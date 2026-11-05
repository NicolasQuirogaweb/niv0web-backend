const express = require('express');
const router = express.Router();
const multer = require('multer');
const { body } = require('express-validator');
const adminAuth = require('../middleware/adminAuth');
const { uploadLimiter } = require('../middleware/rateLimiter');
const asyncHandler = require('../middleware/asyncHandler');
const validate = require('../middleware/validate');
const { uploadToB2 } = require('../services/b2Service');
const { tryCreatePreview } = require('../services/previewService');
const ApiError = require('../utils/ApiError');
const countByParent = require('../utils/countByParent');
const { success } = require('../utils/response');
const { uniqueSlug, cleanFolderName, publishProblem, zipBuildStatus, markZipStale } = require('../utils/samplePacks');

const Playlist = require('../models/Playlist');
const Beat = require('../models/Beat');
const Loops = require('../models/Loops');
const SamplePack = require('../models/SamplePack');
const Samples = require('../models/Samples');
const ProdMixMasters = require('../models/ProdMixMasters');
const User = require('../models/User');

// El chequeo de tipo real vive en uploadToB2 -> validateFile (services/b2Service.js),
// que produce un error prolijo (statusCode/code) y por-archivo dentro de /upload/batch.
// Un fileFilter acá aborta TODA la petición (incluida la batch completa) apenas un
// solo archivo no pasa, antes de llegar al route handler.
// Multer guarda en memoria, así que el límite por archivo y la cantidad por
// batch acotan cuánta RAM puede pedir un solo request (100 MB x 10).
const MAX_FILE_SIZE = 100 * 1024 * 1024;
const MAX_BATCH_FILES = 10;
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_SIZE, files: MAX_BATCH_FILES },
});

// La carpeta llega del cliente y termina siendo el prefijo de la key en B2.
const UPLOAD_FOLDERS = ['uploads', 'beats', 'samples', 'loops', 'prodmixmasters', 'images', 'videos'];
const resolveFolder = (folder) => {
  if (!folder) return 'uploads';
  if (!UPLOAD_FOLDERS.includes(folder)) {
    throw ApiError.badRequest(`Carpeta no permitida: ${folder}`, 'INVALID_FOLDER');
  }
  return folder;
};

// Evita crear beats en un catálogo de loops (o en uno que no existe).
const requirePlaylistOfType = async (playlistId, type) => {
  const playlist = await Playlist.findById(playlistId).lean();
  if (!playlist) throw ApiError.notFound('Playlist no encontrada');
  if (playlist.type !== type) {
    throw ApiError.badRequest(`La playlist es de tipo ${playlist.type}, no ${type}`, 'WRONG_PLAYLIST_TYPE');
  }
  return playlist;
};

const requireSamplePack = async (samplepackId) => {
  const pack = await SamplePack.findById(samplepackId).lean();
  if (!pack) throw ApiError.notFound('Sample pack no encontrado');
  return pack;
};

// Los campos de un PUT son los mismos que en el POST pero todos opcionales.
const asOptional = (fieldName, maxLength) => body(fieldName)
  .optional()
  .trim()
  .notEmpty().withMessage(`${fieldName} no puede estar vacío`)
  .isLength({ max: maxLength }).withMessage(`${fieldName}: máximo ${maxLength} caracteres`);

const playlistUpdateFields = [
  asOptional('title', 100),
  asOptional('description', 300),
  asOptional('imageUrl', 2048),
  asOptional('backgroundVideo', 2048),
];

const trackUpdateFields = [
  asOptional('title', 100),
  asOptional('audioFile', 2048),
  body('description').optional().trim().isLength({ max: 300 }).withMessage('description: máximo 300 caracteres'),
  body('artist').optional().trim().isLength({ max: 50 }).withMessage('artist: máximo 50 caracteres'),
];

// ========== UPLOAD ==========

router.post('/upload', adminAuth, uploadLimiter, upload.single('file'), asyncHandler(async (req, res) => {
  if (!req.file) throw ApiError.badRequest('No se envió ningún archivo');
  const folder = resolveFolder(req.body.folder);
  const result = await uploadToB2(req.file.buffer, req.file.originalname, folder, req.file.mimetype);
  // Un WAV pesado también se guarda en MP3 para escucharlo rápido en la web.
  const previewUrl = await tryCreatePreview(req.file, folder, result.url);
  success(res, { ...result, previewUrl });
}));

