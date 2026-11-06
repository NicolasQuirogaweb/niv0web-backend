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

describe('generic resource routes no longer serve samples', () => {
  it('GET /api/resources/samples answers 404 without touching the models', async () => {
    const res = await request(app).get('/api/resources/samples');

    expect(res.status).toBe(404);
    expect(Samples.find).not.toHaveBeenCalled();
  });

  it('GET /api/resources/samples/playlist/:id answers 404 without reading the pack', async () => {
    const res = await request(app).get('/api/resources/samples/playlist/66a000000000000000000001');

    expect(res.status).toBe(404);
    expect(SamplePack.findById).not.toHaveBeenCalled();
    expect(Samples.find).not.toHaveBeenCalled();
  });
});

describe('zip urls of draft or paid packs never leak', () => {
  const packs = [
    { _id: 'p1', slug: 'free', title: 'Free', folders: ['Kicks'], published: true, zip: { url: 'https://cdn/free.zip', key: 'zips/free.zip', fileId: 'f1' } },
    { _id: 'p2', slug: 'paid', title: 'Paid', folders: [], published: true, priceArs: 1000, zip: { url: 'https://cdn/paid.zip', key: 'zips/paid.zip', fileId: 'f2' } },
    { _id: 'p3', slug: 'draft', title: 'Draft', folders: [], published: false, zip: { url: 'https://cdn/draft.zip', key: 'zips/draft.zip', fileId: 'f3' } },
  ];
  // El mock aplica el filtro como lo haria Mongo, asi el test no depende del orden de los packs.
  const matches = (filter) => (p) => Object.entries(filter).every(([k, v]) => p[k] === v);

  beforeEach(() => {
    SamplePack.find.mockImplementation((filter) => ({
      sort: () => ({ lean: () => Promise.resolve(packs.filter(matches(filter))) }),
    }));
    SamplePack.findOne.mockImplementation((filter) => ({
      lean: () => Promise.resolve(packs.find(matches(filter)) || null),
    }));
    Samples.aggregate.mockResolvedValue([]);
    Samples.find.mockReturnValue({ lean: () => Promise.resolve([]) });
  });

  it('the list shows only the free published zip url, never key/fileId', async () => {
    const res = await request(app).get('/api/resources/samplepacks');
    const body = JSON.stringify(res.body);

    expect(res.status).toBe(200);
    expect(body).toContain('https://cdn/free.zip');
    expect(body).not.toContain('paid.zip');
    expect(body).not.toContain('draft.zip');
    expect(body).not.toContain('fileId');
    expect(body).not.toContain('zips/');
  });

  it('the detail of a draft is 404 and of a paid pack hides the zip', async () => {
    const draft = await request(app).get('/api/resources/samplepacks/draft');
    const paid = await request(app).get('/api/resources/samplepacks/paid');

    expect(draft.status).toBe(404);
    expect(JSON.stringify(draft.body)).not.toContain('draft.zip');
    expect(paid.status).toBe(200);
    expect(paid.body.data.zip).toBeNull();
    expect(JSON.stringify(paid.body)).not.toContain('paid.zip');
  });
});
