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
import { PLAYER_CONFIGS, PLAYER_ORDER } from './game/constants';
import { createInitialState, gameReducer } from './game/reducer';
import type { GameAction } from './game/reducer';
import { getCurrentPlayer } from './game/rules';
import type { GameState, PlayerConfigInput, PlayerId } from './game/types';

type AppView = 'home' | 'lobby' | 'rules' | 'game' | 'admin';

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
  const [view, setView] = useState<AppView>('home');
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

  const stateRef = useRef(state);
  const matchIdRef = useRef(matchId);
  const matchVersionRef = useRef(matchVersion);
  const browserUserRef = useRef(browserUser);
  const syncInFlightRef = useRef(false);
  const queuedStateRef = useRef<GameState | null>(null);

  const currentPlayer = getCurrentPlayer(state);
  const winner = state.winnerId ? state.players.find((player) => player.id === state.winnerId) : null;
  const localSlot = findLocalSlot(slots, browserUser?.id);
  const localPlayerId = localSlot?.id ?? null;
  const isRoomHost = Boolean(localSlot?.isHost);
  const isSyncedGame = Boolean(matchId);
  const canControlCurrentTurn =
    !state.winnerId &&
    (!isSyncedGame
      ? currentPlayer.isHuman
      : currentPlayer.isHuman
        ? currentPlayer.id === localPlayerId
        : isRoomHost);

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

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

  const loadMatchState = useCallback(
    async (nextMatchId: string, enterGame = false) => {
      const match = await getSyncedMatchState(nextMatchId);
      if (!match.gameState) {
        setMessage('对局状态还没有准备好。');
        return;
      }

      setMatchId(match.id);
      matchIdRef.current = match.id;
      hydrateGameState(match.gameState, match.stateVersion);
      if (enterGame) {
        setMessage('');
        setView('game');
      }
    },
    [hydrateGameState],
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
            hydrateGameState(match.gameState, match.stateVersion);
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
    [hydrateGameState, loadMatchState],
  );

  const pushGameState = useCallback(
    (nextState: GameState) => {
      queuedStateRef.current = nextState;
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
      if (sync) {
        void pushGameState(nextState);
      }
    },
    [hydrateGameState, pushGameState],
  );

  useEffect(() => {
    void ensureBrowserUser().then((user) => {
      setBrowserUser(user);
      setNicknameDraft(user.nickname);
      setHostName(user.nickname);
    });
  }, []);

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
      void getServerRoom(roomCode)
        .then((room) => {
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
      void getSyncedMatchState(matchId)
        .then((match) => {
          if (
            match.gameState &&
            match.stateVersion > matchVersionRef.current &&
            !syncInFlightRef.current &&
            !queuedStateRef.current
          ) {
            hydrateGameState(match.gameState, match.stateVersion);
          }
        })
        .catch(() => undefined);
    }, 800);

    return () => window.clearInterval(timer);
  }, [hydrateGameState, matchId, view]);

  useEffect(() => {
    if (view !== 'game' || state.stage !== 'Roll' || currentPlayer.isHuman || state.winnerId || !canControlCurrentTurn) {
      return;
    }

    const timer = window.setTimeout(() => applyGameAction({ type: 'AI_TURN' }), 650);
    return () => window.clearTimeout(timer);
  }, [
    applyGameAction,
    canControlCurrentTurn,
    currentPlayer.isHuman,
    state.currentPlayerIndex,
    state.stage,
    state.turnNumber,
    state.winnerId,
    view,
  ]);

  useEffect(() => {
    if (view !== 'game' || state.stage !== 'Battle' || state.winnerId || !canControlCurrentTurn) {
      return;
    }

    const timer = window.setTimeout(() => applyGameAction({ type: 'FINISH_BATTLE' }), 850);
    return () => window.clearTimeout(timer);
  }, [applyGameAction, canControlCurrentTurn, state.lastMove?.id, state.stage, state.winnerId, view]);

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
      setMessage(`房间 ${room?.code ?? localRoomCode} 已创建，等待其他玩家加入。`);
    } catch {
      setRoomCode(localRoomCode);
      setJoinCode(localRoomCode);
      setSlots(fallbackSlots);
      setStartRequested(false);
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
          {view !== 'admin' && (
            <button className="secondary-button header-button" type="button" onClick={() => setView('admin')}>
              后台
            </button>
          )}
          {view === 'game' && (
            <>
              <button className="secondary-button header-button" type="button" onClick={() => setView('lobby')}>
                大厅
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

      {view === 'admin' && <AdminScreen onBack={() => setView('home')} />}

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

      {view === 'game' && state.notice && (
        <div key={state.notice.id} className={`center-notice ${state.notice.tone}`}>
          {state.notice.text}
        </div>
      )}

      {view === 'game' && winner && (
        <div className="victory-overlay" role="dialog" aria-modal="true">
          <div className="victory-dialog">
            <span className="player-dot huge" style={{ background: winner.color }} />
            <h2>{winner.name}获胜</h2>
            <p>4 枚棋子全部回家。</p>
            <button className="primary-button" type="button" onClick={restartGame} disabled={isSyncedGame}>
              {isSyncedGame ? '对局已同步结束' : '再来一局'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
