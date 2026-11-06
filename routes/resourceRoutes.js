const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const asyncHandler = require('../middleware/asyncHandler');
const ApiError = require('../utils/ApiError');
const buildPublicUrl = require('../utils/buildPublicUrl');
const countByParent = require('../utils/countByParent');
const { attachPreviews, exposeBeatPreviews } = require('../services/previewService');

// Agrega los previews MP3 y, en beats, reemplaza el WAV por su MP3.
const publicTracks = async (resourceType, items) => {
  const withPreviews = await attachPreviews(items.map(withFileUrl));
  return resourceType === 'beats' ? exposeBeatPreviews(withPreviews) : withPreviews;
};
const { success } = require('../utils/response');
const { publicPack } = require('../utils/samplePacks');

const Playlist = require('../models/Playlist');
const Beat = require('../models/Beat');
const SamplePack = require('../models/SamplePack');
const Samples = require('../models/Samples');
const Loops = require('../models/Loops');
const ProdMixMasters = require('../models/ProdMixMasters');

// Los samples no estan aca a proposito: se sirven solo por /samplepacks, que filtra
// los packs publicados y nunca expone el zip de uno pago.
const RESOURCE_MAP = {
  beats: { model: Beat, playlistModel: Playlist, playlistKey: 'playlistId', responseKey: 'beats' },
  loops: { model: Loops, playlistModel: Playlist, playlistKey: 'playlistId', responseKey: 'loops' },
  prodmixmasters: { model: ProdMixMasters, responseKey: 'tracks' },
};

const withFileUrl = (item) => ({ ...item, audioFile: buildPublicUrl(item.audioFile) });

router.get('/playlists', asyncHandler(async (req, res) => {
  const filter = ['beats', 'loops'].includes(req.query.type) ? { type: req.query.type } : {};
  const playlists = await Playlist.find(filter).sort({ createdAt: -1 }).lean();
  const ids = playlists.map((pl) => pl._id);
  const [beatCounts, loopCounts] = await Promise.all([
    countByParent(Beat, 'playlistId', ids),
    countByParent(Loops, 'playlistId', ids),
  ]);

  const result = playlists.map((pl) => {
    const counts = pl.type === 'loops' ? loopCounts : beatCounts;
    return {
      ...pl,
      imageUrl: buildPublicUrl(pl.imageUrl),
      backgroundVideo: buildPublicUrl(pl.backgroundVideo),
      itemsCount: counts[pl._id.toString()] || 0,
    };
  });
  success(res, result);
}));

router.get('/samplepacks', asyncHandler(async (req, res) => {
  const packs = await SamplePack.find({ published: true }).sort({ createdAt: -1 }).lean();
  const counts = await countByParent(Samples, 'samplepackId', packs.map((p) => p._id));
  success(res, packs.map((p) => publicPack(p, { itemsCount: counts[p._id.toString()] || 0 })));
}));

// Debe ir antes de /:resourceType para que "samplepacks" no se confunda con un tipo.
router.get('/samplepacks/:slug', asyncHandler(async (req, res) => {
  const pack = await SamplePack.findOne({ slug: req.params.slug, published: true }).lean();
  if (!pack) throw ApiError.notFound('Sample pack no encontrado', 'PACK_NOT_FOUND');

  const samples = await Samples.find({ samplepackId: pack._id }).lean();
  const byFolder = new Map((pack.folders || []).map((name) => [name, []]));
  for (const s of samples) {
    const list = byFolder.get(s.folder);
    if (list) list.push({ _id: s._id, title: s.title, audioFile: buildPublicUrl(s.audioFile), durationSec: s.durationSec ?? null });
  }
  const folders = [...byFolder].map(([name, list]) => ({
    name,
    samples: list.sort((a, b) => a.title.localeCompare(b.title, 'es', { numeric: true })),
  }));

  success(res, { ...publicPack(pack, { itemsCount: samples.length }), folders });
}));

router.get('/:resourceType', asyncHandler(async (req, res) => {
  const resource = RESOURCE_MAP[req.params.resourceType];
  if (!resource) throw ApiError.notFound('Tipo de recurso no válido');

  const items = await resource.model.find().sort({ createdAt: -1 }).lean();
  success(res, await publicTracks(req.params.resourceType, items));
}));

router.get('/:resourceType/playlist/:playlistId', asyncHandler(async (req, res) => {
  const { resourceType, playlistId } = req.params;
  const resource = RESOURCE_MAP[resourceType];
  if (!resource || !resource.playlistModel) throw ApiError.notFound('Tipo de recurso no válido');
  if (!mongoose.Types.ObjectId.isValid(playlistId)) throw ApiError.badRequest('ID de playlist no válido', 'INVALID_ID');

  const playlist = await resource.playlistModel.findById(playlistId).lean();
  // Un catálogo de loops no se tiene que poder abrir como si fuera de beats (y viceversa).
  if (!playlist || playlist.type !== resourceType) {
    throw ApiError.notFound('Playlist no encontrada');
  }

  const items = await resource.model
    .find({ [resource.playlistKey]: playlist._id })
    .sort({ createdAt: -1 })
    .lean();

  success(res, {
    ...playlist,
    imageUrl: buildPublicUrl(playlist.imageUrl),
    backgroundVideo: buildPublicUrl(playlist.backgroundVideo),
    [resource.responseKey]: await publicTracks(resourceType, items),
  });
}));

module.exports = router;
