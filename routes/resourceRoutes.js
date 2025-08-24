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

  // Si es un archivo local o URL absoluta, lo devolvemos tal cual
  if (filePath.startsWith('http') || filePath.startsWith('/videos')) {
    return filePath;
  }

  // 🚨 Caso clave: es una key guardada en MongoDB (ej: "images/audioimgblack.webp")
  try {
    // Autenticamos contra B2
    await b2.authorize();

    // Obtenemos la URL de descarga del archivo
    const { data } = await b2.getDownloadAuthorization({
      bucketId: process.env.B2_BUCKET_ID,
      fileNamePrefix: filePath, // ej: "images/audioimgblack.webp"
      validDurationInSeconds: 60 * 60, // 1 hora
    });

    // La signed URL se arma con el downloadUrl + key + token
    const downloadUrl = `${b2.downloadUrl}/file/${process.env.B2_BUCKET_NAME}/${filePath}?Authorization=${data.authorizationToken}`;

    return downloadUrl;
  } catch (err) {
    console.error("❌ Error generando signed URL:", err.message);
    return null;
  }
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

    // ⬇️ ACA ESTÁ EL CAMBIO
    let items = await resource.model.find({
      [resource.playlistKey]: new mongoose.Types.ObjectId(playlistId),
    });

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
