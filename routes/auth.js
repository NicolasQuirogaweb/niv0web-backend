const express = require("express");
const jwt = require("jsonwebtoken");
const axios = require("axios");
const User = require("../models/User");
const asyncHandler = require("../middleware/asyncHandler");
const ApiError = require("../utils/ApiError");
const { success } = require("../utils/response");
const router = express.Router();

const REFRESH_COOKIE = "refreshToken";
const REFRESH_PATH = "/api/auth";
const ACCESS_COOKIE = "accessToken";
const ACCESS_PATH = "/";

const setRefreshCookie = (res, token) => {
  res.cookie(REFRESH_COOKIE, token, {
    httpOnly: true,
    secure: true,
    sameSite: "none",
    maxAge: 7 * 24 * 60 * 60 * 1000,
    path: REFRESH_PATH,
  });
};

const clearRefreshCookie = (res) => {
  res.clearCookie(REFRESH_COOKIE, { path: REFRESH_PATH });
};

const setAccessCookie = (res, token) => {
  res.cookie(ACCESS_COOKIE, token, {
    httpOnly: true,
    secure: true,
    sameSite: "none",
    maxAge: 15 * 60 * 1000,
    path: ACCESS_PATH,
  });
};

const clearAccessCookie = (res) => {
  res.clearCookie(ACCESS_COOKIE, { path: ACCESS_PATH });
};

const generateAccessToken = (user) => {
  return jwt.sign(
    { userId: user.googleId, email: user.email, name: user.name, role: user.role },
    process.env.JWT_SECRET,
    { expiresIn: "15m" }
  );
};

const generateRefreshToken = (user) => {
  return jwt.sign(
    { userId: user.googleId, email: user.email },
    process.env.JWT_REFRESH_SECRET,
    { expiresIn: "7d" }
  );
};

router.post("/google-login", asyncHandler(async (req, res) => {
  const { credential } = req.body;
  if (!credential) throw ApiError.badRequest("No se proporcionó el token de Google");

  const googleResponse = await axios.post(
    `https://oauth2.googleapis.com/tokeninfo?id_token=${credential}`
  );
  const { sub, email_verified, email, name, picture } = googleResponse.data;

  if (!email_verified) throw ApiError.badRequest("El correo electrónico no está verificado");

  let user = await User.findOne({ $or: [{ googleId: sub }, { email }] });

  if (!user) {
    user = new User({ email, name, imageUrl: picture, googleId: sub });
  } else {
    user.name = name;
    user.imageUrl = picture;
    user.googleId = sub;
  }
  await user.save();

  const accessToken = generateAccessToken(user);
  const refreshToken = generateRefreshToken(user);

  setRefreshCookie(res, refreshToken);
  setAccessCookie(res, accessToken);

  success(res, {
    token: accessToken,
    user: { name: user.name, email: user.email, imageUrl: user.imageUrl, role: user.role },
  });
}));

router.get("/verify-token", asyncHandler(async (req, res) => {
  const token = req.cookies?.[ACCESS_COOKIE] || req.headers["authorization"]?.split(" ")[1];
  if (!token) throw ApiError.unauthorized("No se proporcionó un token");

  const decoded = jwt.verify(token, process.env.JWT_SECRET);
  success(res, { email: decoded.email, name: decoded.name, role: decoded.role });
}));

router.post("/refresh", asyncHandler(async (req, res) => {
  const refreshToken = req.cookies?.[REFRESH_COOKIE];
  if (!refreshToken) throw ApiError.unauthorized("No hay refresh token");

  const decoded = jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET);
  const user = await User.findOne({ googleId: decoded.userId });
  if (!user) throw ApiError.unauthorized("Usuario no encontrado");

  const newAccessToken = generateAccessToken(user);
  setAccessCookie(res, newAccessToken);
  success(res, { token: newAccessToken });
}));

router.post("/logout", (req, res) => {
  clearRefreshCookie(res);
  clearAccessCookie(res);
  success(res, { message: "Sesión cerrada" });
});

module.exports = router;
