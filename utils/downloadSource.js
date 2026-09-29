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

module.exports = { isAllowedDownloadUrl, safeFilename };