router.post('/upload/batch', adminAuth, uploadLimiter, upload.array('files', MAX_BATCH_FILES), asyncHandler(async (req, res) => {
  if (!req.files || req.files.length === 0) throw ApiError.badRequest('No se enviaron archivos');
  const folder = resolveFolder(req.body.folder);
  const settled = await Promise.allSettled(
    req.files.map(file => uploadToB2(file.buffer, file.originalname, folder, file.mimetype))
  );
  // Previews de a uno: cada ffmpeg usa memoria y Render Free tiene 512 MB.
  for (let i = 0; i < req.files.length; i++) {
    if (settled[i].status !== 'fulfilled') continue;
    const previewUrl = await tryCreatePreview(req.files[i], folder, settled[i].value.url);
    if (previewUrl) settled[i].value.previewUrl = previewUrl;
  }
  const urls = [];
  const errors = [];
  const results = req.files.map((file, i) => {
    const outcome = settled[i];
    if (outcome.status === 'fulfilled') {
      urls.push(outcome.value);
      return { success: true, originalName: file.originalname, ...outcome.value };
    }
    const error = outcome.reason?.message || 'Error desconocido';
    errors.push({ originalName: file.originalname, error });
    return { success: false, originalName: file.originalname, error };
  });
  success(res, { urls, errors, results });
}));

// ========== USERS ==========

router.get('/users', adminAuth, asyncHandler(async (req, res) => {
  const users = await User.find().sort({ createdAt: -1 }).lean();
  success(res, users);
}));

router.put('/users/:id/role', adminAuth, asyncHandler(async (req, res) => {
  const { role } = req.body;
  if (!['user', 'admin'].includes(role)) throw ApiError.badRequest('Rol no válido');
  const user = await User.findByIdAndUpdate(req.params.id, { role }, { new: true }).lean();
  if (!user) throw ApiError.notFound('Usuario no encontrado');
  success(res, user);
}));

// ========== PLAYLISTS ==========

router.get('/playlists', adminAuth, asyncHandler(async (req, res) => {
  const playlists = await Playlist.find().sort({ createdAt: -1 }).lean();
  const ids = playlists.map((pl) => pl._id);
  const [beatCounts, loopCounts] = await Promise.all([
    countByParent(Beat, 'playlistId', ids),
    countByParent(Loops, 'playlistId', ids),
  ]);
  const result = playlists.map((pl) => {
    const counts = pl.type === 'beats' ? beatCounts : loopCounts;
    return { ...pl, itemsCount: counts[pl._id.toString()] || 0 };
  });
  success(res, result);
}));

const playlistFields = [
  body('title').trim().notEmpty().withMessage('El título es requerido (máx 100 caracteres)').isLength({ max: 100 }).withMessage('El título es requerido (máx 100 caracteres)'),
  body('description').trim().notEmpty().withMessage('La descripción es requerida (máx 300 caracteres)').isLength({ max: 300 }).withMessage('La descripción es requerida (máx 300 caracteres)'),
  body('imageUrl').trim().notEmpty().withMessage('La URL de imagen es requerida'),
  body('backgroundVideo').trim().notEmpty().withMessage('La URL del video de fondo es requerida'),
  body('type').isIn(['beats', 'loops']).withMessage('El tipo debe ser beats o loops'),
];

router.post('/playlists', adminAuth, playlistFields, validate, asyncHandler(async (req, res) => {
  const { title, description, imageUrl, backgroundVideo, type } = req.body;
  const playlist = await Playlist.create({ title, description, imageUrl, backgroundVideo, type });
  success(res, playlist, {}, 201);
}));

router.put('/playlists/:id', adminAuth, playlistUpdateFields, validate, asyncHandler(async (req, res) => {
  const { title, description, imageUrl, backgroundVideo } = req.body;
  const playlist = await Playlist.findByIdAndUpdate(
    req.params.id,
    { $set: { title, description, imageUrl, backgroundVideo } },
    { new: true, runValidators: true }
  ).lean();
  if (!playlist) throw ApiError.notFound('Playlist no encontrada');
  success(res, playlist);
}));

