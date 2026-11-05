const { Readable } = require('stream');
const crypto = require('crypto');

jest.mock('backblaze-b2');
const B2 = require('backblaze-b2');
const { uploadLargeStream, deleteFile, PART_SIZE } = require('../services/b2Service');

const MB = 1024 * 1024;
const sha1 = (buf) => crypto.createHash('sha1').update(buf).digest('hex');

// Stream sintetico en chunks de 64 KB, sin tocar disco.
const syntheticStream = (bytes, { failAt = Infinity } = {}) => {
  let sent = 0;
  return new Readable({
    read() {
      if (sent >= failAt) return this.destroy(new Error('input broke'));
      if (sent >= bytes) return this.push(null);
      const size = Math.min(64 * 1024, bytes - sent);
      const chunk = Buffer.alloc(size, sent % 251);
      sent += size;
      this.push(chunk);
    },
  });
};

const opts = { mime: 'application/zip', cacheControl: 'public, max-age=31536000, immutable' };
const b2 = B2.prototype;

beforeEach(() => {
  jest.spyOn(console, 'error').mockImplementation(() => {});
  b2.authorize.mockResolvedValue({ data: {} });
  b2.startLargeFile.mockResolvedValue({ data: { fileId: 'large-1' } });
  b2.getUploadPartUrl.mockResolvedValue({ data: { uploadUrl: 'https://part', authorizationToken: 'tok' } });
  b2.uploadPart.mockResolvedValue({ data: {} });
  b2.finishLargeFile.mockResolvedValue({ data: { fileId: 'large-1' } });
  b2.cancelLargeFile.mockResolvedValue({ data: {} });
  b2.getUploadUrl.mockResolvedValue({ data: { uploadUrl: 'https://up', authorizationToken: 'tok' } });
  b2.uploadFile.mockResolvedValue({ data: { fileId: 'small-1' } });
  b2.deleteFileVersion.mockResolvedValue({ data: {} });
});
afterEach(() => {
  jest.resetAllMocks();
  jest.restoreAllMocks();
});

describe('uploadLargeStream', () => {
  it('uses 10 MB parts', () => {
    expect(PART_SIZE).toBe(10 * MB);
  });

  it('uploads a 25 MB stream as 3 parts and finishes with their SHA-1s', async () => {
    const result = await uploadLargeStream(syntheticStream(25 * MB), 'samplepacks/x-1.zip', opts);

    expect(b2.startLargeFile).toHaveBeenCalledTimes(1);
    const startArgs = b2.startLargeFile.mock.calls[0][0];
    expect(startArgs).toMatchObject({ bucketId: 'test-bucket-id', fileName: 'samplepacks/x-1.zip', contentType: 'application/zip' });
    // backblaze-b2 1.7.1 no reenvia fileInfo: va por axiosOverride.
    expect(startArgs.axiosOverride.data.fileInfo).toEqual({ 'b2-cache-control': opts.cacheControl });

    const parts = b2.uploadPart.mock.calls.map(([args]) => args);
    expect(parts.map((p) => p.partNumber)).toEqual([1, 2, 3]);
    expect(parts.map((p) => p.data.length)).toEqual([10 * MB, 10 * MB, 5 * MB]);
    const hashes = parts.map((p) => sha1(p.data));
    parts.forEach((p, i) => expect(p.hash).toBe(hashes[i]));

    expect(b2.finishLargeFile).toHaveBeenCalledWith({ fileId: 'large-1', partSha1Array: hashes });
    expect(b2.uploadFile).not.toHaveBeenCalled();
    expect(result).toEqual({
      url: 'https://s3.us-east-005.backblazeb2.com/niv0-audios/samplepacks/x-1.zip',
      key: 'samplepacks/x-1.zip',
      bytes: 25 * MB,
      fileId: 'large-1',
    });
  });

  it('uploads a 1 MB stream with a single uploadFile', async () => {
    const result = await uploadLargeStream(syntheticStream(1 * MB), 'samplepacks/x-2.zip', opts);

    expect(b2.uploadFile).toHaveBeenCalledTimes(1);
    const args = b2.uploadFile.mock.calls[0][0];
    expect(args).toMatchObject({
      fileName: 'samplepacks/x-2.zip',
      mime: 'application/zip',
      info: { 'b2-cache-control': opts.cacheControl },
    });
    expect(args.data.length).toBe(1 * MB);
    expect(b2.startLargeFile).not.toHaveBeenCalled();
    expect(result).toMatchObject({ key: 'samplepacks/x-2.zip', bytes: 1 * MB, fileId: 'small-1' });
  });

  it('retries a part and then cancels the large file when it keeps failing', async () => {
    b2.uploadPart.mockRejectedValue(Object.assign(new Error('boom'), { response: { status: 500 } }));

    await expect(uploadLargeStream(syntheticStream(25 * MB), 'samplepacks/x-3.zip', opts)).rejects.toMatchObject({
      code: 'STORAGE_UPLOAD_FAILED',
    });
    expect(b2.uploadPart).toHaveBeenCalledTimes(3);
    expect(b2.cancelLargeFile).toHaveBeenCalledWith({ fileId: 'large-1' });
    expect(b2.finishLargeFile).not.toHaveBeenCalled();
  });

  it('cancels the large file when the input stream errors', async () => {
    const source = syntheticStream(25 * MB, { failAt: 12 * MB });

    await expect(uploadLargeStream(source, 'samplepacks/x-4.zip', opts)).rejects.toMatchObject({
      code: 'STORAGE_UPLOAD_FAILED',
    });
    expect(b2.cancelLargeFile).toHaveBeenCalledWith({ fileId: 'large-1' });
    expect(b2.finishLargeFile).not.toHaveBeenCalled();
  });
});

describe('deleteFile', () => {
  it('deletes the file version by key and fileId', async () => {
    await deleteFile('samplepacks/old.zip', 'old-id');
    expect(b2.deleteFileVersion).toHaveBeenCalledWith({ fileId: 'old-id', fileName: 'samplepacks/old.zip' });
  });
});
