const SpotifyAlbum = require('../models/SpotifyAlbum');

// Discografía desde la API pública de Spotify (Client Credentials: no hace falta
// que el usuario se loguee en Spotify). Solo los lanzamientos propios del artista.
const TOKEN_URL = 'https://accounts.spotify.com/api/token';
const API_URL = 'https://api.spotify.com/v1';
// Sin market, Spotify suele devolver el mismo lanzamiento varias veces (versiones
// regionales o clean/explicit) y la grilla mostraría vinilos repetidos.
const MARKET = 'AR';
const STALE_AFTER_MS = 6 * 60 * 60 * 1000;
// Tras un refresco fallido (Spotify caído o 429) el refresco perezoso espera esto
// antes de reintentar, para no martillar a Spotify con cada visita a About.
const RETRY_AFTER_FAILURE_MS = 15 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 10000;

const isConfigured = () =>
  Boolean(process.env.SPOTIFY_CLIENT_ID && process.env.SPOTIFY_CLIENT_SECRET && process.env.SPOTIFY_ARTIST_ID);

const spotifyError = (message, cause) => {
  const err = new Error(message);
  err.statusCode = 502;
  err.code = 'SPOTIFY_UNAVAILABLE';
  err.cause = cause;
  return err;
};

// Toda llamada a Spotify tiene timeout y cualquier falla (red, HTTP, JSON) es un 502:
// un Spotify colgado no puede dejar trabado el refresco.
const spotifyFetch = async (url, init = {}) => {
  let res;
  try {
    res = await fetch(url, { ...init, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  } catch (err) {
    throw spotifyError(`Spotify: ${err.message}`, err);
  }
  if (!res.ok) throw spotifyError(`Spotify: HTTP ${res.status}`);
  try {
    return await res.json();
  } catch (err) {
    throw spotifyError('Spotify: respuesta inválida', err);
  }
};

const getAccessToken = async () => {
  const credentials = Buffer.from(`${process.env.SPOTIFY_CLIENT_ID}:${process.env.SPOTIFY_CLIENT_SECRET}`).toString('base64');
  const data = await spotifyFetch(TOKEN_URL, {
    method: 'POST',
    headers: { Authorization: `Basic ${credentials}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'client_credentials' }),
  });
  return data.access_token;
};

const toAlbum = (item) => ({
  spotifyId: item.id,
  name: item.name,
  type: item.album_type === 'single' ? 'single' : 'album',
  releaseDate: item.release_date,
  imageUrl: item.images?.[0]?.url || null,
  spotifyUrl: item.external_urls?.spotify || `https://open.spotify.com/album/${item.id}`,
  totalTracks: item.total_tracks || 0,
});

const fetchArtistReleases = async () => {
  const token = await getAccessToken();
  const byId = new Map(); // de-duplica por id entre páginas
  let url = `${API_URL}/artists/${process.env.SPOTIFY_ARTIST_ID}/albums?include_groups=album,single&market=${MARKET}&limit=50`;
  while (url) {
    const page = await spotifyFetch(url, { headers: { Authorization: `Bearer ${token}` } });
    for (const item of page.items || []) byId.set(item.id, toAlbum(item));
    url = page.next;
  }
  return [...byId.values()];
};

// Primero se consulta Spotify; después se hace upsert por spotifyId y recién al
// final se borran los que ya no están. Si algo falla en el medio, el cache viejo
// sigue entero: el sitio nunca se queda sin discografía por un error.
const replaceCache = async (albums) => {
  try {
    if (albums.length) {
      await SpotifyAlbum.bulkWrite(albums.map((album) => ({
        updateOne: { filter: { spotifyId: album.spotifyId }, update: { $set: album }, upsert: true },
      })));
    }
    await SpotifyAlbum.deleteMany({ spotifyId: { $nin: albums.map((a) => a.spotifyId) } });
  } catch (err) {
    throw spotifyError('No se pudo guardar la discografía', err);
  }
};

// Un solo refresco a la vez: si llegan varias visitas o el cron justo mientras
// corre uno, todas esperan ese mismo.
let inFlight = null;
let lastFailureAt = 0;

const refreshDiscography = () => {
  if (!isConfigured()) return Promise.resolve(0);
  if (!inFlight) {
    inFlight = (async () => {
      try {
        const albums = await fetchArtistReleases();
        await replaceCache(albums);
        lastFailureAt = 0;
        return albums.length;
      } catch (err) {
        lastFailureAt = Date.now();
        throw err;
      } finally {
        inFlight = null;
      }
    })();
  }
  return inFlight;
};

const getDiscography = async () => {
  if (!isConfigured()) return [];
  const albums = await SpotifyAlbum.find().sort({ releaseDate: -1 }).lean();

  // Refresco perezoso: si el cache tiene más de 6 h, se actualiza en segundo plano
  // y esta respuesta usa lo que ya había (el cron también lo refresca).
  const newest = await SpotifyAlbum.findOne().sort({ updatedAt: -1 }).lean();
  const stale = !newest || Date.now() - new Date(newest.updatedAt).getTime() > STALE_AFTER_MS;
  const coolingDown = Date.now() - lastFailureAt < RETRY_AFTER_FAILURE_MS;
  if (stale && !coolingDown) {
    refreshDiscography().catch((err) => console.error('Discography refresh failed:', err.message));
  }
  return albums;
};

// Solo para tests: deja el estado del módulo como recién cargado.
const resetRefreshState = () => {
  inFlight = null;
  lastFailureAt = 0;
};

module.exports = { fetchArtistReleases, refreshDiscography, getDiscography, isConfigured, resetRefreshState };
