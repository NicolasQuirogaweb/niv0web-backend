// El front manda el access token en una cookie httpOnly. El header Bearer queda
// como fallback para probar la API con curl/Postman.
const getAccessToken = (req) => {
  const fromCookie = req.cookies?.accessToken;
  if (fromCookie) return fromCookie;
  const header = req.headers.authorization || '';
  return header.startsWith('Bearer ') ? header.slice(7) : null;
};

module.exports = getAccessToken;
