const mongoose = require('mongoose');

// Definir el esquema de la playlist
const playlistSchema = new mongoose.Schema({
    title: {
        type: String,
        required: true,  // Título de la playlist
    },
    description: {
        type: String,
        required: true,  // Descripción de la playlist
    },
    imageUrl: {
        type: String,
        required: true,  // URL de la imagen de la playlist
    },
    createdAt: {
        type: Date,
        default: Date.now,  // Fecha de creación
    },
    // Relación con los beats (referencia a los beats asociados a esta playlist)
    beats: [{
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Beat',  // Referencia al modelo Beat
    }]
});

// Crear el modelo Playlist con el esquema definido
const Playlist = mongoose.model('Playlist', playlistSchema);

// Exportar el modelo
module.exports = Playlist;
