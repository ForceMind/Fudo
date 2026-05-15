import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync, createReadStream, statSync } from 'node:fs';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(__dirname, '..');
const distDir = resolve(rootDir, 'dist');
const legacyDataFile = join(rootDir, 'data', 'dice-arena-db.json');
const defaultDataFile = existsSync(legacyDataFile) ? legacyDataFile : join(rootDir, 'data', 'fudo-db.json');
const dataFile = resolve(process.env.FUDO_DATA_FILE ?? process.env.DICE_ARENA_DATA_FILE ?? defaultDataFile);
const port = Number(process.env.PORT ?? 8787);
const adminToken = process.env.ADMIN_TOKEN ?? '';

const contentTypes = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
};

function now() {
  return new Date().toISOString();
}

function createDb() {
  return {
    users: [],
    rooms: [],
    matches: [],
  };
}

function ensureDb() {
  mkdirSync(dirname(dataFile), { recursive: true });
  if (!existsSync(dataFile)) {
    writeFileSync(dataFile, JSON.stringify(createDb(), null, 2), 'utf8');
  }
}

function readDb() {
  ensureDb();
  try {
    const parsed = JSON.parse(readFileSync(dataFile, 'utf8'));
    return {
      users: Array.isArray(parsed.users) ? parsed.users : [],
      rooms: Array.isArray(parsed.rooms) ? parsed.rooms : [],
      matches: Array.isArray(parsed.matches) ? parsed.matches : [],
    };
  } catch {
    return createDb();
  }
}

function writeDb(db) {
  mkdirSync(dirname(dataFile), { recursive: true });
  writeFileSync(dataFile, JSON.stringify(db, null, 2), 'utf8');
}

function sendJson(res, status, payload) {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  });
  res.end(JSON.stringify(payload));
}

function readBody(req) {
  return new Promise((resolveBody, reject) => {
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
      if (raw.length > 1024 * 1024) {
        reject(new Error('请求体过大'));
        req.destroy();
      }
    });
    req.on('end', () => {
      if (!raw) {
        resolveBody({});
        return;
      }
      try {
        resolveBody(JSON.parse(raw));
      } catch {
        reject(new Error('JSON 格式错误'));
      }
    });
    req.on('error', reject);
  });
}

function roomSlotsToArray(slots = {}) {
  return ['red', 'blue', 'green', 'yellow'].map((playerId) => slots[playerId]).filter(Boolean);
}

function createRoomCode(db) {
  for (let index = 0; index < 20; index += 1) {
    const code = Math.random().toString(36).slice(2, 8).toUpperCase();
    if (!db.rooms.some((room) => room.code === code)) {
      return code;
    }
  }
  return randomUUID().slice(0, 6).toUpperCase();
}

function isAdminRequest(req, url) {
  if (!adminToken) {
    return true;
  }
  return req.headers['x-admin-token'] === adminToken || url.searchParams.get('token') === adminToken;
}

function publicUser(user) {
  return {
    id: user.id,
    clientId: user.clientId,
    nickname: user.nickname,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
    lastSeenAt: user.lastSeenAt,
    gamesPlayed: user.gamesPlayed ?? 0,
    wins: user.wins ?? 0,
  };
}

