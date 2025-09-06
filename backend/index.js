// backend/index.js
// Versión corregida para deploy en Render/servicios similares.
// Incluye manejo más robusto de errores y uso de variables de entorno.

import 'dotenv/config';
import fs from 'fs';
import path from 'path';

const PORT = process.env.PORT || 3000;
const ADMIN_USER = (() => {
    try { return JSON.parse(process.env.ADMIN_USER || '{}'); } catch(e) { console.error('ADMIN_USER JSON parse error:', e); return {}; }
})();
const AUTH_PROJECTS = (() => {
    try { return JSON.parse(process.env.AUTH_PROJECTS || '[]'); } catch(e) { console.error('AUTH_PROJECTS JSON parse error:', e); return []; }
})();
const ADMIN = (() => {
    try { return JSON.parse(process.env.ADMIN || '[]'); } catch(e) { console.error('ADMIN JSON parse error:', e); return []; }
})();
const CHAT_WEBHOOK_URL = process.env.CHAT_WEBHOOK_URL || '';

// Dependencias
import express from 'express';
import cors from 'cors';
import basicAuth from 'express-basic-auth';
import http from 'http';
import { Server } from 'socket.io';

import SessionManager from './utils/sessionManager.js';
import UserManager from './utils/userManager.js';
import sanitize from 'sanitize-filename';

import * as fileStorageUtils from './utils/fileStorage.js';
import { installCleaningJob } from './utils/removeOldProjects.js';
import { countRecentShared, recordPopup } from './utils/recentUsers.js';
import { setPaths, authenticate, fullAuthenticate, freePassesPath, freePasses } from './utils/scratch-auth.js';
import initSockets from './WebSockets.js';

// Express + HTTP server
const app = express();
// CORS relajado (no bloquear solicitudes externas)
app.use(cors({ origin: '*' }));
app.use(express.json({ limit: '5MB' }));

let httpServer = http.createServer(app);

// socket.io
const ioHttp = new Server(httpServer, {
    cors: { origin: '*' },
    maxHttpBufferSize: 2e7,
});

// Mensaje de restart
const restartMessage = 'The Livescratch server is restarting. You will lose connection for a few seconds.';

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// Cargar session manager desde disco
let sessionsObj = {};
try {
    sessionsObj = fileStorageUtils.loadMapFromFolderRecursive('storage') || {};
} catch (e) {
    console.warn('No storage folder found or error reading it, starting empty sessionsObj:', e?.message || e);
}

var sessionManager = SessionManager.fromJSON(sessionsObj);

// Cargar user manager
var userManager = new UserManager();
setPaths(app, userManager, sessionManager);

// Guardar los mapas iniciales (si existen)
try {
    if (sessionManager && sessionManager.livescratch) {
        fileStorageUtils.saveMapToFolder(sessionManager.livescratch, fileStorageUtils.livescratchPath);
    }
} catch (e) {
    console.error('Error saving initial livescratch map:', e);
}

// Arranque del loop de guardado
try {
    fileStorageUtils.saveLoop(sessionManager);
} catch (e) {
    console.warn('saveLoop not available or failed:', e);
}

