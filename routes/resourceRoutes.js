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

// Función para generar signed URL de Backblaze
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

// Map de recursos para manejar todos los tipos
const RESOURCE_MAP = {
  beats: { model: Beat, playlistModel: Playlist, playlistKey: 'playlistId', responseKey: 'beats', fileField: 'audioFile' },
  samples: { model: Samples, playlistModel: SamplePack, playlistKey: 'samplepackId', responseKey: 'samples', fileField: 'audioFile' },
  loops: { model: Loops, playlistModel: Playlist, playlistKey: 'playlistId', responseKey: 'loops', fileField: 'audioFile' },
  prodmixmasters: { model: ProdMixMasters, playlistModel: Playlist, playlistKey: 'playlistId', responseKey: 'tracks', fileField: 'audioFile' },
};

// ✅ Obtener todos los recursos de un tipo
router.get('/:resourceType', async (req, res) => {
  const { resourceType } = req.params;
  const resource = RESOURCE_MAP[resourceType];

  if (!resource) return res.status(400).json({ message: 'Tipo de recurso no válido' });

  try {
    let items = await resource.model.find();
    items = await Promise.all(
      items.map(async (item) => ({
        ...item._doc,
        audioUrl: await getSignedUrl(item[resource.fileField]),
      }))
    );
    res.status(200).json(items);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: `Error al obtener ${resourceType}` });
  }
});

// ✅ Obtener un catálogo / playlist específico con sus recursos
router.get('/:resourceType/playlist/:playlistId', async (req, res) => {
  const { resourceType, playlistId } = req.params;
  const resource = RESOURCE_MAP[resourceType];
  if (!resource) return res.status(400).json({ message: 'Tipo de recurso no válido' });

  if (!mongoose.Types.ObjectId.isValid(playlistId)) {
    return res.status(400).json({ message: 'ID de playlist no válido' });
  }

  try {
    const playlist = await resource.playlistModel.findById(playlistId);
    if (!playlist) return res.status(404).json({ message: 'Playlist no encontrada' });

    // Signed URLs para la playlist
    const playlistWithUrls = {
      ...playlist._doc,
      imageUrl: await getSignedUrl(playlist.imageUrl),
      backgroundVideo: await getSignedUrl(playlist.backgroundVideo),
    };

    // Obtener todos los recursos asociados
    let items = await resource.model.find({ [resource.playlistKey]: playlistId });
    items = await Promise.all(
      items.map(async (item) => ({
        ...item._doc,
        audioUrl: await getSignedUrl(item[resource.fileField]),
      }))
    );

    res.status(200).json({ ...playlistWithUrls, [resource.responseKey]: items });
  } catch (error) {
    console.error(`Error al obtener ${resourceType} de la playlist:`, error);
    res.status(500).json({ message: `Error al obtener ${resourceType}` });
  }
});

module.exports = router;
