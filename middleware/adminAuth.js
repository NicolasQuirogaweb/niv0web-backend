const jwt = require('jsonwebtoken');
const User = require('../models/User');

const adminAuth = async (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = req.cookies?.accessToken ||
    (authHeader && (authHeader.startsWith('Bearer ') ? authHeader.slice(7) : authHeader));

  if (!token) {
    return res.status(403).json({ message: 'No token provided' });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    let user = await User.findOne({ googleId: decoded.userId });
    if (!user && decoded.email) {
      user = await User.findOne({ email: decoded.email });
    }

    if (!user || user.role !== 'admin') {
      return res.status(403).json({ message: 'Acceso denegado: se requieren permisos de administrador' });
    }

    req.user = { ...decoded, role: user.role, _id: user._id };
    next();
  } catch (err) {
    return res.status(403).json({ message: 'Token inválido o expirado' });
  }
};

module.exports = adminAuth;
