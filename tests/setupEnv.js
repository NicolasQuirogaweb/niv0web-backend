// Valores falsos para que config/env.js valide sin un .env real.
Object.assign(process.env, {
  NODE_ENV: 'test',
  MONGODB_URI: 'mongodb://localhost:27017/niv0-test',
  JWT_SECRET: 'test-access-secret-at-least-32-characters-long',
  JWT_REFRESH_SECRET: 'test-refresh-secret-at-least-32-characters-long',
  B2_KEY_ID: 'test-key',
  B2_APPLICATION_KEY: 'test-app-key',
  B2_BUCKET_ID: 'test-bucket-id',
  B2_BUCKET_NAME: 'niv0-audios',
  B2_PUBLIC_URL: 'https://s3.us-east-005.backblazeb2.com',
  GOOGLE_CLIENT_ID: 'test-client.apps.googleusercontent.com',
  FRONTEND_URL: 'http://localhost:3000',
});
