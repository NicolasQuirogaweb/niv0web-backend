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
      findOne: async (q) => [...state.packs.values()].find((p) => (q.$or ? q.$or.some((c) => match(c, p)) : match(q, p))) || null,
      create: async (doc) => { state.created = { ...doc }; const p = { ...doc, _id: 'mm' }; state.packs.set('mm', p); return p; },
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

  it('creates Mastermind unpublished with the agreed fields', async () => {
    const models = makeModels(seed());
    await applyMigration(models, planSamplePackMigration(packs, counts), { log });
    expect(models.state.created).toEqual({
      title: 'Mastermind',
      slug: 'mastermind',
      description: 'Drums, 808s, bajos, synths y FX de niv0. Gratis para tus producciones.',
      type: 'samples',
      published: false,
    });
  });

  it('merges folders into an existing Mastermind without duplicates and stamps its ZIP stale', async () => {
    const models = makeModels(seed(), {
      title: 'Mastermind', slug: 'mastermind', folders: ['Drums', 'Extra'], published: false,
      zip: { url: 'https://b2/zip', stale: false, staleAt: null },
    });
    await applyMigration(models, planSamplePackMigration(packs, counts), { log });
    const mm = models.state.packs.get('mm');
    expect(mm.folders).toEqual(['Drums', 'Extra', '808', 'Bass', 'Synths', 'Fxs']);
    expect(mm['zip.stale']).toBe(true);
    expect(mm['zip.staleAt']).toBeInstanceOf(Date);
  });

  it('does not stamp the ZIP when nothing moved', async () => {
    const models = makeModels([], { title: 'Mastermind', slug: 'mastermind', folders: [], zip: { url: 'u' } });
    models.state.samples.push({ samplepackId: 'mm', folder: 'Drums' });
    const zeroCounts = { fxs: 0, 808: 0, syn: 0, drm: 0, bas: 0 };
    const res = await applyMigration(models, planSamplePackMigration(packs, zeroCounts), { log });
    expect(res.moved).toBe(0);
    expect(models.state.packs.get('mm')['zip.stale']).toBeUndefined();
  });

  it('finds Mastermind by title when it has no slug and sets the slug', async () => {
    const models = makeModels(seed(), { title: 'Mastermind', folders: [] });
    await applyMigration(models, planSamplePackMigration(packs, counts), { log });
    expect(models.state.created).toBeUndefined();
    expect(models.state.packs.get('mm').slug).toBe('mastermind');
  });

  it('sums expected counts of old packs that share a title', async () => {
    const dup = [...packs, { _id: 'drm2', title: 'Drums' }];
    const models = makeModels([...seed(), ...Array.from({ length: 6 }, () => ({ samplepackId: 'drm2' }))]);
    models.state.packs.set('drm2', { _id: 'drm2', title: 'Drums', published: true });
    const plan = planSamplePackMigration(dup, { ...counts, drm2: 6 });
    const res = await applyMigration(models, plan, { log });
    expect(res.total).toBe(253);
  });
});
