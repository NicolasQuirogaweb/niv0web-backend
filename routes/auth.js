const express = require("express");
const jwt = require("jsonwebtoken");
const { OAuth2Client } = require("google-auth-library");
const User = require("../models/User");
const asyncHandler = require("../middleware/asyncHandler");
const ApiError = require("../utils/ApiError");
const getAccessToken = require("../utils/getToken");
const { success } = require("../utils/response");
const router = express.Router();

const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

const REFRESH_COOKIE = "refreshToken";
const REFRESH_PATH = "/api/auth";
const ACCESS_COOKIE = "accessToken";
const ACCESS_PATH = "/";

// Front (Vercel) y API (Render) viven en dominios distintos, por eso sameSite
// tiene que ser "none" para que el browser mande las cookies. La protección
// contra CSRF la da la whitelist de CORS en app.js.
const cookieOptions = (maxAge, path) => ({
  httpOnly: true,
  secure: true,
  sameSite: "none",
  maxAge,
  path,
});

const setAuthCookies = (res, user) => {
  res.cookie(ACCESS_COOKIE, generateAccessToken(user), cookieOptions(15 * 60 * 1000, ACCESS_PATH));
  res.cookie(REFRESH_COOKIE, generateRefreshToken(user), cookieOptions(7 * 24 * 60 * 60 * 1000, REFRESH_PATH));
};

const clearAuthCookies = (res) => {
  res.clearCookie(ACCESS_COOKIE, cookieOptions(0, ACCESS_PATH));
  res.clearCookie(REFRESH_COOKIE, cookieOptions(0, REFRESH_PATH));
};

const generateAccessToken = (user) => jwt.sign(
  { userId: user.googleId, email: user.email, name: user.name, role: user.role },
  process.env.JWT_SECRET,
  { expiresIn: "15m" }
);

const generateRefreshToken = (user) => jwt.sign(
  { userId: user.googleId, tokenVersion: user.tokenVersion || 0 },
  process.env.JWT_REFRESH_SECRET,
  { expiresIn: "7d" }
);

const publicUser = (user) => ({
  name: user.name,
  email: user.email,
  imageUrl: user.imageUrl,
  role: user.role,
});

router.post("/google-login", asyncHandler(async (req, res) => {
  const { credential } = req.body;
  if (!credential) throw ApiError.badRequest("No se proporcionó el token de Google");

  // verifyIdToken chequea firma, expiración y que el token haya sido emitido
  // para NUESTRO client id (aud). Sin eso, un token de cualquier otra app de
  // Google serviría para loguearse acá.
  let payload;
  try {
    const ticket = await googleClient.verifyIdToken({
      idToken: credential,
      audience: process.env.GOOGLE_CLIENT_ID,
    });
    payload = ticket.getPayload();
  } catch {
    throw ApiError.unauthorized("Token de Google inválido", "INVALID_GOOGLE_TOKEN");
  }

  const { sub, email_verified, email, name, picture } = payload;
  if (!email_verified) throw ApiError.badRequest("El correo electrónico no está verificado");

  let user = await User.findOne({ googleId: sub });
  if (!user) {
    // Usuarios creados antes de guardar googleId: se vinculan por email una sola vez.
    user = await User.findOne({ email, googleId: { $exists: false } });
  }

  if (!user) {
    user = new User({ email, name, imageUrl: picture, googleId: sub });
  } else {
    user.googleId = sub;
    user.name = name;
    user.imageUrl = picture;
  }
  await user.save();

  setAuthCookies(res, user);
  success(res, { user: publicUser(user) });
}));

router.get("/verify-token", asyncHandler(async (req, res) => {
  const token = getAccessToken(req);
  if (!token) throw ApiError.unauthorized("No se proporcionó un token");

  const decoded = jwt.verify(token, process.env.JWT_SECRET);
  success(res, { email: decoded.email, name: decoded.name, role: decoded.role });
}));

// Rotación: cada refresh emite un par nuevo. Un refresh token viejo deja de
// servir cuando el usuario hace logout (tokenVersion cambia).
router.post("/refresh", asyncHandler(async (req, res) => {
  const refreshToken = req.cookies?.[REFRESH_COOKIE];
  if (!refreshToken) throw ApiError.unauthorized("No hay refresh token");

  const decoded = jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET);
  const user = await User.findOne({ googleId: decoded.userId });
  if (!user || (user.tokenVersion || 0) !== (decoded.tokenVersion ?? 0)) {
    clearAuthCookies(res);
    throw ApiError.unauthorized("Sesión inválida, volvé a iniciar sesión", "SESSION_REVOKED");
  }

  setAuthCookies(res, user);
  success(res, { user: publicUser(user) });
}));

router.post("/logout", asyncHandler(async (req, res) => {
  const refreshToken = req.cookies?.[REFRESH_COOKIE];
  if (refreshToken) {
    try {
      const decoded = jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET);
      await User.updateOne({ googleId: decoded.userId }, { $inc: { tokenVersion: 1 } });
    } catch {
      // token vencido o inválido: igual limpiamos las cookies
    }
  }
  clearAuthCookies(res);
  success(res, { message: "Sesión cerrada" });
}));

module.exports = router;