// finalSave: guarda todo y sale
export let isFinalSaving = false;
async function finalSave(sessionManagerInstance) {
    try {
        if (isFinalSaving) return;
        console.log('sending message "' + restartMessage + '" to active projects');
        try { sessionManagerInstance.broadcastMessageToAllActiveProjects(restartMessage); } catch (e) { console.warn('broadcastMessageToAllActiveProjects failed:', e); }
        await sleep(2000);
        isFinalSaving = true;
        console.log('final saving...');
        try {
            if (fileStorageUtils && fileStorageUtils.lastIdPath && typeof sessionManagerInstance.lastId !== 'undefined') {
                fs.writeFileSync(fileStorageUtils.lastIdPath, (sessionManagerInstance.lastId).toString());
            }
        } catch (e) { console.warn('Could not write lastIdPath:', e); }
        try {
            if (freePassesPath) fs.writeFileSync(freePassesPath, JSON.stringify(freePasses));
        } catch (e) { console.warn('Could not write freePassesPath:', e); }

        if (sessionManagerInstance && typeof sessionManagerInstance.finalSaveAllProjects === 'function') {
            await sessionManagerInstance.finalSaveAllProjects();
        } else {
            console.warn('sessionManager.finalSaveAllProjects not available');
        }

        try {
            if (fileStorageUtils && typeof fileStorageUtils.saveMapToFolder === 'function') {
                fileStorageUtils.saveMapToFolder(userManager.users, fileStorageUtils.usersPath);
            }
        } catch (e) { console.warn('Could not save users map:', e); }

        if (typeof fileStorageUtils.saveRecent === 'function') {
            await fileStorageUtils.saveRecent();
        } else {
            // If not provided, skip silently
            console.debug('saveRecent not found, skipping');
        }

        process.exit(0);
    } catch (e) {
        console.error('Error during finalSave:', e);
        await sleep(10000);
        isFinalSaving = false;
    }
}

// Install cleaning job (if funciona)
try {
    setTimeout(() => installCleaningJob(sessionManager, userManager), 1000 * 10);
} catch (e) {
    console.warn('installCleaningJob not available or failed:', e);
}

// Init sockets (WebSockets logic reside in ./WebSockets.js)
try {
    new initSockets(ioHttp, sessionManager, userManager);
} catch (e) {
    console.warn('initSockets failed:', e);
}

// --- ENDPOINTS ---
// Nota: muchas funciones de autenticación se delegan a scratch-auth.js
app.post('/newProject/:scratchId/:owner', (req, res) => {
    try {
        if (!authenticate(req.params.owner, req.headers.authorization)) { res.send({ noauth: true }); return; }
        if (!req.params.scratchId || sanitize(req.params.scratchId.toString()) === '') { res.send({ err: 'invalid scratch id' }); return; }
        let project = sessionManager.getScratchToLSProject(req.params.scratchId);
        let json = req.body;
        if (!project) {
            console.log('creating new project from scratch project: ' + req.params.scratchId + ' by ' + req.params.owner + ' titled: ' + req.query.title);
            project = sessionManager.newProject(req.params.owner, req.params.scratchId, json, req.query.title);
            userManager.newProject(req.params.owner, project.id);
        }
        res.send({ id: project.id });
    } catch (e) {
        console.error('/newProject error', e);
        res.status(500).send({ err: 'server error' });
    }
});

app.get('/lsId/:scratchId/:uname', (req, res) => {
    try {
        let lsId = sessionManager.getScratchProjectEntry(req.params.scratchId)?.blId;
        if (!lsId) { res.send(lsId); return; }
        let project = sessionManager.getProject(lsId);
        if (!project) {
            sessionManager.deleteScratchProjectEntry(req.params.scratchId);
            res.send(null);
            return;
        }
        let hasAccess = fullAuthenticate(req.params.uname, req.headers.authorization, lsId);
        res.send(hasAccess ? lsId : null);
    } catch (e) {
        console.error('/lsId error', e);
        res.status(500).send({ err: 'server error' });
    }
});

app.get('/scratchIdInfo/:scratchId', (req, res) => {
    try {
        if (sessionManager.doesScratchProjectEntryExist(req.params.scratchId)) {
            res.send(sessionManager.getScratchProjectEntry(req.params.scratchId));
        } else {
            res.send({ err: ('could not find livescratch project associated with scratch project id: ' + req.params.scratchId) });
        }
    } catch (e) {
        console.error('/scratchIdInfo error', e);
        res.status(500).send({ err: 'server error' });
    }
});

app.get('/projectTitle/:id', (req, res) => {
    try {
        if (!fullAuthenticate(req.headers.uname, req.headers.authorization, req.params.id)) { res.send({ noauth: true }); return; }
        let project = sessionManager.getProject(req.params.id);
        if (!project) res.send({ err: 'could not find project with livescratch id: ' + req.params.id });
        else res.send({ title: project.project.title });
    } catch (e) {
        console.error('/projectTitle error', e);
        res.status(500).send({ err: 'server error' });
    }
});

