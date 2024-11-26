const mongoose = require('mongoose');

const beatSchema = new mongoose.Schema({
    title: {
        type: String,
        required: [true, "El título del beat es obligatorio"],
        maxlength: [100, "El título no puede exceder los 100 caracteres"],
    },
    artist: {
        type: String,
        required: [true, "El nombre del artista es obligatorio"],
        maxlength: [50, "El nombre del artista no puede exceder los 50 caracteres"],
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
    playlistId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Playlist',
        required: [true, "El ID de la playlist es obligatorio"],
    },
}, { timestamps: true });

const Beat = mongoose.model('Beat', beatSchema);

module.exports = Beat;
