const express = require('express');
const Beat = require('../models/Beat');
const router = express.Router();

// Crear un nuevo beat
router.post('/', async (req, res) => {
    const { title, artist, audioFile, playlistId } = req.body;

    try {
        // Creamos el nuevo beat
        const newBeat = new Beat({ title, artist, audioFile, playlistId });

        const savedBeat = await newBeat.save();
        res.status(201).json(savedBeat);  // Respondemos con el beat creado
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
});

// Obtener los beats de una playlist específica
router.get('/playlist/:playlistId', async (req, res) => {
    const { playlistId } = req.params;

    try {
        // Buscar los beats asociados a esta playlist
        const beats = await Beat.find({ playlistId });
        res.json(beats);  // Respondemos con los beats encontrados
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
});

module.exports = router;
