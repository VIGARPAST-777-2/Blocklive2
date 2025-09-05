import 'dotenv/config';
import fs from 'fs';

const PORT = process.env.PORT || 3000;
const ADMIN_USER = JSON.parse(process.env.ADMIN_USER || '{}');
const AUTH_PROJECTS = JSON.parse(process.env.AUTH_PROJECTS || '[]');
const ADMIN = JSON.parse(process.env.ADMIN || '[]');
const CHAT_WEBHOOK_URL = process.env.CHAT_WEBHOOK_URL || '';

process.on('uncaughtException', (err) => {
  console.error('Uncaught exception:', err);
});
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled rejection at:', promise, 'reason:', reason);
});

// be mindful of:
// numbers being passed as strings

///////////
import express from 'express';
const app = express();
import cors from 'cors';
app.use(cors({ origin: '*' }));
app.use(express.json({ limit: '5MB' }));
import basicAuth from 'express-basic-auth';
import http from 'http';

let httpServer = http.createServer(app);

import { Server } from 'socket.io';
const ioHttp = new Server(httpServer, {
  cors: { origin: '*' },
  maxHttpBufferSize: 2e7,
});

import SessionManager from './utils/sessionManager.js';
import UserManager from './utils/userManager.js';
import sanitize from 'sanitize-filename';

export let isFinalSaving = false;

import * as fileStorageUtils from './utils/fileStorage.js';
import { installCleaningJob } from './utils/removeOldProjects.js';
import { countRecentShared, recordPopup } from './utils/recentUsers.js';
import {
  setPaths,
  authenticate,
  fullAuthenticate,
  freePassesPath,
  freePasses
} from './utils/scratch-auth.js';
import initSockets from './WebSockets.js';

const restartMessage = 'The Livescratch server is restarting. You will lose connection for a few seconds.';

function sleep(millis) {
  return new Promise(res => setTimeout(res, millis));
}

// Load session and user manager objects
let sessionsObj = fileStorageUtils.loadMapFromFolderRecursive('storage');
var sessionManager = SessionManager.fromJSON(sessionsObj);
var userManager = new UserManager();
setPaths(app, userManager, sessionManager);

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
    fs.writeFileSync(fileStorageUtils.lastIdPath, sessionManager.lastId.toString());
    fs.writeFileSync(freePassesPath, JSON.stringify(freePasses));
    await sessionManager.finalSaveAllProjects();
    fileStorageUtils.saveMapToFolder(userManager.users, fileStorageUtils.usersPath);
    await fileStorageUtils.saveRecent();
    process.exit();
  } catch (e) {
    console.error('Error during finalSave:', e);
    await sleep(10000);
    isFinalSaving = false;
  }
}

setTimeout(() => installCleaningJob(sessionManager, userManager), 10000);
new initSockets(ioHttp, sessionManager, userManager);

// --- ROUTES ---

app.post('/newProject/:scratchId/:owner', async (req, res) => {
  try {
    if (!authenticate(req.params.owner, req.headers.authorization)) return res.send({ noauth: true });
    if (!req.params.scratchId || sanitize(req.params.scratchId.toString()) === '') return res.send({ err: 'invalid scratch id' });
    
    let project = sessionManager.getScratchToLSProject(req.params.scratchId);
    let json = req.body;
    if (!project) {
      console.log('creating new project from scratch project: ' + req.params.scratchId + ' by ' + req.params.owner + ' titled: ' + req.query.title);
      project = sessionManager.newProject(req.params.owner, req.params.scratchId, json, req.query.title);
      userManager.newProject(req.params.owner, project.id);
    }
    res.send({ id: project.id });
  } catch (err) {
    console.error(err);
    res.status(500).send({ err: 'Internal server error' });
  }
});

app.get('/lsId/:scratchId/:uname', async (req, res) => {
  try {
    let lsId = sessionManager.getScratchProjectEntry(req.params.scratchId)?.blId;
    if (!lsId) return res.send(lsId);
    let project = sessionManager.getProject(lsId);
    if (!project) {
      sessionManager.deleteScratchProjectEntry(req.params.scratchId);
      return res.send(null);
    }
    let hasAccess = fullAuthenticate(req.params.uname, req.headers.authorization, lsId);
    res.send(hasAccess ? lsId : null);
  } catch (err) {
    console.error(err);
    res.status(500).send({ err: 'Internal server error' });
  }
});

