const buildPublicUrl = require('../utils/buildPublicUrl');

describe('buildPublicUrl', () => {
  it('returns null for empty input', () => {
    expect(buildPublicUrl(null)).toBeNull();
    expect(buildPublicUrl('')).toBeNull();
  });

  it('leaves absolute URLs untouched', () => {
    const url = 'https://f005.backblazeb2.com/file/niv0-audios/beats/a.mp3';
    expect(buildPublicUrl(url)).toBe(url);
  });

  it('builds the bucket URL from a relative path, encoding each segment', () => {
    expect(buildPublicUrl('/beats/my song.mp3')).toBe(
      'https://s3.us-east-005.backblazeb2.com/niv0-audios/beats/my%20song.mp3'
    );
  });
});
