const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const asyncHandler = require('../middleware/asyncHandler');
const ApiError = require('../utils/ApiError');
const buildPublicUrl = require('../utils/buildPublicUrl');
const countByParent = require('../utils/countByParent');
const { attachPreviews } = require('../services/previewService');
const { success } = require('../utils/response');

const Playlist = require('../models/Playlist');
const Beat = require('../models/Beat');
const SamplePack = require('../models/SamplePack');
const Samples = require('../models/Samples');
const Loops = require('../models/Loops');
const ProdMixMasters = require('../models/ProdMixMasters');

const RESOURCE_MAP = {
  beats: { model: Beat, playlistModel: Playlist, playlistKey: 'playlistId', responseKey: 'beats' },
  samples: { model: Samples, playlistModel: SamplePack, playlistKey: 'samplepackId', responseKey: 'samples' },
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
  const samplepacks = await SamplePack.find().sort({ createdAt: -1 }).lean();
  const counts = await countByParent(Samples, 'samplepackId', samplepacks.map((sp) => sp._id));

  const result = samplepacks.map((sp) => ({
    ...sp,
    imageUrl: buildPublicUrl(sp.imageUrl),
    itemsCount: counts[sp._id.toString()] || 0,
  }));
  success(res, result);
}));

router.get('/:resourceType', asyncHandler(async (req, res) => {
  const resource = RESOURCE_MAP[req.params.resourceType];
  if (!resource) throw ApiError.badRequest('Tipo de recurso no válido');

  const items = await resource.model.find().sort({ createdAt: -1 }).lean();
  success(res, await attachPreviews(items.map(withFileUrl)));
}));

router.get('/:resourceType/playlist/:playlistId', asyncHandler(async (req, res) => {
  const { resourceType, playlistId } = req.params;
  const resource = RESOURCE_MAP[resourceType];
  if (!resource || !resource.playlistModel) throw ApiError.badRequest('Tipo de recurso no válido');
  if (!mongoose.Types.ObjectId.isValid(playlistId)) throw ApiError.badRequest('ID de playlist no válido', 'INVALID_ID');

  const playlist = await resource.playlistModel.findById(playlistId).lean();
  if (!playlist) {
    throw ApiError.notFound(resourceType === 'samples' ? 'Sample pack no encontrado' : 'Playlist no encontrada');
  }
  // Un catálogo de loops no se tiene que poder abrir como si fuera de beats (y viceversa).
  if (resource.playlistModel === Playlist && playlist.type !== resourceType) {
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
    [resource.responseKey]: await attachPreviews(items.map(withFileUrl)),
  });
}));

module.exports = router;
