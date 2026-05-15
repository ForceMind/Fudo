import type { PlayerConfigInput, PlayerId } from './game/types';
import type { LobbySlot } from './components/RoomLobby';

export interface BrowserUser {
  id: string;
  clientId: string;
  nickname: string;
  createdAt?: string;
  lastSeenAt?: string;
  gamesPlayed?: number;
  wins?: number;
}

export interface StoredRoom {
  code: string;
  status: 'waiting' | 'active' | 'finished';
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  matchId: string | null;
  hostUserId: string | null;
  slots: Record<PlayerId, LobbySlot | null>;
}

export interface StoredMatch {
  id: string;
  roomCode: string | null;
  status: 'running' | 'finished';
  startedAt: string;
  endedAt: string | null;
  winner: { id: PlayerId; name: string; userId?: string | null } | null;
  turnNumber: number;
  players: Array<PlayerConfigInput & { userId?: string | null }>;
}

export interface AdminSummary {
  users: BrowserUser[];
  rooms: StoredRoom[];
  matches: StoredMatch[];
  stats: {
    userCount: number;
    roomCount: number;
    matchCount: number;
    finishedMatchCount: number;
  };
}

const clientIdKey = 'dice-arena-client-id';
const userKey = 'dice-arena-user';

function getClientId(): string {
  const existing = window.localStorage.getItem(clientIdKey);
  if (existing) {
    return existing;
  }
  const next = crypto.randomUUID();
  window.localStorage.setItem(clientIdKey, next);
  return next;
}

async function requestJson<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(path, {
    ...options,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      ...(options.headers ?? {}),
    },
  });

  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error ?? '请求失败');
  }
  return payload as T;
}

export function getStoredUser(): BrowserUser | null {
  const raw = window.localStorage.getItem(userKey);
  if (!raw) {
    return null;
  }
  try {
    return JSON.parse(raw) as BrowserUser;
  } catch {
    return null;
  }
}

export async function ensureBrowserUser(): Promise<BrowserUser> {
  const clientId = getClientId();
  const fallbackUser: BrowserUser = {
    id: `local_${clientId}`,
    clientId,
    nickname: getStoredUser()?.nickname ?? `玩家-${clientId.slice(-4).toUpperCase()}`,
  };

  try {
    const { user } = await requestJson<{ user: BrowserUser }>('/api/users/ensure', {
      method: 'POST',
      body: JSON.stringify({ clientId }),
    });
    window.localStorage.setItem(userKey, JSON.stringify(user));
    return user;
  } catch {
    window.localStorage.setItem(userKey, JSON.stringify(fallbackUser));
    return fallbackUser;
  }
}

export async function updateUserNickname(user: BrowserUser, nickname: string): Promise<BrowserUser> {
  const cleanNickname = nickname.trim().slice(0, 20);
  if (!cleanNickname) {
    throw new Error('昵称不能为空');
  }

  if (user.id.startsWith('local_')) {
    const nextUser = { ...user, nickname: cleanNickname };
    window.localStorage.setItem(userKey, JSON.stringify(nextUser));
    return nextUser;
  }

  const { user: nextUser } = await requestJson<{ user: BrowserUser }>(`/api/users/${user.id}`, {
    method: 'PATCH',
    body: JSON.stringify({ nickname: cleanNickname }),
  });
  window.localStorage.setItem(userKey, JSON.stringify(nextUser));
  return nextUser;
}

export async function createServerRoom(user: BrowserUser, hostName: string): Promise<StoredRoom> {
  const { room } = await requestJson<{ room: StoredRoom }>('/api/rooms', {
    method: 'POST',
    body: JSON.stringify({ hostUserId: user.id, hostName }),
  });
  return room;
}

export async function joinServerRoom(roomCode: string, user: BrowserUser): Promise<StoredRoom> {
  const { room } = await requestJson<{ room: StoredRoom }>(`/api/rooms/${roomCode}/join`, {
    method: 'POST',
    body: JSON.stringify({ userId: user.id, nickname: user.nickname }),
  });
  return room;
}

export async function getServerRoom(roomCode: string): Promise<StoredRoom> {
  const { room } = await requestJson<{ room: StoredRoom }>(`/api/rooms/${roomCode}`);
  return room;
}

export async function startServerMatch(
  roomCode: string,
  players: Array<PlayerConfigInput & { userId?: string | null }>,
): Promise<StoredMatch> {
  const { match } = await requestJson<{ match: StoredMatch }>('/api/matches/start', {
    method: 'POST',
    body: JSON.stringify({ roomCode, players }),
  });
  return match;
}

export async function markServerRoomStarted(roomCode: string, slots: Record<PlayerId, LobbySlot | null>, matchId: string) {
  await requestJson(`/api/rooms/${roomCode}/start`, {
    method: 'POST',
    body: JSON.stringify({ slots, matchId }),
  });
}

export async function finishServerMatch(
  matchId: string,
  winner: { id: PlayerId; name: string; userId?: string | null },
  turnNumber: number,
  players: Array<PlayerConfigInput & { userId?: string | null }>,
): Promise<void> {
  await requestJson(`/api/matches/${matchId}/end`, {
    method: 'POST',
    body: JSON.stringify({ winner, turnNumber, players }),
  });
}

export async function getAdminSummary(token?: string): Promise<AdminSummary> {
  const query = token ? `?token=${encodeURIComponent(token)}` : '';
  return requestJson<AdminSummary>(`/api/admin/summary${query}`);
}
