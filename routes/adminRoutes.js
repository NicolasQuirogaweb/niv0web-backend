const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const multer = require('multer');
const adminAuth = require('../middleware/adminAuth');
const { uploadToB2 } = require('../utils/b2Uploader');

const Playlist = require('../models/Playlist');
const Beat = require('../models/Beat');
const Loops = require('../models/Loops');
const SamplePack = require('../models/SamplePack');
const Samples = require('../models/Samples');
const ProdMixMasters = require('../models/ProdMixMasters');
const User = require('../models/User');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 200 * 1024 * 1024 } });

const buildPublicUrl = (filePath) => {
  if (!filePath) return null;
  if (filePath.startsWith('http')) return filePath;
  const clean = filePath.replace(/^\/+/, '');
  const encoded = clean.split('/').map(encodeURIComponent).join('/');
  return `${process.env.B2_PUBLIC_URL}/${process.env.B2_BUCKET_NAME}/${encoded}`;
};

router.post('/upload', adminAuth, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ message: 'No se envió ningún archivo' });
    const folder = req.body.folder || 'uploads';
    const url = await uploadToB2(req.file.buffer, req.file.originalname, folder);
    res.json({ url, fileName: req.file.originalname });
  } catch (error) {
    console.error('Error al subir archivo:', error);
    res.status(500).json({ message: 'Error al subir archivo' });
  }
});

router.post('/upload/batch', adminAuth, upload.array('files', 20), async (req, res) => {
  try {
    if (!req.files || req.files.length === 0) return res.status(400).json({ message: 'No se enviaron archivos' });
    const folder = req.body.folder || 'uploads';
    const results = await Promise.allSettled(
      req.files.map(file => uploadToB2(file.buffer, file.originalname, folder))
    );
    const urls = [];
    const errors = [];
    req.files.forEach((file, i) => {
      if (results[i].status === 'fulfilled') {
        urls.push({ originalName: file.originalname, url: results[i].value });
      } else {
        errors.push({ originalName: file.originalname, error: results[i].reason?.message || 'Unknown error' });
      }
    });
    res.json({ urls, errors });
  } catch (error) {
    console.error('=== BATCH UPLOAD ERROR ===');
    console.error('Message:', error.message);
    console.error('Stack:', error.stack);
    if (error.response) console.error('Response status:', error.response.status, 'data:', JSON.stringify(error.response.data).slice(0, 500));
    if (error.config) console.error('Request URL:', error.config.url);
    if (error.uploadContext) console.error('Upload context:', error.uploadContext);
    res.status(500).json({ message: 'Error al subir archivos', detail: error.message });
  }
});

router.get('/users', adminAuth, async (req, res) => {
  try {
    const users = await User.find().sort({ createdAt: -1 }).lean();
    res.json(users);
  } catch (error) {
    res.status(500).json({ message: 'Error al obtener usuarios' });
  }
});

router.put('/users/:id/role', adminAuth, async (req, res) => {
  try {
    const { role } = req.body;
    if (!['user', 'admin'].includes(role)) return res.status(400).json({ message: 'Rol no válido' });
    const user = await User.findByIdAndUpdate(req.params.id, { role }, { new: true }).lean();
    if (!user) return res.status(404).json({ message: 'Usuario no encontrado' });
    res.json(user);
  } catch (error) {
    res.status(500).json({ message: 'Error al actualizar rol' });
  }
});

// ========== PLAYLISTS (beats & loops) ==========

router.get('/playlists', adminAuth, async (req, res) => {
  try {
    const playlists = await Playlist.find().sort({ createdAt: -1 }).lean();
    const result = await Promise.all(playlists.map(async (pl) => {
      const Model = pl.type === 'beats' ? Beat : Loops;
      const count = await Model.countDocuments({ playlistId: pl._id });
      return { ...pl, itemsCount: count };
    }));
    res.json(result);
  } catch (error) {
    res.status(500).json({ message: 'Error al obtener playlists' });
  }
});

router.post('/playlists', adminAuth, async (req, res) => {
  try {
    const { title, description, imageUrl, backgroundVideo, type } = req.body;
    if (!title || !description || !imageUrl || !backgroundVideo || !type) {
      return res.status(400).json({ message: 'Todos los campos son obligatorios' });
    }
    const playlist = await Playlist.create({ title, description, imageUrl, backgroundVideo, type });
    res.status(201).json(playlist);
  } catch (error) {
    res.status(500).json({ message: 'Error al crear playlist' });
  }
});

