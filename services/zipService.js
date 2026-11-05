const path = require('path');
const { Transform, pipeline } = require('stream');
const archiver = require('archiver');
const axios = require('axios');
const defaultB2 = require('./b2Service');
const DefaultSamplePack = require('../models/SamplePack');
const DefaultSamples = require('../models/Samples');
const buildPublicUrl = require('../utils/buildPublicUrl');
const wavDurationSec = require('../utils/wavDuration');

const { HEADER_LIMIT } = wavDurationSec;
const ZIP_CACHE_CONTROL = 'public, max-age=31536000, immutable';
const HTTP_TIMEOUT_MS = 60 * 1000;

// Caracteres invalidos en nombres de archivo de Windows/macOS y de control.
// eslint-disable-next-line no-control-regex
const UNSAFE_CHARS = /[\\/:*?"<>|\u0000-\u001f\u007f]/g;

const safe = (value) => {
  const clean = String(value ?? '').replace(UNSAFE_CHARS, '_').trim();
  // "", "." o ".." no pueden ser un segmento de ruta dentro del ZIP.
  return clean && !/^\.+$/.test(clean) ? clean : '_';
};

const extensionOf = (audioFile) => {
  const pathname = String(audioFile || '').split(/[?#]/)[0];
  const ext = path.posix.extname(pathname);
  return /^\.[a-z0-9]{1,5}$/i.test(ext) ? ext : '.wav';
};

const titleCompare = (a, b) => String(a.title).localeCompare(String(b.title), undefined, { numeric: true, sensitivity: 'base' });

/**
 * Archive entries for a pack: pack folder order, then title (numeric compare).
 * Names are `pack/folder/title.ext`; duplicates (case-insensitive, since most
 * desktop file systems are) get " (2)", " (3)"...
 * @returns {Array<{ name: string, url: string, sampleId: any }>}
 */
const zipEntries = (pack, samples) => {
  const order = new Map((pack.folders || []).map((f, i) => [f, i]));
  const folderRank = (s) => (order.has(s.folder) ? order.get(s.folder) : order.size);
  const sorted = [...samples].sort(
    (a, b) => folderRank(a) - folderRank(b) || String(a.folder).localeCompare(String(b.folder)) || titleCompare(a, b)
  );

  const packDir = safe(pack.title);
  const used = new Set();
  return sorted.map((s) => {
    const base = `${packDir}/${safe(s.folder)}/${safe(s.title)}`;
    const ext = extensionOf(s.audioFile);
    let name = `${base}${ext}`;
    for (let n = 2; used.has(name.toLowerCase()); n += 1) name = `${base} (${n})${ext}`;
    used.add(name.toLowerCase());
    return { name, url: buildPublicUrl(s.audioFile), sampleId: s._id };
  });
};

// Deja pasar el audio tal cual y guarda una copia de los primeros bytes para
// leer la duracion del WAV sin descargarlo dos veces.
const headerTap = () => {
  const head = [];
  let headBytes = 0;
  const tap = new Transform({
    transform(chunk, _enc, cb) {
      if (headBytes < HEADER_LIMIT) {
        const part = chunk.subarray(0, HEADER_LIMIT - headBytes);
        head.push(Buffer.from(part));
        headBytes += part.length;
      }
      cb(null, chunk);
    },
  });
  tap.durationSec = () => wavDurationSec(Buffer.concat(head, headBytes));
  return tap;
};

const buildError = (reason, cause) =>
  Object.assign(new Error(`No se pudo armar el ZIP: ${reason}`), { cause, isZipBuildError: true });
const isBuildError = (err) => Boolean(err && err.isZipBuildError);

/**
 * Builds the pack ZIP: streams every sample from B2 through archiver (store
 * mode) straight into a B2 large-file upload, then points `pack.zip` at it and
 * deletes the previous ZIP. On failure only `zip.build` is touched, so the
 * previous ZIP keeps being served. Never rejects: the outcome is in the pack.
 */
const buildPackZip = async (packId, deps = {}) => {
  const {
    b2 = defaultB2,
    http = axios,
    SamplePack = DefaultSamplePack,
    Samples = DefaultSamples,
    now = () => new Date(),
  } = deps;

  let archive = null;
  let source = null; // descarga en curso, para cerrar el socket si el build falla
  try {
    const pack = await SamplePack.findById(packId).lean();
    if (!pack) throw buildError('el pack no existe');
    const samples = await Samples.find({ samplepackId: packId }).lean();
    if (!samples.length) throw buildError('el pack no tiene samples');
    const entries = zipEntries(pack, samples);

    const startedAt = now();
    const key = `samplepacks/${pack.slug}-${startedAt.getTime().toString(36)}.zip`;

    archive = archiver('zip', { store: true });
    // Sin un listener propio, un 'error' emitido cuando la subida ya dejo de
    // leer tiraria el proceso. Quien lo atiende es la subida (for await) o la
    // promesa de cada entrada.
    archive.on('error', () => {});
    archive.on('warning', (err) => archive.destroy(err));

    const upload = b2.uploadLargeStream(archive, key, { mime: 'application/zip', cacheControl: ZIP_CACHE_CONTROL });
    // Si la subida falla a mitad de camino nadie consume el archive: cada paso
    // compite con este rechazo para no quedar colgado.
    const uploadFailed = upload.then(
      () => new Promise(() => {}),
      (err) => {
        throw buildError(err.message || 'error al subir el ZIP', err);
      }
    );
    uploadFailed.catch(() => {});
    const step = (promise) => Promise.race([promise, uploadFailed]);

    const byId = new Map(samples.map((s) => [s._id, s]));
    const durations = [];
    for (const entry of entries) {
      const title = byId.get(entry.sampleId)?.title ?? entry.name;
      let tap;
      try {
        const res = await step(http.get(entry.url, { responseType: 'stream', timeout: HTTP_TIMEOUT_MS }));
        source = res.data;
        tap = headerTap();
        await step(
          new Promise((resolve, reject) => {
            const cleanup = () => {
              archive.off('entry', onEntry);
              archive.off('error', onError);
            };
            const onEntry = () => {
              cleanup();
              resolve();
            };
            const onError = (err) => {
              cleanup();
              reject(err);
            };
            archive.on('entry', onEntry);
            archive.on('error', onError);
            // archiver no propaga errores del stream de entrada: pipeline si.
            pipeline(res.data, tap, (err) => err && onError(err));
            archive.append(tap, { name: entry.name });
          })
        );
      } catch (err) {
        if (isBuildError(err)) throw err;
        throw buildError(title, err);
      }
      const durationSec = tap.durationSec();
      if (durationSec != null) durations.push({ sampleId: entry.sampleId, durationSec });
    }

    await step(archive.finalize());
    const result = await upload.catch((err) => {
      throw buildError(err.message || 'error al subir el ZIP', err);
    });

    await SamplePack.updateOne(
      { _id: packId },
      {
        $set: {
          zip: {
            url: result.url,
            key: result.key,
            fileId: result.fileId,
            bytes: result.bytes,
            builtAt: now(),
            stale: false,
            build: { status: 'idle', startedAt: null, error: null },
          },
        },
      }
    );

    if (durations.length) {
      try {
        await Samples.bulkWrite(
          durations.map(({ sampleId, durationSec }) => ({
            updateOne: { filter: { _id: sampleId }, update: { $set: { durationSec } } },
          }))
        );
      } catch (err) {
        console.error('Sample durations not saved:', { packId: String(packId), message: err.message });
      }
    }

    const previous = pack.zip;
    if (previous && previous.fileId && previous.key && previous.fileId !== result.fileId) {
      try {
        await b2.deleteFile(previous.key, previous.fileId);
      } catch (err) {
        // El ZIP nuevo ya esta guardado: el viejo queda huerfano en B2, no es un fallo del build.
        console.error('Previous pack ZIP not deleted:', { key: previous.key, message: err.message });
      }
    }
  } catch (err) {
    if (source && !source.destroyed) source.destroy();
    if (archive && !archive.destroyed) archive.destroy(err);
    const message = isBuildError(err) ? err.message : buildError(err.message || 'error desconocido').message;
    console.error('Pack ZIP build failed:', { packId: String(packId), message, cause: err.cause?.message });
    try {
      await SamplePack.updateOne(
        { _id: packId },
        { $set: { 'zip.build.status': 'failed', 'zip.build.error': message } }
      );
    } catch (dbErr) {
      console.error('Pack ZIP failure not saved:', { packId: String(packId), message: dbErr.message });
    }
  }
};

module.exports = { zipEntries, buildPackZip, safe, ZIP_CACHE_CONTROL };
