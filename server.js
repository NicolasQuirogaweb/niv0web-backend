const env = require('./config/env');
const mongoose = require('mongoose');
const connectDB = require('./config/db');
const app = require('./app');

const start = async () => {
  await connectDB();

  const server = app.listen(env.PORT, () => {
    console.log(`Servidor corriendo en el puerto ${env.PORT}`);
  });

  const shutdown = () => {
    console.log('Apagando servidor...');
    server.close(() => {
      mongoose.connection.close(false).then(() => {
        console.log('Conexiones cerradas');
        process.exit(0);
      });
    });
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
};

start();
