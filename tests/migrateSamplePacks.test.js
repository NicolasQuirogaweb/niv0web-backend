const { planSamplePackMigration, applyMigration } = require('../scripts/migrate-samplepacks');

const packs = [
  { _id: 'fxs', title: 'Fxs' },
  { _id: '808', title: '808' },
  { _id: 'syn', title: 'Synths' },
  { _id: 'drm', title: 'Drums' },
  { _id: 'bas', title: 'Bass' },
];
const counts = { fxs: 36, 808: 42, syn: 41, drm: 104, bas: 24 };

describe('planSamplePackMigration', () => {
  it('orders folders and totals the samples', () => {
    const plan = planSamplePackMigration(packs, counts);
    expect(plan.folders).toEqual(['Drums', '808', 'Bass', 'Synths', 'Fxs']);
    expect(plan.total).toBe(247);
    expect(plan.moves[0]).toEqual({ fromId: 'drm', folder: 'Drums', count: 104 });
  });

  it('skips Mastermind', () => {
    const plan = planSamplePackMigration([...packs, { _id: 'mm', title: 'Mastermind' }], { ...counts, mm: 5 });
    expect(plan.folders).toHaveLength(5);
    expect(plan.total).toBe(247);
  });

  it('puts unknown packs last, by title', () => {
    const plan = planSamplePackMigration([...packs, { _id: 'z', title: 'Vox' }, { _id: 'a', title: 'Atmos' }], { ...counts, z: 3, a: 2 });
    expect(plan.folders.slice(-2)).toEqual(['Atmos', 'Vox']);
    expect(plan.total).toBe(252);
  });
});

// Fake in-memory models enough for applyMigration.
const makeModels = (samples, existingMaster) => {
  const state = { packs: new Map(), samples: [...samples] };
  if (existingMaster) state.packs.set('mm', { ...existingMaster, _id: 'mm' });
  packs.forEach((p) => state.packs.set(p._id, { ...p, published: true }));
  const match = (q, s) => Object.entries(q).every(([k, v]) => s[k] === v);
  return {
    state,
    SamplePack: {
      findOne: async (q) => [...state.packs.values()].find((p) => match(q, p)) || null,
      create: async (doc) => { const p = { ...doc, _id: 'mm' }; state.packs.set('mm', p); return p; },
      updateOne: async (q, { $set }) => { Object.assign(state.packs.get(q._id), $set); },
      updateMany: async (q, { $set }) => {
        q._id.$in.forEach((id) => Object.assign(state.packs.get(id), $set));
      },
    },
    Samples: {
      countDocuments: async (q) => state.samples.filter((s) => match(q, s)).length,
      updateMany: async (q, { $set }) => {
        state.samples.filter((s) => match(q, s)).forEach((s) => Object.assign(s, $set));
      },
    },
  };
};

const seed = () => Object.entries(counts).flatMap(([id, n]) => Array.from({ length: n }, () => ({ samplepackId: id })));

describe('applyMigration', () => {
  const log = () => {};
  it('moves samples, publishes Mastermind and unpublishes old packs; second run is a no-op', async () => {
    const models = makeModels(seed());
    const plan = planSamplePackMigration(packs, counts);
    const first = await applyMigration(models, plan, { log });
    expect(first.moved).toBe(247);
    expect(models.state.packs.get('mm').published).toBe(true);
    expect(models.state.packs.get('drm').published).toBe(false);

    const replan = planSamplePackMigration(packs, { fxs: 0, 808: 0, syn: 0, drm: 0, bas: 0 });
    const second = await applyMigration(models, replan, { log });
    expect(second.moved).toBe(0);
    expect(models.state.samples.filter((s) => s.samplepackId === 'mm')).toHaveLength(247);
  });

  it('aborts before publishing when counts do not match', async () => {
    const models = makeModels(seed());
    const plan = planSamplePackMigration(packs, counts);
    models.Samples.updateMany = async () => {};
    await expect(applyMigration(models, plan, { log })).rejects.toThrow(/mismatch/i);
    expect(models.state.packs.get('mm').published).toBe(false);
  });
});
