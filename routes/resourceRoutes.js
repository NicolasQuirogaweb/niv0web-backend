const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');

// Modelos
const Playlist = require('../models/Playlist');  
const Beat = require('../models/Beat');  
const SamplePack = require('../models/SamplePack');  
const Samples = require('../models/Samples');  
const Loops = require('../models/Loops');
const ProdMixMasters = require('../models/ProdMixMasters');

// ✅ Ruta para obtener todas las playlists 
router.get('/playlists', async (req, res) => {
  try {
    const playlists = await Playlist.find({});
    res.status(200).json(playlists);
  } catch (error) {
    console.error("Error al obtener playlists:", error);
    res.status(500).json({ message: 'Error al obtener playlists' });
  }
});

// ✅ Ruta específica para obtener sample packs
router.get('/samplePacks', async (req, res) => {
  try {
    const samplepacks = await SamplePack.find();
    res.status(200).json(samplepacks);
  } catch (error) {
    console.error("Error al obtener samplepacks:", error);
    res.status(500).json({ message: 'Error al obtener samplepacks' });
  }
});

// ✅ Ruta para obtener todos los loops
router.get('/loops', async (req, res) => {
  try {
    const loops = await Loops.find();
    res.status(200).json(loops);
  } catch (error) {
    console.error("Error al obtener loops:", error);
    res.status(500).json({ message: 'Error al obtener loops' });
  }
});

// ✅ Ruta para obtener todos los prodmixmasters
router.get('/prodmixmasters', async (req, res) => {
  try {
    const prodmixmasters = await ProdMixMasters.find();
    res.status(200).json(prodmixmasters);
  } catch (error) {
    console.error("Error al obtener prodmixmasters:", error);
    res.status(500).json({ message: 'Error al obtener prodmixmasters' });
  }
});

// ✅ Ruta dinámica para obtener recursos por tipo
router.get('/:resourceType', async (req, res) => {
  const { resourceType } = req.params;
  try {
    let resources;
    if (resourceType === 'beats') {
      resources = await Beat.find().populate('playlistId');
    } else if (resourceType === 'samples') {
      resources = await Samples.find().populate('samplepackId');
    } else {
      return res.status(400).json({ message: 'Tipo de recurso no válido' });
    }
    res.status(200).json(resources);
  } catch (error) {
    res.status(500).json({ message: 'Error al obtener los recursos' });
  }
});

// ✅ Ruta para obtener recursos de una playlist específica
router.get('/:resourceType/playlist/:playlistId', async (req, res) => {
  const { resourceType, playlistId } = req.params;

  if (!mongoose.Types.ObjectId.isValid(playlistId)) {
    return res.status(400).json({ message: 'ID de playlist no válido' });
  }

  try {
    let playlist;
    let beatsOrSamples = [];

    if (resourceType === 'beats') {
      playlist = await Playlist.findById(playlistId);
      if (!playlist) return res.status(404).json({ message: 'Playlist no encontrada' });

      beatsOrSamples = await Beat.find({ playlistId });
    } else if (resourceType === 'samples') {
      const samplePack = await SamplePack.findById(playlistId);
      if (!samplePack) return res.status(404).json({ message: 'Sample pack no encontrado' });

      beatsOrSamples = await Samples.find({ samplepackId: playlistId });
    } else {
      return res.status(400).json({ message: 'Tipo de recurso no válido' });
    }

    res.status(200).json({ ...playlist.toObject(), beats: beatsOrSamples });
  } catch (error) {
    console.error("Error al obtener los recursos:", error);
    res.status(500).json({ message: 'Error al obtener los recursos' });
  }
});

// ✅ Ruta para obtener recursos de un sample pack específico con sus samples
router.get('/:resourceType/samplepack/:samplepackId', async (req, res) => {
  const { resourceType, samplepackId } = req.params;

  if (!mongoose.Types.ObjectId.isValid(samplepackId)) {
    return res.status(400).json({ message: 'ID de sample pack no válido' });
  }

  try {
    if (resourceType !== 'samples') {
      return res.status(400).json({ message: 'Tipo de recurso no válido' });
    }

    const samplePack = await SamplePack.findById(samplepackId);
    if (!samplePack) return res.status(404).json({ message: 'Sample pack no encontrado' });

    const samples = await Samples.find({ samplepackId });

    res.status(200).json({ ...samplePack.toObject(), samples });
  } catch (error) {
    console.error("Error al obtener los samples:", error);
    res.status(500).json({ message: 'Error al obtener los samples' });
  }
});

module.exports = router;
