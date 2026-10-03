const request = require('supertest');
const jwt = require('jsonwebtoken');

jest.mock('../models/User');
jest.mock('../models/AudioPreview');
jest.mock('../services/b2Service', () => ({
  ...jest.requireActual('../services/b2Service'),
  uploadToB2: jest.fn(),
  getDownloadLink: jest.fn(),
}));

const User = require('../models/User');
const AudioPreview = require('../models/AudioPreview');
const { uploadToB2, getDownloadLink } = require('../services/b2Service');
const { bucketKeyFromUrl, downloadFilename, attachmentDisposition } = require('../utils/downloadSource');
const { needsPreview, attachPreviews, tryCreatePreview } = require('../services/previewService');
const app = require('../app');

const WAV = 'https://s3.us-east-005.backblazeb2.com/niv0-audios/beats/1786-ab-Mi%20Beat.wav';

afterEach(() => jest.resetAllMocks());

describe('download helpers', () => {
  it.each([
    ['https://s3.us-east-005.backblazeb2.com/niv0-audios/beats/a%20b.wav', 'beats/a b.wav'],
    ['https://f005.backblazeb2.com/file/niv0-audios/beats/a.mp3', 'beats/a.mp3'],
    ['https://niv0-audios.s3.us-east-005.backblazeb2.com/beats/a.mp3', 'beats/a.mp3'],
  ])('extracts the bucket key from %s', (url, key) => {
    expect(bucketKeyFromUrl(url)).toBe(key);
  });

  it('names the file after the track with the real extension', () => {
    expect(downloadFilename('beats/123-x-file.wav', 'Night Drive')).toBe('Night Drive.wav');
    expect(downloadFilename('beats/123-x-file.mp3', 'a/b:c"d')).toBe('a_b_c_d.mp3');
    expect(downloadFilename('beats/123-x-file.wav')).toBe('123-x-file.wav');
  });

  it('keeps accents in filename* and an ASCII fallback in filename', () => {
    expect(attachmentDisposition('Ñandú.wav')).toBe(
      `attachment; filename="Nandu.wav"; filename*=UTF-8''%C3%91and%C3%BA.wav`
    );
  });
});

describe('GET /api/download/link', () => {
  it('rejects URLs outside our bucket', async () => {
    const res = await request(app).get('/api/download/link').query({ url: 'https://evil.com/?x=backblazeb2.com' });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('INVALID_DOWNLOAD_SOURCE');
    expect(getDownloadLink).not.toHaveBeenCalled();
  });

  it('returns a signed link with an attachment disposition named after the track', async () => {
    getDownloadLink.mockResolvedValue('https://f005.backblazeb2.com/file/niv0-audios/beats/x.wav?Authorization=t');
    const res = await request(app).get('/api/download/link').query({ url: WAV, name: 'Mi Beat' });
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.body.data).toEqual({
      url: 'https://f005.backblazeb2.com/file/niv0-audios/beats/x.wav?Authorization=t',
      filename: 'Mi Beat.wav',
    });
    expect(getDownloadLink).toHaveBeenCalledWith('beats/1786-ab-Mi Beat.wav', expect.stringMatching(/^attachment; filename="Mi Beat\.wav"/));
  });

  it('answers 502 (not 500) when B2 refuses to sign', async () => {
    const err = new Error('nope');
    err.statusCode = 502;
    err.code = 'DOWNLOAD_LINK_FAILED';
    getDownloadLink.mockRejectedValue(err);
    const res = await request(app).get('/api/download/link').query({ url: WAV });
    expect(res.status).toBe(502);
    expect(res.body.code).toBe('DOWNLOAD_LINK_FAILED');
  });
});

describe('MP3 previews', () => {
  it('only applies to big WAV files in audio folders', () => {
    const big = 45 * 1024 * 1024;
    expect(needsPreview('a.wav', 'beats', big)).toBe(true);
    expect(needsPreview('a.WAV', 'loops', big)).toBe(true);
    // Los sample packs quedan en su formato original.
    expect(needsPreview('a.wav', 'samples', big)).toBe(false);
    expect(needsPreview('a.mp3', 'beats', big)).toBe(false);
    expect(needsPreview('a.wav', 'images', big)).toBe(false);
    // Un one-shot de 150 KB ya arranca al instante.
    expect(needsPreview('kick.wav', 'samples', 150 * 1024)).toBe(false);
  });

  it('attaches previewFile to WAV items that have one', async () => {
    AudioPreview.find.mockReturnValue({ lean: () => Promise.resolve([{ sourceUrl: WAV, previewUrl: 'https://x/p.mp3' }]) });
    const items = await attachPreviews([{ audioFile: WAV }, { audioFile: 'https://x/b.mp3' }]);
    expect(items[0].previewFile).toBe('https://x/p.mp3');
    expect(items[1].previewFile).toBeUndefined();
  });

  it('does not query when there are no WAVs', async () => {
    await attachPreviews([{ audioFile: 'https://x/b.mp3' }]);
    expect(AudioPreview.find).not.toHaveBeenCalled();
  });

  it('a failed conversion never breaks the upload (returns null)', async () => {
    const file = { originalname: 'roto.wav', buffer: Buffer.alloc(6 * 1024 * 1024) };
    await expect(tryCreatePreview(file, 'beats', WAV)).resolves.toBeNull();
  });

  it('the upload endpoint still answers 200 when the preview fails', async () => {
    User.findOne.mockResolvedValue({ _id: 'u1', googleId: 'g', role: 'admin' });
    uploadToB2.mockResolvedValue({ url: WAV, filename: 'x.wav', size: 10, mimeType: 'audio/wav' });
    const token = jwt.sign({ userId: 'g', role: 'admin' }, process.env.JWT_SECRET);
    const res = await request(app)
      .post('/api/admin/upload')
      .set('Cookie', `accessToken=${token}`)
      .field('folder', 'beats')
      .attach('file', Buffer.from('no es audio'), { filename: 'beat.wav', contentType: 'audio/wav' });
    expect(res.status).toBe(200);
    expect(res.body.data.url).toBe(WAV);
    expect(res.body.data.previewUrl).toBeNull();
  });
});
