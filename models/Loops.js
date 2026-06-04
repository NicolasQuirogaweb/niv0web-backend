const mongoose = require('mongoose');

const loopsSchema = new mongoose.Schema({
    title: {
        type: String,
        required: [true, "El título del loop es obligatorio"],
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
                return /^(https?:\/\/|\/)/.test(url);
            },
            message: "La ruta del archivo de audio no es válida",
        },
    },
    playlistId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Playlist',
        required: [true, "El ID de la playlist es obligatorio"],
    },
}, { timestamps: true });

loopsSchema.index({ playlistId: 1, createdAt: -1 });

const Loops = mongoose.model('Loops', loopsSchema);

module.exports = Loops;
