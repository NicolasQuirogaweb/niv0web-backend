const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const asyncHandler = require('../middleware/asyncHandler');

const Playlist = require('../models/Playlist');
const Beat = require('../models/Beat');
const SamplePack = require('../models/SamplePack');
const Samples = require('../models/Samples');
const Loops = require('../models/Loops');
const ProdMixMasters = require('../models/ProdMixMasters');

const buildPublicUrl = (filePath) => {
  if (!filePath) return null;
  if (filePath.startsWith('http')) return filePath;
  const clean = filePath.replace(/^\/+/, '');
  const encoded = clean.split('/').map(encodeURIComponent).join('/');
  return `${process.env.B2_PUBLIC_URL}/${process.env.B2_BUCKET_NAME}/${encoded}`;
};

const RESOURCE_MAP = {
  beats: { model: Beat, playlistModel: Playlist, playlistKey: 'playlistId', responseKey: 'beats', fileField: 'audioFile' },
  samples: { model: Samples, playlistModel: SamplePack, playlistKey: 'samplepackId', responseKey: 'samples', fileField: 'audioFile' },
  loops: { model: Loops, playlistModel: Playlist, playlistKey: 'playlistId', responseKey: 'loops', fileField: 'audioFile' },
  prodmixmasters: { model: ProdMixMasters, playlistModel: Playlist, playlistKey: 'playlistId', responseKey: 'tracks', fileField: 'audioFile' },
};

router.get('/playlists', asyncHandler(async (req, res) => {
  const playlists = await Playlist.find().sort({ createdAt: -1 }).lean();
  const playlistIds = playlists.map(pl => pl._id);
  const counts = await Beat.aggregate([
    { $match: { playlistId: { $in: playlistIds } } },
    { $group: { _id: '$playlistId', count: { $sum: 1 } } },
  ]);
  const countMap = {};
  for (const c of counts) countMap[c._id.toString()] = c.count;

  const result = playlists.map(pl => ({
    ...pl,
    imageUrl: buildPublicUrl(pl.imageUrl),
    backgroundVideo: buildPublicUrl(pl.backgroundVideo),
    beatsCount: countMap[pl._id.toString()] || 0,
  }));
  res.json(result);
}));

router.get('/samplePacks', asyncHandler(async (req, res) => {
  const samplepacks = await SamplePack.find().sort({ createdAt: -1 }).lean();
  const samplepackIds = samplepacks.map(sp => sp._id);
  const counts = await Samples.aggregate([
    { $match: { samplepackId: { $in: samplepackIds } } },
    { $group: { _id: '$samplepackId', count: { $sum: 1 } } },
  ]);
  const countMap = {};
  for (const c of counts) countMap[c._id.toString()] = c.count;

  const result = samplepacks.map(sp => ({
    ...sp,
    imageUrl: buildPublicUrl(sp.imageUrl),
    samplesCount: countMap[sp._id.toString()] || 0,
  }));
  res.json(result);
}));

router.get('/:resourceType', asyncHandler(async (req, res) => {
  const { resourceType } = req.params;
  const resource = RESOURCE_MAP[resourceType];
  if (!resource) {
    return res.status(400).json({ message: 'Tipo de recurso no válido' });
  }
  let items = await resource.model.find().lean();
  items = items.map((item) => ({
    ...item,
    audioFile: buildPublicUrl(item[resource.fileField]),
  }));
  res.json(items);
}));

router.get('/:resourceType/playlist/:playlistId', asyncHandler(async (req, res) => {
  const { resourceType, playlistId } = req.params;
  const resource = RESOURCE_MAP[resourceType];
  if (!resource) {
    return res.status(400).json({ message: 'Tipo de recurso no válido' });
  }
  if (!mongoose.Types.ObjectId.isValid(playlistId)) {
    return res.status(400).json({ message: 'ID de playlist no válido' });
  }

  const playlist = await resource.playlistModel.findById(playlistId).lean();
  if (!playlist) {
    return res.status(404).json({ message: resourceType === 'samples' ? 'Sample pack no encontrado' : 'Playlist no encontrada' });
  }

  const playlistWithUrls = {
    ...playlist,
    imageUrl: buildPublicUrl(playlist.imageUrl),
    backgroundVideo: buildPublicUrl(playlist.backgroundVideo),
  };

  let items = await resource.model.find({
    [resource.playlistKey]: new mongoose.Types.ObjectId(playlistId),
  }).sort({ createdAt: -1 }).lean();

  items = items.map((item) => ({
    ...item,
    audioFile: buildPublicUrl(item[resource.fileField]),
  }));

  res.json({ ...playlistWithUrls, [resource.responseKey]: items });
}));

module.exports = router;
