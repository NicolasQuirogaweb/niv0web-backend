const express = require('express');
const connectDB = require('./config/db'); // Asegúrate de que esto esté bien configurado
const authRoutes = require('./routes/auth');
const beatsRoutes = require('./routes/beats');
const playlistsRoutes = require('./routes/playlists'); // Importar las rutas de playlists
const passport = require('passport');
const cors = require('cors');
require('dotenv').config();
const path = require('path');  // Agrega este módulo para la ruta de los archivos

const app = express();  

// Conectar a la base de datos
connectDB();

// Configuración de Passport para Google OAuth
require('./config/passport');

// Middleware
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:3000',
  methods: ['GET', 'POST'],
  credentials: true,
}));
app.use(express.json());  // Para parsear los datos en formato JSON

// Rutas
app.use('/api/auth', authRoutes); // Ruta de autenticación
app.use('/api/beats', beatsRoutes); // Ruta para los beats
app.use('/api/playlists', playlistsRoutes); // Ruta para las playlists

// Configura Express para servir archivos estáticos desde la carpeta 'uploads'
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Configura Express para servir archivos estáticos desde la carpeta 'beats'
app.use('/beats', express.static(path.join(__dirname, 'beats')));

// También puedes configurar los archivos estáticos de 'public' si lo deseas
app.use(express.static('public'));

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Servidor corriendo en el puerto ${PORT}`);
});
