const { spawnSync } = require('child_process');
const path = require('path');

// config/env.js corta el proceso si una variable no valida. Se prueba en un proceso
// aparte para no matar a jest.
const BASE_ENV = {
  NODE_ENV: 'test',
  MONGODB_URI: 'mongodb://localhost:27017/x',
  JWT_SECRET: 'a'.repeat(40),
  JWT_REFRESH_SECRET: 'b'.repeat(40),
  B2_KEY_ID: 'k',
  B2_APPLICATION_KEY: 'k',
  B2_BUCKET_ID: 'b',
  B2_BUCKET_NAME: 'b',
  B2_PUBLIC_URL: 'https://s3.us-east-005.backblazeb2.com',
  GOOGLE_CLIENT_ID: 'g',
};

const loadEnv = (extra) =>
  spawnSync(process.execPath, ['-e', "require('./config/env')"], {
    cwd: path.join(__dirname, '..'),
    env: { PATH: process.env.PATH, SYSTEMROOT: process.env.SYSTEMROOT, ...BASE_ENV, ...extra },
    encoding: 'utf8',
  });

describe('config/env', () => {
  it('boots with the optional vars left empty, as in .env.example', () => {
    const result = loadEnv({ JOBS_TOKEN: '', SPOTIFY_CLIENT_ID: '', SPOTIFY_CLIENT_SECRET: '', SPOTIFY_ARTIST_ID: '' });
    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
  });

  it('still rejects a JOBS_TOKEN that is set but too short', () => {
    expect(loadEnv({ JOBS_TOKEN: 'short' }).status).toBe(1);
  });
});
