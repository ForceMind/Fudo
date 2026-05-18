import { useCallback, useEffect, useRef, useState } from 'react';
import {
  createServerRoom,
  ensureBrowserUser,
  getServerRoom,
  getSyncedMatchState,
  getWaitingRooms,
  joinServerRoom,
  requestServerRoomStart,
  setServerRoomReady,
  updateSyncedMatchState,
  updateUserNickname,
} from './api';
import type { BrowserUser, RoomSummary } from './api';
import { AdminScreen } from './components/AdminScreen';
import { ControlPanel } from './components/ControlPanel';
import { GameCanvas } from './components/GameCanvas';
import { LobbySlot, RoomLobby } from './components/RoomLobby';
import { RulesScreen } from './components/RulesScreen';
import { StartScreen } from './components/StartScreen';
import { PLAYER_CONFIGS, PLAYER_ORDER, TURN_TIMEOUT_MS } from './game/constants';
import { createInitialState, gameReducer } from './game/reducer';
import type { GameAction } from './game/reducer';
import { getCurrentPlayer } from './game/rules';
import type { GameState, PlayerConfigInput, PlayerId } from './game/types';

type AppView = 'home' | 'lobby' | 'rules' | 'game' | 'admin';
const sessionKey = 'fudo-active-session';
const isAdminEntry =
  window.location.pathname.replace(/\/+$/, '') === '/admin' || window.location.hostname.toLowerCase().startsWith('admin.');

interface SavedSession {
  roomCode: string;
  matchId?: string | null;
}

function readSavedSession(): SavedSession | null {
  const raw = window.localStorage.getItem(sessionKey);
  if (!raw) {
    return null;
  }
  try {
    const session = JSON.parse(raw) as SavedSession;
    return session.roomCode || session.matchId ? session : null;
  } catch {
    return null;
  }
}

function saveSession(session: SavedSession) {
  window.localStorage.setItem(sessionKey, JSON.stringify(session));
}

function clearSavedSession() {
  window.localStorage.removeItem(sessionKey);
}

function sanitizeSyncedGameState(gameState: GameState): GameState {
  const timestamp = Date.now();
  return {
    ...gameState,
    selectedPieceId: null,
    moveDraft: null,
    reachableCells: [],
    notice: null,
    startedAt: gameState.startedAt ?? timestamp,
    turnStartedAt: gameState.turnStartedAt ?? timestamp,
  };
}

function moveAnimationKey(gameState: GameState): string {
  const move = gameState.lastMove;
  if (!move) {
    return '';
  }

  return [
    move.id,
    move.playerId,
    move.pieceId,
    `${move.from.x},${move.from.y}`,
    `${move.final.x},${move.final.y}`,
    move.path.map((coord) => `${coord.x},${coord.y}`).join('|'),
    move.capturedPieceIds.join('|'),
  ].join('/');
}

function prepareSyncedGameState(
  gameState: GameState,
  previousState: GameState,
  localPlayerId?: PlayerId | null,
): GameState {
  const sanitized = sanitizeSyncedGameState(gameState);
  if (!sanitized.lastMove || sanitized.lastMove.playerId === localPlayerId) {
    return sanitized;
  }

  if (moveAnimationKey(sanitized) === moveAnimationKey(previousState)) {
    return {
      ...sanitized,
      lastMove: previousState.lastMove,
    };
  }

  return {
    ...sanitized,
    lastMove: {
      ...sanitized.lastMove,
      timestamp: Date.now(),
    },
  };
}

function createEmptySlots(): Record<PlayerId, LobbySlot | null> {
  return {
    red: null,
    blue: null,
    green: null,
    yellow: null,
  };
}

function generateRoomCode(): string {
  return Math.random().toString(36).slice(2, 8).toUpperCase();
}

function normalizeName(name: string, fallback: string): string {
  return name.trim() || fallback;
}

function buildGamePlayers(slots: Record<PlayerId, LobbySlot | null>): Array<PlayerConfigInput & { userId?: string | null }> {
  return PLAYER_ORDER.map((playerId) => {
    const slot = slots[playerId];
    if (slot) {
      return {
        id: playerId,
        name: slot.name,
        isHuman: true,
        userId: slot.userId ?? null,
      };
    }

    return {
      id: playerId,
      name: `${PLAYER_CONFIGS[playerId].name} AI`,
      isHuman: false,
    };
  });
}

