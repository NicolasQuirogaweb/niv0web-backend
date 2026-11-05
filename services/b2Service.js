const path = require('path');
const crypto = require('crypto');
const B2 = require('backblaze-b2');

const ALLOWED_MIME_TYPES = {
  'audio/mpeg': { ext: 'mp3', maxSize: 100 * 1024 * 1024 },
  'audio/wav': { ext: 'wav', maxSize: 100 * 1024 * 1024 },
  'audio/x-wav': { ext: 'wav', maxSize: 100 * 1024 * 1024 },
  'image/jpeg': { ext: 'jpg', maxSize: 10 * 1024 * 1024 },
  'image/png': { ext: 'png', maxSize: 10 * 1024 * 1024 },
  'image/gif': { ext: 'gif', maxSize: 20 * 1024 * 1024 },
  'video/mp4': { ext: 'mp4', maxSize: 100 * 1024 * 1024 }, // tope real: multer corta en 100 MB
};

const ALLOWED_EXTENSIONS = ['.mp3', '.wav', '.jpg', '.jpeg', '.jpe', '.jfif', '.png', '.gif', '.mp4'];

// Distintos browsers/SO reportan mimetypes inconsistentes (o ninguno) para
// estas extensiones JPEG legacy — la extensión manda por sobre el mimetype
// que haya mandado el cliente.
const JPEG_EXTENSIONS = ['.jpg', '.jpeg', '.jpe', '.jfif'];

const resolveMimeType = (originalName, reportedMimeType) => {
  const ext = path.extname(originalName || '').toLowerCase();
  if (JPEG_EXTENSIONS.includes(ext)) return 'image/jpeg';
  return reportedMimeType;
};

const b2 = new B2({
  applicationKeyId: process.env.B2_KEY_ID,
  applicationKey: process.env.B2_APPLICATION_KEY,
});

let authPromise = null;

const MAX_ATTEMPTS = 3;
const RETRY_BASE_MS = 500;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const authorize = async () => {
  if (!authPromise) {
    authPromise = b2.authorize().finally(() => {
      authPromise = null;
    });
  }
  return authPromise;
};

const sanitizeFileName = (fileName) => {
  const ext = ALLOWED_EXTENSIONS.find((e) => fileName.toLowerCase().endsWith(e)) || '';
  const base = ext ? fileName.slice(0, -ext.length) : fileName;
  const clean = base.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 100);
  return `${clean}${ext}`;
};

const validateFile = (mimeType, size) => {
  const typeConfig = ALLOWED_MIME_TYPES[mimeType];
  if (!typeConfig) {
    const err = new Error(`Tipo de archivo no permitido: ${mimeType}`);
    err.statusCode = 400;
    err.code = 'INVALID_FILE_TYPE';
    throw err;
  }
  if (size > typeConfig.maxSize) {
    const maxMb = typeConfig.maxSize / (1024 * 1024);
    const err = new Error(`Archivo demasiado grande (máx ${maxMb}MB)`);
    err.statusCode = 400;
    err.code = 'FILE_TOO_LARGE';
    throw err;
  }
};

