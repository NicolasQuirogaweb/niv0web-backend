require('dotenv').config();
const { z } = require('zod');

// dotenv carga "KEY=" como "" (no undefined). Para las opcionales, vacío = sin definir:
// si no, copiar .env.example tal cual haría que la API no arranque.
const optionalString = (schema) => z.preprocess((v) => (v === '' ? undefined : v), schema.optional());

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.string().default('5000').transform(Number),
  MONGODB_URI: z.string().min(1, 'MONGODB_URI es requerida'),
  JWT_SECRET: z.string().min(32, 'JWT_SECRET debe tener al menos 32 caracteres'),
  JWT_REFRESH_SECRET: z.string().min(32, 'JWT_REFRESH_SECRET debe tener al menos 32 caracteres'),
  B2_KEY_ID: z.string().min(1, 'B2_KEY_ID es requerida'),
  B2_APPLICATION_KEY: z.string().min(1, 'B2_APPLICATION_KEY es requerida'),
  B2_BUCKET_ID: z.string().min(1, 'B2_BUCKET_ID es requerida'),
  B2_BUCKET_NAME: z.string().min(1, 'B2_BUCKET_NAME es requerido'),
  B2_PUBLIC_URL: z.string().url('B2_PUBLIC_URL debe ser una URL válida'),
  GOOGLE_CLIENT_ID: z.string().min(1, 'GOOGLE_CLIENT_ID es requerido'),
  // Discografía (página About). Opcionales: sin ellas /api/discography devuelve [].
  SPOTIFY_CLIENT_ID: optionalString(z.string()),
  SPOTIFY_CLIENT_SECRET: optionalString(z.string()),
  SPOTIFY_ARTIST_ID: optionalString(z.string()),
  // Token que usan los crons de GitHub Actions para llamar a /api/jobs/*.
  JOBS_TOKEN: optionalString(z.string().min(32, 'JOBS_TOKEN debe tener al menos 32 caracteres')),
  FRONTEND_URL: z.string().url('FRONTEND_URL debe ser una URL válida').default('http://localhost:3000'),
});

const parseEnv = () => {
  const result = envSchema.safeParse(process.env);

  if (!result.success) {
    console.error('❌ Error de validación de variables de entorno:');
    for (const issue of result.error.issues) {
      console.error(`  - ${issue.path.join('.')}: ${issue.message}`);
    }
    process.exit(1);
  }

  return result.data;
};

const env = parseEnv();

module.exports = env;
