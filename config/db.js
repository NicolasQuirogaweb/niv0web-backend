const dns = require('dns');
const mongoose = require('mongoose');

// Algunos entornos (notablemente Windows con adaptadores de red virtuales/VPN)
// hacen que Node resuelva DNS contra 127.0.0.1 en vez del DNS real de la red,
// rompiendo la resolución SRV/TXT que necesita mongodb+srv://.
dns.setServers(['8.8.8.8', '8.8.4.4']);

const connectDB = async () => {
    try {
        await mongoose.connect(process.env.MONGODB_URI, {
            maxPoolSize: 10,
        });
        console.log('MongoDB conectado correctamente');
    } catch (error) {
        console.error('Error de conexión a MongoDB:', error);
        process.exit(1);
    }
};

module.exports = connectDB;
