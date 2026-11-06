const {
  slugify,
  uniqueSlug,
  cleanFolderName,
  isFreePack,
  publishProblem,
  zipBuildStatus,
  publicPack,
  markZipStale,
  ZIP_BUILD_TIMEOUT_MS,
} = require('../utils/samplePacks');
const SamplePack = require('../models/SamplePack');
const Samples = require('../models/Samples');

describe('slugify', () => {
  it('lowercases, strips diacritics and collapses separators', () => {
    expect(slugify('Mastermind')).toBe('mastermind');
    expect(slugify('Vol. 1 Ñandú')).toBe('vol-1-nandu');
  });
  it('falls back to "pack"', () => {
    expect(slugify('  ')).toBe('pack');
  });
});

describe('uniqueSlug', () => {
  it('appends a counter until the slug is free', async () => {
    const exists = async (s) => s === 'mastermind';
    expect(await uniqueSlug('Mastermind', exists)).toBe('mastermind-2');
  });
  it('returns the base slug when free', async () => {
    expect(await uniqueSlug('Mastermind', async () => false)).toBe('mastermind');
  });
});

describe('cleanFolderName', () => {
  it('trims', () => {
    expect(cleanFolderName(' 808 ')).toBe('808');
  });
  it.each([[''], ['a/b'], ['a\\b'], ['x'.repeat(51)], ['a\u0007b'], [undefined], [5]])(
    'rejects %p',
    (value) => {
      expect.assertions(1);
      try {
        cleanFolderName(value);
      } catch (err) {
        expect(err.code).toBe('INVALID_FOLDER_NAME');
      }
    }
  );
  it('accepts exactly 50 characters', () => {
    expect(cleanFolderName('x'.repeat(50))).toHaveLength(50);
  });
});

describe('isFreePack / publishProblem', () => {
  it('treats null price as free', () => {
    expect(isFreePack({ priceArs: null })).toBe(true);
    expect(isFreePack({})).toBe(true);
    expect(isFreePack({ priceArs: 25000 })).toBe(false);
  });
  it('reports why a pack cannot be published', () => {
    expect(publishProblem({ priceArs: null }, 0)).toBe('PACK_EMPTY');
    expect(publishProblem({ priceArs: 25000 }, 5)).toBe('PACK_PAID_NOT_SELLABLE');
    expect(publishProblem({ priceArs: null }, 5)).toBeNull();
  });
});

describe('zipBuildStatus', () => {
  const now = Date.now();
  const building = (minAgo) => ({
    zip: { build: { status: 'building', startedAt: new Date(now - minAgo * 60 * 1000) } },
  });
  it('is building within the timeout', () => {
    expect(zipBuildStatus(building(5), now)).toBe('building');
  });
  it('is failed after the timeout', () => {
    expect(ZIP_BUILD_TIMEOUT_MS).toBe(30 * 60 * 1000);
    expect(zipBuildStatus(building(31), now)).toBe('failed');
  });
  it('is idle without zip', () => {
    expect(zipBuildStatus({}, now)).toBe('idle');
  });
  it('passes through failed', () => {
    expect(zipBuildStatus({ zip: { build: { status: 'failed' } } }, now)).toBe('failed');
  });
});

describe('publicPack', () => {
  const base = { _id: 'p1', slug: 'm', title: 'M', description: 'd', imageUrl: 'https://x/y.jpg', folders: ['a', 'b'] };
  it('hides the zip of a paid pack', () => {
    const out = publicPack(
      { ...base, priceArs: 25000, priceUsd: null, zip: { url: 'https://x/z.zip', bytes: 10 } },
      { itemsCount: 3 }
    );
    expect(out.zip).toBeNull();
    expect(out.isFree).toBe(false);
    expect(out.folderCount).toBe(2);
    expect(out.itemsCount).toBe(3);
  });
  it('exposes the zip of a free pack', () => {
    const out = publicPack(
      { ...base, priceArs: null, priceUsd: null, zip: { url: 'https://x/z.zip', bytes: 10 } },
      { itemsCount: 3 }
    );
    expect(out.zip).toEqual({ url: 'https://x/z.zip', bytes: 10 });
    expect(out.isFree).toBe(true);
  });
  it('has no zip when none was built', () => {
    expect(publicPack({ ...base, priceArs: null }, { itemsCount: 0 }).zip).toBeNull();
  });
  it('exposes the English description, or null when there is none', () => {
    expect(publicPack({ ...base, descriptionEn: 'English d' }, { itemsCount: 0 }).descriptionEn).toBe('English d');
    expect(publicPack(base, { itemsCount: 0 }).descriptionEn).toBeNull();
  });
});

describe('markZipStale', () => {
  it('flags the zip as stale and records when, so a running build can tell', async () => {
    const spy = jest.spyOn(SamplePack, 'updateOne').mockResolvedValue({});
    const before = Date.now();
    await markZipStale('abc');
    expect(spy).toHaveBeenCalledWith({ _id: 'abc' }, { $set: { 'zip.stale': true, 'zip.staleAt': expect.any(Date) } });
    expect(spy.mock.calls[0][1].$set['zip.staleAt'].getTime()).toBeGreaterThanOrEqual(before);
    spy.mockRestore();
  });
});

describe('model validation', () => {
  const sample = {
    title: 't',
    audioFile: 'https://x/a.wav',
    samplepackId: '507f1f77bcf86cd799439011',
  };
  it('requires folder on Samples', () => {
    expect(new Samples(sample).validateSync().errors.folder).toBeDefined();
    expect(new Samples({ ...sample, folder: '808' }).validateSync()).toBeUndefined();
  });
  it('caps folder at 50 chars', () => {
    expect(new Samples({ ...sample, folder: 'x'.repeat(51) }).validateSync().errors.folder).toBeDefined();
  });
  it('allows a SamplePack without imageUrl and applies defaults', () => {
    const pack = new SamplePack({ title: 't', description: 'd', type: 'samples' });
    expect(pack.validateSync()).toBeUndefined();
    expect(pack.published).toBe(false);
    expect(pack.priceArs).toBeNull();
    expect(pack.folders).toEqual([]);
    expect(pack.zip.stale).toBe(false);
    expect(pack.zip.build.status).toBe('idle');
  });
});
