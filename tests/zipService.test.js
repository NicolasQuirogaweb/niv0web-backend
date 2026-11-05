const { Readable } = require('stream');

jest.mock('backblaze-b2');
const { zipEntries, buildPackZip } = require('../services/zipService');

const PACK_ID = '66a000000000000000000001';
const BASE = 'https://s3.us-east-005.backblazeb2.com/niv0-audios';

const wav = (dataSize, fill) => {
  const h = Buffer.alloc(44 + dataSize, fill);
  h.write('RIFF', 0, 'ascii');
  h.writeUInt32LE(36 + dataSize, 4);
  h.write('WAVE', 8, 'ascii');
  h.write('fmt ', 12, 'ascii');
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20);
  h.writeUInt16LE(1, 22);
  h.writeUInt32LE(8000, 24);
  h.writeUInt32LE(16000, 28);
  h.writeUInt16LE(2, 32);
  h.writeUInt16LE(16, 34);
  h.write('data', 36, 'ascii');
  h.writeUInt32LE(dataSize, 40);
  return h;
};

const pack = (over = {}) => ({
  _id: PACK_ID,
  title: 'Mastermind',
  slug: 'mastermind',
  folders: ['Drums', 'FX'],
  zip: { url: `${BASE}/samplepacks/mastermind-old.zip`, key: 'samplepacks/mastermind-old.zip', fileId: 'old-id', bytes: 10 },
  ...over,
});

const sample = (id, title, folder, audioFile = `/samples/${id}.wav`) => ({ _id: id, title, folder, audioFile, durationSec: null });

describe('zipEntries', () => {
  it('numbers duplicate titles inside one folder', () => {
    const names = zipEntries(pack(), [sample('s1', 'kick', 'Drums'), sample('s2', 'kick', 'Drums')]).map((e) => e.name);
    expect(names).toEqual(['Mastermind/Drums/kick.wav', 'Mastermind/Drums/kick (2).wav']);
  });

  it('sanitises reserved and control characters', () => {
    const [entry] = zipEntries(pack(), [sample('s1', 'a/b:c', 'Drums')]);
    expect(entry.name).toBe('Mastermind/Drums/a_b_c.wav');
    const [ctrl] = zipEntries(pack({ title: 'P*?"<>|\\' }), [sample('s1', 'x\u0001y', 'Drums')]);
    expect(ctrl.name).toBe('P_______/Drums/x_y.wav');
  });

  it('follows the pack folder order, then numeric title order', () => {
    const entries = zipEntries(pack({ folders: ['FX', 'Drums'] }), [
      sample('s1', 'kick 10', 'Drums'),
      sample('s2', 'riser', 'FX'),
      sample('s3', 'kick 2', 'Drums'),
    ]);
    expect(entries.map((e) => e.name)).toEqual([
      'Mastermind/FX/riser.wav',
      'Mastermind/Drums/kick 2.wav',
      'Mastermind/Drums/kick 10.wav',
    ]);
    expect(entries[0]).toEqual({ name: 'Mastermind/FX/riser.wav', url: `${BASE}/samples/s2.wav`, sampleId: 's2' });
  });

  it('keeps the audio file extension and defaults to .wav', () => {
    const entries = zipEntries(pack(), [
      sample('s1', 'a', 'Drums', `${BASE}/samples/a.aif`),
      sample('s2', 'b', 'Drums', `${BASE}/samples/noext`),
    ]);
    expect(entries.map((e) => e.name)).toEqual(['Mastermind/Drums/a.aif', 'Mastermind/Drums/b.wav']);
  });
});


