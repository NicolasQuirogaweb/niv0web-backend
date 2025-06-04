const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
    email: { type: String, required: true, unique: true },  // Email único
    name: { type: String, required: true },  // Nombre del usuario
    imageUrl: { type: String, required: true },  // URL de la imagen del perfil de Google
    googleId: { type: String, unique: true }  // googleId único para cada usuario de Google
});

// Se crea el modelo de Usuario basado en el esquema definido
const User = mongoose.model('User', userSchema);

module.exports = User;
