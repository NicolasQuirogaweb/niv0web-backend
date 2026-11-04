const request = require('supertest');

jest.mock('../models/SpotifyAlbum');

const SpotifyAlbum = require('../models/SpotifyAlbum');
const { fetchArtistReleases, resetRefreshState } = require('../services/spotifyService');
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
  resetRefreshState(); // el estado del refresco es del módulo: cada test arranca limpio
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
      // market evita que Spotify devuelva el mismo lanzamiento varias veces (versiones regionales).
      'https://api.spotify.com/v1/artists/artist123/albums?include_groups=album,single&market=AR&limit=10'
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

  it('after a failed background refresh it waits before trying again (no hammering a rate-limited Spotify)', async () => {
    const { resetRefreshState } = require('../services/spotifyService');
    resetRefreshState();
    SpotifyAlbum.find.mockReturnValue(findChain([]));
    const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue(jsonResponse({}, 429));

    await request(app).get('/api/discography');
    await new Promise((resolve) => setImmediate(resolve));
    const callsAfterFirst = fetchSpy.mock.calls.length;
    expect(callsAfterFirst).toBeGreaterThan(0);

    await request(app).get('/api/discography');
    await new Promise((resolve) => setImmediate(resolve));
    expect(fetchSpy.mock.calls.length).toBe(callsAfterFirst);
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
    // Upsert por spotifyId y recién después se borra lo que ya no está: el cache nunca queda vacío.
    expect(SpotifyAlbum.bulkWrite).toHaveBeenCalledWith([
      expect.objectContaining({
        updateOne: expect.objectContaining({ filter: { spotifyId: 'alb1' }, upsert: true }),
      }),
    ]);
    expect(SpotifyAlbum.deleteMany).toHaveBeenCalledWith({ spotifyId: { $nin: ['alb1'] } });
    expect(SpotifyAlbum.insertMany).not.toHaveBeenCalled();
  });

  it('keeps the old cache when Spotify fails', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(jsonResponse({}, 500));
    const res = await refresh().set('Authorization', `Bearer ${JOBS_TOKEN}`);
    expect(res.status).toBe(502);
    expect(res.body.code).toBe('SPOTIFY_UNAVAILABLE');
    expect(SpotifyAlbum.deleteMany).not.toHaveBeenCalled();
  });

  it('a failed write never empties the cache', async () => {
    mockSpotify();
    SpotifyAlbum.bulkWrite.mockRejectedValue(new Error('mongo hiccup'));
    const res = await refresh().set('Authorization', `Bearer ${JOBS_TOKEN}`);
    expect(res.status).toBe(502);
    expect(SpotifyAlbum.deleteMany).not.toHaveBeenCalled();
  });

  it('a network error or a hang is a 502, and every Spotify call has a timeout', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch').mockRejectedValue(new TypeError('fetch failed'));
    const res = await refresh().set('Authorization', `Bearer ${JOBS_TOKEN}`);
    expect(res.status).toBe(502);
    expect(res.body.code).toBe('SPOTIFY_UNAVAILABLE');
    expect(fetchSpy.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
  });

  it('runs only one refresh at a time', async () => {
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    const fetchSpy = jest.spyOn(global, 'fetch').mockImplementation(async (url) => {
      if (String(url).startsWith('https://accounts.spotify.com')) {
        await gate;
        return jsonResponse({ access_token: 'tok' });
      }
      return jsonResponse({ items: [SPOTIFY_ALBUM], next: null });
    });
    const { refreshDiscography } = require('../services/spotifyService');

    const first = refreshDiscography();
    const second = refreshDiscography();
    release();
    await expect(Promise.all([first, second])).resolves.toEqual([1, 1]);
    const tokenCalls = fetchSpy.mock.calls.filter(([u]) => String(u).startsWith('https://accounts.spotify.com'));
    expect(tokenCalls).toHaveLength(1);
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
