const { scheduleZipRebuild, claimZipBuild, AUTO_BUILD_DELAY_MS, cancelAllZipRebuilds } = require('../services/zipAutoBuild');

// Al editar un pack (título, carpetas, samples) el ZIP se vuelve a armar solo, para que
// la descarga tenga los nombres nuevos sin acordarse de apretar "Generar ZIP".
const deps = (overrides = {}) => ({
  SamplePack: { findOneAndUpdate: jest.fn().mockResolvedValue({ _id: 'p1' }) },
  Samples: { countDocuments: jest.fn().mockResolvedValue(3) },
  build: jest.fn().mockResolvedValue(undefined),
  ...overrides,
});

const flush = async () => {
  for (let i = 0; i < 5; i++) await Promise.resolve();
};

beforeEach(() => jest.useFakeTimers());
afterEach(() => {
  cancelAllZipRebuilds();
  jest.useRealTimers();
});

describe('scheduleZipRebuild', () => {
  it('waits a moment after the last edit, then builds the ZIP once', async () => {
    const d = deps();
    scheduleZipRebuild('p1', d);
    jest.advanceTimersByTime(AUTO_BUILD_DELAY_MS - 1);
    scheduleZipRebuild('p1', d); // otra edición: vuelve a esperar
    jest.advanceTimersByTime(AUTO_BUILD_DELAY_MS - 1);
    expect(d.build).not.toHaveBeenCalled();
    jest.advanceTimersByTime(1);
    await flush();
    expect(d.build).toHaveBeenCalledTimes(1);
    expect(d.build).toHaveBeenCalledWith('p1', undefined, { startedAt: expect.any(Date) });
  });

  it('if a build is already running, tries again later instead of skipping the edit', async () => {
    const d = deps({ SamplePack: { findOneAndUpdate: jest.fn().mockResolvedValueOnce(null).mockResolvedValue({ _id: 'p1' }) } });
    scheduleZipRebuild('p1', d);
    jest.advanceTimersByTime(AUTO_BUILD_DELAY_MS);
    await flush();
    expect(d.build).not.toHaveBeenCalled();
    jest.advanceTimersByTime(AUTO_BUILD_DELAY_MS);
    await flush();
    expect(d.build).toHaveBeenCalledTimes(1);
  });

  it('does nothing for a pack without samples', async () => {
    const d = deps({ Samples: { countDocuments: jest.fn().mockResolvedValue(0) } });
    scheduleZipRebuild('p1', d);
    jest.advanceTimersByTime(AUTO_BUILD_DELAY_MS);
    await flush();
    expect(d.SamplePack.findOneAndUpdate).not.toHaveBeenCalled();
    expect(d.build).not.toHaveBeenCalled();
  });
});

describe('claimZipBuild', () => {
  it('claims only when no fresh build is running', async () => {
    const d = deps();
    const startedAt = await claimZipBuild('p1', d);
    expect(startedAt).toBeInstanceOf(Date);
    const [filter, update] = d.SamplePack.findOneAndUpdate.mock.calls[0];
    expect(filter._id).toBe('p1');
    expect(filter.$or).toHaveLength(2);
    expect(update.$set['zip.build']).toEqual({ status: 'building', startedAt, error: null });
    d.SamplePack.findOneAndUpdate.mockResolvedValue(null);
    expect(await claimZipBuild('p1', d)).toBeNull();
  });
});

describe('scheduleZipRebuild after a failure', () => {
  it('tries again on its own when the build failed (up to 3 tries), then stops', async () => {
    const d = deps({
      SamplePack: {
        findOneAndUpdate: jest.fn().mockResolvedValue({ _id: 'p1' }),
        findById: jest.fn(() => ({ lean: () => Promise.resolve({ zip: { build: { status: 'failed' } } }) })),
      },
    });
    scheduleZipRebuild('p1', d);
    for (let i = 0; i < 6; i++) {
      jest.advanceTimersByTime(AUTO_BUILD_DELAY_MS * 4);
      await flush();
    }
    expect(d.build).toHaveBeenCalledTimes(3);
  });

  it('waits only a few seconds after an edit', () => {
    expect(AUTO_BUILD_DELAY_MS).toBeLessThanOrEqual(8000);
  });
});
