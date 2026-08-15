const env = require("./config/env");
const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const compression = require("compression");
const cookieParser = require("cookie-parser");
const mongoose = require("mongoose");
const path = require("path");
const connectDB = require("./config/db");
const { generalLimiter, authLimiter } = require("./middleware/rateLimiter");
const errorHandler = require("./middleware/errorHandler");
const ApiError = require("./utils/ApiError");
const authRoutes = require("./routes/auth");
const resourceRoutes = require("./routes/resourceRoutes");
const adminRoutes = require("./routes/adminRoutes");

const app = express();
connectDB();

app.use(helmet({
  hsts: { maxAge: 63072000, includeSubDomains: true, preload: true },
  referrerPolicy: { policy: "same-origin" },
  contentSecurityPolicy: false,
}));
app.use(compression());
app.use(generalLimiter);

const allowedOrigins = [
  process.env.FRONTEND_URL || "http://localhost:3000",
  "https://niv0web.vercel.app",
];

const corsOptions = {
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
};

app.use(cors(corsOptions));

app.options("*", cors(corsOptions));

app.use("/api/auth", authLimiter);

app.use(cookieParser());
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: true, limit: "50mb" }));

app.use("/api/auth", authRoutes);
app.use("/api/resources", resourceRoutes);
app.use("/api/admin", adminRoutes);

app.get("/api/download", async (req, res, next) => {
  try {
    const { url } = req.query;
    if (!url) return next(ApiError.badRequest("URL parameter required"));
    console.log("Download attempt for URL:", url.substring(0, 80));
    if (!url.startsWith("https://") || !url.includes("backblazeb2.com")) {
      return next(ApiError.forbidden("Invalid download source"));
    }
    const axios = require("axios");
    const response = await axios({ url, method: "GET", responseType: "stream" });
    const filename = decodeURIComponent(url.split("/").pop() || "download");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.setHeader("Content-Type", response.headers["content-type"] || "application/octet-stream");
    response.data.pipe(res);
  } catch (err) {
    next(ApiError.internal("Download error: " + err.message));
  }
});

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

app.use((req, res, next) => {
  next(ApiError.notFound(`Ruta no encontrada: ${req.originalUrl}`));
});

app.use(errorHandler);

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
