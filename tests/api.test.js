const request = require('supertest');
const jwt = require('jsonwebtoken');

jest.mock('../models/User');
jest.mock('../models/Playlist');

const User = require('../models/User');
const Playlist = require('../models/Playlist');
const app = require('../app');

const accessToken = (payload = {}) =>
  jwt.sign({ userId: 'google-123', email: 'a@b.com', role: 'user', ...payload }, process.env.JWT_SECRET, {
    expiresIn: '15m',
  });

const refreshToken = (payload = {}) =>
  jwt.sign({ userId: 'google-123', tokenVersion: 0, ...payload }, process.env.JWT_REFRESH_SECRET, {
    expiresIn: '7d',
  });

afterEach(() => jest.resetAllMocks());

describe('GET /health', () => {
  it('responds even when the database is down', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });
});

describe('admin auth', () => {
  it('returns 401 without a token', async () => {
    const res = await request(app).get('/api/admin/dashboard');
    expect(res.status).toBe(401);
    expect(res.body).toMatchObject({ success: false, code: 'UNAUTHORIZED' });
  });

  it('returns 401 for a token signed with another secret', async () => {
    const forged = jwt.sign({ userId: 'google-123', role: 'admin' }, 'not-the-real-secret');
    const res = await request(app).get('/api/admin/dashboard').set('Cookie', `accessToken=${forged}`);
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('INVALID_TOKEN');
  });

  it('returns 403 when the user in the database is not an admin, whatever the token says', async () => {
    User.findOne.mockResolvedValue({ _id: 'u1', googleId: 'google-123', role: 'user' });
    const res = await request(app)
      .get('/api/admin/dashboard')
      .set('Cookie', `accessToken=${accessToken({ role: 'admin' })}`);
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('FORBIDDEN');
  });
});

describe('admin validation', () => {
  beforeEach(() => {
    User.findOne.mockResolvedValue({ _id: 'u1', googleId: 'google-123', role: 'admin' });
  });

  it('rejects an empty title on playlist update', async () => {
    const res = await request(app)
      .put('/api/admin/playlists/66a000000000000000000001')
      .set('Cookie', `accessToken=${accessToken()}`)
      .send({ title: '   ' });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
    expect(Playlist.findByIdAndUpdate).not.toHaveBeenCalled();
  });

  it('rejects a title longer than 100 characters on playlist update', async () => {
    const res = await request(app)
      .put('/api/admin/playlists/66a000000000000000000001')
      .set('Cookie', `accessToken=${accessToken()}`)
      .send({ title: 'x'.repeat(101) });
    expect(res.status).toBe(400);
  });

  it('refuses to add a beat to a loops playlist', async () => {
    Playlist.findById.mockReturnValue({ lean: () => Promise.resolve({ _id: 'p1', type: 'loops' }) });
    const res = await request(app)
      .post('/api/admin/playlists/66a000000000000000000001/beats')
      .set('Cookie', `accessToken=${accessToken()}`)
      .send({ title: 'Beat', audioFile: 'https://f005.backblazeb2.com/file/niv0-audios/a.mp3' });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('WRONG_PLAYLIST_TYPE');
  });

  it('rejects uploads to a folder outside the allowlist', async () => {
    const res = await request(app)
      .post('/api/admin/upload')
      .set('Cookie', `accessToken=${accessToken()}`)
      .field('folder', '../../etc')
      .attach('file', Buffer.from('fake'), 'a.mp3');
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('INVALID_FOLDER');
  });
});

describe('GET /api/download', () => {
  it('rejects hosts outside our bucket', async () => {
    const res = await request(app).get('/api/download').query({ url: 'https://evil.com/?x=backblazeb2.com' });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('INVALID_DOWNLOAD_SOURCE');
  });

  it('requires the url parameter', async () => {
    const res = await request(app).get('/api/download');
    expect(res.status).toBe(400);
  });
});

describe('POST /api/auth/refresh', () => {
  it('rejects a refresh token issued before the last logout', async () => {
    User.findOne.mockResolvedValue({ googleId: 'google-123', tokenVersion: 3 });
    const res = await request(app)
      .post('/api/auth/refresh')
      .set('Cookie', `refreshToken=${refreshToken({ tokenVersion: 2 })}`);
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('SESSION_REVOKED');
  });

  it('rotates both cookies when the token is current', async () => {
    User.findOne.mockResolvedValue({ googleId: 'google-123', email: 'a@b.com', role: 'user', tokenVersion: 0 });
    const res = await request(app).post('/api/auth/refresh').set('Cookie', `refreshToken=${refreshToken()}`);
    expect(res.status).toBe(200);
    const cookies = res.headers['set-cookie'].join(';');
    expect(cookies).toMatch(/accessToken=/);
    expect(cookies).toMatch(/refreshToken=/);
    expect(res.body.data).not.toHaveProperty('token');
  });
});

describe('POST /api/auth/google-login', () => {
  it('rejects a Google token that was not issued for our client id', async () => {
    const res = await request(app).post('/api/auth/google-login').send({ credential: 'not-a-real-google-token' });
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('INVALID_GOOGLE_TOKEN');
  });
});

describe('CORS', () => {
  it('returns 403 (not 500) for an origin that is not allowed', async () => {
    const res = await request(app).get('/health').set('Origin', 'https://evil.com');
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('CORS_NOT_ALLOWED');
  });
});