router.put('/playlists/:id', adminAuth, async (req, res) => {
  try {
    const { title, description, imageUrl, backgroundVideo } = req.body;
    const playlist = await Playlist.findByIdAndUpdate(
      req.params.id,
      { $set: { title, description, imageUrl, backgroundVideo } },
      { new: true, runValidators: true }
    ).lean();
    if (!playlist) return res.status(404).json({ message: 'Playlist no encontrada' });
    res.json(playlist);
  } catch (error) {
    res.status(500).json({ message: 'Error al actualizar playlist' });
  }
});

router.delete('/playlists/:id', adminAuth, async (req, res) => {
  try {
    const playlist = await Playlist.findById(req.params.id);
    if (!playlist) return res.status(404).json({ message: 'Playlist no encontrada' });

    const Model = playlist.type === 'beats' ? Beat : Loops;
    await Model.deleteMany({ playlistId: playlist._id });
    await Playlist.findByIdAndDelete(req.params.id);

    res.json({ message: 'Playlist y sus items eliminados' });
  } catch (error) {
    res.status(500).json({ message: 'Error al eliminar playlist' });
  }
});

router.post('/playlists/:id/duplicate', adminAuth, async (req, res) => {
  try {
    const original = await Playlist.findById(req.params.id).lean();
    if (!original) return res.status(404).json({ message: 'Playlist no encontrada' });

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

    res.status(201).json({ message: 'Playlist duplicada', playlist: newPlaylist, itemsCount: newItems.length });
  } catch (error) {
    res.status(500).json({ message: 'Error al duplicar playlist' });
  }
});

// ========== BEATS ==========

router.get('/playlists/:playlistId/beats', adminAuth, async (req, res) => {
  try {
    const beats = await Beat.find({ playlistId: req.params.playlistId }).sort({ createdAt: -1 }).lean();
    res.json(beats);
  } catch (error) {
    res.status(500).json({ message: 'Error al obtener beats' });
  }
});

router.post('/playlists/:playlistId/beats', adminAuth, async (req, res) => {
  try {
    const { title, artist, description, audioFile } = req.body;
    if (!title || !audioFile) {
      return res.status(400).json({ message: 'Faltan campos obligatorios (título y audio)' });
    }
    const beat = await Beat.create({ title, artist: artist || '', description: description || '', audioFile, playlistId: req.params.playlistId });
    res.status(201).json(beat);
  } catch (error) {
    res.status(500).json({ message: 'Error al crear beat' });
  }
});

router.post('/playlists/:playlistId/beats/batch', adminAuth, async (req, res) => {
  try {
    const { beats } = req.body;
    if (!Array.isArray(beats) || beats.length === 0) {
      return res.status(400).json({ message: 'Se requiere un array de beats' });
    }
    const withPlaylistId = beats.map(b => ({ ...b, playlistId: req.params.playlistId }));
    const created = await Beat.insertMany(withPlaylistId);
    res.status(201).json({ beats: created, count: created.length });
  } catch (error) {
    res.status(500).json({ message: 'Error al crear beats en lote' });
  }
});

router.put('/beats/:id', adminAuth, async (req, res) => {
  try {
    const { title, artist, description, audioFile } = req.body;
    const beat = await Beat.findByIdAndUpdate(
      req.params.id,
      { $set: { title, artist, description, audioFile } },
      { new: true, runValidators: true }
    ).lean();
    if (!beat) return res.status(404).json({ message: 'Beat no encontrado' });
    res.json(beat);
  } catch (error) {
    res.status(500).json({ message: 'Error al actualizar beat' });
  }
});

router.delete('/beats/:id', adminAuth, async (req, res) => {
  try {
    const beat = await Beat.findByIdAndDelete(req.params.id).lean();
    if (!beat) return res.status(404).json({ message: 'Beat no encontrado' });
    res.json({ message: 'Beat eliminado' });
  } catch (error) {
    res.status(500).json({ message: 'Error al eliminar beat' });
  }
});

// ========== LOOPS ==========

router.get('/playlists/:playlistId/loops', adminAuth, async (req, res) => {
  try {
    const loops = await Loops.find({ playlistId: req.params.playlistId }).sort({ createdAt: -1 }).lean();
    res.json(loops);
  } catch (error) {
    res.status(500).json({ message: 'Error al obtener loops' });
  }
});

router.post('/playlists/:playlistId/loops', adminAuth, async (req, res) => {
  try {
    const { title, description, audioFile } = req.body;
    if (!title || !audioFile) {
      return res.status(400).json({ message: 'Faltan campos obligatorios (título y audio)' });
    }
    const loop = await Loops.create({ title, description: description || '', audioFile, playlistId: req.params.playlistId });
    res.status(201).json(loop);
  } catch (error) {
    res.status(500).json({ message: 'Error al crear loop' });
  }
});

