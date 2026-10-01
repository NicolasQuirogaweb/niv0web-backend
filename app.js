const env = require('./config/env');
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const cookieParser = require('cookie-parser');
const mongoose = require('mongoose');
const axios = require('axios');
const { generalLimiter, authLimiter } = require('./middleware/rateLimiter');
const errorHandler = require('./middleware/errorHandler');
const ApiError = require('./utils/ApiError');
const { isAllowedDownloadUrl, safeFilename } = require('./utils/downloadSource');
const authRoutes = require('./routes/auth');
const resourceRoutes = require('./routes/resourceRoutes');
const adminRoutes = require('./routes/adminRoutes');

const app = express();

// Render pone un proxy adelante. Sin esto req.ip es siempre la IP del proxy
// y el rate limit termina siendo un solo balde compartido por todos.
app.set('trust proxy', 1);

app.use(helmet({
  hsts: { maxAge: 63072000, includeSubDomains: true, preload: true },
  referrerPolicy: { policy: 'same-origin' },
  contentSecurityPolicy: false,
}));
app.use(compression());
app.use(generalLimiter);

const allowedOrigins = [env.FRONTEND_URL, 'https://niv0web.vercel.app'];

const corsOptions = {
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
    return callback(ApiError.forbidden(`Origen no permitido: ${origin}`, 'CORS_NOT_ALLOWED'));
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true,
  maxAge: 86400,
};

app.use(cors(corsOptions));
app.options('*', cors(corsOptions));

app.use('/api/auth', authLimiter);

app.use(cookieParser());
// Los archivos van por multipart (multer), así que el JSON nunca necesita ser grande.
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));

app.use('/api/auth', authRoutes);
app.use('/api/resources', resourceRoutes);
app.use('/api/admin', adminRoutes);

app.get('/api/download', async (req, res, next) => {
  const { url } = req.query;
  if (typeof url !== 'string' || !url) return next(ApiError.badRequest('Falta el parámetro url'));
  if (!isAllowedDownloadUrl(url)) return next(ApiError.badRequest('Origen de descarga no válido', 'INVALID_DOWNLOAD_SOURCE'));

  try {
    const upstream = await axios({ url, method: 'GET', responseType: 'stream', timeout: 30000, maxRedirects: 0 });
    res.setHeader('Content-Disposition', `attachment; filename="${safeFilename(url)}"`);
    res.setHeader('Content-Type', upstream.headers['content-type'] || 'application/octet-stream');
    if (upstream.headers['content-length']) res.setHeader('Content-Length', upstream.headers['content-length']);
    upstream.data.pipe(res);
  } catch (err) {
    const status = err.response?.status;
    if (status === 404) return next(ApiError.notFound('El archivo no existe'));
    next(new ApiError(502, 'No se pudo descargar el archivo', 'DOWNLOAD_FAILED'));
  }
});

app.get('/health', (req, res) => {
  res.json({
    ok: true,
    db: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected',
  });
});

app.use((req, res, next) => {
  next(ApiError.notFound(`Ruta no encontrada: ${req.originalUrl}`));
});

app.use(errorHandler);

module.exports = app;
