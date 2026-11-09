// The strict auth limit (20 every 15 min per IP) protects the Google login. Checking the
// session happens on every page load, so it must not count: a user who reloads ~20 times
// used to get logged out and then could not log in again.
const request = require('supertest');

jest.mock('../models/User');
// Rechazo inmediato del token, sin ir a buscar los certificados de Google en cada intento.
jest.mock('google-auth-library', () => ({
  OAuth2Client: jest.fn().mockImplementation(() => ({ verifyIdToken: jest.fn().mockRejectedValue(new Error('bad token')) })),
}));
const app = require('../app');

describe('auth rate limit', () => {
  it('never blocks the session check, however many pages a user opens', async () => {
    for (let i = 0; i < 25; i += 1) {
      const res = await request(app).get('/api/auth/verify-token');
      expect(res.status).not.toBe(429);
    }
  });

  it('never blocks the token refresh either', async () => {
    for (let i = 0; i < 25; i += 1) {
      const res = await request(app).post('/api/auth/refresh');
      expect(res.status).not.toBe(429);
    }
  });

  it('still limits Google login attempts', async () => {
    const statuses = [];
    for (let i = 0; i < 21; i += 1) {
      const res = await request(app).post('/api/auth/google-login').send({ credential: 'not-a-real-google-token' });
      statuses.push(res.status);
    }
    expect(statuses.slice(0, 20).every((s) => s !== 429)).toBe(true);
    expect(statuses[20]).toBe(429);
  });
});
