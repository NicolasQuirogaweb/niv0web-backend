const request = require('supertest');

jest.mock('../models/SpotifyAlbum');

const SpotifyAlbum = require('../models/SpotifyAlbum');
const { fetchArtistReleases } = require('../services/spotifyService');
const app = require('../app');

const JOBS_TOKEN = 'j'.repeat(40);

const SPOTIFY_ALBUM = {
  id: 'alb1',
  name: 'Archetype',
  album_type: 'album',
  release_date: '2025-08-01',
  images: [{ url: 'https://i.scdn.co/image/cover' }],
  external_urls: { spotify: 'https://open.spotify.com/album/alb1' },
  total_tracks: 9,
};

const jsonResponse = (body, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
});

const mockSpotify = (albumsPages = [{ items: [SPOTIFY_ALBUM], next: null }]) => {
  const pages = [...albumsPages];
  return jest.spyOn(global, 'fetch').mockImplementation(async (url) => {
    if (String(url).startsWith('https://accounts.spotify.com/api/token')) {
      return jsonResponse({ access_token: 'tok', expires_in: 3600 });
    }
    return jsonResponse(pages.shift());
  });
};

const findChain = (docs) => ({ sort: () => ({ lean: () => Promise.resolve(docs) }) });

beforeEach(() => {
  Object.assign(process.env, {
    SPOTIFY_CLIENT_ID: 'cid',
    SPOTIFY_CLIENT_SECRET: 'csecret',
    SPOTIFY_ARTIST_ID: 'artist123',
    JOBS_TOKEN,
  });
  SpotifyAlbum.find.mockReturnValue(findChain([]));
  SpotifyAlbum.findOne.mockReturnValue({ sort: () => ({ lean: () => Promise.resolve(null) }) });
});

afterEach(() => {
  jest.restoreAllMocks();
  jest.resetAllMocks();
});

describe('fetchArtistReleases', () => {
  it('asks Spotify for the artist own albums and singles and maps them', async () => {
    const fetchSpy = mockSpotify();
    const albums = await fetchArtistReleases();

    const [tokenUrl, tokenInit] = fetchSpy.mock.calls[0];
    expect(tokenUrl).toBe('https://accounts.spotify.com/api/token');
    expect(String(tokenInit.body)).toContain('grant_type=client_credentials');
    expect(tokenInit.headers.Authorization).toBe(`Basic ${Buffer.from('cid:csecret').toString('base64')}`);
    expect(fetchSpy.mock.calls[1][0]).toBe(
      'https://api.spotify.com/v1/artists/artist123/albums?include_groups=album,single&limit=50'
    );
    expect(albums).toEqual([
      {
        spotifyId: 'alb1',
        name: 'Archetype',
        type: 'album',
        releaseDate: '2025-08-01',
        imageUrl: 'https://i.scdn.co/image/cover',
        spotifyUrl: 'https://open.spotify.com/album/alb1',
        totalTracks: 9,
      },
    ]);
  });

  it('follows pagination and uses null when an album has no cover', async () => {
    mockSpotify([
      { items: [SPOTIFY_ALBUM], next: 'https://api.spotify.com/v1/artists/artist123/albums?offset=50' },
      { items: [{ ...SPOTIFY_ALBUM, id: 'alb2', images: [] }], next: null },
    ]);
    const albums = await fetchArtistReleases();
    expect(albums.map((a) => a.spotifyId)).toEqual(['alb1', 'alb2']);
    expect(albums[1].imageUrl).toBeNull();
  });
});

describe('GET /api/discography', () => {
  it('returns the cached releases, newest first', async () => {
    const cached = [{ spotifyId: 'b', releaseDate: '2025-01-01' }, { spotifyId: 'a', releaseDate: '2021-05-01' }];
    SpotifyAlbum.find.mockReturnValue(findChain(cached));
    SpotifyAlbum.findOne.mockReturnValue({ sort: () => ({ lean: () => Promise.resolve({ updatedAt: new Date() }) }) });
    const fetchSpy = jest.spyOn(global, 'fetch');

    const res = await request(app).get('/api/discography');
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual(cached);
    expect(fetchSpy).not.toHaveBeenCalled(); // cache fresco: no se consulta Spotify
  });

  it('answers with the stale cache right away and refreshes it in the background', async () => {
    const cached = [{ spotifyId: 'old', releaseDate: '2020-01-01' }];
    SpotifyAlbum.find.mockReturnValue(findChain(cached));
    const sevenHoursAgo = new Date(Date.now() - 7 * 60 * 60 * 1000);
    SpotifyAlbum.findOne.mockReturnValue({ sort: () => ({ lean: () => Promise.resolve({ updatedAt: sevenHoursAgo }) }) });
    const fetchSpy = mockSpotify();

    const res = await request(app).get('/api/discography');
    expect(res.body.data).toEqual(cached);
    await new Promise((resolve) => setImmediate(resolve));
    expect(fetchSpy).toHaveBeenCalled();
  });

  it('returns an empty list when Spotify is not configured', async () => {
    delete process.env.SPOTIFY_ARTIST_ID;
    const fetchSpy = jest.spyOn(global, 'fetch');
    const res = await request(app).get('/api/discography');
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe('POST /api/jobs/refresh-discography', () => {
  const refresh = () => request(app).post('/api/jobs/refresh-discography');

  it('requires the jobs token', async () => {
    expect((await refresh()).status).toBe(401);
    expect((await refresh().set('Authorization', 'Bearer nope')).status).toBe(401);
  });

  it('replaces the cache with the current releases', async () => {
    mockSpotify();
    const res = await refresh().set('Authorization', `Bearer ${JOBS_TOKEN}`);
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ count: 1 });
    expect(SpotifyAlbum.deleteMany).toHaveBeenCalled();
    expect(SpotifyAlbum.insertMany).toHaveBeenCalledWith([expect.objectContaining({ spotifyId: 'alb1' })]);
  });

  it('keeps the old cache when Spotify fails', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(jsonResponse({}, 500));
    const res = await refresh().set('Authorization', `Bearer ${JOBS_TOKEN}`);
    expect(res.status).toBe(502);
    expect(res.body.code).toBe('SPOTIFY_UNAVAILABLE');
    expect(SpotifyAlbum.deleteMany).not.toHaveBeenCalled();
  });

  it('does nothing when Spotify is not configured', async () => {
    delete process.env.SPOTIFY_CLIENT_ID;
    const fetchSpy = jest.spyOn(global, 'fetch');
    const res = await refresh().set('Authorization', `Bearer ${JOBS_TOKEN}`);
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ count: 0 });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('is disabled when JOBS_TOKEN is not set', async () => {
    delete process.env.JOBS_TOKEN;
    const res = await refresh().set('Authorization', `Bearer ${JOBS_TOKEN}`);
    expect(res.status).toBe(503);
    expect(res.body.code).toBe('JOBS_DISABLED');
  });
});
