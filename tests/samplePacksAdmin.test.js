const request = require('supertest');
const jwt = require('jsonwebtoken');

jest.mock('../models/User');
jest.mock('../models/SamplePack');
jest.mock('../models/Samples');
jest.mock('../services/zipService');

const User = require('../models/User');
const SamplePack = require('../models/SamplePack');
const Samples = require('../models/Samples');
const { buildPackZip } = require('../services/zipService');
const app = require('../app');

const PACK_ID = '66a000000000000000000001';
const cookie = () => `accessToken=${jwt.sign({ userId: 'g1', role: 'admin' }, process.env.JWT_SECRET, { expiresIn: '15m' })}`;
const lean = (value) => ({ lean: () => Promise.resolve(value) });
const api = (method, path) => request(app)[method](`/api/admin${path}`).set('Cookie', cookie());

beforeEach(() => {
  User.findOne.mockResolvedValue({ _id: 'u1', googleId: 'g1', role: 'admin' });
});
afterEach(() => jest.resetAllMocks());

describe('PUT /samplepacks/:id publishing', () => {
  it('refuses to publish a paid pack', async () => {
    SamplePack.findById.mockReturnValue(lean({ _id: PACK_ID, title: 'A', priceArs: 1000, folders: ['Kicks'] }));
    Samples.countDocuments.mockResolvedValue(3);
    const res = await api('put', `/samplepacks/${PACK_ID}`).send({ published: true });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('PACK_PAID_NOT_SELLABLE');
    expect(SamplePack.findByIdAndUpdate).not.toHaveBeenCalled();
  });

  it('refuses to publish an empty pack', async () => {
    SamplePack.findById.mockReturnValue(lean({ _id: PACK_ID, title: 'A', folders: [] }));
    Samples.countDocuments.mockResolvedValue(0);
    const res = await api('put', `/samplepacks/${PACK_ID}`).send({ published: true });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('PACK_EMPTY');
  });

  it('never changes the slug and marks the zip stale on a title change', async () => {
    SamplePack.findById.mockReturnValue(lean({ _id: PACK_ID, title: 'Old', slug: 'old' }));
    SamplePack.findByIdAndUpdate.mockReturnValue(lean({ _id: PACK_ID, title: 'New', slug: 'old' }));
    const res = await api('put', `/samplepacks/${PACK_ID}`).send({ title: 'New' });
    expect(res.status).toBe(200);
    const update = SamplePack.findByIdAndUpdate.mock.calls[0][1];
    expect(update.$set).toMatchObject({ title: 'New', 'zip.stale': true, 'zip.staleAt': expect.any(Date) });
    expect(update.$set.slug).toBeUndefined();
  });
});

describe('folders', () => {
  it('rejects a duplicate folder name case-insensitively', async () => {
    SamplePack.findById.mockReturnValue(lean({ _id: PACK_ID, folders: ['Drums'] }));
    const res = await api('post', `/samplepacks/${PACK_ID}/folders`).send({ name: 'drums' });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('FOLDER_EXISTS');
  });

  it('renames a folder, moves its samples and marks the zip stale', async () => {
    SamplePack.findById.mockReturnValue(lean({ _id: PACK_ID, folders: ['Snares', 'Drums'] }));
    SamplePack.findByIdAndUpdate.mockReturnValue(lean({ _id: PACK_ID, folders: ['Snares', 'Kicks'] }));
    const res = await api('put', `/samplepacks/${PACK_ID}/folders`).send({ from: 'Drums', to: 'Kicks' });
    expect(res.status).toBe(200);
    expect(Samples.updateMany).toHaveBeenCalledWith(
      { samplepackId: PACK_ID, folder: 'Drums' },
      { $set: { folder: 'Kicks' } }
    );
    const update = SamplePack.findByIdAndUpdate.mock.calls[0][1];
    expect(update.$set).toMatchObject({ folders: ['Snares', 'Kicks'], 'zip.stale': true, 'zip.staleAt': expect.any(Date) });
  });

  it('refuses to delete a folder that has samples', async () => {
    SamplePack.findById.mockReturnValue(lean({ _id: PACK_ID, folders: ['Drums'] }));
    Samples.exists.mockResolvedValue({ _id: 's1' });
    const res = await api('delete', `/samplepacks/${PACK_ID}/folders/Drums`);
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('FOLDER_NOT_EMPTY');
    expect(SamplePack.findByIdAndUpdate).not.toHaveBeenCalled();
  });

  it('rejects an order that is not a permutation of the folders', async () => {
    SamplePack.findById.mockReturnValue(lean({ _id: PACK_ID, folders: ['A', 'B'] }));
    const res = await api('put', `/samplepacks/${PACK_ID}/folders/order`).send({ folders: ['A', 'C'] });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('INVALID_FOLDER_ORDER');
  });
});