async function handleApi(req, res, url) {
  const db = readDb();
  const path = url.pathname;

  if (req.method === 'POST' && path === '/api/users/ensure') {
    const body = await readBody(req);
    const clientId = String(body.clientId ?? '').slice(0, 120);
    if (!clientId) {
      sendJson(res, 400, { error: '缺少 clientId' });
      return;
    }

    let user = db.users.find((candidate) => candidate.clientId === clientId);
    if (!user) {
      user = {
        id: `usr_${randomUUID()}`,
        clientId,
        nickname: String(body.nickname ?? '').trim().slice(0, 20) || `玩家-${clientId.slice(-4).toUpperCase()}`,
        createdAt: now(),
        updatedAt: now(),
        lastSeenAt: now(),
        userAgent: String(req.headers['user-agent'] ?? '').slice(0, 300),
        gamesPlayed: 0,
        wins: 0,
      };
      db.users.push(user);
    } else {
      user.lastSeenAt = now();
      user.userAgent = String(req.headers['user-agent'] ?? '').slice(0, 300);
    }
    writeDb(db);
    sendJson(res, 200, { user: publicUser(user) });
    return;
  }

  const userPatchMatch = path.match(/^\/api\/users\/([^/]+)$/);
  if (req.method === 'PATCH' && userPatchMatch) {
    const body = await readBody(req);
    const user = db.users.find((candidate) => candidate.id === userPatchMatch[1]);
    if (!user) {
      sendJson(res, 404, { error: '用户不存在' });
      return;
    }
    const nickname = String(body.nickname ?? '').trim().slice(0, 20);
    if (!nickname) {
      sendJson(res, 400, { error: '昵称不能为空' });
      return;
    }
    user.nickname = nickname;
    user.updatedAt = now();
    user.lastSeenAt = now();
    writeDb(db);
    sendJson(res, 200, { user: publicUser(user) });
    return;
  }

  if (req.method === 'POST' && path === '/api/rooms') {
    const body = await readBody(req);
    const code = createRoomCode(db);
    const hostName = String(body.hostName ?? '房主').trim().slice(0, 20) || '房主';
    const room = {
      code,
      status: 'waiting',
      createdAt: now(),
      updatedAt: now(),
      startedAt: null,
      matchId: null,
      hostUserId: body.hostUserId ?? null,
      slots: {
        red: {
          id: 'red',
          name: hostName,
          isHuman: true,
          isHost: true,
          userId: body.hostUserId ?? null,
        },
        blue: null,
        green: null,
        yellow: null,
      },
    };
    db.rooms.unshift(room);
    writeDb(db);
    sendJson(res, 201, { room });
    return;
  }

  const roomMatch = path.match(/^\/api\/rooms\/([A-Z0-9]{6})(?:\/(join|start))?$/);
  if (roomMatch) {
    const code = roomMatch[1];
    const action = roomMatch[2] ?? '';
    const room = db.rooms.find((candidate) => candidate.code === code);
    if (!room) {
      sendJson(res, 404, { error: '房间不存在' });
      return;
    }

    if (req.method === 'GET' && !action) {
      sendJson(res, 200, { room });
      return;
    }

    if (req.method === 'POST' && action === 'join') {
      const body = await readBody(req);
      if (room.status !== 'waiting') {
        sendJson(res, 409, { error: '房间已开始' });
        return;
      }
      const userId = body.userId ?? null;
      const existing = roomSlotsToArray(room.slots).find((slot) => slot.userId && slot.userId === userId);
      if (existing) {
        sendJson(res, 200, { room });
        return;
      }
      const nextPlayerId = ['red', 'blue', 'green', 'yellow'].find((playerId) => !room.slots[playerId]);
      if (!nextPlayerId) {
        sendJson(res, 409, { error: '房间已满' });
        return;
      }
      room.slots[nextPlayerId] = {
        id: nextPlayerId,
        name: String(body.nickname ?? '玩家').trim().slice(0, 20) || '玩家',
        isHuman: true,
        isHost: false,
        userId,
      };
      room.updatedAt = now();
      writeDb(db);
      sendJson(res, 200, { room });
      return;
    }

    if (req.method === 'POST' && action === 'start') {
      const body = await readBody(req);
      room.status = 'active';
      room.startedAt = now();
      room.updatedAt = now();
      room.matchId = body.matchId ?? room.matchId ?? null;
      room.slots = body.slots ?? room.slots;
      writeDb(db);
      sendJson(res, 200, { room });
      return;
    }
  }

  if (req.method === 'POST' && path === '/api/matches/start') {
    const body = await readBody(req);
    const match = {
      id: `mat_${randomUUID()}`,
      roomCode: body.roomCode ?? null,
      status: 'running',
      startedAt: now(),
      endedAt: null,
      winner: null,
      turnNumber: 1,
      players: Array.isArray(body.players) ? body.players : [],
    };
    db.matches.unshift(match);
    writeDb(db);
    sendJson(res, 201, { match });
    return;
  }

  const matchEnd = path.match(/^\/api\/matches\/([^/]+)\/end$/);
  if (req.method === 'POST' && matchEnd) {
    const body = await readBody(req);
    const match = db.matches.find((candidate) => candidate.id === matchEnd[1]);
    if (!match) {
      sendJson(res, 404, { error: '对局不存在' });
      return;
    }

    match.status = 'finished';
    match.endedAt = now();
    match.winner = body.winner ?? null;
    match.turnNumber = Number(body.turnNumber ?? match.turnNumber ?? 1);
    if (Array.isArray(body.players)) {
      match.players = body.players;
    }

    const userIds = new Set(match.players.map((player) => player.userId).filter(Boolean));
    userIds.forEach((userId) => {
      const user = db.users.find((candidate) => candidate.id === userId);
      if (!user) {
        return;
      }
      user.gamesPlayed = (user.gamesPlayed ?? 0) + 1;
      if (match.winner?.userId === userId) {
        user.wins = (user.wins ?? 0) + 1;
      }
      user.updatedAt = now();
    });

    writeDb(db);
    sendJson(res, 200, { match });
    return;
  }

  if (req.method === 'GET' && path === '/api/admin/summary') {
    if (!isAdminRequest(req, url)) {
      sendJson(res, 401, { error: '需要后台访问令牌' });
      return;
    }

    sendJson(res, 200, {
      users: db.users.map(publicUser),
      rooms: db.rooms,
      matches: db.matches,
      stats: {
        userCount: db.users.length,
        roomCount: db.rooms.length,
        matchCount: db.matches.length,
        finishedMatchCount: db.matches.filter((match) => match.status === 'finished').length,
      },
    });
    return;
  }

  sendJson(res, 404, { error: 'API 不存在' });
}

function serveStatic(req, res, url) {
  const requestedPath = decodeURIComponent(url.pathname);
  const relativePath = requestedPath === '/' ? 'index.html' : requestedPath.replace(/^\/+/, '');
  const filePath = resolve(distDir, relativePath);
  const safePath = filePath.startsWith(distDir) ? filePath : join(distDir, 'index.html');
  const finalPath = existsSync(safePath) && statSync(safePath).isFile() ? safePath : join(distDir, 'index.html');
  const ext = extname(finalPath);

  res.writeHead(200, {
    'content-type': contentTypes[ext] ?? 'application/octet-stream',
  });
  createReadStream(finalPath).pipe(res);
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
    if (url.pathname.startsWith('/api/')) {
      await handleApi(req, res, url);
      return;
    }
    serveStatic(req, res, url);
  } catch (error) {
    sendJson(res, 500, { error: error instanceof Error ? error.message : '服务器错误' });
  }
});

server.listen(port, '0.0.0.0', () => {
  console.log(`Fudo production server listening on http://0.0.0.0:${port}`);
  console.log(`Data file: ${dataFile}`);
});