router.delete('/playlists/:id', adminAuth, asyncHandler(async (req, res) => {
  const playlist = await Playlist.findById(req.params.id);
  if (!playlist) throw ApiError.notFound('Playlist no encontrada');
  const Model = playlist.type === 'beats' ? Beat : Loops;
  await Model.deleteMany({ playlistId: playlist._id });
  await Playlist.findByIdAndDelete(req.params.id);
  success(res, { message: 'Playlist y sus items eliminados' });
}));

router.post('/playlists/:id/duplicate', adminAuth, asyncHandler(async (req, res) => {
  const original = await Playlist.findById(req.params.id).lean();
  if (!original) throw ApiError.notFound('Playlist no encontrada');
  const newPlaylist = await Playlist.create({
    title: `Copia de ${original.title}`,
    description: original.description,
    imageUrl: original.imageUrl,
    backgroundVideo: original.backgroundVideo,
    type: original.type,
  });
  const Model = original.type === 'beats' ? Beat : Loops;
  const items = await Model.find({ playlistId: original._id }).lean();
  const newItems = items.map(item => ({
    title: item.title,
    description: item.description,
    audioFile: item.audioFile,
    artist: item.artist,
    playlistId: newPlaylist._id,
  }));
  if (newItems.length > 0) await Model.insertMany(newItems);
  success(res, { message: 'Playlist duplicada', playlist: newPlaylist, itemsCount: newItems.length }, {}, 201);
}));

// ========== BEATS ==========

router.get('/playlists/:playlistId/beats', adminAuth, asyncHandler(async (req, res) => {
  const beats = await Beat.find({ playlistId: req.params.playlistId }).sort({ createdAt: -1 }).lean();
  success(res, beats);
}));

const beatFields = [
  body('title').trim().notEmpty().withMessage('El título del beat es requerido').isLength({ max: 100 }).withMessage('El título del beat es requerido'),
  body('audioFile').trim().notEmpty().withMessage('El archivo de audio es requerido'),
];

router.post('/playlists/:playlistId/beats', adminAuth, beatFields, validate, asyncHandler(async (req, res) => {
  await requirePlaylistOfType(req.params.playlistId, 'beats');
  const { title, artist, description, audioFile } = req.body;
  const beat = await Beat.create({ title, artist: artist || '', description: description || '', audioFile, playlistId: req.params.playlistId });
  success(res, beat, {}, 201);
}));

router.post('/playlists/:playlistId/beats/batch', adminAuth, asyncHandler(async (req, res) => {
  const { beats } = req.body;
  if (!Array.isArray(beats) || beats.length === 0) throw ApiError.badRequest('Se requiere un array de beats');
  const invalidIndex = beats.findIndex(b => !b || !String(b.title || '').trim() || !String(b.audioFile || '').trim());
  if (invalidIndex !== -1) throw ApiError.badRequest(`El beat en la posición ${invalidIndex + 1} no tiene título o audioFile`);
  await requirePlaylistOfType(req.params.playlistId, 'beats');
  const withPlaylistId = beats.map(b => ({
    title: b.title,
    artist: b.artist || '',
    description: b.description || '',
    audioFile: b.audioFile,
    playlistId: req.params.playlistId,
  }));
  const created = await Beat.insertMany(withPlaylistId);
  success(res, { beats: created, count: created.length }, {}, 201);
}));

router.put('/beats/:id', adminAuth, trackUpdateFields, validate, asyncHandler(async (req, res) => {
  const { title, artist, description, audioFile } = req.body;
  const beat = await Beat.findByIdAndUpdate(
    req.params.id,
    { $set: { title, artist, description, audioFile } },
    { new: true, runValidators: true }
  ).lean();
  if (!beat) throw ApiError.notFound('Beat no encontrado');
  success(res, beat);
}));

router.delete('/beats/:id', adminAuth, asyncHandler(async (req, res) => {
  const beat = await Beat.findByIdAndDelete(req.params.id).lean();
  if (!beat) throw ApiError.notFound('Beat no encontrado');
  success(res, { message: 'Beat eliminado' });
}));

// ========== LOOPS ==========

router.get('/playlists/:playlistId/loops', adminAuth, asyncHandler(async (req, res) => {
  const loops = await Loops.find({ playlistId: req.params.playlistId }).sort({ createdAt: -1 }).lean();
  success(res, loops);
}));