describe('samples', () => {
  const sample = { title: 'k', audioFile: 'https://cdn/k.wav' };

  it('rejects a sample whose folder is not in the pack', async () => {
    SamplePack.findById.mockReturnValue(lean({ _id: PACK_ID, folders: ['Kicks'] }));
    const res = await api('post', `/samplepacks/${PACK_ID}/samples`).send({ ...sample, folder: 'Nope' });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('UNKNOWN_FOLDER');
    expect(Samples.create).not.toHaveBeenCalled();
  });

  it('inserts nothing when one sample in a batch has a bad folder', async () => {
    SamplePack.findById.mockReturnValue(lean({ _id: PACK_ID, folders: ['Kicks'] }));
    const res = await api('post', `/samplepacks/${PACK_ID}/samples/batch`).send({
      samples: [{ ...sample, folder: 'Kicks' }, { ...sample, folder: 'Nope' }],
    });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('UNKNOWN_FOLDER');
    expect(Samples.insertMany).not.toHaveBeenCalled();
  });
});

describe('review follow-ups', () => {
  it('refuses a price on an already published pack', async () => {
    SamplePack.findById.mockReturnValue(lean({ _id: PACK_ID, title: 'A', published: true, folders: ['K'] }));
    Samples.countDocuments.mockResolvedValue(3);
    const res = await api('put', `/samplepacks/${PACK_ID}`).send({ priceArs: 1000 });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('PACK_PAID_NOT_SELLABLE');
    expect(SamplePack.findByIdAndUpdate).not.toHaveBeenCalled();
  });

  it('gives a second pack with the same title the -2 slug', async () => {
    SamplePack.exists.mockImplementation(async ({ slug }) => (slug === 'mastermind' ? { _id: 'x' } : null));
    SamplePack.create.mockImplementation(async (doc) => doc);
    const res = await api('post', '/samplepacks').send({ title: 'Mastermind', description: 'd' });
    expect(res.status).toBe(201);
    expect(res.body.data.slug).toBe('mastermind-2');
    expect(res.body.data.published).toBe(false);
  });

  it('gives the duplicate a unique slug, unpublished', async () => {
    SamplePack.findById.mockReturnValue(lean({ _id: PACK_ID, title: 'Mastermind', description: 'd', folders: ['K'], priceUsd: 5 }));
    SamplePack.exists.mockImplementation(async ({ slug }) => (slug === 'copia-de-mastermind' ? { _id: 'x' } : null));
    SamplePack.create.mockImplementation(async (doc) => ({ _id: 'new', ...doc }));
    Samples.find.mockReturnValue(lean([{ title: 's', audioFile: 'https://cdn/s.wav', folder: 'K' }]));
    const res = await api('post', `/samplepacks/${PACK_ID}/duplicate`);
    expect(res.status).toBe(201);
    expect(SamplePack.create.mock.calls[0][0]).toMatchObject({ slug: 'copia-de-mastermind-2', published: false, folders: ['K'], priceUsd: 5 });
    expect(Samples.insertMany.mock.calls[0][0][0]).toMatchObject({ folder: 'K', samplepackId: 'new' });
  });

  it.each(['a/b', 'a\b'])('rejects folder name %j', async (name) => {
    SamplePack.findById.mockReturnValue(lean({ _id: PACK_ID, folders: [] }));
    const res = await api('post', `/samplepacks/${PACK_ID}/folders`).send({ name });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('INVALID_FOLDER_NAME');
  });

  it('does not mark the zip stale when adding or reordering folders', async () => {
    SamplePack.findById.mockReturnValue(lean({ _id: PACK_ID, folders: ['A', 'B'] }));
    SamplePack.findByIdAndUpdate.mockReturnValue(lean({}));
    await api('post', `/samplepacks/${PACK_ID}/folders`).send({ name: 'C' });
    await api('put', `/samplepacks/${PACK_ID}/folders/order`).send({ folders: ['B', 'A'] });
    for (const call of SamplePack.findByIdAndUpdate.mock.calls) {
      expect(JSON.stringify(call[1])).not.toContain('zip.stale');
    }
  });

  it('rejects renaming onto an existing name, case-insensitively', async () => {
    SamplePack.findById.mockReturnValue(lean({ _id: PACK_ID, folders: ['Drums', 'Kicks'] }));
    const res = await api('put', `/samplepacks/${PACK_ID}/folders`).send({ from: 'Drums', to: 'kicks' });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('FOLDER_EXISTS');
    expect(Samples.updateMany).not.toHaveBeenCalled();
  });

  it('returns 404 when renaming an unknown folder', async () => {
    SamplePack.findById.mockReturnValue(lean({ _id: PACK_ID, folders: ['Drums'] }));
    const res = await api('put', `/samplepacks/${PACK_ID}/folders`).send({ from: 'Nope', to: 'X' });
    expect(res.status).toBe(404);
    expect(res.body.code).toBe('FOLDER_NOT_FOUND');
  });
});

