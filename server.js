const express = require("express");
const cors = require("cors");
const connectDB = require("./config/db");
const authRoutes = require("./routes/auth");
const resourceRoutes = require("./routes/resourceRoutes");
require("dotenv").config();
const path = require("path");

const app = express();

// Conectar a la base de datos
connectDB();

// Middleware
const allowedOrigins = [
  "http://localhost:3000",         // Local
  "https://niv0web.vercel.app"    // Tu dominio en Vercel (ajustalo si cambia)
];

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin || allowedOrigins.includes(origin)) {
        return callback(null, true);
      }
      return callback(new Error("CORS not allowed: " + origin));
    },
    methods: ["GET", "POST"],
    allowedHeaders: ["Content-Type", "Authorization"],
    credentials: true,
  })
);

app.use(express.json());

// Rutas
app.use("/api/auth", authRoutes);
app.use("/api/resources", resourceRoutes);

// Healthcheck (para Render y monitoreo)
app.get("/health", (req, res) => res.json({ ok: true }));

// Configuración de archivos estáticos
app.use("/uploads", express.static(path.join(__dirname, "uploads")));
app.use("/beats", express.static(path.join(__dirname, "beats")));
app.use("/samples", express.static(path.join(__dirname, "samples")));
app.use("/loops", express.static(path.join(__dirname, "loops")));
app.use("/prodmixmasters", express.static(path.join(__dirname, "prodmixmasters")));
app.use(express.static("public"));

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`🚀 Servidor corriendo en el puerto ${PORT}`);
});