const loopFields = [
  body('title').trim().notEmpty().withMessage('El título del loop es requerido').isLength({ max: 100 }).withMessage('El título del loop es requerido'),
  body('audioFile').trim().notEmpty().withMessage('El archivo de audio es requerido'),
];

router.post('/playlists/:playlistId/loops', adminAuth, loopFields, validate, asyncHandler(async (req, res) => {
  await requirePlaylistOfType(req.params.playlistId, 'loops');
  const { title, description, audioFile } = req.body;
  const loop = await Loops.create({ title, description: description || '', audioFile, playlistId: req.params.playlistId });
  success(res, loop, {}, 201);
}));

router.post('/playlists/:playlistId/loops/batch', adminAuth, asyncHandler(async (req, res) => {
  const { loops } = req.body;
  if (!Array.isArray(loops) || loops.length === 0) throw ApiError.badRequest('Se requiere un array de loops');
  const invalidIndex = loops.findIndex(l => !l || !String(l.title || '').trim() || !String(l.audioFile || '').trim());
  if (invalidIndex !== -1) throw ApiError.badRequest(`El loop en la posición ${invalidIndex + 1} no tiene título o audioFile`);
  await requirePlaylistOfType(req.params.playlistId, 'loops');
  const withPlaylistId = loops.map(l => ({
    title: l.title,
    description: l.description || '',
    audioFile: l.audioFile,
    playlistId: req.params.playlistId,
  }));
  const created = await Loops.insertMany(withPlaylistId);
  success(res, { loops: created, count: created.length }, {}, 201);
}));

router.put('/loops/:id', adminAuth, trackUpdateFields, validate, asyncHandler(async (req, res) => {
  const { title, description, audioFile } = req.body;
  const loop = await Loops.findByIdAndUpdate(
    req.params.id,
    { $set: { title, description, audioFile } },
    { new: true, runValidators: true }
  ).lean();
  if (!loop) throw ApiError.notFound('Loop no encontrado');
  success(res, loop);
}));

router.delete('/loops/:id', adminAuth, asyncHandler(async (req, res) => {
  const loop = await Loops.findByIdAndDelete(req.params.id).lean();
  if (!loop) throw ApiError.notFound('Loop no encontrado');
  success(res, { message: 'Loop eliminado' });
}));

// ========== SAMPLE PACKS ==========

router.get('/samplepacks', adminAuth, asyncHandler(async (req, res) => {
  const samplepacks = await SamplePack.find().sort({ createdAt: -1 }).lean();
  const counts = await countByParent(Samples, 'samplepackId', samplepacks.map((sp) => sp._id));
  const result = samplepacks.map((sp) => ({
    ...sp,
    itemsCount: counts[sp._id.toString()] || 0,
    zip: { ...(sp.zip || {}), build: { ...((sp.zip && sp.zip.build) || {}), status: zipBuildStatus(sp) } },
  }));
  success(res, result);
}));

// Los precios son un numero >= 0 o null (null = sin precio).
const priceField = (name) => body(name)
  .optional({ values: 'null' })
  .isFloat({ min: 0 }).withMessage(`${name} debe ser un número mayor o igual a 0`)
  .toFloat();

const samplePackFields = [
  body('title').trim().notEmpty().withMessage('El título es requerido').isLength({ max: 100 }).withMessage('El título es requerido'),
  body('description').trim().notEmpty().withMessage('La descripción es requerida').isLength({ max: 300 }).withMessage('La descripción es requerida'),
  body('imageUrl').optional().trim().isLength({ max: 2048 }).withMessage('imageUrl: máximo 2048 caracteres'),
  body('folders').optional().isArray().withMessage('folders debe ser una lista'),
  priceField('priceArs'),
  priceField('priceUsd'),
];

const samplePackUpdateFields = [
  asOptional('title', 100),
  asOptional('description', 300),
  asOptional('imageUrl', 2048),
  priceField('priceArs'),
  priceField('priceUsd'),
  body('published').optional().isBoolean().withMessage('published debe ser true o false').toBoolean(),
];

const sameName = (a, b) => a.toLowerCase() === b.toLowerCase();
const hasFolder = (folders, name) => folders.some((f) => sameName(f, name));
const folderExists = () => ApiError.conflict('Ya existe una carpeta con ese nombre', 'FOLDER_EXISTS');
const folderNotFound = () => ApiError.notFound('Carpeta no encontrada', 'FOLDER_NOT_FOUND');
const slugTaken = async (candidate) => Boolean(await SamplePack.exists({ slug: candidate }));