const uploadToB2 = async (fileBuffer, fileName, folder = 'uploads', mimeType = 'application/octet-stream') => {
  const resolvedMimeType = resolveMimeType(fileName, mimeType);
  validateFile(resolvedMimeType, fileBuffer.length);

  const cleanName = sanitizeFileName(fileName);
  const uniqueName = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}-${cleanName}`;
  const key = `${folder}/${uniqueName}`;
  let lastError;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    try {
      await authorize();
      const { data: uploadUrl } = await b2.getUploadUrl({ bucketId: process.env.B2_BUCKET_ID });

      await b2.uploadFile({
        uploadUrl: uploadUrl.uploadUrl,
        uploadAuthToken: uploadUrl.authorizationToken,
        fileName: key,
        data: fileBuffer,
        mime: resolvedMimeType,
      });

      const url = `${process.env.B2_PUBLIC_URL}/${process.env.B2_BUCKET_NAME}/${key}`;

      return { url, filename: uniqueName, size: fileBuffer.length, mimeType: resolvedMimeType };
    } catch (err) {
      lastError = err;
      const status = err.response?.status;
      // Un 401/403 suele ser el token de autorización vencido: se fuerza re-authorize.
      if (status === 401 || status === 403) authPromise = null;
      // B2 recomienda pedir una upload URL nueva y esperar antes de reintentar.
      if (attempt < MAX_ATTEMPTS - 1) await sleep(RETRY_BASE_MS * 2 ** attempt);
    }
  }

  console.error('B2 upload failed:', {
    fileName: uniqueName,
    key,
    attempts: MAX_ATTEMPTS,
    status: lastError.response?.status,
    data: lastError.response?.data,
    message: lastError.message,
  });

  const uploadError = new Error('Error al subir el archivo al almacenamiento');
  uploadError.statusCode = 502;
  uploadError.code = 'STORAGE_UPLOAD_FAILED';
  uploadError.cause = lastError;
  throw uploadError;
};

// Link de descarga directa desde B2, válido unos minutos y con Content-Disposition
// "attachment": el navegador lo baja con su propia barra de progreso, sin pasar
// el archivo por este servidor. Requiere que la key tenga la capability shareFiles.
const DOWNLOAD_LINK_TTL_SECONDS = 300;

const getDownloadLink = async (key, disposition) => {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      if (!b2.authorizationToken || attempt > 0) await authorize();
      const { data } = await b2.getDownloadAuthorization({
        bucketId: process.env.B2_BUCKET_ID,
        fileNamePrefix: key,
        validDurationInSeconds: DOWNLOAD_LINK_TTL_SECONDS,
        b2ContentDisposition: disposition,
      });
      const encodedKey = key.split('/').map(encodeURIComponent).join('/');
      const params = new URLSearchParams({
        Authorization: data.authorizationToken,
        b2ContentDisposition: disposition,
      });
      return `${b2.downloadUrl}/file/${process.env.B2_BUCKET_NAME}/${encodedKey}?${params}`;
    } catch (err) {
      const status = err.response?.status;
      // Token de cuenta vencido: se reautoriza una vez y se reintenta.
      if ((status === 401 || status === 403) && attempt === 0) continue;
      const linkError = new Error('No se pudo generar el link de descarga');
      linkError.statusCode = 502;
      linkError.code = 'DOWNLOAD_LINK_FAILED';
      linkError.cause = err;
      throw linkError;
    }
  }
};

// Archivos grandes (ZIPs de packs) se suben en partes de 10 MB: B2 exige partes
// de al menos 5 MB salvo la ultima, y en Render Free (512 MB) solo se mantiene
// una parte en memoria a la vez.
const PART_SIZE = 10 * 1024 * 1024;

const sha1Hex = (buf) => crypto.createHash('sha1').update(buf).digest('hex');

const publicUrlForKey = (key) => `${process.env.B2_PUBLIC_URL}/${process.env.B2_BUCKET_NAME}/${key}`;

// Igual que uploadToB2: hasta MAX_ATTEMPTS intentos con backoff, y un 401/403
// fuerza re-authorize antes del siguiente intento.
const withRetry = async (fn) => {
  let lastError;
  let needsAuth = false;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    try {
      if (needsAuth) await authorize();
      return await fn();
    } catch (err) {
      lastError = err;
      const status = err.response?.status;
      needsAuth = status === 401 || status === 403;
      if (attempt < MAX_ATTEMPTS - 1) await sleep(RETRY_BASE_MS * 2 ** attempt);
    }
  }
  throw lastError;
};

/**
 * Streams `readable` to B2 under `key` without holding the whole file in memory.
 * Up to PART_SIZE bytes are buffered at a time; anything that fits in one part
 * goes up with a plain uploadFile. On failure the large file is cancelled and a
 * STORAGE_UPLOAD_FAILED error is thrown.
 * @returns {Promise<{ url: string, key: string, bytes: number, fileId: string }>}
 */
const uploadLargeStream = async (readable, key, { mime = 'application/octet-stream', cacheControl } = {}) => {
  const fileInfo = cacheControl ? { 'b2-cache-control': cacheControl } : {};
  let fileId = null;
  const partSha1Array = [];
  let chunks = [];
  let buffered = 0;
  let bytes = 0;

  const uploadPart = async (data) => {
    const partNumber = partSha1Array.length + 1;
    const hash = sha1Hex(data);
    await withRetry(async () => {
      // B2 recomienda pedir una URL de parte nueva en cada reintento.
      const { data: part } = await b2.getUploadPartUrl({ fileId });
      await b2.uploadPart({
        partNumber,
        uploadUrl: part.uploadUrl,
        uploadAuthToken: part.authorizationToken,
        data,
        hash,
      });
    });
    partSha1Array.push(hash);
  };

  try {
    await authorize();
    for await (const chunk of readable) {
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      chunks.push(buf);
      buffered += buf.length;
      bytes += buf.length;
      // Se corta una parte solo cuando sobra algo despues: asi la ultima parte
      // nunca queda vacia y un large file siempre tiene 2 partes o mas.
      while (buffered > PART_SIZE) {
        const all = Buffer.concat(chunks, buffered);
        chunks = [Buffer.from(all.subarray(PART_SIZE))]; // copia: libera el buffer grande
        buffered -= PART_SIZE;
        if (!fileId) {
          const { data } = await withRetry(() =>
            b2.startLargeFile({
              bucketId: process.env.B2_BUCKET_ID,
              fileName: key,
              contentType: mime,
              // backblaze-b2 1.7.1 no reenvia fileInfo en startLargeFile.
              axiosOverride: { data: { fileInfo } },
            })
          );
          fileId = data.fileId;
        }
        await uploadPart(all.subarray(0, PART_SIZE));
      }
    }

    const rest = Buffer.concat(chunks, buffered);
    chunks = []; // suelta los chunks: `rest` ya tiene la copia

    if (!fileId) {
      const { data } = await withRetry(async () => {
        const { data: up } = await b2.getUploadUrl({ bucketId: process.env.B2_BUCKET_ID });
        return b2.uploadFile({
          uploadUrl: up.uploadUrl,
          uploadAuthToken: up.authorizationToken,
          fileName: key,
          data: rest,
          mime,
          info: fileInfo,
        });
      });
      return { url: publicUrlForKey(key), key, bytes, fileId: data.fileId };
    }

    await uploadPart(rest);
    await withRetry(() => b2.finishLargeFile({ fileId, partSha1Array }));
    return { url: publicUrlForKey(key), key, bytes, fileId };
  } catch (err) {
    if (typeof readable.destroy === 'function' && !readable.destroyed) readable.destroy();
    if (fileId) {
      try {
        await b2.cancelLargeFile({ fileId });
      } catch (cancelErr) {
        console.error('B2 cancelLargeFile failed:', { key, fileId, message: cancelErr.message });
      }
    }
    console.error('B2 large upload failed:', {
      key,
      status: err.response?.status,
      data: err.response?.data,
      message: err.message,
    });
    const uploadError = new Error('Error al subir el archivo al almacenamiento');
    uploadError.statusCode = 502;
    uploadError.code = 'STORAGE_UPLOAD_FAILED';
    uploadError.cause = err;
    throw uploadError;
  }
};

const deleteFile = async (key, fileId) => {
  await authorize();
  await withRetry(() => b2.deleteFileVersion({ fileId, fileName: key }));
};

module.exports = {
  uploadToB2,
  getDownloadLink,
  uploadLargeStream,
  deleteFile,
  PART_SIZE,
  resolveMimeType,
  ALLOWED_MIME_TYPES,
  ALLOWED_EXTENSIONS,
};