router.post('/playlists/:playlistId/loops/batch', adminAuth, async (req, res) => {
  try {
    const { loops } = req.body;
    if (!Array.isArray(loops) || loops.length === 0) {
      return res.status(400).json({ message: 'Se requiere un array de loops' });
    }
    const withPlaylistId = loops.map(l => ({ ...l, playlistId: req.params.playlistId }));
    const created = await Loops.insertMany(withPlaylistId);
    res.status(201).json({ loops: created, count: created.length });
  } catch (error) {
    res.status(500).json({ message: 'Error al crear loops en lote' });
  }
});

router.put('/loops/:id', adminAuth, async (req, res) => {
  try {
    const { title, description, audioFile } = req.body;
    const loop = await Loops.findByIdAndUpdate(
      req.params.id,
      { $set: { title, description, audioFile } },
      { new: true, runValidators: true }
    ).lean();
    if (!loop) return res.status(404).json({ message: 'Loop no encontrado' });
    res.json(loop);
  } catch (error) {
    res.status(500).json({ message: 'Error al actualizar loop' });
  }
});

router.delete('/loops/:id', adminAuth, async (req, res) => {
  try {
    const loop = await Loops.findByIdAndDelete(req.params.id).lean();
    if (!loop) return res.status(404).json({ message: 'Loop no encontrado' });
    res.json({ message: 'Loop eliminado' });
  } catch (error) {
    res.status(500).json({ message: 'Error al eliminar loop' });
  }
});

// ========== SAMPLE PACKS ==========

router.get('/samplepacks', adminAuth, async (req, res) => {
  try {
    const samplepacks = await SamplePack.find().sort({ createdAt: -1 }).lean();
    const result = await Promise.all(samplepacks.map(async (sp) => {
      const count = await Samples.countDocuments({ samplepackId: sp._id });
      return { ...sp, itemsCount: count };
    }));
    res.json(result);
  } catch (error) {
    res.status(500).json({ message: 'Error al obtener sample packs' });
  }
});

router.post('/samplepacks', adminAuth, async (req, res) => {
  try {
    const { title, description, imageUrl } = req.body;
    if (!title || !description || !imageUrl) {
      return res.status(400).json({ message: 'Todos los campos son obligatorios' });
    }
    const samplepack = await SamplePack.create({ title, description, imageUrl, type: 'samples' });
    res.status(201).json(samplepack);
  } catch (error) {
    res.status(500).json({ message: 'Error al crear sample pack' });
  }
});

router.put('/samplepacks/:id', adminAuth, async (req, res) => {
  try {
    const { title, description, imageUrl } = req.body;
    const samplepack = await SamplePack.findByIdAndUpdate(
      req.params.id,
      { $set: { title, description, imageUrl } },
      { new: true, runValidators: true }
    ).lean();
    if (!samplepack) return res.status(404).json({ message: 'Sample pack no encontrado' });
    res.json(samplepack);
  } catch (error) {
    res.status(500).json({ message: 'Error al actualizar sample pack' });
  }
});

router.delete('/samplepacks/:id', adminAuth, async (req, res) => {
  try {
    const samplepack = await SamplePack.findById(req.params.id);
    if (!samplepack) return res.status(404).json({ message: 'Sample pack no encontrado' });
    await Samples.deleteMany({ samplepackId: samplepack._id });
    await SamplePack.findByIdAndDelete(req.params.id);
    res.json({ message: 'Sample pack y sus samples eliminados' });
  } catch (error) {
    res.status(500).json({ message: 'Error al eliminar sample pack' });
  }
});

router.post('/samplepacks/:id/duplicate', adminAuth, async (req, res) => {
  try {
    const original = await SamplePack.findById(req.params.id).lean();
    if (!original) return res.status(404).json({ message: 'Sample pack no encontrado' });
    const newSp = await SamplePack.create({
      title: `Copia de ${original.title}`,
      description: original.description,
      imageUrl: original.imageUrl,
      type: 'samples',
    });
    const samples = await Samples.find({ samplepackId: original._id }).lean();
    const newSamples = samples.map(s => ({
      title: s.title,
      description: s.description,
      audioFile: s.audioFile,
      samplepackId: newSp._id,
    }));
    if (newSamples.length > 0) await Samples.insertMany(newSamples);
    res.status(201).json({ message: 'Sample pack duplicado', samplepack: newSp, itemsCount: newSamples.length });
  } catch (error) {
    res.status(500).json({ message: 'Error al duplicar sample pack' });
  }
});

// ========== SAMPLES ==========