router.post('/samplepacks', adminAuth, samplePackFields, validate, asyncHandler(async (req, res) => {
  const { title, description, imageUrl, priceArs, priceUsd } = req.body;
  const folders = [];
  for (const raw of req.body.folders || []) {
    const name = cleanFolderName(raw);
    if (hasFolder(folders, name)) throw folderExists();
    folders.push(name);
  }
  const slug = await uniqueSlug(title, slugTaken);
  const samplepack = await SamplePack.create({
    title, description, imageUrl, folders, slug, published: false, type: 'samples',
    priceArs: priceArs ?? null, priceUsd: priceUsd ?? null,
  });
  success(res, samplepack, {}, 201);
}));

router.put('/samplepacks/:id', adminAuth, samplePackUpdateFields, validate, asyncHandler(async (req, res) => {
  const current = await requireSamplePack(req.params.id);
  const set = {};
  for (const key of ['title', 'description', 'imageUrl', 'priceArs', 'priceUsd', 'published']) {
    if (req.body[key] !== undefined) set[key] = req.body[key];
  }
  if (set.published === true) {
    const problem = publishProblem({ ...current, ...set }, await Samples.countDocuments({ samplepackId: current._id }));
    if (problem === 'PACK_EMPTY') throw ApiError.conflict('El pack no tiene samples: no se puede publicar vacío', problem);
    if (problem) throw ApiError.conflict('Un pack con precio todavía no se puede publicar: la venta no está disponible', problem);
  }
  // El nombre del zip depende del título.
  if (set.title !== undefined && set.title !== current.title) set['zip.stale'] = true;
  // El slug no se toca nunca: las URLs públicas no pueden romperse.
  const samplepack = await SamplePack.findByIdAndUpdate(
    req.params.id, { $set: set }, { new: true, runValidators: true }
  ).lean();
  if (!samplepack) throw ApiError.notFound('Sample pack no encontrado');
  success(res, samplepack);
}));

router.post('/samplepacks/:id/folders', adminAuth, body('name').isString().withMessage('name es requerido'), validate, asyncHandler(async (req, res) => {
  const name = cleanFolderName(req.body.name);
  const pack = await requireSamplePack(req.params.id);
  if (hasFolder(pack.folders || [], name)) throw folderExists();
  const updated = await SamplePack.findByIdAndUpdate(
    req.params.id, { $push: { folders: name }, $set: { 'zip.stale': true } }, { new: true }
  ).lean();
  success(res, updated, {}, 201);
}));

router.put('/samplepacks/:id/folders/order', adminAuth, body('folders').isArray().withMessage('folders debe ser una lista'), validate, asyncHandler(async (req, res) => {
  const pack = await requireSamplePack(req.params.id);
  const current = pack.folders || [];
  const next = req.body.folders;
  const isPermutation = next.length === current.length
    && new Set(next).size === next.length
    && next.every((name) => current.includes(name));
  if (!isPermutation) throw ApiError.badRequest('La lista debe contener exactamente las carpetas actuales', 'INVALID_FOLDER_ORDER');
  const updated = await SamplePack.findByIdAndUpdate(req.params.id, { $set: { folders: next, 'zip.stale': true } }, { new: true }).lean();
  success(res, updated);
}));

router.put('/samplepacks/:id/folders', adminAuth, [
  body('from').isString().withMessage('from es requerido'),
  body('to').isString().withMessage('to es requerido'),
], validate, asyncHandler(async (req, res) => {
  const to = cleanFolderName(req.body.to);
  const pack = await requireSamplePack(req.params.id);
  const folders = pack.folders || [];
  const index = folders.indexOf(req.body.from);
  if (index === -1) throw folderNotFound();
  // Cambiar solo las mayúsculas del mismo nombre es válido.
  if (!sameName(folders[index], to) && hasFolder(folders, to)) throw folderExists();
  const next = folders.map((f, i) => (i === index ? to : f));
  const updated = await SamplePack.findByIdAndUpdate(req.params.id, { $set: { folders: next, 'zip.stale': true } }, { new: true }).lean();
  await Samples.updateMany({ samplepackId: pack._id, folder: req.body.from }, { $set: { folder: to } });
  success(res, updated);
}));

