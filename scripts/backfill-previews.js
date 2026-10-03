// Genera las versiones MP3 para escuchar de los WAV que ya estaban cargados.
// Los uploads nuevos las generan solos (ver services/previewService.js).
//
// Uso:
//   node scripts/backfill-previews.js --dry-run   # solo lista lo que haría
//   node scripts/backfill-previews.js             # baja, convierte, sube y registra
//
// Es idempotente: un WAV que ya tiene preview se saltea.
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const path = require('path');
const dns = require('dns');
const mongoose = require('mongoose');

// Mismo arreglo que config/db.js: en algunos Windows Node resuelve DNS contra
// 127.0.0.1 y falla la resolución SRV de mongodb+srv://.
if (process.env.NODE_ENV !== 'production') dns.setServers(['8.8.8.8', '8.8.4.4']);
const Beat = require('../models/Beat');
const Loops = require('../models/Loops');
const Samples = require('../models/Samples');
const AudioPreview = require('../models/AudioPreview');
const buildPublicUrl = require('../utils/buildPublicUrl');
const { createPreview, MIN_PREVIEW_BYTES } = require('../services/previewService');

const dryRun = process.argv.includes('--dry-run');

async function run() {
  await mongoose.connect(process.env.MONGODB_URI);

  const collections = [['beats', Beat], ['loops', Loops], ['samples', Samples]];
  const pending = [];
  for (const [label, Model] of collections) {
    const docs = await Model.find({ audioFile: /\.wav$/i }).select('title audioFile').lean();
    for (const doc of docs) {
      const sourceUrl = buildPublicUrl(doc.audioFile);
      const exists = await AudioPreview.exists({ sourceUrl });
      if (exists) continue;
      // Igual que en el upload: los WAV chicos (samples sueltos) no necesitan preview.
      const head = await fetch(sourceUrl, { method: 'HEAD' });
      const size = Number(head.headers.get('content-length')) || 0;
      if (size >= MIN_PREVIEW_BYTES) pending.push({ label, title: doc.title, sourceUrl, size });
    }
  }

  console.log(`${pending.length} WAV sin preview${dryRun ? ' (dry-run, no se cambia nada)' : ''}`);
  pending.forEach((p) => console.log(`  - [${p.label}] ${p.title} (${(p.size / 1e6).toFixed(1)} MB)`));

  if (!dryRun) {
    let ok = 0;
    for (const p of pending) {
      try {
        const res = await fetch(p.sourceUrl);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const buffer = Buffer.from(await res.arrayBuffer());
        const name = path.basename(new URL(p.sourceUrl).pathname);
        const previewUrl = await createPreview(buffer, decodeURIComponent(name), p.sourceUrl);
        ok++;
        console.log(`  ✓ ${p.title} -> ${previewUrl}`);
      } catch (err) {
        console.log(`  ✗ ${p.title}: ${err.message}`);
      }
    }
    console.log(`Listo: ${ok}/${pending.length}`);
  }

  await mongoose.disconnect();
}

run().catch(async (err) => {
  console.error(err);
  await mongoose.disconnect();
  process.exit(1);
});
