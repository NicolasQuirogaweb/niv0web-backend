const mongoose = require('mongoose');

const samplePackSchema = new mongoose.Schema({
    title: {
        type: String,
        required: true,  // Título del sample pack
    },
    description: {
        type: String,
        required: true,  // Descripción del sample pack
    },
    imageUrl: {
        type: String,
        required: true,  // URL de la imagen del sample pack
    },
    
    createdAt: {
        type: Date,
        default: Date.now,  // Fecha de creación
    },
    type: {
        type: String,
        enum: ['samples'],
        required: true,
    },
}, { timestamps: true });

samplePackSchema.index({ createdAt: -1 });

const SamplePack = mongoose.model('SamplePack', samplePackSchema);

module.exports = SamplePack;
