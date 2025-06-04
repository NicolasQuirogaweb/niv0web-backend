const express = require("express");
const jwt = require("jsonwebtoken");
const axios = require("axios");
const User = require("../models/User"); // Asegúrate de importar el modelo de usuario
const router = express.Router();

// Ruta para manejar el login con Google
router.post("/google-login", async (req, res) => {
  console.log("Datos recibidos en el backend:", req.body);
  const { credential } = req.body; // Recibimos el token JWT de Google

  if (!credential) {
    return res
      .status(400)
      .json({ message: "No se proporcionó el token de Google" });
  }

  try {
    // Paso 1: Verificar el token JWT de Google
    const googleResponse = await axios.post(
      `https://oauth2.googleapis.com/tokeninfo?id_token=${credential}`
    );

    // Datos del token verificado de Google
    const { sub, email_verified, email, name, picture } = googleResponse.data;

    if (!email_verified) {
      return res
        .status(400)
        .json({ message: "El correo electrónico no está verificado" });
    }

    // Paso 2: Verificar si el usuario ya existe en la base de datos
    // Buscamos al usuario por googleId o por correo electrónico
    let user = await User.findOne({
      $or: [{ googleId: sub }, { email: email }],
    });

    // Si el usuario no existe, creamos uno nuevo
    if (!user) {
      user = new User({
        email,
        name,
        imageUrl: picture,
        googleId: sub, // Guardamos el googleId en la base de datos
      });
    } else {
      // Si el usuario ya existe, actualizamos sus datos
      user.name = name;
      user.imageUrl = picture;
    }

    // Guardamos el usuario (ya sea nuevo o actualizado)
    await user.save();

    // Paso 3: Generar un JWT para el frontend
    const token = jwt.sign(
      { userId: user.googleId, email: user.email, name: user.name }, // Información del usuario
      process.env.JWT_SECRET, // Usar el secreto de tu JWT
      { expiresIn: "1h" } // Tiempo de expiración del token
    );

    // Paso 4: Retornar el token y los datos del usuario al frontend
    res.status(200).json({
      token,
      user: { name: user.name, email: user.email, imageUrl: user.imageUrl },
    });
  } catch (error) {
    console.error("Error al verificar el token de Google:", error);
    res
      .status(500)
      .json({ message: "Hubo un error al autenticar al usuario." });
  }
});

// Ruta para verificar el token
router.get("/verify-token", (req, res) => {
  const token = req.headers["authorization"]?.split(" ")[1]; // Obtener el token del encabezado de autorización

  if (!token) {
    return res.status(401).json({ message: "No se proporcionó un token" });
  }

  // Verificar el token
  jwt.verify(token, process.env.JWT_SECRET, (err, decoded) => {
    if (err) {
      return res.status(401).json({ message: "Token inválido o expirado" });
    }

    // Si el token es válido, enviar los datos decodificados
    res.json({
      email: decoded.email,
      name: decoded.name,
    });
  });
});

module.exports = router;
