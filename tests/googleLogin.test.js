// Login con Google contra el modelo User real (sus validaciones), sin base: save() valida y listo.
const request = require('supertest');

const mockVerify = jest.fn();
jest.mock('google-auth-library', () => ({
  OAuth2Client: jest.fn().mockImplementation(() => ({ verifyIdToken: mockVerify })),
}));

const User = require('../models/User');
const app = require('../app');

const googleSays = (payload) =>
  mockVerify.mockResolvedValue({
    getPayload: () => ({ sub: 'google-999', email_verified: true, email: 'someone@gmail.com', ...payload }),
  });

let saved;
beforeEach(() => {
  saved = null;
  jest.spyOn(User.prototype, 'save').mockImplementation(async function save() {
    await this.validate();
    saved = this;
    return this;
  });
});
afterEach(() => jest.restoreAllMocks());

const login = () => request(app).post('/api/auth/google-login').send({ credential: 'google-id-token' });

describe('POST /api/auth/google-login with what Google really sends', () => {
  it('lets in an existing user whose Google account sends no photo, keeping the photo we had', async () => {
    const existing = new User({ email: 'someone@gmail.com', name: 'Someone', imageUrl: 'https://old/photo.jpg', googleId: 'google-999' });
    jest.spyOn(User, 'findOne').mockResolvedValue(existing);
    googleSays({ name: 'Someone' }); // sin picture

    const res = await login();

    expect(res.status).toBe(200);
    expect(saved.imageUrl).toBe('https://old/photo.jpg');
    expect(res.body.data.user.email).toBe('someone@gmail.com');
  });

  it('creates a new user without a photo when Google sends none', async () => {
    jest.spyOn(User, 'findOne').mockResolvedValue(null);
    googleSays({ name: 'New Person' });

    const res = await login();

    expect(res.status).toBe(200);
    expect(saved.imageUrl).toBeNull();
    expect(saved.name).toBe('New Person');
  });

  it('uses the start of the email as the name when Google sends no name', async () => {
    jest.spyOn(User, 'findOne').mockResolvedValue(null);
    googleSays({ picture: 'https://g/photo.jpg' }); // sin name

    const res = await login();

    expect(res.status).toBe(200);
    expect(saved.name).toBe('someone');
  });

  it('updates name and photo when Google sends them', async () => {
    const existing = new User({ email: 'someone@gmail.com', name: 'Old', imageUrl: 'https://old/photo.jpg', googleId: 'google-999' });
    jest.spyOn(User, 'findOne').mockResolvedValue(existing);
    googleSays({ name: 'New', picture: 'https://g/new.jpg' });

    const res = await login();

    expect(res.status).toBe(200);
    expect(saved.name).toBe('New');
    expect(saved.imageUrl).toBe('https://g/new.jpg');
  });
});
