const express = require('express');
const passport = require('passport');
const jwt = require('jsonwebtoken');
const router = express.Router();

// Ruta para manejar el login con Google
router.post('/google-login', (req, res, next) => {
    const { email, name, imageUrl } = req.body;

    // Verifica que se reciban los datos necesarios
    if (!email || !name) {
        return res.status(400).json({ message: 'Faltan datos importantes para la autenticación' });
    }

    // Aquí puedes crear o buscar el usuario en tu base de datos
    // Suponiendo que tienes un modelo de Usuario, lo buscarás o crearás
    // Este paso puede ser personalizado dependiendo de tu lógica de base de datos
    const user = { email, name, imageUrl }; // Simplificado para este ejemplo

    // Crear el JWT
    const token = jwt.sign({ email: user.email, name: user.name }, process.env.JWT_SECRET, { expiresIn: '1h' });

    // Enviar el token de vuelta al frontend
    res.json({ token });
});

module.exports = router;
