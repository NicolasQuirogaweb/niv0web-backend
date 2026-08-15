const path = require('path');
const B2 = require('backblaze-b2');

const ALLOWED_MIME_TYPES = {
  'audio/mpeg': { ext: 'mp3', maxSize: 100 * 1024 * 1024 },
  'audio/wav': { ext: 'wav', maxSize: 100 * 1024 * 1024 },
  'audio/x-wav': { ext: 'wav', maxSize: 100 * 1024 * 1024 },
  'image/jpeg': { ext: 'jpg', maxSize: 10 * 1024 * 1024 },
  'image/png': { ext: 'png', maxSize: 10 * 1024 * 1024 },
  'video/mp4': { ext: 'mp4', maxSize: 500 * 1024 * 1024 },
};

const ALLOWED_EXTENSIONS = ['.mp3', '.wav', '.jpg', '.jpeg', '.jpe', '.jfif', '.png', '.mp4'];

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

const validateFile = (mimeType, originalName, size) => {
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
  validateFile(resolvedMimeType, fileName, fileBuffer.length);

  const cleanName = sanitizeFileName(fileName);
  const uniqueName = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}-${cleanName}`;
  const key = `${folder}/${uniqueName}`;
  let lastError;

  for (let attempt = 0; attempt < 3; attempt++) {
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
      const isAuthError = status === 401 || status === 403 || err.code === 'ERR_RATE_LIMIT';
      if (isAuthError) {
        authPromise = null;
        continue;
      }
      if (status === 429 || (status && status >= 500) || err.code === 'ECONNRESET' || err.code === 'ETIMEDOUT') {
        if (attempt < 2) continue;
      }
      if (attempt < 2) continue;
      break;
    }
  }

  lastError.uploadContext = { fileName: uniqueName, key, attempts: 3 };
  throw lastError;
};

module.exports = { uploadToB2, resolveMimeType, ALLOWED_MIME_TYPES, ALLOWED_EXTENSIONS };
