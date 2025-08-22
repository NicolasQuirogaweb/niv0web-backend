const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const B2 = require('backblaze-b2');
require('dotenv').config();

// Modelos
const Playlist = require('../models/Playlist');  
const Beat = require('../models/Beat');  
const SamplePack = require('../models/SamplePack');  
const Samples = require('../models/Samples');  
const Loops = require('../models/Loops');
const ProdMixMasters = require('../models/ProdMixMasters');

// Inicializar Backblaze B2
const b2 = new B2({
  applicationKeyId: process.env.B2_KEY_ID,
  applicationKey: process.env.B2_APPLICATION_KEY,
});

// Función para generar signed URL de un archivo en B2
const getSignedUrl = async (fileName) => {
  if (!fileName) return null;
  await b2.authorize();
  const auth = await b2.getDownloadAuthorization({
    bucketId: process.env.B2_BUCKET_ID,
    fileNamePrefix: fileName,
    validDurationInSeconds: 3600, // 1 hora
  });
  const token = auth.data.authorizationToken;
  return `https://f005.backblazeb2.com/file/${process.env.B2_BUCKET_NAME}/${fileName}?Authorization=${token}`;
};

// ✅ Ruta para obtener todas las playlists con signed URLs
router.get('/playlists', async (req, res) => {
  try {
    const playlists = await Playlist.find({});

    const playlistsWithUrls = await Promise.all(
      playlists.map(async (pl) => {
        return {
          ...pl._doc,
          imageUrl: await getSignedUrl(pl.imageUrl),
          backgroundVideo: await getSignedUrl(pl.backgroundVideo),
        };
      })
    );

    res.status(200).json(playlistsWithUrls);
  } catch (error) {
    console.error("Error al obtener playlists:", error);
    res.status(500).json({ message: 'Error al obtener playlists' });
  }
});

// ✅ Ruta específica para obtener sample packs con signed URLs
router.get('/samplePacks', async (req, res) => {
  try {
    const samplepacks = await SamplePack.find();

    const samplepacksWithUrls = await Promise.all(
      samplepacks.map(async (sp) => ({
        ...sp._doc,
        imageUrl: await getSignedUrl(sp.imageUrl),
      }))
    );

    res.status(200).json(samplepacksWithUrls);
  } catch (error) {
    console.error("Error al obtener samplepacks:", error);
    res.status(500).json({ message: 'Error al obtener samplepacks' });
  }
});

// ✅ Resto de rutas sin cambios, pero agregando signed URLs a beats y samples
router.get('/:resourceType', async (req, res) => {
  const { resourceType } = req.params;
  try {
    let resources;
    if (resourceType === 'beats') {
      resources = await Beat.find().populate('playlistId');
      resources = await Promise.all(
        resources.map(async (beat) => ({
          ...beat._doc,
          audioUrl: await getSignedUrl(beat.audioUrl),
        }))
      );
    } else if (resourceType === 'samples') {
      resources = await Samples.find().populate('samplepackId');
      resources = await Promise.all(
        resources.map(async (sample) => ({
          ...sample._doc,
          audioUrl: await getSignedUrl(sample.audioUrl),
        }))
      );
    } else {
      return res.status(400).json({ message: 'Tipo de recurso no válido' });
    }
    res.status(200).json(resources);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Error al obtener los recursos' });
  }
});

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
      beatsOrSamples = await Promise.all(
        beatsOrSamples.map(async (beat) => ({
          ...beat._doc,
          audioUrl: await getSignedUrl(beat.audioUrl),
        }))
      );
    } else if (resourceType === 'samples') {
      const samplePack = await SamplePack.findById(playlistId);
      if (!samplePack) return res.status(404).json({ message: 'Sample pack no encontrado' });

      beatsOrSamples = await Samples.find({ samplepackId: playlistId });
      beatsOrSamples = await Promise.all(
        beatsOrSamples.map(async (sample) => ({
          ...sample._doc,
          audioUrl: await getSignedUrl(sample.audioUrl),
        }))
      );
    } else {
      return res.status(400).json({ message: 'Tipo de recurso no válido' });
    }

    res.status(200).json({ ...playlist.toObject(), beats: beatsOrSamples });
  } catch (error) {
    console.error("Error al obtener los recursos:", error);
    res.status(500).json({ message: 'Error al obtener los recursos' });
  }
});

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

    let samples = await Samples.find({ samplepackId });
    samples = await Promise.all(
      samples.map(async (sample) => ({
        ...sample._doc,
        audioUrl: await getSignedUrl(sample.audioUrl),
      }))
    );

    res.status(200).json({ ...samplePack.toObject(), samples });
  } catch (error) {
    console.error("Error al obtener los samples:", error);
    res.status(500).json({ message: 'Error al obtener los samples' });
  }
});

module.exports = router;
