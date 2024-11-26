const jwt = require('jsonwebtoken');

// Middleware para verificar si el token JWT es válido
const authenticateJWT = (req, res, next) => {
  // Obtén el token del encabezado 'Authorization'
  const token = req.headers['authorization']; // El token debe enviarse con el prefijo 'Bearer'

  // Si no hay token, retorna un error
  if (!token) {
    return res.status(403).json({ message: 'No token provided' }); // Error 403 si no hay token
  }

  // Verifica el token usando el JWT_SECRET
  jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
    if (err) {
      // Si el token no es válido o ha expirado, retorna un error
      return res.status(403).json({ message: 'Token is invalid or expired' });
    }

    // Si el token es válido, agrega la información del usuario al objeto req
    req.user = user;  // 'user' contiene la información decodificada del token
    next();  // Pasa al siguiente middleware o controlador de la ruta
  });
};

module.exports = authenticateJWT;
