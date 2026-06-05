const express = require("express");
const jwt = require("jsonwebtoken");
const axios = require("axios");
const User = require("../models/User");
const asyncHandler = require("../middleware/asyncHandler");
const ApiError = require("../utils/ApiError");
const router = express.Router();

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

  const token = jwt.sign(
    { userId: user.googleId, email: user.email, name: user.name, role: user.role },
    process.env.JWT_SECRET,
    { expiresIn: "1h" }
  );

  res.json({
    token,
    user: { name: user.name, email: user.email, imageUrl: user.imageUrl, role: user.role },
  });
}));

router.get("/verify-token", (req, res) => {
  const token = req.headers["authorization"]?.split(" ")[1];
  if (!token) {
    return res.status(401).json({ message: "No se proporcionó un token" });
  }
  jwt.verify(token, process.env.JWT_SECRET, (err, decoded) => {
    if (err) {
      return res.status(401).json({ message: "Token inválido o expirado" });
    }
    res.json({ email: decoded.email, name: decoded.name, role: decoded.role });
  });
});

module.exports = router;
