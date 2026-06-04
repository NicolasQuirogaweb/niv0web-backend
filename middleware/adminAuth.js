const jwt = require('jsonwebtoken');
const User = require('../models/User');

const adminAuth = async (req, res, next) => {
  const authHeader = req.headers['authorization'];
  if (!authHeader) {
    return res.status(403).json({ message: 'No token provided' });
  }

  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : authHeader;

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findOne({ googleId: decoded.userId });

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