app.post('/projectSavedJSON/:lsId/:version', (req, res) => {
    try {
        if (!fullAuthenticate(req.headers.uname, req.headers.authorization, req.params.lsId)) { res.send({ noauth: true }); return; }
        let json = req.body;
        let project = sessionManager.getProject(req.params.lsId);
        if (!project) { console.log('Could not find project: ' + req.params.lsId); res.send({ err: 'Couldn\\'t find the specified project!' }); return; }
        project.scratchSavedJSON(json, parseFloat(req.params.version));
        res.send({ success: 'Successfully saved the project!' });
    } catch (e) {
        console.error('/projectSavedJSON error', e);
        res.status(500).send({ err: 'server error' });
    }
});

app.get('/projectJSON/:lsId', (req, res) => {
    try {
        if (!fullAuthenticate(req.query.username, req.headers.authorization, req.params.lsId)) { res.send({ noauth: true }); return; }
        let lsId = req.params.lsId;
        let project = sessionManager.getProject(lsId);
        if (!project) { res.sendStatus(404); return; }
        res.send({ json: project.projectJson, version: project.jsonVersion });
    } catch (e) {
        console.error('/projectJSON error', e);
        res.status(500).send({ err: 'server error' });
    }
});

app.use('/html', express.static('static'));

app.get('/changesSince/:id/:version', (req, res) => {
    try {
        if (!fullAuthenticate(req.headers.uname, req.headers.authorization, req.params.id)) { res.send({ noauth: true }); return; }
        let project = sessionManager.getProject(req.params.id);
        if (!project) { res.send([]); return; }

        let oldestChange = project.project.getIndexZeroVersion();
        let clientVersion = req.params.version;
        let jsonVersion = project.jsonVersion;
        let forceReload = clientVersion < oldestChange - 1 && jsonVersion >= oldestChange - 1;
        if (clientVersion < oldestChange - 1 && jsonVersion < oldestChange - 1) {
            console.error('client version too old AND json version too old. id,jsonVersion,clientVersion,indexZeroVersion', project.id, jsonVersion, clientVersion, oldestChange);
        }

        let changes = project.project.getChangesSinceVersion(parseFloat(req.params.version));
        if (forceReload) {
            changes = ListToObj(changes);
            changes.forceReload = true;
        }

        res.send(changes);
    } catch (e) {
        console.error('/changesSince error', e);
        res.status(500).send({ err: 'server error' });
    }
});

function ListToObj(list) {
    let output = { length: list.length };
    for (let i = 0; i < list.length; i++) output[i] = list[i];
    return output;
}

app.get('/chat/:id', (req, res) => {
    try {
        if (!fullAuthenticate(req.headers.uname, req.headers.authorization, req.params.id)) { res.send({ noauth: true }); return; }
        let project = sessionManager.getProject(req.params.id);
        if (!project) res.send([]);
        else res.send(project.getChat());
    } catch (e) {
        console.error('/chat error', e);
        res.status(500).send({ err: 'server error' });
    }
});

// ADMIN routes (ban/unban/banned/stats) — protected with basic auth using ADMIN_USER env var
try {
    app.use('/ban', basicAuth({ users: ADMIN_USER, challenge: true }));
    app.put('/ban/:username', (req, res) => {
        fileStorageUtils.ban(req.params.username).then(() => res.send({ success: 'Successfully banned!' })).catch(err => res.send({ err }));
    });

    app.use('/unban', basicAuth({ users: ADMIN_USER, challenge: true }));
    app.put('/unban/:username', (req, res) => {
        fileStorageUtils.unban(req.params.username).then(() => res.send({ success: 'Successfully unbanned!' })).catch(err => res.send({ err }));
    });

    app.use('/banned', basicAuth({ users: ADMIN_USER, challenge: true }));
    app.get('/banned', (req, res) => {
        fileStorageUtils.getBanned().then(list => res.send(list)).catch(err => res.send({ err }));
    });

    app.use('/stats', basicAuth({ users: ADMIN_USER, challenge: true }));
    app.get('/stats', (req, res) => {
        try {
            let cachedStats = sessionManager.getStats();
            cachedStats.cachedAt = new Date();
            res.send(cachedStats);
        } catch (e) {
            console.error('/stats error', e);
            res.status(500).send({ err: 'server error' });
        }
    });
} catch (e) {
    console.warn('Admin routes not fully configured (ADMIN_USER missing or bad):', e);
}

app.get('/dau/:days', (req, res) => {
    try { res.send(String(countRecentShared(parseFloat(req.params.days)))); } catch (e) { res.status(500).send({ err: 'server error' }); }
});

app.put('/linkScratch/:scratchId/:lsId/:owner', (req, res) => {
    try {
        if (!fullAuthenticate(req.params.owner, req.headers.authorization, req.params.lsId)) { res.send({ noauth: true }); return; }
        console.log('linking:', req.params);
        sessionManager.linkProject(req.params.lsId, req.params.scratchId, req.params.owner, 0);
        res.send({ success: 'Successfully linked!' });
    } catch (e) { console.error('/linkScratch error', e); res.status(500).send({ err: 'server error' }); }
});

app.get('/userExists/:username', (req, res) => {
    try { res.send(userManager.userExists(req.params.username) && !userManager.getUser(req.params.username).privateMe); } catch (e) { res.status(500).send({ err: 'server error' }); }
});

app.put('/privateMe/:username/:private', (req, res) => {
    try {
        req.params.username = sanitize(req.params.username);
        if (!authenticate(req.params.username, req.headers.authorization)) { res.send({ noauth: true }); return; }
        let user = userManager.getUser(req.params.username);
        user.privateMe = req.params.private == 'true';
        res.status(200).end();
    } catch (e) { console.error('/privateMe PUT error', e); res.status(500).send({ err: 'server error' }); }
});

app.get('/privateMe/:username', (req, res) => {
    try {
        req.params.username = sanitize(req.params.username);
        if (!authenticate(req.params.username, req.headers.authorization)) { res.send({ noauth: true }); return; }
        let user = userManager.getUser(req.params.username);
        res.send(user.privateMe);
    } catch (e) { console.error('/privateMe GET error', e); res.status(500).send({ err: 'server error' }); }
});

app.get('/userRedirect/:scratchId/:username', (req, res) => {
    try {
        let project = sessionManager.getScratchToLSProject(req.params.scratchId);
        if (!fullAuthenticate(req.params.username, req.headers.authorization, project?.id)) { res.send({ noauth: true, goto: 'none' }); return; }
        if (!project) { res.send({ goto: 'none' }); return; }
        let ownedProject = project.getOwnersProject(req.params.username);
        if (!!ownedProject) res.send({ goto: ownedProject.scratchId });
        else res.send({ goto: 'new', lsId: project.id });
    } catch (e) { console.error('/userRedirect error', e); res.status(500).send({ err: 'server error' }); }
});

app.get('/active/:lsId', (req, res) => {
    try {
        if (!fullAuthenticate(req.headers.uname, req.headers.authorization, req.params.lsId)) { res.send({ noauth: true }); return; }
        let usernames = sessionManager.getProject(req.params.lsId)?.session.getConnectedUsernames();
        let clients = sessionManager.getProject(req.params.lsId)?.session.getConnectedUsersClients();
        if (usernames) {
            res.send(usernames.map(name => {
                let user = userManager.getUser(name);
                return { username: user.username, pk: user.pk, cursor: clients[name].cursor };
            }));
        } else res.send({ err: 'could not get users for project with id: ' + req.params.lsId });
    } catch (e) { console.error('/active error', e); res.status(500).send({ err: 'server error' }); }
});

app.get('/', (req, res) => {
    res.send('LiveScratch API');
});

// Friends endpoints
app.post('/friends/:user/:friend', (req, res) => {
    try {
        if (!authenticate(req.params.user, req.headers.authorization)) { res.send({ noauth: true }); return; }
        if (!userManager.userExists(req.params.friend)) { res.sendStatus(404); return; }
        userManager.befriend(req.params.user, req.params.friend);
        res.send({ success: 'Successfully friended!' });
    } catch (e) { console.error('/friends POST error', e); res.status(500).send({ err: 'server error' }); }
});
app.delete('/friends/:user/:friend', (req, res) => {
    try {
        if (!authenticate(req.params.user, req.headers.authorization)) { res.send({ noauth: true }); return; }
        userManager.unbefriend(req.params.user, req.params.friend);
        res.send({ success: 'Succesfully unfriended!' });
    } catch (e) { console.error('/friends DELETE error', e); res.status(500).send({ err: 'server error' }); }
});
app.get('/friends/:user', (req, res) => {
    try {
        recordPopup(req.params.user);
        if (!authenticate(req.params.user, req.headers.authorization)) { res.send({ noauth: true }); return; }
        res.send(userManager.getUser(req.params.user)?.friends);
    } catch (e) { console.error('/friends GET error', e); res.status(500).send({ err: 'server error' }); }
});

// Projects listing for user
app.get('/userProjects/:user', (req, res) => {
    try {
        if (!authenticate(req.params.user, req.headers.authorization)) { res.send({ noauth: true }); return; }
        res.send(userManager.getShared(req.params.user));
    } catch (e) { console.error('/userProjects error', e); res.status(500).send({ err: 'server error' }); }
});

// My stuff (info for frontend)
app.get('/userProjectsScratch/:user', (req, res) => {
    try {
        if (!authenticate(req.params.user, req.headers.authorization)) { res.send({ noauth: true }); return; }
        let livescratchIds = userManager.getAllProjects(req.params.user);
        let projectsList = livescratchIds.map(id => {
            let projectObj = {};
            let project = sessionManager.getProject(id);
            if (!project) return null;
            projectObj.scratchId = project.getOwnersProject(req.params.user)?.scratchId;
            if (!projectObj.scratchId) projectObj.scratchId = project.scratchId;
            projectObj.blId = project.id;
            projectObj.title = project.project.title;
            projectObj.lastTime = project.project.lastTime;
            projectObj.lastUser = project.project.lastUser;
            projectObj.online = project.session.getConnectedUsernames();
            return projectObj;
        }).filter(Boolean);
        res.send(projectsList);
    } catch (e) { console.error('/userProjectsScratch error', e); res.status(500).send({ err: 'server error' }); }
});

app.put('/leaveScratchId/:scratchId/:username', (req, res) => {
    try {
        let project = sessionManager.getScratchToLSProject(req.params.scratchId);
        if (!fullAuthenticate(req.params.username, req.headers.authorization, project, false)) { res.send({ noauth: true }); return; }
        userManager.unShare(req.params.username, project.id);
        sessionManager.unshareProject(project.id, req.params.username);
        res.send({ success: 'User succesfully removed!' });
    } catch (e) { console.error('/leaveScratchId error', e); res.status(500).send({ err: 'server error' }); }
});
app.put('/leaveLSId/:lsId/:username', (req, res) => {
    try {
        if (!authenticate(req.params.username, req.headers.authorization)) { res.send({ noauth: true }); return; }
        userManager.unShare(req.params.username, req.params.lsId);
        sessionManager.unshareProject(req.params.lsId, req.params.username);
        res.send({ success: 'User succesfully removed!' });
    } catch (e) { console.error('/leaveLSId error', e); res.status(500).send({ err: 'server error' }); }
});

app.get('/verify/test', (req, res) => {
    try { res.send({ verified: authenticate(req.query.username, req.headers.authorization) }); } catch (e) { console.error('/verify/test error', e); res.status(500).send({ err: 'server error' }); }
});

// Sharing endpoints
app.get('/share/:id', (req, res) => {
    try {
        if (!fullAuthenticate(req.headers.uname, req.headers.authorization, req.params.id)) { res.send({ noauth: true }); return; }
        let project = sessionManager.getProject(req.params.id);
        let list = project?.sharedWith;
        if (!list) { res.send({ err: 'No shared list found for the specified project.' }); return; }
        list = list.map(name => ({ username: name, pk: userManager.getUser(name).pk }));
        res.send(list ? [{ username: project.owner, pk: userManager.getUser(project.owner).pk }].concat(list) : { err: 'could not find livescratch project: ' + req.params.id });
    } catch (e) { console.error('/share GET error', e); res.status(500).send({ err: 'server error' }); }
});

app.put('/share/:id/:to/:from', (req, res) => {
    try {
        if (!fullAuthenticate(req.params.from, req.headers.authorization, req.params.id)) { res.send({ noauth: true }); return; }
        if (sessionManager.getProject(req.params.id)?.owner == req.params.to) { res.send({ err: 'Cannot share the project with the owner.' }); return; }
        if (!userManager.userExists(req.params.to)) { res.sendStatus(404); return; }

        sessionManager.shareProject(req.params.id, req.params.to, req.query.pk);
        userManager.getUser(req.params.to).pk = req.query.pk;
        userManager.share(req.params.to, req.params.id, req.params.from);
        res.send({ success: 'Project successfully shared.' });
    } catch (e) { console.error('/share PUT error', e); res.status(500).send({ err: 'server error' }); }
});

app.put('/unshare/:id/:to', (req, res) => {
    try {
        if (!fullAuthenticate(req.headers.uname, req.headers.authorization, req.params.id)) { res.send({ noauth: true }); return; }
        if (sessionManager.getProject(req.params.id)?.owner == req.params.to) { res.send({ err: 'Cannot unshare the project with the owner.' }); return; }
        sessionManager.unshareProject(req.params.id, req.params.to);
        userManager.unShare(req.params.to, req.params.id);
        res.send({ success: 'Project successfully unshared.' });
    } catch (e) { console.error('/unshare error', e); res.status(500).send({ err: 'server error' }); }
});

// ---------------------
// Static serving: intenta servir "public" (backend/public) o "public" desde la raíz del repo.
// Asegúrate de que tu index.html esté en backend/public/index.html o public/index.html
const possiblePublicDirs = [
    path.join(process.cwd(), 'backend', 'public'),
    path.join(process.cwd(), 'public'),
    path.join(process.cwd(), 'backend', 'static'),
    path.join(process.cwd(), 'static')
];
let servedPublic = null;
for (const d of possiblePublicDirs) {
    try {
        if (fs.existsSync(d)) {
            app.use(express.static(d));
            servedPublic = d;
            console.log('Serving static files from:', d);
            break;
        }
    } catch (e) {
        // ignore
    }
}

if (!servedPublic) {
    console.warn('No static public folder found in expected locations:', possiblePublicDirs);
}

// Start server
(async () => {
    try {
        httpServer.listen(PORT, '0.0.0.0', () => {
            console.log(`Servidor corriendo en puerto ${PORT}`);
            if (servedPublic) {
                console.log(`Public served at / from ${servedPublic}`);
            } else {
                console.log('No public directory served - make sure backend/public or public exists with index.html');
            }
        });
    } catch (e) {
        console.error('Failed to start server:', e);
        process.exit(1);
    }
})();

// Graceful exit handlers
process.stdin.resume();
async function exitHandler(options, exitCode) {
    if (options.cleanup) console.log('clean');
    if (exitCode || exitCode === 0) console.log('exitCode', exitCode);
    if (options.exit) {
        await finalSave(sessionManager);
    }
}

process.on('exit', exitHandler.bind(null, { cleanup: true }));
process.on('SIGINT', exitHandler.bind(null, { exit: true }));
process.on('SIGUSR1', exitHandler.bind(null, { exit: true }));
process.on('SIGUSR2', exitHandler.bind(null, { exit: true }));
process.on('uncaughtException', async (err) => {
    console.error('uncaughtException:', err);
    try {
        await exitHandler({ exit: true }, 1);
    } catch (e) { console.error('error in uncaughtException handler:', e); }
});
