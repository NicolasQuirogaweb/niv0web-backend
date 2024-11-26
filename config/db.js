const mongoose = require('mongoose');
require('dotenv').config();

const connectDB = async () => {
    try {
        await mongoose.connect(process.env.MONGODB_URI, {
            useNewUrlParser: true,
            useUnifiedTopology: true,
        });
        console.log('MongoDB conectado correctamente');
    } catch (error) {
        console.error('Error de conexión a MongoDB:', error);
        process.exit(1); // Termina el proceso si no puede conectarse
    }
};

module.exports = connectDB;
