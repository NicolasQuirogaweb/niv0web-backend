const path = require('path');
const { Transform, pipeline } = require('stream');
const archiver = require('archiver');
const axios = require('axios');
const defaultB2 = require('./b2Service');
const DefaultSamplePack = require('../models/SamplePack');
const DefaultSamples = require('../models/Samples');
const buildPublicUrl = require('../utils/buildPublicUrl');
const wavDurationSec = require('../utils/wavDuration');
const { ZIP_BUILD_TIMEOUT_MS } = require('../utils/samplePacks');

const { HEADER_LIMIT } = wavDurationSec;
const ZIP_CACHE_CONTROL = 'public, max-age=31536000, immutable';
const HTTP_TIMEOUT_MS = 60 * 1000;
// Una descarga que deja de mandar bytes (sin que la subida la frene) se corta.
const SOURCE_IDLE_TIMEOUT_MS = 60 * 1000;
// Tras abortar, cuanto se espera a que la subida cancele el large file.
const CANCEL_WAIT_MS = 30 * 1000;

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
// leer la duracion del WAV sin descargarlo dos veces. onChunk alimenta el
// timer de inactividad.
const headerTap = () => {
  const head = [];
  let headBytes = 0;
  const tap = new Transform({
    transform(chunk, _enc, cb) {
      if (tap.onChunk) tap.onChunk();
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

const SILENT_CODES = ['ZIP_SOURCE_IDLE', 'ECONNABORTED', 'ETIMEDOUT'];
// "404", "sin respuesta" o el mensaje del error de descarga.
const downloadReason = (err) => {
  const status = err && err.response && err.response.status;
  if (status) return String(status);
  if (err && SILENT_CODES.includes(err.code)) return 'sin respuesta';
  return (err && err.message) || 'error de descarga';
};

// Espera una promesa como mucho `ms` (sin rechazar nunca).
const settle = (promise, ms) => {
  let timer;
  const limit = new Promise((resolve) => {
    timer = setTimeout(resolve, ms);
  });
  return Promise.race([promise.catch(() => {}), limit]).finally(() => clearTimeout(timer));
};

const successSet = (result, builtAt, stale) => ({
  $set: {
    'zip.url': result.url,
    'zip.key': result.key,
    'zip.fileId': result.fileId,
    'zip.bytes': result.bytes,
    'zip.builtAt': builtAt,
    'zip.stale': stale,
    'zip.build': { status: 'idle', startedAt: null, error: null },
  },
});

/**
 * Builds the pack ZIP: streams every sample from B2 through archiver (store
 * mode) straight into a B2 large-file upload, then points `pack.zip` at it and
 * deletes the ZIP it replaced. On failure only `zip.build` is touched, so the
 * previous ZIP keeps being served. Never rejects: the outcome is in the pack.
 *
 * `claim.startedAt` is the `zip.build.startedAt` the caller wrote when it
 * claimed the build. **Callers that start builds in the background must pass
 * it**: with a claim, the final success/failure updates only apply while the
 * pack still carries that `startedAt`. A superseded build deletes its own new
 * file instead of touching the pack, and an edit made during the build
 * (`zip.staleAt` later than `startedAt`) leaves `zip.stale: true`. Without a
 * claim the updates are unconditional.
 *
 * `deps.idleTimeoutMs` / `deps.buildTimeoutMs` override the per-download idle
 * limit and the overall cap (ZIP_BUILD_TIMEOUT_MS).
 */
const buildPackZip = async (packId, deps = {}, claim = null) => {
  const {
    b2 = defaultB2,
    http = axios,
    SamplePack = DefaultSamplePack,
    Samples = DefaultSamples,
    now = () => new Date(),
    idleTimeoutMs = SOURCE_IDLE_TIMEOUT_MS,
    buildTimeoutMs = ZIP_BUILD_TIMEOUT_MS,
  } = deps;

  const owned = claim ? { _id: packId, 'zip.build.startedAt': claim.startedAt } : { _id: packId };
  const savedAs = { new: false, projection: { zip: 1 } };

  let archive = null;
  let source = null; // descarga en curso, para cerrar el socket si el build falla
  let upload = null;
  let uploaded = null; // ZIP nuevo ya subido pero todavia no guardado en el pack
  let deadlineTimer;
  const deadline = new Promise((_resolve, reject) => {
    deadlineTimer = setTimeout(() => reject(buildError('se supero el tiempo maximo de armado')), buildTimeoutMs);
  });
  deadline.catch(() => {});

  try {
    const pack = await Promise.race([SamplePack.findById(packId).lean(), deadline]);
    if (!pack) throw buildError('el pack no existe');
    const samples = await Promise.race([Samples.find({ samplepackId: packId }).lean(), deadline]);
    if (!samples.length) throw buildError('el pack no tiene samples');
    const entries = zipEntries(pack, samples);

    const startedAt = now();
    // Los packs viejos pueden no tener slug.
    const key = `samplepacks/${pack.slug || String(pack._id)}-${startedAt.getTime().toString(36)}.zip`;

    archive = archiver('zip', { store: true });
    // Sin un listener propio, un 'error' emitido cuando la subida ya dejo de
    // leer tiraria el proceso. Quien lo atiende es la subida (for await) o la
    // promesa de cada entrada.
    archive.on('error', () => {});
    archive.on('warning', (err) => archive.destroy(err));

    upload = b2.uploadLargeStream(archive, key, { mime: 'application/zip', cacheControl: ZIP_CACHE_CONTROL });
    // Si la subida falla a mitad de camino nadie consume el archive: cada paso
    // compite con este rechazo (y con el tope total) para no quedar colgado.
    const uploadFailed = upload.then(
      () => new Promise(() => {}),
      (err) => {
        throw buildError(err.message || 'error al subir el ZIP', err);
      }
    );
    uploadFailed.catch(() => {});
    const step = (promise) => Promise.race([promise, uploadFailed, deadline]);

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
            let idleTimer;
            const arm = () => {
              clearTimeout(idleTimer);
              idleTimer = setTimeout(onIdle, idleTimeoutMs);
            };
            const onIdle = () => {
              // Si la que frena es la subida (backpressure), la descarga no esta colgada.
              if (tap.writableNeedDrain || (typeof source.isPaused === 'function' && source.isPaused())) return arm();
              source.destroy(Object.assign(new Error('sin respuesta'), { code: 'ZIP_SOURCE_IDLE' }));
            };
            const cleanup = () => {
              clearTimeout(idleTimer);
              tap.onChunk = null;
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
            tap.onChunk = arm;
            arm();
            archive.on('entry', onEntry);
            archive.on('error', onError);
            // archiver no propaga errores del stream de entrada: pipeline si.
            pipeline(source, tap, (err) => err && onError(err));
            archive.append(tap, { name: entry.name });
          })
        );
      } catch (err) {
        if (isBuildError(err)) throw err;
        throw buildError(`${title} (${downloadReason(err)})`, err);
      }
      source = null;
      const durationSec = tap.durationSec();
      if (durationSec != null) durations.push({ sampleId: entry.sampleId, durationSec });
    }

    await step(archive.finalize());
    const result = await step(
      upload.catch((err) => {
        throw buildError(err.message || 'error al subir el ZIP', err);
      })
    );
    uploaded = result;
    const builtAt = now();

    let before;
    if (!claim) {
      before = await SamplePack.findOneAndUpdate(owned, successSet(result, builtAt, false), savedAs).lean();
    } else {
      // Dos updates condicionales, cada uno atomico: si nadie edito el pack
      // despues de reclamar el build queda fresco; si no, queda stale. Una
      // edicion posterior a estos updates marca stale por su cuenta.
      before = await SamplePack.findOneAndUpdate(
        { ...owned, $or: [{ 'zip.staleAt': null }, { 'zip.staleAt': { $lte: claim.startedAt } }] },
        successSet(result, builtAt, false),
        savedAs
      ).lean();
      if (!before) before = await SamplePack.findOneAndUpdate(owned, successSet(result, builtAt, true), savedAs).lean();
    }

    if (!before) {
      // Otro build tomo el pack (o se borro): este ZIP no lo referencia nadie.
      console.error('Pack ZIP build superseded, discarding its file:', { packId: String(packId), key: result.key });
      uploaded = null;
      await b2.deleteFile(result.key, result.fileId).catch((err) => {
        console.error('Superseded pack ZIP not deleted:', { key: result.key, message: err.message });
      });
      return;
    }
    uploaded = null;

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

    // Se borra el ZIP que este update reemplazo (no el leido al empezar).
    const previous = before.zip;
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
    // Destruir el archive hace que la subida cancele el large file: se espera
    // (acotado) para no dejar trabajo colgando despues de registrar el fallo.
    if (upload) await settle(upload, CANCEL_WAIT_MS);
    if (uploaded) {
      await b2.deleteFile(uploaded.key, uploaded.fileId).catch(() => {});
    }
    const message = isBuildError(err) ? err.message : buildError(err.message || 'error desconocido').message;
    console.error('Pack ZIP build failed:', { packId: String(packId), message, cause: err.cause?.message });
    try {
      await SamplePack.updateOne(owned, { $set: { 'zip.build.status': 'failed', 'zip.build.error': message } });
    } catch (dbErr) {
      console.error('Pack ZIP failure not saved:', { packId: String(packId), message: dbErr.message });
    }
  } finally {
    clearTimeout(deadlineTimer);
  }
};

module.exports = { zipEntries, buildPackZip, safe, ZIP_CACHE_CONTROL, SOURCE_IDLE_TIMEOUT_MS };
