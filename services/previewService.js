const { spawn } = require('child_process');
const path = require('path');
const ffmpegPath = require('ffmpeg-static');
const AudioPreview = require('../models/AudioPreview');
const { uploadToB2 } = require('./b2Service');

// Solo vale la pena para formatos pesados; un MP3 ya se reproduce rápido.
const PREVIEW_SOURCE_EXTENSIONS = ['.wav'];
const PREVIEW_FOLDERS = ['beats', 'loops', 'samples'];
const TRANSCODE_TIMEOUT_MS = 120000;

const needsPreview = (fileName, folder) =>
  PREVIEW_FOLDERS.includes(folder) &&
  PREVIEW_SOURCE_EXTENSIONS.includes(path.extname(fileName || '').toLowerCase());

// WAV -> MP3 192 kbps, todo por pipes (sin archivos temporales en disco).
const transcodeToMp3 = (inputBuffer) =>
  new Promise((resolve, reject) => {
    const ff = spawn(ffmpegPath, [
      '-hide_banner', '-loglevel', 'error',
      '-i', 'pipe:0',
      '-vn', '-codec:a', 'libmp3lame', '-b:a', '192k',
      '-f', 'mp3', 'pipe:1',
    ]);
    const chunks = [];
    let stderr = '';
    const timer = setTimeout(() => {
      ff.kill('SIGKILL');
      reject(new Error('ffmpeg timeout'));
    }, TRANSCODE_TIMEOUT_MS);

    ff.stdout.on('data', (c) => chunks.push(c));
    ff.stderr.on('data', (c) => { stderr += c; });
    ff.on('error', (err) => { clearTimeout(timer); reject(err); });
    ff.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0 && chunks.length) return resolve(Buffer.concat(chunks));
      reject(new Error(`ffmpeg exited with ${code}: ${stderr.slice(0, 300)}`));
    });
    ff.stdin.on('error', () => {}); // si ffmpeg corta antes, el error real llega por 'close'
    ff.stdin.end(inputBuffer);
  });

// Genera y registra el preview. Devuelve la URL del MP3.
const createPreview = async (sourceBuffer, originalName, sourceUrl) => {
  const mp3 = await transcodeToMp3(sourceBuffer);
  const base = path.basename(originalName, path.extname(originalName));
  const uploaded = await uploadToB2(mp3, `${base}.mp3`, 'previews', 'audio/mpeg');
  await AudioPreview.findOneAndUpdate(
    { sourceUrl },
    { sourceUrl, previewUrl: uploaded.url },
    { upsert: true, new: true }
  );
  return uploaded.url;
};

// Para el upload: nunca hace fallar la subida. Sin preview se reproduce el original.
const tryCreatePreview = async (file, folder, sourceUrl) => {
  if (!needsPreview(file.originalname, folder)) return null;
  try {
    return await createPreview(file.buffer, file.originalname, sourceUrl);
  } catch (err) {
    console.error('Preview failed:', { file: file.originalname, message: err.message });
    return null;
  }
};

// Agrega previewFile a una lista de items que ya tienen audioFile como URL pública.
const attachPreviews = async (items) => {
  const urls = items.map((i) => i.audioFile).filter((u) => u && /\.wav$/i.test(u));
  if (urls.length === 0) return items;
  const previews = await AudioPreview.find({ sourceUrl: { $in: urls } }).lean();
  const byUrl = Object.fromEntries(previews.map((p) => [p.sourceUrl, p.previewUrl]));
  return items.map((i) => (byUrl[i.audioFile] ? { ...i, previewFile: byUrl[i.audioFile] } : i));
};

module.exports = { needsPreview, transcodeToMp3, createPreview, tryCreatePreview, attachPreviews };
