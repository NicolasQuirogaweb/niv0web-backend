// /api/download funciona como proxy para esquivar CORS al descargar desde B2.
// Solo acepta URLs de nuestro bucket: si no, cualquiera podría usar el server
// para pedir recursos arbitrarios (SSRF).
const B2_HOST_SUFFIX = '.backblazeb2.com';

const isAllowedDownloadUrl = (rawUrl, bucketName = process.env.B2_BUCKET_NAME) => {
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.port) return false;

  const host = url.hostname.toLowerCase();
  if (!host.endsWith(B2_HOST_SUFFIX)) return false;
  if (!bucketName) return false;

  // Formatos de URL pública de B2:
  //   https://f005.backblazeb2.com/file/<bucket>/<key>
  //   https://s3.<region>.backblazeb2.com/<bucket>/<key>
  //   https://<bucket>.s3.<region>.backblazeb2.com/<key>
  const segments = url.pathname.split('/').filter(Boolean);
  return (
    host.startsWith(`${bucketName}.`) ||
    segments[0] === bucketName ||
    (segments[0] === 'file' && segments[1] === bucketName)
  );
};

// Nombre seguro para Content-Disposition: sin comillas, barras ni caracteres de control.
const safeFilename = (rawUrl) => {
  let name = 'download';
  try {
    const last = new URL(rawUrl).pathname.split('/').pop();
    if (last) name = decodeURIComponent(last);
  } catch {
    // nos quedamos con el default
  }
  return name.replace(/[^\w.\- ()]/g, '_').slice(0, 150) || 'download';
};

// Key del archivo dentro del bucket, a partir de cualquiera de los tres formatos de URL.
// Asume que la URL ya pasó por isAllowedDownloadUrl.
const bucketKeyFromUrl = (rawUrl, bucketName = process.env.B2_BUCKET_NAME) => {
  const url = new URL(rawUrl);
  const segments = url.pathname.split('/').filter(Boolean).map(decodeURIComponent);
  if (url.hostname.toLowerCase().startsWith(`${bucketName}.`)) return segments.join('/');
  if (segments[0] === 'file') return segments.slice(2).join('/');
  return segments.slice(1).join('/');
};

// Content-Disposition con fallback ASCII y el nombre real (acentos, ñ) en filename*.
const attachmentDisposition = (filename) => {
  const ascii = filename.normalize('NFD').replace(/[^\x20-\x7e]/g, '').replace(/["\\]/g, '_') || 'download';
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
};

// Nombre que ve el usuario al descargar: el título del tema + la extensión real del archivo.
const downloadFilename = (key, requestedName) => {
  const ext = (key.match(/\.[a-z0-9]{2,4}$/i) || [''])[0].toLowerCase();
  const base = typeof requestedName === 'string' && requestedName.trim()
    ? requestedName.trim()
    : key.split('/').pop().replace(/\.[a-z0-9]{2,4}$/i, '');
  // Caracteres que no van en un nombre de archivo (Windows) y de control.
  const clean = [...base]
    .map((ch) => (ch.charCodeAt(0) < 32 || '\\/:*?"<>|'.includes(ch) ? '_' : ch))
    .join('')
    .replace(/\.[a-z0-9]{2,4}$/i, '')
    .slice(0, 120);
  return `${clean || 'download'}${ext}`;
};

module.exports = { isAllowedDownloadUrl, safeFilename, bucketKeyFromUrl, attachmentDisposition, downloadFilename };
