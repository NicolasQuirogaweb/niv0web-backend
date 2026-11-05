const ApiError = require('./ApiError');
const buildPublicUrl = require('./buildPublicUrl');
const SamplePack = require('../models/SamplePack');

const ZIP_BUILD_TIMEOUT_MS = 30 * 60 * 1000;

const slugify = (title) => {
  const slug = String(title ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'pack';
};

const uniqueSlug = async (title, exists) => {
  const base = slugify(title);
  let slug = base;
  for (let n = 2; await exists(slug); n += 1) slug = `${base}-${n}`;
  return slug;
};

const cleanFolderName = (name) => {
  const clean = typeof name === 'string' ? name.trim() : '';
  // eslint-disable-next-line no-control-regex
  if (clean.length < 1 || clean.length > 50 || /[/\\\u0000-\u001f\u007f]/.test(clean)) {
    throw ApiError.badRequest(
      'El nombre de la carpeta debe tener entre 1 y 50 caracteres y no puede incluir / \\ ni caracteres de control',
      'INVALID_FOLDER_NAME'
    );
  }
  return clean;
};

// Un pack es gratis cuando no tiene precio en ARS.
const isFreePack = (pack) => pack.priceArs == null;

const publishProblem = (pack, sampleCount) => {
  if (sampleCount < 1) return 'PACK_EMPTY';
  if (!isFreePack(pack)) return 'PACK_PAID_NOT_SELLABLE';
  return null;
};

// Un build "building" que supera el timeout se considera fallido (el proceso murio).
const zipBuildStatus = (pack, now = Date.now()) => {
  const build = pack.zip && pack.zip.build;
  if (!build || !build.status) return 'idle';
  if (build.status === 'building') {
    const started = build.startedAt ? new Date(build.startedAt).getTime() : 0;
    return now - started > ZIP_BUILD_TIMEOUT_MS ? 'failed' : 'building';
  }
  return build.status;
};

const markZipStale = (packId) =>
  SamplePack.updateOne({ _id: packId }, { $set: { 'zip.stale': true } });

const publicPack = (pack, { itemsCount }) => {
  const isFree = isFreePack(pack);
  const zip = isFree && pack.zip && pack.zip.url ? { url: pack.zip.url, bytes: pack.zip.bytes ?? null } : null;
  return {
    _id: pack._id,
    slug: pack.slug,
    title: pack.title,
    description: pack.description,
    imageUrl: buildPublicUrl(pack.imageUrl),
    folderCount: (pack.folders || []).length,
    itemsCount,
    priceArs: pack.priceArs ?? null,
    priceUsd: pack.priceUsd ?? null,
    isFree,
    zip,
  };
};

module.exports = {
  slugify,
  uniqueSlug,
  cleanFolderName,
  isFreePack,
  publishProblem,
  ZIP_BUILD_TIMEOUT_MS,
  zipBuildStatus,
  markZipStale,
  publicPack,
};