router.delete('/samplepacks/:id/folders/:name', adminAuth, asyncHandler(async (req, res) => {
  const pack = await requireSamplePack(req.params.id);
  if (!(pack.folders || []).includes(req.params.name)) throw folderNotFound();
  if (await Samples.exists({ samplepackId: pack._id, folder: req.params.name })) {
    throw ApiError.conflict('La carpeta tiene samples: movelos o eliminalos primero', 'FOLDER_NOT_EMPTY');
  }
  const updated = await SamplePack.findByIdAndUpdate(
    req.params.id, { $pull: { folders: req.params.name }, $set: { 'zip.stale': true } }, { new: true }
  ).lean();
  success(res, updated);
}));

router.delete('/samplepacks/:id', adminAuth, asyncHandler(async (req, res) => {
  const samplepack = await SamplePack.findById(req.params.id);
  if (!samplepack) throw ApiError.notFound('Sample pack no encontrado');
  await Samples.deleteMany({ samplepackId: samplepack._id });
  await SamplePack.findByIdAndDelete(req.params.id);
  success(res, { message: 'Sample pack y sus samples eliminados' });
}));

router.post('/samplepacks/:id/duplicate', adminAuth, asyncHandler(async (req, res) => {
  const original = await SamplePack.findById(req.params.id).lean();
  if (!original) throw ApiError.notFound('Sample pack no encontrado');
  const title = `Copia de ${original.title}`;
  const slug = await uniqueSlug(title, slugTaken);
  // La copia nace sin publicar y sin zip: se arma aparte.
  const newSp = await SamplePack.create({
    title,
    slug,
    description: original.description,
    imageUrl: original.imageUrl,
    folders: original.folders || [],
    priceArs: original.priceArs ?? null,
    priceUsd: original.priceUsd ?? null,
    published: false,
    type: 'samples',
  });
  const samples = await Samples.find({ samplepackId: original._id }).lean();
  const newSamples = samples.map(s => ({
    title: s.title,
    description: s.description,
    audioFile: s.audioFile,
    folder: s.folder,
    durationSec: s.durationSec ?? null,
    samplepackId: newSp._id,
  }));
  if (newSamples.length > 0) await Samples.insertMany(newSamples);
  success(res, { message: 'Sample pack duplicado', samplepack: newSp, itemsCount: newSamples.length }, {}, 201);
}));

// ========== SAMPLES ==========

router.get('/samplepacks/:samplepackId/samples', adminAuth, asyncHandler(async (req, res) => {
  const samples = await Samples.find({ samplepackId: req.params.samplepackId }).sort({ createdAt: -1 }).lean();
  success(res, samples);
}));

const sampleFields = [
  body('title').trim().notEmpty().withMessage('El título del sample es requerido').isLength({ max: 100 }).withMessage('El título del sample es requerido'),
  body('audioFile').trim().notEmpty().withMessage('El archivo de audio es requerido'),
  body('folder').isString().withMessage('La carpeta del sample es requerida'),
];

const requireKnownFolder = (pack, folder) => {
  if (!(pack.folders || []).includes(folder)) {
    throw ApiError.badRequest(`La carpeta "${folder}" no existe en este pack`, 'UNKNOWN_FOLDER');
  }
};

router.post('/samplepacks/:samplepackId/samples', adminAuth, sampleFields, validate, asyncHandler(async (req, res) => {
  const pack = await requireSamplePack(req.params.samplepackId);
  const { title, description, audioFile, folder } = req.body;
  requireKnownFolder(pack, folder);
  const sample = await Samples.create({ title, description: description || '', audioFile, folder, samplepackId: req.params.samplepackId });
  await markZipStale(pack._id);
  success(res, sample, {}, 201);
}));