describe('zip stale marking on samples', () => {
  const stale = () => SamplePack.updateOne.mock.calls.map((c) => JSON.stringify(c));
  const existing = { _id: 's1', samplepackId: PACK_ID, folder: 'A', audioFile: 'https://cdn/a.wav', title: 't' };
  beforeEach(() => {
    SamplePack.findById.mockReturnValue(lean({ _id: PACK_ID, folders: ['A', 'B'] }));
    Samples.findById.mockReturnValue(lean(existing));
    Samples.findByIdAndUpdate.mockReturnValue(lean({ ...existing }));
  });

  it('marks stale on single add', async () => {
    Samples.create.mockResolvedValue({ _id: 's2' });
    await api('post', `/samplepacks/${PACK_ID}/samples`).send({ title: 'x', audioFile: 'https://cdn/x.wav', folder: 'A' });
    expect(SamplePack.updateOne).toHaveBeenCalledWith({ _id: PACK_ID }, { $set: { 'zip.stale': true, 'zip.staleAt': expect.any(Date) } });
  });

  it('marks stale on batch add', async () => {
    Samples.insertMany.mockResolvedValue([{ _id: 's2' }]);
    await api('post', `/samplepacks/${PACK_ID}/samples/batch`).send({ samples: [{ title: 'x', audioFile: 'https://cdn/x.wav', folder: 'A' }] });
    expect(SamplePack.updateOne).toHaveBeenCalledWith({ _id: PACK_ID }, { $set: { 'zip.stale': true, 'zip.staleAt': expect.any(Date) } });
  });

  it('marks stale on delete', async () => {
    Samples.findByIdAndDelete.mockReturnValue(lean(existing));
    await api('delete', '/samples/s1');
    expect(SamplePack.updateOne).toHaveBeenCalledWith({ _id: PACK_ID }, { $set: { 'zip.stale': true, 'zip.staleAt': expect.any(Date) } });
  });

  it('marks stale when the folder changes', async () => {
    await api('put', '/samples/s1').send({ folder: 'B' });
    expect(stale()).toHaveLength(1);
  });

  it('marks stale when the audioFile changes', async () => {
    await api('put', '/samples/s1').send({ audioFile: 'https://cdn/new.wav' });
    expect(stale()).toHaveLength(1);
  });

  it('marks stale when the title changes (the title is the file name inside the zip)', async () => {
    const res = await api('put', '/samples/s1').send({ title: 'renamed' });
    expect(res.status).toBe(200);
    expect(SamplePack.updateOne).toHaveBeenCalledWith({ _id: PACK_ID }, { $set: { 'zip.stale': true, 'zip.staleAt': expect.any(Date) } });
  });

  it('does not mark stale when nothing that reaches the zip changes', async () => {
    const res = await api('put', '/samples/s1').send({ title: 't', folder: 'A', description: 'new text' });
    expect(res.status).toBe(200);
    expect(SamplePack.updateOne).not.toHaveBeenCalled();
  });
});