router.get('/samplepacks/:samplepackId/samples', adminAuth, async (req, res) => {
  try {
    const samples = await Samples.find({ samplepackId: req.params.samplepackId }).sort({ createdAt: -1 }).lean();
    res.json(samples);
  } catch (error) {
    res.status(500).json({ message: 'Error al obtener samples' });
  }
});

router.post('/samplepacks/:samplepackId/samples', adminAuth, async (req, res) => {
  try {
    const { title, description, audioFile } = req.body;
    if (!title || !audioFile) {
      return res.status(400).json({ message: 'Faltan campos obligatorios (título y audio)' });
    }
    const sample = await Samples.create({ title, description: description || '', audioFile, samplepackId: req.params.samplepackId });
    res.status(201).json(sample);
  } catch (error) {
    res.status(500).json({ message: 'Error al crear sample' });
  }
});

router.post('/samplepacks/:samplepackId/samples/batch', adminAuth, async (req, res) => {
  try {
    const { samples } = req.body;
    if (!Array.isArray(samples) || samples.length === 0) {
      return res.status(400).json({ message: 'Se requiere un array de samples' });
    }
    const withPackId = samples.map(s => ({ ...s, samplepackId: req.params.samplepackId }));
    const created = await Samples.insertMany(withPackId);
    res.status(201).json({ samples: created, count: created.length });
  } catch (error) {
    res.status(500).json({ message: 'Error al crear samples en lote' });
  }
});

router.put('/samples/:id', adminAuth, async (req, res) => {
  try {
    const { title, description, audioFile } = req.body;
    const sample = await Samples.findByIdAndUpdate(
      req.params.id,
      { $set: { title, description, audioFile } },
      { new: true, runValidators: true }
    ).lean();
    if (!sample) return res.status(404).json({ message: 'Sample no encontrado' });
    res.json(sample);
  } catch (error) {
    res.status(500).json({ message: 'Error al actualizar sample' });
  }
});

router.delete('/samples/:id', adminAuth, async (req, res) => {
  try {
    const sample = await Samples.findByIdAndDelete(req.params.id).lean();
    if (!sample) return res.status(404).json({ message: 'Sample no encontrado' });
    res.json({ message: 'Sample eliminado' });
  } catch (error) {
    res.status(500).json({ message: 'Error al eliminar sample' });
  }
});

// ========== PROD MIX MASTERS ==========

router.get('/prodmixmasters', adminAuth, async (req, res) => {
  try {
    const items = await ProdMixMasters.find().sort({ createdAt: -1 }).lean();
    res.json(items);
  } catch (error) {
    res.status(500).json({ message: 'Error al obtener prod mix masters' });
  }
});

router.post('/prodmixmasters', adminAuth, async (req, res) => {
  try {
    const { title, description, audioFile } = req.body;
    if (!title || !audioFile) {
      return res.status(400).json({ message: 'Faltan campos obligatorios (título y audio)' });
    }
    const item = await ProdMixMasters.create({ title, description: description || '', audioFile });
    res.status(201).json(item);
  } catch (error) {
    res.status(500).json({ message: 'Error al crear prod mix master' });
  }
});

router.put('/prodmixmasters/:id', adminAuth, async (req, res) => {
  try {
    const { title, description, audioFile } = req.body;
    const item = await ProdMixMasters.findByIdAndUpdate(
      req.params.id,
      { $set: { title, description, audioFile } },
      { new: true, runValidators: true }
    ).lean();
    if (!item) return res.status(404).json({ message: 'Prod mix master no encontrado' });
    res.json(item);
  } catch (error) {
    res.status(500).json({ message: 'Error al actualizar prod mix master' });
  }
});

router.delete('/prodmixmasters/:id', adminAuth, async (req, res) => {
  try {
    const item = await ProdMixMasters.findByIdAndDelete(req.params.id).lean();
    if (!item) return res.status(404).json({ message: 'Prod mix master no encontrado' });
    res.json({ message: 'Prod mix master eliminado' });
  } catch (error) {
    res.status(500).json({ message: 'Error al eliminar prod mix master' });
  }
});

// ========== DASHBOARD STATS ==========

router.get('/dashboard', adminAuth, async (req, res) => {
  try {
    const [playlists, beats, loops, samplepacks, samples, prodmix, users] = await Promise.all([
      Playlist.countDocuments(),
      Beat.countDocuments(),
      Loops.countDocuments(),
      SamplePack.countDocuments(),
      Samples.countDocuments(),
      ProdMixMasters.countDocuments(),
      User.countDocuments(),
    ]);
    res.json({ playlists, beats, loops, samplepacks, samples, prodmix, users });
  } catch (error) {
    res.status(500).json({ message: 'Error al obtener estadísticas' });
  }
});

module.exports = router;