router.post('/samplepacks/:samplepackId/samples/batch', adminAuth, asyncHandler(async (req, res) => {
  const { samples } = req.body;
  if (!Array.isArray(samples) || samples.length === 0) throw ApiError.badRequest('Se requiere un array de samples');
  const invalidIndex = samples.findIndex(s => !s || !String(s.title || '').trim() || !String(s.audioFile || '').trim());
  if (invalidIndex !== -1) throw ApiError.badRequest(`El sample en la posición ${invalidIndex + 1} no tiene título o audioFile`);
  const pack = await requireSamplePack(req.params.samplepackId);
  // Se valida todo antes de insertar: una carpeta mala no deja samples a medias.
  samples.forEach((s) => requireKnownFolder(pack, s.folder));
  const withPackId = samples.map(s => ({
    title: s.title,
    description: s.description || '',
    audioFile: s.audioFile,
    folder: s.folder,
    samplepackId: req.params.samplepackId,
  }));
  const created = await Samples.insertMany(withPackId);
  await markZipStale(pack._id);
  success(res, { samples: created, count: created.length }, {}, 201);
}));

router.put('/samples/:id', adminAuth, [...trackUpdateFields, body('folder').optional().isString().withMessage('folder inválido')], validate, asyncHandler(async (req, res) => {
  const { title, description, audioFile, folder } = req.body;
  const current = await Samples.findById(req.params.id).lean();
  if (!current) throw ApiError.notFound('Sample no encontrado');
  if (folder !== undefined) requireKnownFolder(await requireSamplePack(current.samplepackId), folder);
  const sample = await Samples.findByIdAndUpdate(
    req.params.id,
    { $set: { title, description, audioFile, folder } },
    { new: true, runValidators: true }
  ).lean();
  if (!sample) throw ApiError.notFound('Sample no encontrado');
  const changed = (folder !== undefined && folder !== current.folder) || (audioFile !== undefined && audioFile !== current.audioFile);
  if (changed) await markZipStale(current.samplepackId);
  success(res, sample);
}));

router.delete('/samples/:id', adminAuth, asyncHandler(async (req, res) => {
  const sample = await Samples.findByIdAndDelete(req.params.id).lean();
  if (!sample) throw ApiError.notFound('Sample no encontrado');
  await markZipStale(sample.samplepackId);
  success(res, { message: 'Sample eliminado' });
}));

// ========== PROD MIX MASTERS ==========

router.get('/prodmixmasters', adminAuth, asyncHandler(async (req, res) => {
  const items = await ProdMixMasters.find().sort({ createdAt: -1 }).lean();
  success(res, items);
}));

const prodMixFields = [
  body('title').trim().notEmpty().withMessage('El título es requerido').isLength({ max: 100 }).withMessage('El título es requerido'),
  body('audioFile').trim().notEmpty().withMessage('El archivo de audio es requerido'),
];

router.post('/prodmixmasters', adminAuth, prodMixFields, validate, asyncHandler(async (req, res) => {
  const { title, description, audioFile } = req.body;
  const item = await ProdMixMasters.create({ title, description: description || '', audioFile });
  success(res, item, {}, 201);
}));

router.put('/prodmixmasters/:id', adminAuth, trackUpdateFields, validate, asyncHandler(async (req, res) => {
  const { title, description, audioFile } = req.body;
  const item = await ProdMixMasters.findByIdAndUpdate(
    req.params.id,
    { $set: { title, description, audioFile } },
    { new: true, runValidators: true }
  ).lean();
  if (!item) throw ApiError.notFound('Prod mix master no encontrado');
  success(res, item);
}));

router.delete('/prodmixmasters/:id', adminAuth, asyncHandler(async (req, res) => {
  const item = await ProdMixMasters.findByIdAndDelete(req.params.id).lean();
  if (!item) throw ApiError.notFound('Prod mix master no encontrado');
  success(res, { message: 'Prod mix master eliminado' });
}));

// ========== DASHBOARD ==========

router.get('/dashboard', adminAuth, asyncHandler(async (req, res) => {
  const [beatPlaylists, loopPlaylists, beats, loops, samplepacks, samples, prodmix, users] = await Promise.all([
    Playlist.countDocuments({ type: 'beats' }),
    Playlist.countDocuments({ type: 'loops' }),
    Beat.countDocuments(),
    Loops.countDocuments(),
    SamplePack.countDocuments(),
    Samples.countDocuments(),
    ProdMixMasters.countDocuments(),
    User.countDocuments(),
  ]);
  success(res, {
    playlists: beatPlaylists + loopPlaylists,
    beatPlaylists,
    loopPlaylists,
    beats,
    loops,
    samplepacks,
    samples,
    prodmix,
    users,
  });
}));

module.exports = router;
