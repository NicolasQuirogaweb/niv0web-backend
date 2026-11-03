const crypto = require('crypto');
const express = require('express');
const asyncHandler = require('../middleware/asyncHandler');
const ApiError = require('../utils/ApiError');
const { success } = require('../utils/response');
const { getDiscography, refreshDiscography } = require('../services/spotifyService');

// Discografía pública (página About) y el job que la refresca.
const discographyRouter = express.Router();

discographyRouter.get('/', asyncHandler(async (req, res) => {
  success(res, await getDiscography());
}));

// Los jobs los llama un cron de GitHub Actions con un token compartido:
// Render Free se duerme, así que no pueden depender de un timer del servidor.
const requireJobsToken = (req, res, next) => {
  const expected = process.env.JOBS_TOKEN;
  if (!expected) return next(new ApiError(503, 'Los jobs no están habilitados', 'JOBS_DISABLED'));
  // Solo header: un job nunca usa la cookie de sesión de un usuario.
  const header = req.headers.authorization || '';
  const given = header.startsWith('Bearer ') ? header.slice(7) : '';
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return next(ApiError.unauthorized('Token de job inválido'));
  }
  next();
};

const jobsRouter = express.Router();

jobsRouter.post('/refresh-discography', requireJobsToken, asyncHandler(async (req, res) => {
  const count = await refreshDiscography();
  success(res, { count });
}));

module.exports = { discographyRouter, jobsRouter };
