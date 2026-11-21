const DefaultSamplePack = require('../models/SamplePack');
const DefaultSamples = require('../models/Samples');
const { ZIP_BUILD_TIMEOUT_MS } = require('../utils/samplePacks');

// Cuánto se espera después de la última edición antes de rearmar el ZIP: renombrar
// varios samples seguidos arma un solo ZIP, no uno por cambio.
const AUTO_BUILD_DELAY_MS = 20 * 1000;

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
  const { Samples = DefaultSamples, build = defaultBuild, delayMs = AUTO_BUILD_DELAY_MS } = deps;
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
    } catch (err) {
      console.error(`Auto ZIP build failed for pack ${id}:`, err.message);
    }
  }, delayMs);
  if (typeof timer.unref === 'function') timer.unref();
  timers.set(id, timer);
};

const cancelAllZipRebuilds = () => {
  timers.forEach((timer) => clearTimeout(timer));
  timers.clear();
};

module.exports = { AUTO_BUILD_DELAY_MS, claimZipBuild, scheduleZipRebuild, cancelAllZipRebuilds };