describe('buildPackZip', () => {
  const NOW = new Date('2026-11-05T12:00:00Z');
  const CLAIMED = new Date('2026-11-05T11:59:00Z');
  const KEY = `samplepacks/mastermind-${NOW.getTime().toString(36)}.zip`;
  let deps;
  let uploaded;

  // findOneAndUpdate devuelve el documento ANTES del update (o null si el
  // filtro no matcheo). `saves` define que devuelve cada llamada.
  const setup = ({ packDoc = pack(), samples, get, saves }) => {
    uploaded = null;
    const results = saves || [{ _id: PACK_ID, zip: packDoc.zip }];
    let call = 0;
    deps = {
      SamplePack: {
        findById: jest.fn(() => ({ lean: () => Promise.resolve(packDoc) })),
        findOneAndUpdate: jest.fn(() => {
          const value = results[Math.min(call, results.length - 1)];
          call += 1;
          return { lean: () => Promise.resolve(value) };
        }),
        updateOne: jest.fn().mockResolvedValue({}),
      },
      Samples: {
        find: jest.fn(() => ({ lean: () => Promise.resolve(samples) })),
        bulkWrite: jest.fn().mockResolvedValue({}),
      },
      http: { get: jest.fn(get) },
      b2: {
        // Consume el stream como lo haria B2, juntando los bytes.
        uploadLargeStream: jest.fn(async (readable, key) => {
          const chunks = [];
          for await (const c of readable) chunks.push(c);
          uploaded = Buffer.concat(chunks);
          return { url: `${BASE}/${key}`, key, bytes: uploaded.length, fileId: 'new-id' };
        }),
        deleteFile: jest.fn().mockResolvedValue(),
      },
      now: () => NOW,
    };
  };

  beforeEach(() => jest.spyOn(console, 'error').mockImplementation(() => {}));
  afterEach(() => jest.restoreAllMocks());

  const saveCalls = () => deps.SamplePack.findOneAndUpdate.mock.calls;
  const okWavs = () => ({ data: Readable.from([wav(100, 0)]) });
  const notFound = () => Object.assign(new Error('Request failed with status code 404'), { response: { status: 404 } });

  it('streams the WAVs into the upload, saves the new zip and deletes the one it replaced', async () => {
    const files = { [`${BASE}/samples/s1.wav`]: wav(16000, 1), [`${BASE}/samples/s2.wav`]: wav(8000, 2) };
    setup({
      samples: [sample('s1', 'kick', 'Drums'), sample('s2', 'snare', 'Drums')],
      get: async (url) => ({ data: Readable.from([files[url]]) }),
    });

    await buildPackZip(PACK_ID, deps);

    expect(deps.http.get.mock.calls.map(([url, o]) => [url, o.responseType])).toEqual([
      [`${BASE}/samples/s1.wav`, 'stream'],
      [`${BASE}/samples/s2.wav`, 'stream'],
    ]);
    expect(deps.b2.uploadLargeStream).toHaveBeenCalledWith(expect.anything(), KEY, {
      mime: 'application/zip',
      cacheControl: 'public, max-age=31536000, immutable',
    });
    expect(uploaded.subarray(0, 2).toString()).toBe('PK');
    expect(uploaded.includes('Mastermind/Drums/kick.wav')).toBe(true);
    expect(uploaded.includes('Mastermind/Drums/snare.wav')).toBe(true);
    // store mode: el WAV entra tal cual
    expect(uploaded.includes(files[`${BASE}/samples/s1.wav`])).toBe(true);

    // sin claim: update incondicional, como antes
    expect(saveCalls()).toHaveLength(1);
    const [filter, update] = saveCalls()[0];
    expect(filter).toEqual({ _id: PACK_ID });
    expect(update.$set).toEqual({
      'zip.url': `${BASE}/${KEY}`,
      'zip.key': KEY,
      'zip.fileId': 'new-id',
      'zip.bytes': uploaded.length,
      'zip.builtAt': NOW,
      'zip.stale': false,
      'zip.build': { status: 'idle', startedAt: null, error: null },
    });
    expect(deps.SamplePack.updateOne).not.toHaveBeenCalled();
    expect(deps.b2.deleteFile).toHaveBeenCalledWith('samplepacks/mastermind-old.zip', 'old-id');
    expect(deps.SamplePack.findOneAndUpdate.mock.invocationCallOrder[0]).toBeLessThan(
      deps.b2.deleteFile.mock.invocationCallOrder[0]
    );

    const ops = deps.Samples.bulkWrite.mock.calls[0][0];
    expect(ops).toEqual([
      { updateOne: { filter: { _id: 's1' }, update: { $set: { durationSec: 1 } } } },
      { updateOne: { filter: { _id: 's2' }, update: { $set: { durationSec: 0.5 } } } },
    ]);
  });

  it('does not delete anything when the pack had no previous zip', async () => {
    const packDoc = pack({ zip: { url: null, key: null, fileId: null } });
    setup({ packDoc, samples: [sample('s1', 'kick', 'Drums')], get: async () => okWavs() });
    await buildPackZip(PACK_ID, deps);
    expect(saveCalls()[0][1].$set['zip.url']).toBe(`${BASE}/${KEY}`);
    expect(deps.b2.deleteFile).not.toHaveBeenCalled();
  });

  it('falls back to the pack id in the key when the pack has no slug', async () => {
    setup({ packDoc: pack({ slug: undefined }), samples: [sample('s1', 'kick', 'Drums')], get: async () => okWavs() });
    await buildPackZip(PACK_ID, deps);
    expect(deps.b2.uploadLargeStream.mock.calls[0][1]).toBe(`samplepacks/${PACK_ID}-${NOW.getTime().toString(36)}.zip`);
  });

  describe('with a claim', () => {
    const claim = { startedAt: CLAIMED };
    const owned = { _id: PACK_ID, 'zip.build.startedAt': CLAIMED };

    it('saves a fresh zip only while it owns the claim and nothing was edited since', async () => {
      setup({ samples: [sample('s1', 'kick', 'Drums')], get: async () => okWavs() });
      await buildPackZip(PACK_ID, deps, claim);

      expect(saveCalls()).toHaveLength(1);
      const [filter, update] = saveCalls()[0];
      expect(filter).toEqual({ ...owned, $or: [{ 'zip.staleAt': null }, { 'zip.staleAt': { $lte: CLAIMED } }] });
      expect(update.$set['zip.stale']).toBe(false);
      expect(deps.b2.deleteFile).toHaveBeenCalledWith('samplepacks/mastermind-old.zip', 'old-id');
    });

    it('leaves the zip stale when the pack was edited during the build', async () => {
      // el primer update no matchea (staleAt > startedAt), el segundo si
      setup({
        samples: [sample('s1', 'kick', 'Drums')],
        get: async () => okWavs(),
        saves: [null, { _id: PACK_ID, zip: pack().zip }],
      });
      await buildPackZip(PACK_ID, deps, claim);

      expect(saveCalls()).toHaveLength(2);
      const [filter, update] = saveCalls()[1];
      expect(filter).toEqual(owned);
      expect(update.$set['zip.stale']).toBe(true);
      expect(update.$set['zip.url']).toBe(`${BASE}/${KEY}`);
      expect(deps.b2.deleteFile).toHaveBeenCalledWith('samplepacks/mastermind-old.zip', 'old-id');
    });

    it('deletes its own new file and leaves the pack alone when superseded', async () => {
      setup({ samples: [sample('s1', 'kick', 'Drums')], get: async () => okWavs(), saves: [null] });
      await buildPackZip(PACK_ID, deps, claim);

      expect(saveCalls()).toHaveLength(2);
      saveCalls().forEach(([filter]) => expect(filter).toMatchObject(owned));
      expect(deps.b2.deleteFile).toHaveBeenCalledTimes(1);
      expect(deps.b2.deleteFile).toHaveBeenCalledWith(KEY, 'new-id');
      expect(deps.SamplePack.updateOne).not.toHaveBeenCalled();
      expect(deps.Samples.bulkWrite).not.toHaveBeenCalled();
    });

    it('records a failure only while it still owns the claim', async () => {
      setup({
        samples: [sample('s1', 'Lost Kick', 'Drums')],
        get: async () => {
          throw notFound();
        },
      });
      deps.SamplePack.updateOne.mockResolvedValue({ matchedCount: 0 });
      await buildPackZip(PACK_ID, deps, claim);

      expect(deps.SamplePack.updateOne).toHaveBeenCalledTimes(1);
      const [filter, update] = deps.SamplePack.updateOne.mock.calls[0];
      expect(filter).toEqual(owned);
      expect(update.$set['zip.build.error']).toBe('No se pudo armar el ZIP: Lost Kick (404)');
      expect(saveCalls()).toHaveLength(0);
      expect(deps.b2.deleteFile).not.toHaveBeenCalled();
    });
  });

  const failure = () => {
    const sets = deps.SamplePack.updateOne.mock.calls.map(([, update]) => update.$set);
    expect(sets).toHaveLength(1);
    expect(sets[0]['zip.build.status']).toBe('failed');
    expect(Object.keys(sets[0]).some((k) => k === 'zip' || k === 'zip.url' || k === 'zip.fileId' || k === 'zip.bytes')).toBe(false);
    expect(saveCalls()).toHaveLength(0);
    expect(deps.b2.deleteFile).not.toHaveBeenCalled();
    return sets[0]['zip.build.error'];
  };

  it('fails naming the sample and the status when a WAV is missing (404) and keeps the previous zip', async () => {
    setup({
      samples: [sample('s1', 'kick', 'Drums'), sample('s2', 'Missing Snare', 'Drums')],
      get: async (url) => {
        if (url.endsWith('s2.wav')) throw notFound();
        return okWavs();
      },
    });

    await buildPackZip(PACK_ID, deps);

    expect(failure()).toBe('No se pudo armar el ZIP: Missing Snare (404)');
    // la subida vio el error y no termino
    await expect(deps.b2.uploadLargeStream.mock.results[0].value).rejects.toThrow();
    expect(uploaded).toBeNull();
  });

  it('fails without hanging when a WAV stream errors midway', async () => {
    setup({
      samples: [sample('s1', 'Broken Kick', 'Drums')],
      get: async () => {
        const data = new Readable({ read() {} });
        data.push(wav(100, 0));
        setImmediate(() => data.destroy(new Error('socket hang up')));
        return { data };
      },
    });

    await buildPackZip(PACK_ID, deps);
    expect(failure()).toBe('No se pudo armar el ZIP: Broken Kick (socket hang up)');
  });

  it('fails when the upload fails', async () => {
    setup({ samples: [sample('s1', 'kick', 'Drums')], get: async () => okWavs() });
    deps.b2.uploadLargeStream.mockImplementation(async (readable) => {
      readable.resume();
      throw Object.assign(new Error('Error al subir el archivo al almacenamiento'), { code: 'STORAGE_UPLOAD_FAILED' });
    });

    await buildPackZip(PACK_ID, deps);
    expect(failure()).toContain('almacenamiento');
  });

  it('fails when the pack has no samples', async () => {
    setup({ samples: [], get: async () => okWavs() });
    await buildPackZip(PACK_ID, deps);
    expect(failure()).toContain('no tiene samples');
    expect(deps.b2.uploadLargeStream).not.toHaveBeenCalled();
  });

  describe('stalled downloads', () => {
    const B2 = require('backblaze-b2');
    const realB2 = require('../services/b2Service');
    const b2 = B2.prototype;
    // Manda un chunk (mas grande que una parte, asi arranca el large file) y se queda quieto.
    const stalled = () => {
      const data = new Readable({ read() {} });
      data.push(Buffer.alloc(11 * 1024 * 1024, 3));
      return data;
    };

    beforeEach(() => {
      b2.authorize.mockResolvedValue({ data: {} });
      b2.startLargeFile.mockResolvedValue({ data: { fileId: 'large-1' } });
      b2.getUploadPartUrl.mockResolvedValue({ data: { uploadUrl: 'https://part', authorizationToken: 'tok' } });
      b2.uploadPart.mockResolvedValue({ data: {} });
      b2.cancelLargeFile.mockResolvedValue({ data: {} });
    });
    afterEach(() => jest.resetAllMocks());

    it('fails the sample after the idle timeout and cancels the large file', async () => {
      setup({ samples: [sample('s1', 'Frozen Pad', 'Drums')], get: async () => ({ data: stalled() }) });
      deps.b2 = { uploadLargeStream: realB2.uploadLargeStream, deleteFile: jest.fn() };
      deps.idleTimeoutMs = 50;

      await buildPackZip(PACK_ID, deps);

      expect(failure()).toBe('No se pudo armar el ZIP: Frozen Pad (sin respuesta)');
      expect(b2.startLargeFile).toHaveBeenCalled();
      expect(b2.cancelLargeFile).toHaveBeenCalledWith({ fileId: 'large-1' });
      expect(b2.finishLargeFile).not.toHaveBeenCalled();
    });

    it('aborts at the overall build cap and cancels the large file', async () => {
      setup({ samples: [sample('s1', 'Slow Pad', 'Drums')], get: async () => ({ data: stalled() }) });
      deps.b2 = { uploadLargeStream: realB2.uploadLargeStream, deleteFile: jest.fn() };
      deps.idleTimeoutMs = 60 * 1000;
      deps.buildTimeoutMs = 80;

      await buildPackZip(PACK_ID, deps);

      expect(failure()).toBe('No se pudo armar el ZIP: se supero el tiempo maximo de armado');
      expect(b2.cancelLargeFile).toHaveBeenCalledWith({ fileId: 'large-1' });
      expect(b2.finishLargeFile).not.toHaveBeenCalled();
    });
  });
});
