// Mergea los sample packs viejos (Drums, 808, Bass, Synths, Fxs) en un unico pack
// "Mastermind" con una carpeta por pack viejo.
// Uso: node scripts/migrate-samplepacks.js [--apply] [--delete-old]
//   sin flags: dry run, solo imprime el plan.
//   --apply: ejecuta la migracion (idempotente).
//   --delete-old: borra los packs viejos que quedaron con 0 samples. Solo con OK explicito.
const MASTER_SLUG = 'mastermind';
const MASTER_TITLE = 'Mastermind';
const MASTER_DESCRIPTION = 'Drums, 808s, bajos, synths y FX de niv0. Gratis para tus producciones.';
const DEFAULT_ORDER = ['Drums', '808', 'Bass', 'Synths', 'Fxs'];

const isMaster = (pack) => pack.slug === MASTER_SLUG || pack.title === MASTER_TITLE;

/**
 * @param {Array<{_id: any, title: string}>} oldPacks
 * @param {Record<string, number>} counts samples per pack id
 * @returns {{ folders: string[], moves: Array<{fromId: any, folder: string, count: number}>, total: number }}
 */
const planSamplePackMigration = (oldPacks, counts, order = DEFAULT_ORDER) => {
  const rank = (title) => (order.includes(title) ? order.indexOf(title) : order.length);
  const sorted = oldPacks
    .filter((p) => !isMaster(p))
    .sort((a, b) => rank(a.title) - rank(b.title) || String(a.title).localeCompare(String(b.title)));
  const moves = sorted.map((p) => ({ fromId: p._id, folder: p.title, count: counts[String(p._id)] || 0 }));
  return { folders: moves.map((m) => m.folder), moves, total: moves.reduce((sum, m) => sum + m.count, 0) };
};

/**
 * Applies a plan. Moves samples into Mastermind, verifies the counts, and only
 * then publishes it and unpublishes the old packs. Throws on any mismatch.
 */
const applyMigration = async ({ SamplePack, Samples }, plan, { log = console.log } = {}) => {
  const { publishProblem } = require('../utils/samplePacks');
  let master = await SamplePack.findOne({ slug: MASTER_SLUG });
  if (!master) {
    master = await SamplePack.create({
      title: MASTER_TITLE, slug: MASTER_SLUG, description: MASTER_DESCRIPTION, type: 'samples', published: false,
    });
    log(`Creado el pack ${MASTER_TITLE}`);
  }
  const folders = [...new Set([...(master.folders || []), ...plan.folders])];
  await SamplePack.updateOne({ _id: master._id }, { $set: { folders } });

  const before = {};
  for (const m of plan.moves) before[m.folder] = await Samples.countDocuments({ samplepackId: master._id, folder: m.folder });
  const totalBefore = await Samples.countDocuments({ samplepackId: master._id });

  let moved = 0;
  for (const m of plan.moves) {
    if (m.count > 0) {
      await Samples.updateMany({ samplepackId: m.fromId }, { $set: { samplepackId: master._id, folder: m.folder } });
    }
    moved += m.count;
    log(`  ${m.folder}: ${m.count} movidos`);
  }

  for (const m of plan.moves) {
    const now = await Samples.countDocuments({ samplepackId: master._id, folder: m.folder });
    if (now !== before[m.folder] + m.count) {
      throw new Error(`Count mismatch en ${m.folder}: esperaba ${before[m.folder] + m.count}, hay ${now}`);
    }
  }
  const totalAfter = await Samples.countDocuments({ samplepackId: master._id });
  if (totalAfter !== totalBefore + plan.total) {
    throw new Error(`Count mismatch total: esperaba ${totalBefore + plan.total}, hay ${totalAfter}`);
  }

  const problem = publishProblem(master, totalAfter);
  if (problem) throw new Error(`No se puede publicar ${MASTER_TITLE}: ${problem}`);
  await SamplePack.updateOne({ _id: master._id }, { $set: { published: true } });
  const oldIds = plan.moves.map((m) => m.fromId);
  if (oldIds.length) await SamplePack.updateMany({ _id: { $in: oldIds } }, { $set: { published: false } });
  return { moved, total: totalAfter, masterId: master._id };
};

const printPlan = (plan, log = console.log) => {
  log('Carpeta'.padEnd(14) + 'Pack origen'.padEnd(28) + 'Samples');
  plan.moves.forEach((m) => log(m.folder.padEnd(14) + String(m.fromId).padEnd(28) + String(m.count).padStart(7)));
  log('Total'.padEnd(42) + String(plan.total).padStart(7));
};

const main = async () => {
  require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
  const mongoose = require('mongoose');
  const SamplePack = require('../models/SamplePack');
  const Samples = require('../models/Samples');
  const apply = process.argv.includes('--apply');
  const deleteOld = process.argv.includes('--delete-old');

  await mongoose.connect(process.env.MONGODB_URI);
  try {
    const old = (await SamplePack.find().lean()).filter((p) => !isMaster(p));
    const counts = {};
    for (const p of old) counts[String(p._id)] = await Samples.countDocuments({ samplepackId: p._id });
    const plan = planSamplePackMigration(old, counts);
    printPlan(plan);

    if (apply) {
      const result = await applyMigration({ SamplePack, Samples }, plan);
      console.log(`Migracion completa: ${result.moved} movidos, ${result.total} en ${MASTER_TITLE}`);
    } else if (!deleteOld) {
      console.log('Dry run: no se cambio nada. Usa --apply para ejecutar.');
    }

    if (deleteOld) {
      for (const p of old) {
        if ((await Samples.countDocuments({ samplepackId: p._id })) === 0) {
          await SamplePack.deleteOne({ _id: p._id });
          console.log(`Borrado el pack vacio ${p.title}`);
        }
      }
    }
  } finally {
    await mongoose.disconnect();
  }
};

if (require.main === module) {
  main().catch((err) => {
    console.error('Error en migracion:', err.message);
    process.exit(1);
  });
}

module.exports = { planSamplePackMigration, applyMigration, MASTER_SLUG };
