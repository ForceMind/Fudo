import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync, createReadStream, statSync } from 'node:fs';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { advanceServerAiTurns } from './game-engine.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(__dirname, '..');
const distDir = resolve(rootDir, 'dist');
const legacyDataFile = join(rootDir, 'data', 'dice-arena-db.json');
const defaultDataFile = existsSync(legacyDataFile) ? legacyDataFile : join(rootDir, 'data', 'fudo-db.json');
const dataFile = resolve(process.env.FUDO_DATA_FILE ?? process.env.DICE_ARENA_DATA_FILE ?? defaultDataFile);
const port = Number(process.env.PORT ?? 8787);
const adminToken = process.env.ADMIN_TOKEN ?? '';
const adminHosts = String(process.env.ADMIN_HOSTS ?? process.env.ADMIN_HOST ?? '')
  .split(',')
  .map((host) => host.trim().toLowerCase())
  .filter(Boolean);
const offlineTimeoutMs = Number(process.env.OFFLINE_TIMEOUT_MS ?? 15000);

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

function sanitizeGameStateForStorage(gameState) {
  if (!gameState || typeof gameState !== 'object') {
    return gameState;
  }

  return {
    ...gameState,
    selectedPieceId: null,
    moveDraft: null,
    reachableCells: [],
    notice: null,
  };
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

function parseTimestamp(value) {
  const time = Date.parse(value ?? '');
  return Number.isFinite(time) ? time : 0;
}

function isSlotOnline(slot, referenceTime = Date.now()) {
  return Boolean(slot?.isHuman && slot.userId && parseTimestamp(slot.lastSeenAt) >= referenceTime - offlineTimeoutMs);
}

function touchUser(db, userId) {
  if (!userId) {
    return null;
  }

  const user = db.users.find((candidate) => candidate.id === userId);
  if (!user) {
    return null;
  }

  const timestamp = now();
  user.lastSeenAt = timestamp;
  user.updatedAt = timestamp;
  return user;
}

function touchRoomSlot(db, room, userId) {
  const user = touchUser(db, userId);
  const slot = room ? getRoomSlotByUserId(room, userId) : null;
  if (!slot) {
    return null;
  }

  const timestamp = user?.lastSeenAt ?? now();
  slot.lastSeenAt = timestamp;
  if (user?.nickname) {
    slot.name = user.nickname;
  }
  room.updatedAt = timestamp;
  return slot;
}

function publicRoomSummary(room) {
  const players = roomSlotsToArray(room.slots).map((slot) => ({
    id: slot.id,
    name: slot.name,
    isHost: Boolean(slot.isHost),
    ready: Boolean(slot.ready),
    online: isSlotOnline(slot),
    lastSeenAt: slot.lastSeenAt ?? null,
  }));
  const host = players.find((player) => player.isHost) ?? players[0] ?? null;
  return {
    code: room.code,
    status: room.status,
    createdAt: room.createdAt,
    updatedAt: room.updatedAt,
    hostName: host?.name ?? '房主',
    playerCount: players.length,
    capacity: 4,
    players,
    startRequested: Boolean(room.startRequested),
  };
}

function getHostSlot(room) {
  return roomSlotsToArray(room.slots).find((slot) => slot.isHost) ?? null;
}

function allJoinedPlayersReady(room) {
  return roomSlotsToArray(room.slots)
    .filter((slot) => slot.isHuman && !slot.isHost)
    .every((slot) => Boolean(slot.ready));
}

function findRoomByMatch(db, match) {
  return db.rooms.find((room) => room.code === match.roomCode) ?? null;
}

function createMatchFromRoom(room) {
  const match = {
    id: `mat_${randomUUID()}`,
    roomCode: room.code,
    status: 'running',
    startedAt: now(),
    endedAt: null,
    updatedAt: now(),
    winner: null,
    turnNumber: 1,
    players: Array.isArray(room.pendingPlayers) ? room.pendingPlayers : [],
    gameState: sanitizeGameStateForStorage(room.pendingGameState ?? null),
    stateVersion: 1,
  };

  room.status = 'active';
  room.startedAt = match.startedAt;
  room.updatedAt = match.startedAt;
  room.matchId = match.id;
  room.startRequested = false;
  delete room.pendingPlayers;
  delete room.pendingGameState;

  return match;
}

function maybeStartRoom(db, room) {
  if (room.status !== 'waiting' || !room.startRequested || !room.pendingGameState || !allJoinedPlayersReady(room)) {
    return null;
  }

  const match = createMatchFromRoom(room);
  db.matches.unshift(match);
  return match;
}

function getRoomSlotByUserId(room, userId) {
  return roomSlotsToArray(room.slots).find((slot) => slot.userId && slot.userId === userId) ?? null;
}

function syncMatchPresence(db, match) {
  const room = findRoomByMatch(db, match);
  if (!room || !Array.isArray(match.gameState?.players)) {
    return false;
  }

  const referenceTime = Date.now();
  let changed = false;
  const players = match.gameState.players.map((player) => {
    const slot = room.slots?.[player.id] ?? null;
    const desiredHuman = slot?.isHuman ? isSlotOnline(slot, referenceTime) : false;
    const desiredName = slot?.name ?? player.name;
    if (player.isHuman === desiredHuman && player.name === desiredName) {
      return player;
    }

    changed = true;
    return {
      ...player,
      name: desiredName,
      isHuman: desiredHuman,
    };
  });

  if (!changed) {
    return false;
  }

  match.gameState = sanitizeGameStateForStorage({
    ...match.gameState,
    players,
  });
  match.stateVersion = Number(match.stateVersion ?? 0) + 1;
  match.updatedAt = now();
  return true;
}

function publicSyncedMatch(match) {
  return {
    id: match.id,
    roomCode: match.roomCode,
    status: match.status,
    stateVersion: match.stateVersion ?? 0,
    gameState: match.gameState ?? null,
    winner: match.winner ?? null,
  };
}

function advanceMatchAi(db, match) {
  if (match.status !== 'running' || !match.gameState) {
    return false;
  }

  const presenceChanged = syncMatchPresence(db, match);
  const result = advanceServerAiTurns(match.gameState);
  if (!result.changed) {
    return presenceChanged;
  }

  match.gameState = sanitizeGameStateForStorage(result.gameState);
  match.stateVersion = Number(match.stateVersion ?? 0) + 1;
  match.turnNumber = Number(result.gameState.turnNumber ?? match.turnNumber ?? 1);
  match.updatedAt = now();
  applyMatchResultStats(db, match, result.gameState);
  return true;
}

function dissolveRoom(db, room) {
  const timestamp = now();
  room.status = 'finished';
  room.updatedAt = timestamp;
  room.endedAt = timestamp;
  room.dissolvedAt = timestamp;
  room.closedReason = 'admin_dissolved';
  room.startRequested = false;
  delete room.pendingPlayers;
  delete room.pendingGameState;

  const match = room.matchId ? db.matches.find((candidate) => candidate.id === room.matchId) : null;
  if (match && match.status !== 'finished') {
    match.status = 'finished';
    match.endedAt = timestamp;
    match.updatedAt = timestamp;
    match.winner = null;
    match.closedReason = 'admin_dissolved';
    match.stateVersion = Number(match.stateVersion ?? 0) + 1;
  }

  return { room, match };
}

function canUpdateMatchState(db, match, userId) {
  const room = findRoomByMatch(db, match);
  const state = match.gameState;
  const currentPlayer = state?.players?.[state.currentPlayerIndex];
  if (!room || !currentPlayer || !userId) {
    return false;
  }

  if (currentPlayer.isHuman) {
    const currentSlot = room.slots?.[currentPlayer.id] ?? null;
    return currentSlot?.userId === userId && isSlotOnline(currentSlot);
  }

  return false;
}

function applyMatchResultStats(db, match, gameState) {
  if (!gameState?.winnerId || match.status === 'finished') {
    return;
  }

  const room = findRoomByMatch(db, match);
  const winnerPlayer = gameState.players?.find((player) => player.id === gameState.winnerId);
  const winnerSlot = room?.slots?.[gameState.winnerId] ?? null;
  match.status = 'finished';
  match.endedAt = now();
  match.winner = {
    id: gameState.winnerId,
    name: winnerPlayer?.name ?? gameState.winnerId,
    userId: winnerSlot?.userId ?? null,
  };
  match.turnNumber = Number(gameState.turnNumber ?? match.turnNumber ?? 1);

  const userIds = new Set((match.players ?? []).map((player) => player.userId).filter(Boolean));
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

function getRequestHost(req) {
  return String(req.headers['x-forwarded-host'] ?? req.headers.host ?? '')
    .split(',')[0]
    .trim()
    .replace(/:\d+$/, '')
    .toLowerCase();
}

function isAdminRequest(req, url) {
  const hostAllowed = adminHosts.length === 0 || adminHosts.includes(getRequestHost(req));
  const tokenAllowed =
    Boolean(adminToken) && (req.headers['x-admin-token'] === adminToken || url.searchParams.get('token') === adminToken);
  return hostAllowed && tokenAllowed;
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

  if (req.method === 'GET' && path === '/api/rooms') {
    const rooms = db.rooms
      .filter((room) => room.status === 'waiting')
      .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))
      .slice(0, 20)
      .map(publicRoomSummary);
    sendJson(res, 200, { rooms });
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
          ready: false,
          lastSeenAt: now(),
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

  const roomMatch = path.match(/^\/api\/rooms\/([A-Z0-9]{6})(?:\/(join|start|ready|start-request))?$/);
  if (roomMatch) {
    const code = roomMatch[1];
    const action = roomMatch[2] ?? '';
    const room = db.rooms.find((candidate) => candidate.code === code);
    if (!room) {
      sendJson(res, 404, { error: '房间不存在' });
      return;
    }

    if (req.method === 'GET' && !action) {
      const userId = url.searchParams.get('userId');
      let changed = false;
      if (userId) {
        touchRoomSlot(db, room, userId);
        changed = true;
      }
      if (room.matchId) {
        const match = db.matches.find((candidate) => candidate.id === room.matchId);
        changed = match ? advanceMatchAi(db, match) || changed : changed;
      }
      if (changed) {
        writeDb(db);
      }
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
        touchRoomSlot(db, room, userId);
        writeDb(db);
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
        ready: false,
        lastSeenAt: now(),
      };
      room.updatedAt = now();
      writeDb(db);
      sendJson(res, 200, { room });
      return;
    }

    if (req.method === 'POST' && action === 'ready') {
      const body = await readBody(req);
      if (room.status !== 'waiting') {
        sendJson(res, 409, { error: '房间已开始' });
        return;
      }

      const slot = getRoomSlotByUserId(room, body.userId ?? null);
      if (!slot) {
        sendJson(res, 403, { error: '你不在这个房间中' });
        return;
      }
      if (slot.isHost) {
        sendJson(res, 403, { error: '房主不需要准备' });
        return;
      }

      slot.ready = Boolean(body.ready);
      touchRoomSlot(db, room, body.userId ?? null);
      room.updatedAt = now();
      const match = maybeStartRoom(db, room);
      writeDb(db);
      sendJson(res, 200, { room, match });
      return;
    }

    if (req.method === 'POST' && action === 'start-request') {
      const body = await readBody(req);
      if (room.status !== 'waiting') {
        sendJson(res, 409, { error: '房间已开始' });
        return;
      }

      const host = getHostSlot(room);
      if (!host || host.userId !== body.hostUserId) {
        sendJson(res, 403, { error: '只有房主可以开始' });
        return;
      }
      touchRoomSlot(db, room, body.hostUserId ?? null);
      if (!body.gameState || !Array.isArray(body.players)) {
        sendJson(res, 400, { error: '缺少对局初始状态' });
        return;
      }

      room.startRequested = true;
      room.pendingPlayers = body.players;
      room.pendingGameState = sanitizeGameStateForStorage(body.gameState);
      room.updatedAt = now();
      const match = maybeStartRoom(db, room);
      writeDb(db);
      sendJson(res, 200, { room, match });
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
        updatedAt: now(),
        winner: null,
        turnNumber: 1,
        players: Array.isArray(body.players) ? body.players : [],
        gameState: sanitizeGameStateForStorage(body.gameState ?? null),
        stateVersion: 1,
      };
    db.matches.unshift(match);
    writeDb(db);
    sendJson(res, 201, { match });
    return;
  }

  const matchState = path.match(/^\/api\/matches\/([^/]+)\/state$/);
  if (matchState) {
    const match = db.matches.find((candidate) => candidate.id === matchState[1]);
    if (!match) {
      sendJson(res, 404, { error: '对局不存在' });
      return;
    }

    if (req.method === 'GET') {
      const room = findRoomByMatch(db, match);
      const userId = url.searchParams.get('userId');
      if (userId) {
        touchRoomSlot(db, room, userId);
      }
      const changed = advanceMatchAi(db, match);
      if (userId || changed) {
        writeDb(db);
      }
      sendJson(res, 200, { match: publicSyncedMatch(match) });
      return;
    }

    if (req.method === 'POST') {
      const body = await readBody(req);
      if (match.status !== 'running') {
        sendJson(res, 409, { error: '对局已结束' });
        return;
      }
      if (!body.gameState) {
        sendJson(res, 400, { error: '缺少 gameState' });
        return;
      }
      const room = findRoomByMatch(db, match);
      touchRoomSlot(db, room, body.userId ?? null);
      if (Number(body.stateVersion) !== Number(match.stateVersion ?? 0)) {
        sendJson(res, 409, {
          error: '对局状态已更新，请同步后重试',
          stateVersion: match.stateVersion ?? 0,
          gameState: match.gameState ?? null,
        });
        return;
      }
      if (!canUpdateMatchState(db, match, body.userId ?? null)) {
        sendJson(res, 403, { error: '现在不是你的行动回合' });
        return;
      }

      match.gameState = sanitizeGameStateForStorage(body.gameState);
      match.stateVersion = Number(match.stateVersion ?? 0) + 1;
      match.turnNumber = Number(body.gameState.turnNumber ?? match.turnNumber ?? 1);
      match.updatedAt = now();
      applyMatchResultStats(db, match, body.gameState);
      advanceMatchAi(db, match);
      writeDb(db);
      sendJson(res, 200, { match: publicSyncedMatch(match) });
      return;
    }
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

  const adminRoomDissolve = path.match(/^\/api\/admin\/rooms\/([A-Z0-9]{6})\/dissolve$/);
  if (req.method === 'POST' && adminRoomDissolve) {
    if (!isAdminRequest(req, url)) {
      sendJson(res, 401, { error: '需要后台访问令牌' });
      return;
    }

    const room = db.rooms.find((candidate) => candidate.code === adminRoomDissolve[1]);
    if (!room) {
      sendJson(res, 404, { error: '房间不存在' });
      return;
    }

    const result = dissolveRoom(db, room);
    writeDb(db);
    sendJson(res, 200, result);
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

function runAiAutomationTick() {
  const db = readDb();
  let changed = false;
  db.matches
    .filter((match) => match.status === 'running')
    .forEach((match) => {
      changed = advanceMatchAi(db, match) || changed;
    });

  if (changed) {
    writeDb(db);
  }
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

const aiAutomationTimer = setInterval(() => {
  try {
    runAiAutomationTick();
  } catch (error) {
    console.error('AI takeover tick failed:', error);
  }
}, 1000);
aiAutomationTimer.unref?.();

server.listen(port, '0.0.0.0', () => {
  console.log(`Fudo production server listening on http://0.0.0.0:${port}`);
  console.log(`Data file: ${dataFile}`);
});
