const express = require("express");
const router = express.Router();
const mongoose = require("mongoose");
const B2 = require("backblaze-b2");
require("dotenv").config();

// Modelos
const Playlist = require("../models/Playlist");
const Beat = require("../models/Beat");
const SamplePack = require("../models/SamplePack");
const Samples = require("../models/Samples");
const Loops = require("../models/Loops");
const ProdMixMasters = require("../models/ProdMixMasters");

// Inicializar Backblaze B2
const b2 = new B2({
  applicationKeyId: process.env.B2_KEY_ID,
  applicationKey: process.env.B2_APPLICATION_KEY,
});

// ---------------------
// ✅ PROXY PARA ARCHIVOS B2
// ---------------------
router.get("/file/:filePath(*)", async (req, res) => {
  let { filePath } = req.params;
  filePath = filePath.replace(/^\/+/, ""); // 🔑 saca "/" inicial
  try {
    await b2.authorize();
    const { data } = await b2.getDownloadAuthorization({
      bucketId: process.env.B2_BUCKET_ID,
      fileNamePrefix: filePath,
      validDurationInSeconds: 60,
    });

    const signedUrl = `${b2.downloadUrl}/file/${process.env.B2_BUCKET_NAME}/${filePath}?Authorization=${data.authorizationToken}`;
    return res.redirect(signedUrl);
  } catch (err) {
    console.error("❌ Error generando proxy URL:", err.message);
    return res.status(500).json({ message: "Error generando el archivo" });
  }
});

// ---------------------
// 🔑 Helper para armar URL de proxy
// ---------------------
const buildProxyUrl = (filePath) => {
  if (!filePath) return null;
  // le saco barras iniciales por las dudas
  const cleanPath = filePath.replace(/^\/+/, "");
  return `/api/resources/file/${cleanPath}`;
};

// Map de recursos
const RESOURCE_MAP = {
  beats: {
    model: Beat,
    playlistModel: Playlist,
    playlistKey: "playlistId",
    responseKey: "beats",
    fileField: "audioFile",
  },
  samples: {
    model: Samples,
    playlistModel: SamplePack,
    playlistKey: "samplepackId",
    responseKey: "samples",
    fileField: "audioFile",
  },
  loops: {
    model: Loops,
    playlistModel: Playlist,
    playlistKey: "playlistId",
    responseKey: "loops",
    fileField: "audioFile",
  },
  prodmixmasters: {
    model: ProdMixMasters,
    playlistModel: Playlist,
    playlistKey: "playlistId",
    responseKey: "tracks",
    fileField: "audioFile",
  },
};

// ---------------------
// ✅ PLAYLISTS BEATS
// ---------------------
router.get("/playlists", async (req, res) => {
  try {
    const playlists = await Playlist.find().sort({ createdAt: -1 });
    const playlistsWithUrls = await Promise.all(
      playlists.map(async (pl) => ({
        ...pl._doc,
        imageUrl: buildProxyUrl(pl.imageUrl),
        backgroundVideo: buildProxyUrl(pl.backgroundVideo),
        beatsCount: await Beat.countDocuments({ playlistId: pl._id }),
      }))
    );
    res.status(200).json(playlistsWithUrls);
  } catch (error) {
    console.error("Error al obtener playlists:", error);
    res.status(500).json({ message: "Error al obtener playlists" });
  }
});

// ---------------------
// ✅ SAMPLE PACKS
// ---------------------
router.get("/samplePacks", async (req, res) => {
  try {
    const samplepacks = await SamplePack.find().sort({ createdAt: -1 });
    const samplepacksWithUrls = await Promise.all(
      samplepacks.map(async (sp) => ({
        ...sp._doc,
        imageUrl: buildProxyUrl(sp.imageUrl),
        samplesCount: await Samples.countDocuments({ samplepackId: sp._id }),
      }))
    );
    res.status(200).json(samplepacksWithUrls);
  } catch (error) {
    console.error("Error al obtener samplepacks:", error);
    res.status(500).json({ message: "Error al obtener samplepacks" });
  }
});

// ---------------------
// ✅ TODOS LOS RECURSOS
// ---------------------
router.get("/:resourceType", async (req, res) => {
  const { resourceType } = req.params;
  const resource = RESOURCE_MAP[resourceType];
  if (!resource)
    return res.status(400).json({ message: "Tipo de recurso no válido" });

  try {
    let items = await resource.model.find();
    items = items.map((item) => ({
      ...item._doc,
      audioFile: buildProxyUrl(item[resource.fileField]),
    }));
    res.status(200).json(items);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: `Error al obtener ${resourceType}` });
  }
});

// ---------------------
// ✅ PLAYLIST / SAMPLE PACK INDIVIDUAL
// ---------------------
router.get("/:resourceType/playlist/:playlistId", async (req, res) => {
  const { resourceType, playlistId } = req.params;
  const resource = RESOURCE_MAP[resourceType];
  if (!resource)
    return res.status(400).json({ message: "Tipo de recurso no válido" });
  if (!mongoose.Types.ObjectId.isValid(playlistId)) {
    return res.status(400).json({ message: "ID de playlist no válido" });
  }

  try {
    const playlist = await resource.playlistModel.findById(playlistId);
    if (!playlist) {
      return res
        .status(404)
        .json({
          message:
            resourceType === "samples"
              ? "Sample pack no encontrado"
              : "Playlist no encontrada",
        });
    }

    const playlistWithUrls = {
      ...playlist._doc,
      imageUrl: buildProxyUrl(playlist.imageUrl),
      backgroundVideo: buildProxyUrl(playlist.backgroundVideo),
    };

    let items = await resource.model
      .find({
        [resource.playlistKey]: new mongoose.Types.ObjectId(playlistId),
      })
      .sort({ createdAt: -1 });

    items = items.map((item) => ({
      ...item._doc,
      audioFile: buildProxyUrl(item[resource.fileField]),
    }));

    res
      .status(200)
      .json({ ...playlistWithUrls, [resource.responseKey]: items });
  } catch (error) {
    console.error(`Error al obtener ${resourceType} de la playlist:`, error);
    res.status(500).json({ message: `Error al obtener ${resourceType}` });
  }
});

module.exports = router;
