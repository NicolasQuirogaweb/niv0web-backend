const request = require('supertest');

jest.mock('../models/SamplePack');
jest.mock('../models/Samples');

const SamplePack = require('../models/SamplePack');
const Samples = require('../models/Samples');
const app = require('../app');

afterEach(() => jest.resetAllMocks());


describe('GET /api/resources/samplepacks', () => {
  it('lists only published packs and hides the zip of paid ones', async () => {
    const sortSpy = jest.fn(() => ({ lean: () => Promise.resolve([
      { _id: 'p1', slug: 'free', title: 'Free', folders: ['Kicks'], zip: { url: 'https://cdn/x.zip', bytes: 5 } },
      { _id: 'p2', slug: 'paid', title: 'Paid', folders: [], priceArs: 1000, zip: { url: 'https://cdn/y.zip' } },
    ]) }));
    SamplePack.find.mockReturnValue({ sort: sortSpy });
    Samples.aggregate.mockResolvedValue([{ _id: 'p1', count: 3 }]);

    const res = await request(app).get('/api/resources/samplepacks');

    expect(res.status).toBe(200);
    expect(SamplePack.find).toHaveBeenCalledWith({ published: true });
    expect(sortSpy).toHaveBeenCalledWith({ createdAt: -1 });
    expect(res.body.data[0]).toMatchObject({ slug: 'free', itemsCount: 3, isFree: true, folderCount: 1 });
    expect(res.body.data[0].zip).toEqual({ url: 'https://cdn/x.zip', bytes: 5 });
    expect(res.body.data[1]).toMatchObject({ slug: 'paid', itemsCount: 0, isFree: false, zip: null });
  });
});

describe('GET /api/resources/samplepacks/:slug', () => {
  const pack = { _id: 'p1', slug: 'mastermind', title: 'Mastermind', folders: ['Snares', 'Kicks'], published: true };

  it('returns folders in pack order with samples naturally sorted', async () => {
    SamplePack.findOne.mockReturnValue({ lean: () => Promise.resolve(pack) });
    Samples.find.mockReturnValue({ lean: () => Promise.resolve([
      { _id: 's1', title: 'kick 10', audioFile: 'https://cdn/k10.wav', folder: 'Kicks', durationSec: 1 },
      { _id: 's2', title: 'kick 2', audioFile: 'https://cdn/k2.wav', folder: 'Kicks', durationSec: 2 },
      { _id: 's3', title: 'snare 1', audioFile: 'https://cdn/s1.wav', folder: 'Snares', durationSec: null },
      { _id: 's4', title: 'orphan', audioFile: 'https://cdn/o.wav', folder: 'Gone', durationSec: 1 },
    ]) });
    Samples.aggregate.mockResolvedValue([{ _id: 'p1', count: 4 }]);

    const res = await request(app).get('/api/resources/samplepacks/mastermind');

    expect(res.status).toBe(200);
    expect(SamplePack.findOne).toHaveBeenCalledWith({ slug: 'mastermind', published: true });
    expect(res.body.data.slug).toBe('mastermind');
    expect(res.body.data.folders.map((f) => f.name)).toEqual(['Snares', 'Kicks']);
    expect(res.body.data.folders[1].samples.map((s) => s.title)).toEqual(['kick 2', 'kick 10']);
    expect(res.body.data.folders[1].samples[0]).toEqual({
      _id: 's2', title: 'kick 2', audioFile: 'https://cdn/k2.wav', durationSec: 2,
    });
    expect(JSON.stringify(res.body.data.folders)).not.toContain('orphan');
  });

  it('returns 404 PACK_NOT_FOUND for an unknown or unpublished slug', async () => {
    SamplePack.findOne.mockReturnValue({ lean: () => Promise.resolve(null) });

    const res = await request(app).get('/api/resources/samplepacks/nope');

    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ success: false, code: 'PACK_NOT_FOUND' });
    expect(SamplePack.findOne).toHaveBeenCalledWith({ slug: 'nope', published: true });
  });
});
