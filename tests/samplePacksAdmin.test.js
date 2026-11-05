const request = require('supertest');
const jwt = require('jsonwebtoken');

jest.mock('../models/User');
jest.mock('../models/SamplePack');
jest.mock('../models/Samples');

const User = require('../models/User');
const SamplePack = require('../models/SamplePack');
const Samples = require('../models/Samples');
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
    expect(update.$set).toMatchObject({ title: 'New', 'zip.stale': true });
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
    expect(update.$set).toMatchObject({ folders: ['Snares', 'Kicks'], 'zip.stale': true });
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
    expect(SamplePack.updateOne).toHaveBeenCalledWith({ _id: PACK_ID }, { $set: { 'zip.stale': true } });
  });

  it('marks stale on batch add', async () => {
    Samples.insertMany.mockResolvedValue([{ _id: 's2' }]);
    await api('post', `/samplepacks/${PACK_ID}/samples/batch`).send({ samples: [{ title: 'x', audioFile: 'https://cdn/x.wav', folder: 'A' }] });
    expect(SamplePack.updateOne).toHaveBeenCalledWith({ _id: PACK_ID }, { $set: { 'zip.stale': true } });
  });

  it('marks stale on delete', async () => {
    Samples.findByIdAndDelete.mockReturnValue(lean(existing));
    await api('delete', '/samples/s1');
    expect(SamplePack.updateOne).toHaveBeenCalledWith({ _id: PACK_ID }, { $set: { 'zip.stale': true } });
  });

  it('marks stale when the folder changes', async () => {
    await api('put', '/samples/s1').send({ folder: 'B' });
    expect(stale()).toHaveLength(1);
  });

  it('marks stale when the audioFile changes', async () => {
    await api('put', '/samples/s1').send({ audioFile: 'https://cdn/new.wav' });
    expect(stale()).toHaveLength(1);
  });

  it('does not mark stale on a title-only edit', async () => {
    const res = await api('put', '/samples/s1').send({ title: 'renamed' });
    expect(res.status).toBe(200);
    expect(SamplePack.updateOne).not.toHaveBeenCalled();
  });
});
