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
        // Opcional: un pack nuevo puede crearse sin portada
    },
    slug: { type: String, unique: true, sparse: true },
    folders: { type: [String], default: [] },
    priceArs: { type: Number, min: 0, default: null },
    priceUsd: { type: Number, min: 0, default: null },
    published: { type: Boolean, default: false },
    zip: {
        url: { type: String, default: null },
        key: { type: String, default: null },
        fileId: { type: String, default: null },
        bytes: { type: Number, default: null },
        builtAt: { type: Date, default: null },
        stale: { type: Boolean, default: false },
        build: {
            status: { type: String, enum: ['idle', 'building', 'failed'], default: 'idle' },
            startedAt: { type: Date, default: null },
            error: { type: String, default: null },
        },
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
