import express from 'express';
import cors from 'cors';
import jwt from 'jsonwebtoken';
import bodyParser from 'body-parser';
import fs from 'fs';
import path from 'path';

const app = express();
const PORT = process.env.PORT || 3000;

// Llave secreta para JWT (en producción usa variable de entorno)
const JWT_SECRET = process.env.JWT_SECRET || 'supersecretkey';

// Middleware
app.use(cors({
  origin: 'https://blocklive2.onrender.com',
  credentials: true,
}));
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// Middleware de autenticación JWT
function authMiddleware(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ success: false, message: 'Token no proporcionado' });

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded.user;
    next();
  } catch (err) {
    return res.status(401).json({ success: false, message: 'Token inválido' });
  }
}

// Rutas
app.get('/', (req, res) => {
  res.sendFile(path.join(process.cwd(), 'index.html'));
});

// Compartir proyecto
app.post('/api/share', authMiddleware, (req, res) => {
  const { projectId, user } = req.body;
  if (!projectId || !user) return res.status(400).json({ success: false, message: 'Faltan datos' });

  // Guardar en archivo JSON simulado (puedes usar DB real)
  const projectsFile = path.join(process.cwd(), 'projects.json');
  let projects = {};
  if (fs.existsSync(projectsFile)) {
    projects = JSON.parse(fs.readFileSync(projectsFile));
  }
  if (!projects[projectId]) projects[projectId] = { owner: req.user, collaborators: [] };
  if (!projects[projectId].collaborators.includes(user)) {
    projects[projectId].collaborators.push(user);
  }
  fs.writeFileSync(projectsFile, JSON.stringify(projects, null, 2));

  res.json({ success: true, message: 'Proyecto compartido correctamente', projectId, user });
});

// Obtener proyecto
app.get('/api/project/:projectId', authMiddleware, (req, res) => {
  const { projectId } = req.params;
  const projectsFile = path.join(process.cwd(), 'projects.json');
  if (!fs.existsSync(projectsFile)) return res.status(404).json({ success: false, message: 'No hay proyectos' });

  const projects = JSON.parse(fs.readFileSync(projectsFile));
  const project = projects[projectId];
  if (!project) return res.status(404).json({ success: false, message: 'Proyecto no encontrado' });

  // Verificar si usuario es colaborador
  if (project.owner !== req.user && !project.collaborators.includes(req.user)) {
    return res.status(403).json({ success: false, message: 'No autorizado' });
  }

  res.json({ success: true, project });
});

// Guardar proyecto
app.post('/api/project/:projectId', authMiddleware, (req, res) => {
  const { projectId } = req.params;
  const { data } = req.body;
  if (!data) return res.status(400).json({ success: false, message: 'Faltan datos del proyecto' });

  const projectsFile = path.join(process.cwd(), 'projects.json');
  let projects = {};
  if (fs.existsSync(projectsFile)) projects = JSON.parse(fs.readFileSync(projectsFile));

  if (!projects[projectId]) return res.status(404).json({ success: false, message: 'Proyecto no encontrado' });

  // Verificar permisos
  const project = projects[projectId];
  if (project.owner !== req.user && !project.collaborators.includes(req.user)) {
    return res.status(403).json({ success: false, message: 'No autorizado' });
  }

  project.data = data;
  fs.writeFileSync(projectsFile, JSON.stringify(projects, null, 2));

  res.json({ success: true, message: 'Proyecto guardado correctamente', projectId });
});

// Crear JWT demo (solo para test, producción usar login real)
app.post('/api/login', (req, res) => {
  const { user } = req.body;
  if (!user) return res.status(400).json({ success: false, message: 'Usuario requerido' });

  const token = jwt.sign({ user }, JWT_SECRET, { expiresIn: '12h' });
  res.json({ success: true, token, user });
});

// Manejo de rutas no encontradas
app.use((req, res) => {
  res.status(404).json({ success: false, message: 'Ruta no encontrada' });
});

// Error handler
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ success: false, message: 'Error interno del servidor' });
});

// Start server
app.listen(PORT, () => console.log(`Servidor corriendo en puerto ${PORT}`));
