const express = require("express");
const cors = require("cors");
const connectDB = require("./config/db");
const authRoutes = require("./routes/auth");

const resourceRoutes = require("./routes/resourceRoutes"); // Importado aquí

require("dotenv").config();
const path = require("path");
const app = express();

// Conectar a la base de datos
connectDB();

// Middleware
app.use(
  cors({
    origin: process.env.FRONTEND_URL || "http://localhost:3000",
    methods: ["GET", "POST"],
    allowedHeaders: ["Content-Type", "Authorization"],
    credentials: true,
  })
); 
app.use(express.json());

// Rutas
app.use("/api/auth", authRoutes);

app.use("/api/resources", resourceRoutes); // Añadido aquí

// Configuración de archivos estáticos
app.use("/uploads", express.static(path.join(__dirname, "uploads")));
app.use("/beats", express.static(path.join(__dirname, "beats")));
app.use("/samples", express.static(path.join(__dirname, "samples")));
app.use("/loops", express.static(path.join(__dirname, "loops")));
app.use(
  "/prodmixmasters",
  express.static(path.join(__dirname, "prodmixmasters"))
);

app.use(express.static("public"));

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Servidor corriendo en el puerto ${PORT}`);
});
