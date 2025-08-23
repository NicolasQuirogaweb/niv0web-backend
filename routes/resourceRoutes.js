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

// Función para generar signed URL solo si el path es relativo
const getSignedUrlIfNeeded = async (filePath) => {
  if (!filePath) return null;

  // Si ya es una URL absoluta (http) o video interno, retornamos tal cual
  if (filePath.startsWith('http') || filePath.startsWith('/videos')) return filePath;

  await b2.authorize();

  // Generamos token temporal para bucket privado
  const auth = await b2.getDownloadAuthorization({
    bucketId: process.env.B2_BUCKET_ID,
    fileNamePrefix: filePath,
    validDurationInSeconds: 60 * 60 * 24 * 7, // 7 días
  });

  // Construimos la URL usando fileName real y token temporal
  return `https://f005.backblazeb2.com/file/${process.env.B2_BUCKET_NAME}/${filePath}?Authorization=${auth.data.authorizationToken}`;
};

// Map de recursos
const RESOURCE_MAP = {
  beats: { model: Beat, playlistModel: Playlist, playlistKey: 'playlistId', responseKey: 'beats', fileField: 'audioFile' },
  samples: { model: Samples, playlistModel: SamplePack, playlistKey: 'samplepackId', responseKey: 'samples', fileField: 'audioFile' },
  loops: { model: Loops, playlistModel: Playlist, playlistKey: 'playlistId', responseKey: 'loops', fileField: 'audioFile' },
  prodmixmasters: { model: ProdMixMasters, playlistModel: Playlist, playlistKey: 'playlistId', responseKey: 'tracks', fileField: 'audioFile' },
};

// ---------------------
// ✅ PLAYLISTS BEATS
// ---------------------
router.get('/playlists', async (req, res) => {
  try {
    const playlists = await Playlist.find();
    const playlistsWithUrls = await Promise.all(
      playlists.map(async (pl) => ({
        ...pl._doc,
        imageUrl: await getSignedUrlIfNeeded(pl.imageUrl),
        backgroundVideo: await getSignedUrlIfNeeded(pl.backgroundVideo),
        beatsCount: await Beat.countDocuments({ playlistId: pl._id }),
      }))
    );
    res.status(200).json(playlistsWithUrls);
  } catch (error) {
    console.error('Error al obtener playlists:', error);
    res.status(500).json({ message: 'Error al obtener playlists' });
  }
});

// ---------------------
// ✅ SAMPLE PACKS
// ---------------------
router.get('/samplePacks', async (req, res) => {
  try {
    const samplepacks = await SamplePack.find();
    const samplepacksWithUrls = await Promise.all(
      samplepacks.map(async (sp) => ({
        ...sp._doc,
        imageUrl: await getSignedUrlIfNeeded(sp.imageUrl),
        samplesCount: await Samples.countDocuments({ samplepackId: sp._id }),
      }))
    );
    res.status(200).json(samplepacksWithUrls);
  } catch (error) {
    console.error('Error al obtener samplepacks:', error);
    res.status(500).json({ message: 'Error al obtener samplepacks' });
  }
});

// ---------------------
// ✅ TODOS LOS RECURSOS
// ---------------------
router.get('/:resourceType', async (req, res) => {
  const { resourceType } = req.params;
  const resource = RESOURCE_MAP[resourceType];
  if (!resource) return res.status(400).json({ message: 'Tipo de recurso no válido' });

  try {
    let items = await resource.model.find();
    items = await Promise.all(
      items.map(async (item) => ({
        ...item._doc,
        audioFile: await getSignedUrlIfNeeded(item[resource.fileField]),
      }))
    );
    res.status(200).json(items);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: `Error al obtener ${resourceType}` });
  }
});

// ---------------------
// ✅ PLAYLIST / SAMPLE PACK INDIVIDUAL
// ---------------------
router.get('/:resourceType/playlist/:playlistId', async (req, res) => {
  const { resourceType, playlistId } = req.params;
  const resource = RESOURCE_MAP[resourceType];
  if (!resource) return res.status(400).json({ message: 'Tipo de recurso no válido' });
  if (!mongoose.Types.ObjectId.isValid(playlistId)) {
    return res.status(400).json({ message: 'ID de playlist no válido' });
  }

  try {
    const playlist = await resource.playlistModel.findById(playlistId);
    if (!playlist) return res.status(404).json({ message: resourceType === 'samples' ? 'Sample pack no encontrado' : 'Playlist no encontrada' });

    const playlistWithUrls = {
      ...playlist._doc,
      imageUrl: await getSignedUrlIfNeeded(playlist.imageUrl),
      backgroundVideo: await getSignedUrlIfNeeded(playlist.backgroundVideo),
    };

    let items = await resource.model.find({ [resource.playlistKey]: playlistId });
    items = await Promise.all(
      items.map(async (item) => ({
        ...item._doc,
        audioFile: await getSignedUrlIfNeeded(item[resource.fileField]),
      }))
    );

    res.status(200).json({ ...playlistWithUrls, [resource.responseKey]: items });
  } catch (error) {
    console.error(`Error al obtener ${resourceType} de la playlist:`, error);
    res.status(500).json({ message: `Error al obtener ${resourceType}` });
  }
});

module.exports = router;
