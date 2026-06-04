const mongoose = require('mongoose');

const sampleSchema = new mongoose.Schema({
    title: {
        type: String,
        required: [true, "El título del sample es obligatorio"],
        maxlength: [100, "El título no puede exceder los 100 caracteres"],
    },
    description: {
        type: String,
        required: [true, "La descripción es obligatoria"],
        maxlength: [300, "La descripción no puede exceder los 300 caracteres"],
    },
    audioFile: {
        type: String,
        required: [true, "La ruta del archivo de audio es obligatoria"],
        validate: {
            validator: function (url) {
                return /^(https?:\/\/|\/)/.test(url); // Valida que sea una URL o una ruta relativa
            },
            message: "La ruta del archivo de audio no es válida",
        },
    },
    samplepackId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Samplepack',
        required: [true, "El ID del sample pack es obligatorio"],
    },
}, { timestamps: true });

sampleSchema.index({ samplepackId: 1, createdAt: -1 });

const Samples = mongoose.model('Samples', sampleSchema);

module.exports = Samples;
