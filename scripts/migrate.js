require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const mongoose = require('mongoose');
const User = require('../models/User');
const Loops = require('../models/Loops');
const Playlist = require('../models/Playlist');

const ADMIN_EMAIL = 'nivo2798@gmail.com';

async function migrate() {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log('Conectado a MongoDB');

  // 1. Setear admin
  const admin = await User.findOneAndUpdate(
    { email: ADMIN_EMAIL },
    { $set: { role: 'admin' } },
    { new: true }
  );
  if (admin) {
    console.log(`✓ Usuario ${ADMIN_EMAIL} seteado como admin`);
  } else {
    console.log(`✗ Usuario ${ADMIN_EMAIL} no encontrado. Creá uno haciendo login primero.`);
  }

  // 2. Migrar loops existentes sin playlistId
  const loopsSinPlaylist = await Loops.find({ playlistId: { $exists: false } });
  if (loopsSinPlaylist.length > 0) {
    let playlist = await Playlist.findOne({ title: 'Loops Generales', type: 'loops' });
    if (!playlist) {
      playlist = await Playlist.create({
        title: 'Loops Generales',
        description: 'Catálogo principal de loops',
        imageUrl: `${process.env.B2_PUBLIC_URL || ''}/${process.env.B2_BUCKET_NAME || ''}/images/loopimg.webp`,
        backgroundVideo: `${process.env.B2_PUBLIC_URL || ''}/${process.env.B2_BUCKET_NAME || ''}/videos/loopvideo.mp4`,
        type: 'loops',
      });
      console.log(`✓ Catálogo "Loops Generales" creado`);
    }

    await Loops.updateMany(
      { playlistId: { $exists: false } },
      { $set: { playlistId: playlist._id } }
    );
    console.log(`✓ ${loopsSinPlaylist.length} loops migrados al catálogo "Loops Generales"`);
  } else {
    console.log('✓ Todos los loops ya tienen playlistId');
  }

  await mongoose.disconnect();
  console.log('Migración completada');
}

migrate().catch((err) => {
  console.error('Error en migración:', err);
  process.exit(1);
});
