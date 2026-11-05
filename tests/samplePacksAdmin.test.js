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