describe('POST /samplepacks/:id/zip', () => {
  const post = () => api('post', `/samplepacks/${PACK_ID}/zip`);
  const MIN = 60 * 1000;

  beforeEach(() => {
    SamplePack.exists.mockResolvedValue({ _id: PACK_ID });
    Samples.countDocuments.mockResolvedValue(3);
    buildPackZip.mockResolvedValue(undefined);
  });

  it('claims the build and starts it in the background with the claim', async () => {
    SamplePack.findOneAndUpdate.mockResolvedValue({ _id: PACK_ID });
    const res = await post();
    expect(res.status).toBe(202);
    expect(res.body.data).toEqual({ status: 'building' });
    const [filter, update] = SamplePack.findOneAndUpdate.mock.calls[0];
    expect(filter.$or).toEqual(expect.arrayContaining([
      { 'zip.build.status': { $ne: 'building' } },
      { 'zip.build.startedAt': { $lt: expect.any(Date) } },
    ]));
    const { startedAt } = update.$set['zip.build'];
    expect(update.$set['zip.build']).toEqual({ status: 'building', startedAt: expect.any(Date), error: null });
    expect(buildPackZip).toHaveBeenCalledTimes(1);
    const args = buildPackZip.mock.calls[0];
    expect(args[0]).toBe(PACK_ID);
    expect(args[2]).toEqual({ startedAt });
  });

  it('uses a 30 minute stale cutoff in the claim filter', async () => {
    SamplePack.findOneAndUpdate.mockResolvedValue({ _id: PACK_ID });
    await post();
    const cutoff = SamplePack.findOneAndUpdate.mock.calls[0][0].$or[1]['zip.build.startedAt'].$lt;
    expect(Date.now() - cutoff.getTime()).toBeGreaterThan(29 * MIN);
    expect(Date.now() - cutoff.getTime()).toBeLessThan(31 * MIN);
  });

  it('answers 409 ZIP_BUILDING when the claim matches nothing (building 5 min ago)', async () => {
    SamplePack.findOneAndUpdate.mockResolvedValue(null);
    const res = await post();
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('ZIP_BUILDING');
    expect(buildPackZip).not.toHaveBeenCalled();
  });

  it('answers 202 when the previous build started 31 min ago (claim matches)', async () => {
    SamplePack.findOneAndUpdate.mockResolvedValue({ _id: PACK_ID });
    const res = await post();
    expect(res.status).toBe(202);
    expect(buildPackZip).toHaveBeenCalledTimes(1);
  });

  it('answers 409 PACK_EMPTY without claiming when the pack has no samples', async () => {
    Samples.countDocuments.mockResolvedValue(0);
    const res = await post();
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('PACK_EMPTY');
    expect(SamplePack.findOneAndUpdate).not.toHaveBeenCalled();
    expect(buildPackZip).not.toHaveBeenCalled();
  });

  it('answers 404 when the pack does not exist', async () => {
    SamplePack.exists.mockResolvedValue(null);
    const res = await post();
    expect(res.status).toBe(404);
    expect(res.body.code).toBe('PACK_NOT_FOUND');
    expect(buildPackZip).not.toHaveBeenCalled();
  });
});

describe('pack cover is optional', () => {
  beforeEach(() => {
    SamplePack.findById.mockReturnValue(lean({ _id: PACK_ID, title: 'Mastermind', imageUrl: 'https://cdn/old.jpg', published: true }));
    Samples.countDocuments.mockResolvedValue(3);
    SamplePack.findByIdAndUpdate.mockImplementation((id, update) => lean({ _id: PACK_ID, ...update.$set }));
  });

  it('PUT with imageUrl "" saves the pack and stores the cover as null', async () => {
    const res = await api('put', `/samplepacks/${PACK_ID}`).send({ title: 'Mastermind', imageUrl: '' });
    expect(res.status).toBe(200);
    expect(SamplePack.findByIdAndUpdate.mock.calls[0][1].$set.imageUrl).toBeNull();
    expect(res.body.data.imageUrl).toBeNull();
  });

  it('PUT with imageUrl null also stores null', async () => {
    const res = await api('put', `/samplepacks/${PACK_ID}`).send({ imageUrl: null });
    expect(res.status).toBe(200);
    expect(SamplePack.findByIdAndUpdate.mock.calls[0][1].$set.imageUrl).toBeNull();
  });

  it('PUT with a real imageUrl still stores it', async () => {
    const res = await api('put', `/samplepacks/${PACK_ID}`).send({ imageUrl: 'https://cdn/new.jpg' });
    expect(res.status).toBe(200);
    expect(SamplePack.findByIdAndUpdate.mock.calls[0][1].$set.imageUrl).toBe('https://cdn/new.jpg');
  });

  it('PUT rejects an imageUrl longer than 2048 characters', async () => {
    const res = await api('put', `/samplepacks/${PACK_ID}`).send({ imageUrl: `https://cdn/${'a'.repeat(2048)}` });
    expect(res.status).toBe(400);
  });

  it('POST with imageUrl "" creates the pack with a null cover', async () => {
    SamplePack.exists.mockResolvedValue(null);
    SamplePack.create.mockImplementation((doc) => Promise.resolve({ _id: PACK_ID, ...doc }));
    const res = await api('post', '/samplepacks').send({ title: 'Nuevo', description: 'd', imageUrl: '' });
    expect(res.status).toBe(201);
    expect(SamplePack.create.mock.calls[0][0].imageUrl).toBeNull();
  });
});
