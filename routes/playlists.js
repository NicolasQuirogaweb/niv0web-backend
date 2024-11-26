const express = require('express');
const Playlist = require('../models/Playlist');
const Beat = require('../models/Beat');  // Importamos el modelo Beat
const router = express.Router();

// Crear una nueva playlist (con beats)
router.post('/', async (req, res) => {
    const { title, description, imageUrl, beats } = req.body;

    try {
        const existingPlaylist = await Playlist.findOne({ title });
        if (existingPlaylist) {
            return res.status(400).json({ error: 'Ya existe una playlist con este título.' });
        }

        // Creamos la nueva playlist
        const newPlaylist = new Playlist({ title, description, imageUrl, beats });

        const savedPlaylist = await newPlaylist.save();
        res.status(201).json(savedPlaylist);  // Respondemos con la playlist creada
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
});

// Obtener todas las playlists
router.get('/', async (req, res) => {
    try {
        const playlists = await Playlist.find();
        res.json(playlists);  // Respondemos con todas las playlists
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
});

// Obtener una playlist por su ID
router.get('/:id', async (req, res) => {
    const { id } = req.params;  // Obtener el ID de la playlist desde los parámetros de la URL

    try {
        // Buscar la playlist por su ID e incluir los beats asociados
        const playlist = await Playlist.findById(id).populate('beats');
        
        if (!playlist) {
            return res.status(404).json({ error: 'Playlist no encontrada' });
        }

        res.json(playlist);  // Respondemos con la playlist encontrada
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
});

module.exports = router;
