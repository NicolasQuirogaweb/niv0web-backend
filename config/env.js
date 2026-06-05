require('dotenv').config();
const { z } = require('zod');

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.string().default('5000').transform(Number),
  MONGODB_URI: z.string().min(1, 'MONGODB_URI es requerida'),
  JWT_SECRET: z.string().min(32, 'JWT_SECRET debe tener al menos 32 caracteres'),
  B2_KEY_ID: z.string().min(1, 'B2_KEY_ID es requerida'),
  B2_APPLICATION_KEY: z.string().min(1, 'B2_APPLICATION_KEY es requerida'),
  B2_BUCKET_ID: z.string().min(1, 'B2_BUCKET_ID es requerida'),
  B2_BUCKET_NAME: z.string().min(1, 'B2_BUCKET_NAME es requerido'),
  B2_PUBLIC_URL: z.string().url('B2_PUBLIC_URL debe ser una URL válida'),
  GOOGLE_CLIENT_ID: z.string().min(1, 'GOOGLE_CLIENT_ID es requerido'),
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
