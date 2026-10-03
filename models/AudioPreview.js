const mongoose = require('mongoose');

// Versión MP3 liviana de un audio pesado (WAV), solo para escuchar en la web.
// Es un derivado del archivo original: se identifica por su URL, así no hay que
// tocar los modelos de beats/loops/samples ni los formularios del admin.
// La descarga siempre entrega el original.
const audioPreviewSchema = new mongoose.Schema({
  sourceUrl: { type: String, required: true, unique: true },
  previewUrl: { type: String, required: true },
}, { timestamps: true });

const AudioPreview = mongoose.model('AudioPreview', audioPreviewSchema);

module.exports = AudioPreview;
