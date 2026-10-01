const jwt = require('jsonwebtoken');
const User = require('../models/User');
const ApiError = require('../utils/ApiError');
const getAccessToken = require('../utils/getToken');

// El rol se lee de la base y no del token: si le saco el admin a alguien,
// deja de tener acceso en el próximo request y no 15 minutos después.
const adminAuth = async (req, res, next) => {
  const token = getAccessToken(req);
  if (!token) return next(ApiError.unauthorized('No se proporcionó un token'));

  let decoded;
  try {
    decoded = jwt.verify(token, process.env.JWT_SECRET);
  } catch (err) {
    return next(err); // errorHandler lo traduce a 401 INVALID_TOKEN / TOKEN_EXPIRED
  }

  try {
    const user = await User.findOne({ googleId: decoded.userId });
    if (!user) return next(ApiError.unauthorized('Usuario no encontrado'));
    if (user.role !== 'admin') {
      return next(ApiError.forbidden('Se requieren permisos de administrador'));
    }
    req.user = { ...decoded, role: user.role, _id: user._id };
    next();
  } catch (err) {
    next(err);
  }
};

module.exports = adminAuth;
