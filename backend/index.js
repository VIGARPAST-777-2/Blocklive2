import express from "express";
import bodyParser from "body-parser";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// Simulación de verificación de usuario (igual que en producción)
function verifyUser(req, res, next) {
  const userToken = req.headers["authorization"];
  if (!userToken || userToken !== "demo-token") {
    return res.status(401).json({
      success: false,
      message: "Usuario no verificado",
    });
  }
  req.user = "demo-user"; // asignamos usuario verificado
  next();
}

// Servir archivos estáticos
app.use(express.static(path.join(__dirname, "frontend")));

// Endpoints API

// Compatibilidad /api para que no devuelva "Ruta no encontrada"
app.get("/api", verifyUser, (req, res) => {
  res.json({
    success: true,
    message: "Proyecto compartido correctamente",
    projectId: "test-project",
    user: req.user,
  });
});

// Endpoint principal de compartir proyecto
app.post("/api/share", verifyUser, (req, res) => {
  const { projectId } = req.body;
  if (!projectId) {
    return res.status(400).json({
      success: false,
      message: "Falta projectId",
    });
  }

  // Aquí iría la lógica real de guardar o compartir el proyecto
  res.json({
    success: true,
    message: "Proyecto compartido correctamente",
    projectId,
    user: req.user,
  });
});

// Catch-all para rutas desconocidas
app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: "Ruta no encontrada",
  });
});

// Iniciar servidor
app.listen(PORT, () => {
  console.log(`Servidor iniciado en http://localhost:${PORT}`);
});
