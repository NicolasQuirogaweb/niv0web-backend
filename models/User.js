const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
    email: { type: String, required: true, unique: true },
    name: { type: String, required: true },
    imageUrl: { type: String, required: true }, // Guardamos la URL de la imagen de Google
});

const User = mongoose.model('User', userSchema);

module.exports = User;
