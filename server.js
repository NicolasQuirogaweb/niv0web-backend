require("dotenv").config();
const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const compression = require("compression");
const rateLimit = require("express-rate-limit");
const mongoose = require("mongoose");
const path = require("path");
const connectDB = require("./config/db");
const authRoutes = require("./routes/auth");
const resourceRoutes = require("./routes/resourceRoutes");
const adminRoutes = require("./routes/adminRoutes");

const app = express();
connectDB();

app.use(helmet());
app.use(compression());

const allowedOrigins = [
  process.env.FRONTEND_URL || "http://localhost:3000",
  "https://niv0web.vercel.app",
];

app.use(cors({
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.includes(origin)) {
      return callback(null, true);
    }
    return callback(new Error("CORS not allowed: " + origin));
  },
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
  credentials: true,
  maxAge: 86400,
}));

app.options("*", cors());

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: { message: "Demasiadas solicitudes, intente de nuevo más tarde" },
});
app.use("/api/auth", authLimiter);

app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: true, limit: "50mb" }));

app.use("/api/auth", authRoutes);
app.use("/api/resources", resourceRoutes);
app.use("/api/admin", adminRoutes);

app.get("/health", async (req, res) => {
  const dbState = mongoose.connection.readyState;
  res.json({
    ok: true,
    db: dbState === 1 ? "connected" : "disconnected",
  });
});

app.use("/uploads", express.static(path.join(__dirname, "uploads")));
app.use("/beats", express.static(path.join(__dirname, "beats")));
app.use("/samples", express.static(path.join(__dirname, "samples")));
app.use("/loops", express.static(path.join(__dirname, "loops")));
app.use("/prodmixmasters", express.static(path.join(__dirname, "prodmixmasters")));

app.use((err, req, res, next) => {
  console.error("Error:", err.message);
  res.status(err.status || 500).json({
    message: err.message || "Error interno del servidor",
  });
});

const PORT = process.env.PORT || 5000;
const server = app.listen(PORT, () => {
  console.log(`Servidor corriendo en el puerto ${PORT}`);
});

const shutdown = () => {
  console.log("Apagando servidor...");
  server.close(() => {
    mongoose.connection.close(false).then(() => {
      console.log("Conexiones cerradas");
      process.exit(0);
    });
  });
};
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
