const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
    email: { type: String, required: true, unique: true },
    name: { type: String, required: true },
    // Google no manda foto (picture) en todas las cuentas: sin foto el login igual tiene que andar.
    imageUrl: { type: String, default: null },
    googleId: { type: String, unique: true },
    role: { type: String, enum: ['user', 'admin'], default: 'user' },
    // Se incrementa en cada logout: invalida todos los refresh tokens emitidos antes.
    tokenVersion: { type: Number, default: 0 },
}, { timestamps: true });

const User = mongoose.model('User', userSchema);

module.exports = User;
