const { isAllowedDownloadUrl, safeFilename } = require('../utils/downloadSource');

describe('isAllowedDownloadUrl', () => {
  it.each([
    'https://f005.backblazeb2.com/file/niv0-audios/beats/a.mp3',
    'https://s3.us-east-005.backblazeb2.com/niv0-audios/beats/a.mp3',
    'https://niv0-audios.s3.us-east-005.backblazeb2.com/beats/a.mp3',
  ])('accepts our bucket: %s', (url) => {
    expect(isAllowedDownloadUrl(url)).toBe(true);
  });

  it.each([
    ['substring trick in the query', 'https://evil.com/?x=backblazeb2.com'],
    ['look-alike domain', 'https://backblazeb2.com.evil.com/file/niv0-audios/a.mp3'],
    ['plain http', 'http://f005.backblazeb2.com/file/niv0-audios/a.mp3'],
    ['another bucket', 'https://f005.backblazeb2.com/file/other-bucket/a.mp3'],
    ['credentials in the URL', 'https://user:pass@f005.backblazeb2.com/file/niv0-audios/a.mp3'],
    ['not a URL', 'niv0-audios/a.mp3'],
  ])('rejects %s', (_label, url) => {
    expect(isAllowedDownloadUrl(url)).toBe(false);
  });
});

describe('safeFilename', () => {
  it('decodes the last path segment', () => {
    expect(safeFilename('https://x.backblazeb2.com/file/b/beats/Mi%20Beat.mp3')).toBe('Mi Beat.mp3');
  });

  it('strips characters that could break the Content-Disposition header', () => {
    expect(safeFilename('https://x.backblazeb2.com/file/b/a%22%0D%0Ab.mp3')).toBe('a___b.mp3');
  });
});
