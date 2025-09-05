import express from "express";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const app = express();

// Configuración básica
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Para servir archivos estáticos (index.html, css, js…)
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
app.use(express.static(path.join(__dirname, "public")));

// ✅ Ruta principal → sirve index.html
app.get("/", (req, res) => {
  try {
    res.sendFile(path.join(__dirname, "public", "index.html"));
  } catch (error) {
    console.error("Error sirviendo index.html:", error);
    res.status(500).json({ success: false, message: "Error interno del servidor" });
  }
});

// ✅ API de prueba
app.get("/api/share", (req, res) => {
  try {
    res.json({
      success: true,
      message: "Proyecto compartido correctamente",
      projectId: "test-project",
      user: "demo-user",
    });
  } catch (error) {
    console.error("Error en /api/share:", error);
    res.status(500).json({ success: false, message: "Error en el servidor" });
  }
});

// ✅ Ruta esperada por la extensión (cargar proyecto)
app.get("/blId/:projectId/:userId", (req, res) => {
  try {
    const { projectId, userId } = req.params;

    if (!projectId || !userId) {
      return res.status(400).json({
        success: false,
        message: "Parámetros inválidos",
      });
    }

    // Aquí se puede conectar a base de datos más adelante
    res.json({
      success: true,
      message: "Proyecto cargado correctamente",
      projectId,
      userId,
    });
  } catch (error) {
    console.error("Error en /blId:", error);
    res.status(500).json({ success: false, message: "Error en el servidor" });
  }
});

// ✅ Simulación de verificación de usuario
app.get("/verify/:userId", (req, res) => {
  try {
    const { userId } = req.params;
    res.json({
      success: true,
      verified: true,
      userId,
      message: "Usuario verificado correctamente",
    });
  } catch (error) {
    console.error("Error en /verify:", error);
    res.status(500).json({ success: false, message: "Error en el servidor" });
  }
});

// ✅ Manejo de 404 → responde siempre con JSON
app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: "Ruta no encontrada",
  });
});

// ✅ Arranque del servidor
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Servidor corriendo en puerto ${PORT}`);
});
