const HEADER_LIMIT = 64 * 1024;

/**
 * Duration of a RIFF/WAVE file from its first bytes: size of the `data` chunk
 * divided by the `byteRate` of the `fmt ` chunk, rounded to 0.01 s.
 * Returns null when the buffer is not a WAV or either chunk is not within the
 * first 64 KB.
 */
const wavDurationSec = (header) => {
  if (!Buffer.isBuffer(header) || header.length < 12) return null;
  if (header.toString('ascii', 0, 4) !== 'RIFF' || header.toString('ascii', 8, 12) !== 'WAVE') return null;

  const end = Math.min(header.length, HEADER_LIMIT);
  let byteRate = null;
  let offset = 12;
  while (offset + 8 <= end) {
    const id = header.toString('ascii', offset, offset + 4);
    const size = header.readUInt32LE(offset + 4);
    if (id === 'fmt ') {
      if (offset + 20 > end) return null;
      byteRate = header.readUInt32LE(offset + 16);
    } else if (id === 'data') {
      // 0xFFFFFFFF = tamaño desconocido (WAV grabado en streaming o RF64)
      if (!byteRate || size === 0xffffffff) return null;
      return Math.round((size / byteRate) * 100) / 100;
    }
    offset += 8 + size + (size % 2); // los chunks impares llevan un byte de padding
  }
  return null;
};

module.exports = wavDurationSec;
module.exports.HEADER_LIMIT = HEADER_LIMIT;