app.get('/scratchIdInfo/:scratchId', async (req, res) => {
  try {
    if (sessionManager.doesScratchProjectEntryExist(req.params.scratchId)) {
      res.send(sessionManager.getScratchProjectEntry(req.params.scratchId));
    } else {
      res.send({ err: 'could not find livescratch project associated with scratch project id: ' + req.params.scratchId });
    }
  } catch (err) {
    console.error(err);
    res.status(500).send({ err: 'Internal server error' });
  }
});

// Project Title
app.get('/projectTitle/:id', async (req, res) => {
  try {
    if (!fullAuthenticate(req.headers.uname, req.headers.authorization, req.params.id)) return res.send({ noauth: true });
    let project = sessionManager.getProject(req.params.id);
    if (!project) res.send({ err: 'could not find project with livescratch id: ' + req.params.id });
    else res.send({ title: project.project.title });
  } catch (err) {
    console.error(err);
    res.status(500).send({ err: 'Internal server error' });
  }
});

// Project Save
app.post('/projectSavedJSON/:lsId/:version', async (req, res) => {
  try {
    if (!fullAuthenticate(req.headers.uname, req.headers.authorization, req.params.lsId)) return res.send({ noauth: true });
    let project = sessionManager.getProject(req.params.lsId);
    if (!project) return res.send({ err: 'Couldn\'t find the specified project!' });
    project.scratchSavedJSON(req.body, parseFloat(req.params.version));
    res.send({ success: 'Successfully saved the project!' });
  } catch (err) {
    console.error(err);
    res.status(500).send({ err: 'Internal server error' });
  }
});

// Project JSON
app.get('/projectJSON/:lsId', async (req, res) => {
  try {
    if (!fullAuthenticate(req.query.username, req.headers.authorization, req.params.lsId)) return res.send({ noauth: true });
    let project = sessionManager.getProject(req.params.lsId);
    if (!project) return res.sendStatus(404);
    res.send({ json: project.projectJson, version: project.jsonVersion });
  } catch (err) {
    console.error(err);
    res.status(500).send({ err: 'Internal server error' });
  }
});

// Changes since
app.get('/changesSince/:id/:version', async (req, res) => {
  try {
    if (!fullAuthenticate(req.headers.uname, req.headers.authorization, req.params.id)) return res.send({ noauth: true });
    let project = sessionManager.getProject(req.params.id);
    if (!project) return res.send([]);
    let oldestChange = project.project.getIndexZeroVersion();
    let clientVersion = parseFloat(req.params.version);
    let jsonVersion = project.jsonVersion;
    let forceReload = clientVersion < oldestChange - 1 && jsonVersion >= oldestChange - 1;
    if (clientVersion < oldestChange - 1 && jsonVersion < oldestChange - 1) console.error('client version too old AND json version too old.', project.id, jsonVersion, clientVersion, oldestChange);
    let changes = project.project.getChangesSinceVersion(clientVersion);
    if (forceReload) {
      changes = ListToObj(changes);
      changes.forceReload = true;
    }
    res.send(changes);
  } catch (err) {
    console.error(err);
    res.status(500).send({ err: 'Internal server error' });
  }
});

function ListToObj(list) {
  let output = { length: list.length };
  for (let i = 0; i < list.length; i++) output[i] = list[i];
  return output;
}

// --- Remaining routes go here ---
// Aquí irían todas las rutas de chat, ban/unban, friends, share/unshare, stats, etc.  
// Cada ruta debe ir envuelta en try/catch exactamente como las anteriores.  

// --- HTTP Server ---
httpServer.listen(PORT, '0.0.0.0', () => console.log('listening http on port ' + PORT));

// --- Graceful shutdown ---
process.stdin.resume();
async function exitHandler(options, exitCode) {
  if (options.cleanup) console.log('clean');
  if (exitCode || exitCode === 0) console.log(exitCode);
  if (options.exit) await finalSave(sessionManager);
}
process.on('exit', exitHandler.bind(null, { cleanup: true }));
process.on('SIGINT', exitHandler.bind(null, { exit: true }));
process.on('SIGUSR1', exitHandler.bind(null, { exit: true }));
process.on('SIGUSR2', exitHandler.bind(null, { exit: true }));
process.on('uncaughtException', exitHandler.bind(null, { exit: true }));
