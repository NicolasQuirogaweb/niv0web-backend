const SpotifyAlbum = require('../models/SpotifyAlbum');

// Discografía desde la API pública de Spotify (Client Credentials: no hace falta
// que el usuario se loguee en Spotify). Solo los lanzamientos propios del artista.
const TOKEN_URL = 'https://accounts.spotify.com/api/token';
const API_URL = 'https://api.spotify.com/v1';
const STALE_AFTER_MS = 6 * 60 * 60 * 1000;

const isConfigured = () =>
  Boolean(process.env.SPOTIFY_CLIENT_ID && process.env.SPOTIFY_CLIENT_SECRET && process.env.SPOTIFY_ARTIST_ID);

const spotifyError = (message) => {
  const err = new Error(message);
  err.statusCode = 502;
  err.code = 'SPOTIFY_UNAVAILABLE';
  return err;
};

const getAccessToken = async () => {
  const credentials = Buffer.from(`${process.env.SPOTIFY_CLIENT_ID}:${process.env.SPOTIFY_CLIENT_SECRET}`).toString('base64');
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { Authorization: `Basic ${credentials}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'client_credentials' }),
  });
  if (!res.ok) throw spotifyError(`Spotify token: HTTP ${res.status}`);
  const data = await res.json();
  return data.access_token;
};

const toAlbum = (item) => ({
  spotifyId: item.id,
  name: item.name,
  type: item.album_type === 'single' ? 'single' : 'album',
  releaseDate: item.release_date,
  imageUrl: item.images?.[0]?.url || null,
  spotifyUrl: item.external_urls?.spotify,
  totalTracks: item.total_tracks || 0,
});

const fetchArtistReleases = async () => {
  const token = await getAccessToken();
  const albums = [];
  let url = `${API_URL}/artists/${process.env.SPOTIFY_ARTIST_ID}/albums?include_groups=album,single&limit=50`;
  while (url) {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) throw spotifyError(`Spotify albums: HTTP ${res.status}`);
    const page = await res.json();
    albums.push(...page.items.map(toAlbum));
    url = page.next;
  }
  return albums;
};

// Primero se consulta Spotify y recién si salió bien se reemplaza el cache:
// si Spotify falla, el sitio sigue mostrando lo último que había.
const refreshDiscography = async () => {
  if (!isConfigured()) return 0;
  const albums = await fetchArtistReleases();
  await SpotifyAlbum.deleteMany({});
  if (albums.length) await SpotifyAlbum.insertMany(albums);
  return albums.length;
};

const getDiscography = async () => {
  if (!isConfigured()) return [];
  const albums = await SpotifyAlbum.find().sort({ releaseDate: -1 }).lean();

  // Refresco perezoso: si el cache tiene más de 6 h, se actualiza en segundo plano
  // y esta respuesta usa lo que ya había (el cron también lo refresca).
  const newest = await SpotifyAlbum.findOne().sort({ updatedAt: -1 }).lean();
  if (!newest || Date.now() - new Date(newest.updatedAt).getTime() > STALE_AFTER_MS) {
    refreshDiscography().catch((err) => console.error('Discography refresh failed:', err.message));
  }
  return albums;
};

module.exports = { fetchArtistReleases, refreshDiscography, getDiscography, isConfigured };
