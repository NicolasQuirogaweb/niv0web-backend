const wavDurationSec = require('../utils/wavDuration');

// Cabecera WAV canonica de 44 bytes: RIFF/WAVE + chunk "fmt " de 16 + chunk "data".
const wavHeader = ({ sampleRate = 44100, bitsPerSample = 16, channels = 2, dataSize = 176400 } = {}) => {
  const blockAlign = (channels * bitsPerSample) / 8;
  const h = Buffer.alloc(44);
  h.write('RIFF', 0, 'ascii');
  h.writeUInt32LE(36 + dataSize, 4);
  h.write('WAVE', 8, 'ascii');
  h.write('fmt ', 12, 'ascii');
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20);
  h.writeUInt16LE(channels, 22);
  h.writeUInt32LE(sampleRate, 24);
  h.writeUInt32LE(sampleRate * blockAlign, 28);
  h.writeUInt16LE(blockAlign, 32);
  h.writeUInt16LE(bitsPerSample, 34);
  h.write('data', 36, 'ascii');
  h.writeUInt32LE(dataSize, 40);
  return h;
};

describe('wavDurationSec', () => {
  it('reads one second from a 44.1 kHz 16-bit stereo header', () => {
    expect(wavDurationSec(wavHeader())).toBe(1);
  });

  it('rounds to hundredths', () => {
    expect(wavDurationSec(wavHeader({ dataSize: 176400 / 3 }))).toBe(0.33);
  });

  it('skips unknown chunks before data', () => {
    const base = wavHeader();
    const list = Buffer.alloc(8 + 5 + 1); // chunk impar: lleva un byte de padding
    list.write('LIST', 0, 'ascii');
    list.writeUInt32LE(5, 4);
    const withList = Buffer.concat([base.subarray(0, 36), list, base.subarray(36)]);
    expect(wavDurationSec(withList)).toBe(1);
  });

  it('returns null for something that is not a WAV', () => {
    expect(wavDurationSec(Buffer.from('not a wav'))).toBeNull();
  });

  it('returns null when the data chunk is missing', () => {
    expect(wavDurationSec(wavHeader().subarray(0, 36))).toBeNull();
  });
});
