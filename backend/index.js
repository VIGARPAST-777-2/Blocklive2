import 'dotenv/config';
import fs from 'fs';
import express from 'express';
import cors from 'cors';
import basicAuth from 'express-basic-auth';
import http from 'http';
import { Server } from 'socket.io';
import sanitize from 'sanitize-filename';

import SessionManager from './utils/sessionManager.js';
import UserManager from './utils/userManager.js';
import * as fileStorageUtils from './utils/fileStorage.js';
import { installCleaningJob } from './utils/removeOldProjects.js';
import { countRecentShared, recordPopup } from './utils/recentUsers.js';
import { setPaths, authenticate, fullAuthenticate, freePassesPath, freePasses } from './utils/scratch-auth.js';
import initSockets from './WebSockets.js';

export let isFinalSaving = false;
const PORT = process.env.PORT || 3000;

// Variables de entorno
const ADMIN_USER = JSON.parse(process.env.ADMIN_USER || '{}');
const AUTH_PROJECTS = JSON.parse(process.env.AUTH_PROJECTS || '[]');
const ADMIN = JSON.parse(process.env.ADMIN || '[]');
const CHAT_WEBHOOK_URL = process.env.CHAT_WEBHOOK_URL || '';

const restartMessage = 'The Livescratch server is restarting. You will lose connection for a few seconds.';

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Inicializar Express y Socket.io
const app = express();
app.use(cors({ origin: '*' }));
app.use(express.json({ limit: '5MB' }));

const httpServer = http.createServer(app);
const ioHttp = new Server(httpServer, {
  cors: { origin: '*' },
  maxHttpBufferSize: 2e7,
});

// Cargar managers
const sessionsObj = fileStorageUtils.loadMapFromFolderRecursive('storage');
const sessionManager = SessionManager.fromJSON(sessionsObj);
const userManager = new UserManager();
setPaths(app, userManager, sessionManager);

// Guardar mapas iniciales
fileStorageUtils.saveMapToFolder(sessionManager.livescratch, fileStorageUtils.livescratchPath);
fileStorageUtils.saveLoop(sessionManager);

async function finalSave(sessionManager) {
  try {
    if (isFinalSaving) return;
    console.log('sending message "' + restartMessage + '"');
    sessionManager.broadcastMessageToAllActiveProjects(restartMessage);
    await sleep(2000);
    isFinalSaving = true;
    console.log('final saving...');
    fs.writeFileSync(fileStorageUtils.lastIdPath, (sessionManager.lastId).toString());
    fs.writeFileSync(freePassesPath, JSON.stringify(freePasses));
    await sessionManager.finalSaveAllProjects();
    fileStorageUtils.saveMapToFolder(userManager.users, fileStorageUtils.usersPath);
    isFinalSaving = false;
  } catch (e) {
    console.error('Error en finalSave:', e);
    isFinalSaving = false;
  }
}

// Jobs y sockets
setTimeout(() => installCleaningJob(sessionManager, userManager), 10000);
new initSockets(ioHttp, sessionManager, userManager);

// ----------------- RUTAS COMPLETAS -----------------

// Copiar aquí todas tus rutas de tu index.js original (las 470+ líneas)
// Incluyendo: /newProject, /lsId, /scratchIdInfo, /projectTitle,
// /projectSavedJSON, /projectJSON, /changesSince, /chat, /ban, /unban, /stats,
// /share, /unshare, /friends, /userProjects, /userProjectsScratch, /leaveScratchId,
// /leaveLSId, /verify/test, /active/:lsId, /privateMe, /userRedirect, /dau, etc.

// Todas las rutas deben ir envueltas en try/catch, como en los ejemplos anteriores, para que Render no cierre la app al lanzar errores.

// Ejemplo resumido de ruta con try/catch:
app.post('/newProject/:scratchId/:owner', (req, res) => {
  try {
    if (!authenticate(req.params.owner, req.headers.authorization)) { res.send({ noauth: true }); return; }
    if (!req.params.scratchId || sanitize(req.params.scratchId.toString()) === '') { res.send({ err: 'invalid scratch id' }); return; }

    let project = sessionManager.getScratchToLSProject(req.params.scratchId);
    const json = req.body;

    if (!project) {
      console.log('creating new project from scratch project: ' + req.params.scratchId + ' by ' + req.params.owner + ' titled: ' + req.query.title);
      project = sessionManager.newProject(req.params.owner, req.params.scratchId, json, req.query.title);
      userManager.newProject(req.params.owner, project.id);
    }
    res.send({ id: project.id });
  } catch (e) {
    console.error(e);
    res.send({ err: 'Error creating project' });
  }
});

// ----------------- FIN RUTAS -----------------

// Servidor
httpServer.listen(PORT, '0.0.0.0', () => {
  console.log('Server listening on port', PORT);
});

// Captura global de errores
process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

// Exit handlers (no usar process.exit)
process.stdin.resume();

async function exitHandler(options) {
  if (options.cleanup) console.log('Cleaning up before exit...');
  if (options.exit) {
    await finalSave(sessionManager);
    console.log('Cleanup done, keeping process alive for PM2');
  }
}

process.on('exit', exitHandler.bind(null, { cleanup: true }));
process.on('SIGINT', exitHandler.bind(null, { exit: true }));
process.on('SIGUSR1', exitHandler.bind(null, { exit: true }));
process.on('SIGUSR2', exitHandler.bind(null, { exit: true }));
