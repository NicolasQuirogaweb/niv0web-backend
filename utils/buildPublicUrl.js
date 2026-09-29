// Los documentos viejos guardan paths relativos ("beats/tema.mp3"), los nuevos
// guardan la URL completa que devuelve uploadToB2. Esto normaliza ambos casos.
const buildPublicUrl = (filePath) => {
  if (!filePath) return null;
  if (filePath.startsWith('http')) return filePath;
  const clean = filePath.replace(/^\/+/, '');
  const encoded = clean.split('/').map(encodeURIComponent).join('/');
  return `${process.env.B2_PUBLIC_URL}/${process.env.B2_BUCKET_NAME}/${encoded}`;
};

module.exports = buildPublicUrl;
