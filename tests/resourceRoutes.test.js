const buildPublicUrl = (filePath) => {
  if (!filePath) return null;
  if (filePath.startsWith('http')) return filePath;
  const clean = filePath.replace(/^\/+/, '');
  const encoded = clean.split('/').map(encodeURIComponent).join('/');
  return `https://s3.test.com/bucket/${encoded}`;
};

describe('buildPublicUrl', () => {
  it('returns null for falsy input', () => {
    expect(buildPublicUrl(null)).toBeNull();
    expect(buildPublicUrl(undefined)).toBeNull();
    expect(buildPublicUrl('')).toBeNull();
  });

  it('returns absolute URLs as-is', () => {
    const url = 'https://example.com/file.mp3';
    expect(buildPublicUrl(url)).toBe(url);
  });

  it('encodes path segments individually', () => {
    const result = buildPublicUrl('beats/my song.mp3');
    expect(result).toBe('https://s3.test.com/bucket/beats/my%20song.mp3');
  });

  it('strips leading slash', () => {
    const result = buildPublicUrl('/beats/file.mp3');
    expect(result).toBe('https://s3.test.com/bucket/beats/file.mp3');
  });

  it('preserves forward slashes in paths', () => {
    const result = buildPublicUrl('beats/subdir/file.mp3');
    expect(result).toBe('https://s3.test.com/bucket/beats/subdir/file.mp3');
  });
});