function findLocalSlot(slots: Record<PlayerId, LobbySlot | null>, userId?: string | null): LobbySlot | null {
  if (!userId) {
    return null;
  }
  return PLAYER_ORDER.map((playerId) => slots[playerId]).find((slot) => slot?.userId === userId) ?? null;
}

function App() {
  const [view, setView] = useState<AppView>(isAdminEntry ? 'admin' : 'home');
  const [returnView, setReturnView] = useState<AppView>('home');
  const [roomCode, setRoomCode] = useState('');
  const [hostName, setHostName] = useState('房主');
  const [joinCode, setJoinCode] = useState('');
  const [message, setMessage] = useState('');
  const [rooms, setRooms] = useState<RoomSummary[]>([]);
  const [roomsLoading, setRoomsLoading] = useState(false);
  const [browserUser, setBrowserUser] = useState<BrowserUser | null>(null);
  const [nicknameDraft, setNicknameDraft] = useState('');
  const [slots, setSlots] = useState<Record<PlayerId, LobbySlot | null>>(createEmptySlots);
  const [startRequested, setStartRequested] = useState(false);
  const [gamePlayers, setGamePlayers] = useState<Array<PlayerConfigInput & { userId?: string | null }>>(
    buildGamePlayers(createEmptySlots()),
  );
  const [matchId, setMatchId] = useState<string | null>(null);
  const [matchVersion, setMatchVersion] = useState(0);
  const [state, setState] = useState<GameState>(() => createInitialState());
  const [dismissedVictoryKey, setDismissedVictoryKey] = useState<string | null>(null);

  const stateRef = useRef(state);
  const slotsRef = useRef(slots);
  const matchIdRef = useRef(matchId);
  const matchVersionRef = useRef(matchVersion);
  const browserUserRef = useRef(browserUser);
  const syncInFlightRef = useRef(false);
  const queuedStateRef = useRef<GameState | null>(null);

  const currentPlayer = getCurrentPlayer(state);
  const winner = state.winnerId ? state.players.find((player) => player.id === state.winnerId) : null;
  const victoryKey = winner ? `${matchId ?? 'local'}:${state.startedAt}:${winner.id}` : null;
  const showVictoryDialog = Boolean(winner && victoryKey && dismissedVictoryKey !== victoryKey);
  const visibleNotice =
    state.notice && state.globalNotice
      ? state.notice.id >= state.globalNotice.id
        ? state.notice
        : state.globalNotice
      : state.notice ?? state.globalNotice;
  const localSlot = findLocalSlot(slots, browserUser?.id);
  const localPlayerId = localSlot?.id ?? null;
  const isSyncedGame = Boolean(matchId);
  const canControlCurrentTurn =
    !state.winnerId &&
    (!isSyncedGame
      ? currentPlayer.isHuman
      : currentPlayer.isHuman
        ? currentPlayer.id === localPlayerId
        : false);

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  useEffect(() => {
    slotsRef.current = slots;
  }, [slots]);

  useEffect(() => {
    matchIdRef.current = matchId;
  }, [matchId]);

  useEffect(() => {
    matchVersionRef.current = matchVersion;
  }, [matchVersion]);

  useEffect(() => {
    browserUserRef.current = browserUser;
  }, [browserUser]);

  const hydrateGameState = useCallback((nextState: GameState, version = matchVersionRef.current) => {
    stateRef.current = nextState;
    matchVersionRef.current = version;
    setState(nextState);
    setMatchVersion(version);
  }, []);

  const getLocalPlayerId = useCallback((): PlayerId | null => {
    return findLocalSlot(slotsRef.current, browserUserRef.current?.id)?.id ?? null;
  }, []);

  const hydrateSyncedGameState = useCallback(
    (nextState: GameState, version = matchVersionRef.current) => {
      hydrateGameState(prepareSyncedGameState(nextState, stateRef.current, getLocalPlayerId()), version);
    },
    [getLocalPlayerId, hydrateGameState],
  );

  const loadMatchState = useCallback(
    async (nextMatchId: string, enterGame = false) => {
      const match = await getSyncedMatchState(nextMatchId, browserUserRef.current);
      if (match.status === 'finished' && !match.winner && !match.gameState?.winnerId) {
        clearSavedSession();
        setMatchId(null);
        matchIdRef.current = null;
        setMessage('房间已被后台解散，对局已结束。');
        setView('home');
        return;
      }
      if (!match.gameState) {
        setMessage('对局状态还没有准备好。');
        return;
      }

      setMatchId(match.id);
      matchIdRef.current = match.id;
      if (match.roomCode ?? roomCode) {
        saveSession({ roomCode: match.roomCode ?? roomCode, matchId: match.id });
      }
      hydrateSyncedGameState(match.gameState, match.stateVersion);
      if (enterGame) {
        setMessage('');
        setView('game');
      }
    },
    [hydrateSyncedGameState],
  );

  const flushQueuedGameState = useCallback(
    async () => {
      if (syncInFlightRef.current) {
        return;
      }

      const activeMatchId = matchIdRef.current;
      const activeUser = browserUserRef.current;
      const queuedState = queuedStateRef.current;
      if (!activeMatchId || !activeUser || !queuedState) {
        return;
      }

      queuedStateRef.current = null;
      syncInFlightRef.current = true;
      try {
        const match = await updateSyncedMatchState(activeMatchId, activeUser, matchVersionRef.current, queuedState);
        if (match.gameState) {
          matchVersionRef.current = match.stateVersion;
          setMatchVersion(match.stateVersion);
          if (!queuedStateRef.current) {
            hydrateSyncedGameState(match.gameState, match.stateVersion);
          }
        }
      } catch (error) {
        setMessage(error instanceof Error ? error.message : '同步对局失败。');
        queuedStateRef.current = null;
        try {
          await loadMatchState(activeMatchId);
        } catch {
          // Keep the optimistic state visible until the next successful poll.
        }
      } finally {
        syncInFlightRef.current = false;
        if (queuedStateRef.current) {
          void flushQueuedGameState();
        }
      }
    },
    [hydrateSyncedGameState, loadMatchState],
  );

  const pushGameState = useCallback(
    (nextState: GameState) => {
      queuedStateRef.current = sanitizeSyncedGameState(nextState);
      void flushQueuedGameState();
    },
    [flushQueuedGameState],
  );

  const applyGameAction = useCallback(
    (action: GameAction, sync = true) => {
      const nextState = gameReducer(stateRef.current, action);
      if (nextState === stateRef.current) {
        return;
      }

      hydrateGameState(nextState);
      const shouldSync =
        sync &&
        matchIdRef.current &&
        (action.type === 'ROLL_DICE' ||
          action.type === 'FINISH_BATTLE' ||
          action.type === 'AI_TURN' ||
          (action.type === 'MOVE_TO' && nextState.stage !== 'Move'));

      if (shouldSync) {
        void pushGameState(nextState);
      }
    },
    [hydrateGameState, pushGameState],
  );

  const restoreSavedSession = useCallback(
    async (user: BrowserUser) => {
      if (isAdminEntry) {
        return;
      }

      const savedSession = readSavedSession();
      if (!savedSession?.roomCode) {
        return;
      }

      try {
        const room = await getServerRoom(savedSession.roomCode, user);
        const restoredSlot = findLocalSlot(room.slots, user.id);
        if (!restoredSlot) {
          clearSavedSession();
          return;
        }
        if (room.status === 'finished') {
          clearSavedSession();
          setMessage('房间已结束或已被解散。');
          setView('home');
          return;
        }

        setRoomCode(room.code);
        setJoinCode(room.code);
        setSlots(room.slots);
        setStartRequested(Boolean(room.startRequested));
        if (room.status === 'active' && (room.matchId || savedSession.matchId)) {
          await loadMatchState(room.matchId ?? savedSession.matchId!, true);
          return;
        }

        setMessage(`已回到房间 ${room.code}。`);
        setView('lobby');
      } catch {
        clearSavedSession();
      }
    },
    [loadMatchState],
  );

  useEffect(() => {
    void ensureBrowserUser().then((user) => {
      browserUserRef.current = user;
      setBrowserUser(user);
      setNicknameDraft(user.nickname);
      setHostName(user.nickname);
      void restoreSavedSession(user);
    });
  }, [restoreSavedSession]);

  const refreshRooms = async (showLoading = false) => {
    if (showLoading) {
      setRoomsLoading(true);
    }
    try {
      const nextRooms = await getWaitingRooms();
      setRooms(nextRooms);
    } catch {
      setRooms([]);
    } finally {
      if (showLoading) {
        setRoomsLoading(false);
      }
    }
  };

  useEffect(() => {
    if (view !== 'home') {
      return;
    }

    void refreshRooms(true);
    const timer = window.setInterval(() => {
      void refreshRooms(false);
    }, 3500);

    return () => window.clearInterval(timer);
  }, [view]);

  useEffect(() => {
    if (view !== 'lobby' || !roomCode) {
      return;
    }

    const syncRoom = () => {
      void getServerRoom(roomCode, browserUserRef.current)
        .then((room) => {
          if (room.status === 'finished') {
            clearSavedSession();
            setSlots(createEmptySlots());
            setStartRequested(false);
            setView('home');
            setMessage('房间已被后台解散。');
            return;
          }
          setSlots(room.slots);
          setStartRequested(Boolean(room.startRequested));
          if (room.status === 'active' && room.matchId) {
            void loadMatchState(room.matchId, true);
          }
        })
        .catch(() => undefined);
    };

    syncRoom();
    const timer = window.setInterval(syncRoom, 1500);

    return () => window.clearInterval(timer);
  }, [loadMatchState, roomCode, view]);

  useEffect(() => {
    if (view !== 'game' || !matchId) {
      return;
    }

    const timer = window.setInterval(() => {
      void getSyncedMatchState(matchId, browserUserRef.current)
        .then((match) => {
          if (match.status === 'finished' && !match.winner && !match.gameState?.winnerId) {
            clearSavedSession();
            setMatchId(null);
            matchIdRef.current = null;
            setView('home');
            setMessage('房间已被后台解散，对局已结束。');
            return;
          }
          if (
            match.gameState &&
            match.stateVersion > matchVersionRef.current &&
            !syncInFlightRef.current &&
            !queuedStateRef.current
          ) {
            hydrateSyncedGameState(match.gameState, match.stateVersion);
          }
        })
        .catch(() => undefined);
    }, 800);

    return () => window.clearInterval(timer);
  }, [hydrateSyncedGameState, matchId, view]);

  useEffect(() => {
    if (
      view !== 'game' ||
      isSyncedGame ||
      state.stage !== 'Roll' ||
      currentPlayer.isHuman ||
      state.winnerId
    ) {
      return;
    }

    const timer = window.setTimeout(() => applyGameAction({ type: 'AI_TURN' }), 650);
    return () => window.clearTimeout(timer);
  }, [
    applyGameAction,
    currentPlayer.isHuman,
    isSyncedGame,
    state.currentPlayerIndex,
    state.lastMove?.id,
    state.stage,
    state.turnNumber,
    state.winnerId,
    view,
  ]);

  useEffect(() => {
    const canFinishBattle = isSyncedGame ? canControlCurrentTurn : canControlCurrentTurn || !currentPlayer.isHuman;
    if (view !== 'game' || state.stage !== 'Battle' || state.winnerId || !canFinishBattle) {
      return;
    }

    const timer = window.setTimeout(() => applyGameAction({ type: 'FINISH_BATTLE' }), 850);
    return () => window.clearTimeout(timer);
  }, [
    applyGameAction,
    canControlCurrentTurn,
    currentPlayer.isHuman,
    isSyncedGame,
    state.lastMove?.id,
    state.stage,
    state.winnerId,
    view,
  ]);

  useEffect(() => {
    if (
      view !== 'game' ||
      isSyncedGame ||
      state.winnerId ||
      !currentPlayer.isHuman ||
      state.stage === 'End' ||
      state.stage === 'Battle'
    ) {
      return;
    }

    const elapsed = Date.now() - (state.turnStartedAt ?? Date.now());
    const delay = Math.max(0, TURN_TIMEOUT_MS - elapsed);
    const timer = window.setTimeout(() => applyGameAction({ type: 'TIMEOUT_AI_TURN' }), delay);
    return () => window.clearTimeout(timer);
  }, [
    applyGameAction,
    currentPlayer.id,
    currentPlayer.isHuman,
    isSyncedGame,
    state.currentPlayerIndex,
    state.lastMove?.id,
    state.stage,
    state.turnStartedAt,
    state.winnerId,
    view,
  ]);

  const openRules = () => {
    setReturnView(view === 'rules' ? 'home' : view);
    setView('rules');
    setMessage('');
  };

  const saveNickname = async () => {
    if (!browserUser) {
      return;
    }
    try {
      const nextUser = await updateUserNickname(browserUser, nicknameDraft);
      setBrowserUser(nextUser);
      setNicknameDraft(nextUser.nickname);
      setHostName(nextUser.nickname);
      setMessage('昵称已保存。');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '昵称保存失败。');
    }
  };

  const createRoom = async () => {
    const cleanHostName = normalizeName(hostName, '房主');
    const localRoomCode = generateRoomCode();
    const fallbackSlots: Record<PlayerId, LobbySlot | null> = {
      ...createEmptySlots(),
      red: {
        id: 'red',
        name: cleanHostName,
        isHuman: true,
        isHost: true,
        userId: browserUser?.id ?? null,
        ready: false,
      },
    };

    try {
      const room = browserUser ? await createServerRoom(browserUser, cleanHostName) : null;
      setRoomCode(room?.code ?? localRoomCode);
      setJoinCode(room?.code ?? localRoomCode);
      setSlots(room?.slots ?? fallbackSlots);
      setStartRequested(Boolean(room?.startRequested));
      saveSession({ roomCode: room?.code ?? localRoomCode, matchId: null });
      setMessage(`房间 ${room?.code ?? localRoomCode} 已创建，等待其他玩家加入。`);
    } catch {
      setRoomCode(localRoomCode);
      setJoinCode(localRoomCode);
      setSlots(fallbackSlots);
      setStartRequested(false);
      saveSession({ roomCode: localRoomCode, matchId: null });
      setMessage(`离线房间 ${localRoomCode} 已创建。生产服务启动后会自动记录房间。`);
    }
    setView('lobby');
  };

  const joinRoom = async (roomCodeOverride?: string) => {
    const code = (roomCodeOverride ?? joinCode).trim().toUpperCase();
    if (!code) {
      setMessage('请输入房间号。');
      return;
    }

    if (!browserUser) {
      setMessage('正在创建用户，请稍后再试。');
      return;
    }

    try {
      const room = await joinServerRoom(code, browserUser);
      setRoomCode(room.code);
      setJoinCode(room.code);
      setSlots(room.slots);
      setStartRequested(Boolean(room.startRequested));
      saveSession({ roomCode: room.code, matchId: room.matchId ?? null });
      setMessage(`${browserUser.nickname} 已加入房间 ${room.code}。`);
      setView('lobby');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '加入房间失败。');
    }
  };

  const toggleReady = async () => {
    if (!browserUser || !roomCode || !localSlot || localSlot.isHost) {
      return;
    }

    try {
      const room = await setServerRoomReady(roomCode, browserUser, !localSlot.ready);
      setSlots(room.slots);
      setStartRequested(Boolean(room.startRequested));
      setMessage(!localSlot.ready ? '已准备。' : '已取消准备。');
      if (room.status === 'active' && room.matchId) {
        await loadMatchState(room.matchId, true);
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '准备状态更新失败。');
    }
  };

  const startGame = async () => {
    const players = buildGamePlayers(slots);
    const initialState = createInitialState(players);
    setGamePlayers(players);

    if (browserUser && roomCode) {
      try {
        const { room, match } = await requestServerRoomStart(roomCode, browserUser, players, initialState);
        setSlots(room.slots);
        setStartRequested(Boolean(room.startRequested));
        if (match?.id) {
          saveSession({ roomCode, matchId: match.id });
          await loadMatchState(match.id, true);
        } else {
          setMessage('已请求开始，等待真人玩家准备。');
        }
        return;
      } catch (error) {
        setMessage(error instanceof Error ? error.message : '开始游戏失败。');
        return;
      }
    }

    setMatchId(null);
    matchIdRef.current = null;
    clearSavedSession();
    hydrateGameState(initialState, 0);
    setMessage('');
    setView('game');
  };

  const restartGame = () => {
    if (isSyncedGame) {
      return;
    }
    hydrateGameState(createInitialState(gamePlayers), 0);
  };

  const closeVictoryDialog = () => {
    if (victoryKey) {
      setDismissedVictoryKey(victoryKey);
    }
  };

  const exitGame = () => {
    if (!window.confirm('退出当前游戏？退出后刷新不会自动回到这局游戏。')) {
      return;
    }

    clearSavedSession();
    queuedStateRef.current = null;
    setMatchId(null);
    matchIdRef.current = null;
    setMatchVersion(0);
    matchVersionRef.current = 0;
    setView('home');
    setMessage('已退出当前游戏。');
  };

  const headerChip =
    view === 'game' && roomCode ? `房间 ${roomCode}` : view === 'lobby' ? '房间大厅' : view === 'admin' ? '后台管理' : '生产版';

  return (
    <div className="app-shell">
      <header className="app-header">
        <div>
          <p className="eyebrow">2D Ludo Battle / 多人同步 / Canvas 棋盘</p>
          <h1>Fudo</h1>
        </div>
        <div className="header-actions">
          <input
            className="nickname-input"
            value={nicknameDraft}
            maxLength={20}
            onChange={(event) => setNicknameDraft(event.target.value)}
            placeholder="昵称"
          />
          <button className="secondary-button header-button" type="button" onClick={() => void saveNickname()}>
            保存昵称
          </button>
          {view === 'game' && (
            <>
              <button className="secondary-button header-button" type="button" onClick={exitGame}>
                退出游戏
              </button>
              <button className="secondary-button header-button" type="button" onClick={openRules}>
                规则
              </button>
            </>
          )}
          <div className="header-chip">{headerChip}</div>
        </div>
      </header>

      {view === 'home' && (
        <StartScreen
          hostName={hostName}
          joinCode={joinCode}
          message={message}
          rooms={rooms}
          roomsLoading={roomsLoading}
          onHostNameChange={setHostName}
          onJoinCodeChange={setJoinCode}
          onCreateRoom={() => void createRoom()}
          onJoinRoom={() => void joinRoom()}
          onJoinListedRoom={(code) => void joinRoom(code)}
          onRefreshRooms={() => void refreshRooms(true)}
          onOpenRules={openRules}
        />
      )}

      {view === 'lobby' && (
        <RoomLobby
          roomCode={roomCode}
          slots={slots}
          message={message}
          localUserId={browserUser?.id ?? null}
          startRequested={startRequested}
          onToggleReady={() => void toggleReady()}
          onStartGame={() => void startGame()}
          onBackHome={() => {
            setView('home');
            setMessage(roomCode ? `当前房间号：${roomCode}` : '');
          }}
          onOpenRules={openRules}
        />
      )}

      {view === 'rules' && <RulesScreen onBack={() => setView(returnView)} />}

      {view === 'admin' && (
        <AdminScreen
          onBack={() => {
            window.history.pushState(null, '', '/');
            setView('home');
          }}
        />
      )}

      {view === 'game' && (
        <main className="game-layout">
          <GameCanvas
            state={state}
            canInteract={canControlCurrentTurn}
            onPieceClick={(pieceId) => applyGameAction({ type: 'SELECT_PIECE', pieceId })}
            onCellClick={(coord) => applyGameAction({ type: 'MOVE_TO', coord })}
          />
          <ControlPanel
            state={state}
            canAct={canControlCurrentTurn}
            canRestart={!isSyncedGame}
            onRoll={() => applyGameAction({ type: 'ROLL_DICE' })}
            onRestart={restartGame}
          />
        </main>
      )}

      {view === 'game' && visibleNotice && (
        <div key={`${visibleNotice.id}-${visibleNotice.text}`} className={`center-notice ${visibleNotice.tone}`}>
          {visibleNotice.text}
        </div>
      )}

      {view === 'game' && winner && showVictoryDialog && (
        <div className="victory-overlay" role="dialog" aria-modal="true">
          <div className="victory-dialog">
            <span className="player-dot huge" style={{ background: winner.color }} />
            <h2>{winner.name}获胜</h2>
            <p>4 枚棋子全部回家。</p>
            <button className="primary-button" type="button" onClick={isSyncedGame ? closeVictoryDialog : restartGame}>
              {isSyncedGame ? '关闭' : '再来一局'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
