import express from 'express';
import cors from 'cors';
import bodyParser from 'body-parser';
import fs from 'fs';
import 'dotenv/config';

// ======================
// ⚙️ Variables de entorno
// ======================
const PORT = process.env.PORT || 3000;
let ADMIN_USER, AUTH_PROJECTS, ADMIN, CHAT_WEBHOOK_URL;

try {
  ADMIN_USER = JSON.parse(process.env.ADMIN_USER || '{}');
  AUTH_PROJECTS = JSON.parse(process.env.AUTH_PROJECTS || '[]');
  ADMIN = JSON.parse(process.env.ADMIN || '[]');
  CHAT_WEBHOOK_URL = process.env.CHAT_WEBHOOK_URL || '';
} catch (err) {
  console.error('❌ Error al parsear variables de entorno:', err.message);
  process.exit(1);
}

// ======================
// 🚀 Inicializar Express
// ======================
const app = express();
app.use(cors());
app.use(bodyParser.json());

// ======================
// 🌍 Servir frontend
// ======================
app.use(express.static('public'));

// ======================
// 🛠️ Middlewares simples
// ======================
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
  next();
});

// ======================
// 📌 Rutas API de ejemplo
// ======================
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', uptime: process.uptime() });
});

app.post('/api/share', (req, res) => {
  try {
    const { projectId, user } = req.body;

    if (!projectId || !user) {
      return res.status(400).json({ error: 'Faltan parámetros projectId o user' });
    }

    // Ejemplo de registro en archivo
    fs.appendFileSync(
      'shares.log',
      `[${new Date().toISOString()}] ${user} compartió proyecto ${projectId}\n`
    );

    res.json({
      success: true,
      message: 'Proyecto compartido correctamente',
      projectId,
      user,
    });
  } catch (err) {
    console.error('❌ Error en /api/share:', err);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// ======================
// ⚠️ 404 para APIs
// ======================
app.use('/api/*', (req, res) => {
  res.status(404).json({ error: 'Ruta no encontrada' });
});

// ======================
// 🚀 Arrancar servidor
// ======================
app.listen(PORT, () => {
  console.log(`✅ Servidor escuchando en http://localhost:${PORT}`);
});
