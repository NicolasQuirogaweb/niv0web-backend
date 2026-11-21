const DefaultSamplePack = require('../models/SamplePack');
const DefaultSamples = require('../models/Samples');
const { ZIP_BUILD_TIMEOUT_MS } = require('../utils/samplePacks');

// Cuánto se espera después de la última edición antes de rearmar el ZIP: renombrar
// varios samples seguidos arma un solo ZIP, no uno por cambio.
const AUTO_BUILD_DELAY_MS = 5 * 1000;
// Si el armado falla (un archivo que no respondió), se reintenta solo hasta 3 veces.
const MAX_AUTO_ATTEMPTS = 3;
const RETRY_DELAY_MS = 15 * 1000;

const timers = new Map();

/**
 * Claim atómico del build: solo gana si no hay uno vigente (uno de más de
 * ZIP_BUILD_TIMEOUT_MS se considera trabado). Devuelve el startedAt o null.
 */
const claimZipBuild = async (packId, { SamplePack = DefaultSamplePack } = {}) => {
  const startedAt = new Date();
  const claimed = await SamplePack.findOneAndUpdate(
    {
      _id: packId,
      $or: [
        { 'zip.build.status': { $ne: 'building' } },
        { 'zip.build.startedAt': { $lt: new Date(Date.now() - ZIP_BUILD_TIMEOUT_MS) } },
      ],
    },
    { $set: { 'zip.build': { status: 'building', startedAt, error: null } } },
    { new: true }
  );
  return claimed ? startedAt : null;
};

const defaultBuild = (...args) => require('./zipService').buildPackZip(...args);

/**
 * Después de editar un pack (título, carpetas o samples), vuelve a armar su ZIP solo,
 * para que la descarga tenga los nombres nuevos. Si ya hay un build corriendo, prueba
 * de nuevo más tarde: ese build no incluye la edición. Nunca falla hacia quien llama.
 */
const scheduleZipRebuild = (packId, deps = {}) => {
  const { Samples = DefaultSamples, build = defaultBuild, delayMs = AUTO_BUILD_DELAY_MS, attempt = 1 } = deps;
  const id = String(packId);
  clearTimeout(timers.get(id));
  const timer = setTimeout(async () => {
    timers.delete(id);
    try {
      if (!(await Samples.countDocuments({ samplepackId: packId }))) return;
      const startedAt = await claimZipBuild(packId, deps);
      if (!startedAt) {
        scheduleZipRebuild(packId, deps);
        return;
      }
      await build(packId, undefined, { startedAt });
      await retryIfFailed(packId, { ...deps, attempt });
    } catch (err) {
      console.error(`Auto ZIP build failed for pack ${id}:`, err.message);
    }
  }, delayMs);
  if (typeof timer.unref === 'function') timer.unref();
  timers.set(id, timer);
};

/**
 * Si el último armado falló, programa otro intento (hasta MAX_AUTO_ATTEMPTS en total).
 * Lo usan el armado automático y el botón del admin.
 */
async function retryIfFailed(packId, deps = {}) {
  const { SamplePack = DefaultSamplePack, attempt = 1 } = deps;
  if (!SamplePack.findById || attempt >= MAX_AUTO_ATTEMPTS) return;
  const after = await SamplePack.findById(packId).lean();
  if (after?.zip?.build?.status === 'failed') {
    scheduleZipRebuild(packId, { ...deps, attempt: attempt + 1, delayMs: RETRY_DELAY_MS });
  }
}

const cancelAllZipRebuilds = () => {
  timers.forEach((timer) => clearTimeout(timer));
  timers.clear();
};

module.exports = { AUTO_BUILD_DELAY_MS, claimZipBuild, scheduleZipRebuild, retryIfFailed, cancelAllZipRebuilds };
