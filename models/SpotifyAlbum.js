const mongoose = require('mongoose');

// Copia local de los lanzamientos del artista en Spotify (álbumes, EPs, singles).
// La fuente de verdad es Spotify; esto es un cache que se refresca cada 6 h.
const spotifyAlbumSchema = new mongoose.Schema({
  spotifyId: { type: String, required: true, unique: true },
  name: { type: String, required: true },
  type: { type: String, enum: ['album', 'single'], required: true },
  releaseDate: { type: String, required: true }, // 'YYYY', 'YYYY-MM' o 'YYYY-MM-DD', como lo da Spotify
  imageUrl: { type: String, default: null },
  spotifyUrl: { type: String, required: true },
  totalTracks: { type: Number, default: 0 },
}, { timestamps: true });

const SpotifyAlbum = mongoose.model('SpotifyAlbum', spotifyAlbumSchema);

module.exports = SpotifyAlbum;
