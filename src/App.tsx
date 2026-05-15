import { useEffect, useReducer, useState } from 'react';
import {
  BrowserUser,
  createServerRoom,
  ensureBrowserUser,
  finishServerMatch,
  getServerRoom,
  joinServerRoom,
  markServerRoomStarted,
  startServerMatch,
  updateUserNickname,
} from './api';
import { AdminScreen } from './components/AdminScreen';
import { ControlPanel } from './components/ControlPanel';
import { GameCanvas } from './components/GameCanvas';
import { LobbySlot, RoomLobby } from './components/RoomLobby';
import { RulesScreen } from './components/RulesScreen';
import { StartScreen } from './components/StartScreen';
import { PLAYER_CONFIGS, PLAYER_ORDER } from './game/constants';
import { createInitialState, gameReducer } from './game/reducer';
import { getCurrentPlayer } from './game/rules';
import type { PlayerConfigInput, PlayerId } from './game/types';

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

function App() {
  const [view, setView] = useState<AppView>('home');
  const [returnView, setReturnView] = useState<AppView>('home');
  const [roomCode, setRoomCode] = useState('');
  const [hostName, setHostName] = useState('房主');
  const [joinName, setJoinName] = useState('玩家 2');
  const [joinCode, setJoinCode] = useState('');
  const [message, setMessage] = useState('');
  const [browserUser, setBrowserUser] = useState<BrowserUser | null>(null);
  const [nicknameDraft, setNicknameDraft] = useState('');
  const [slots, setSlots] = useState<Record<PlayerId, LobbySlot | null>>(createEmptySlots);
  const [gamePlayers, setGamePlayers] = useState<Array<PlayerConfigInput & { userId?: string | null }>>(
    buildGamePlayers(createEmptySlots()),
  );
  const [matchId, setMatchId] = useState<string | null>(null);
  const [reportedMatchId, setReportedMatchId] = useState<string | null>(null);
  const [state, dispatch] = useReducer(gameReducer, undefined, createInitialState);
  const currentPlayer = getCurrentPlayer(state);
  const winner = state.winnerId ? state.players.find((player) => player.id === state.winnerId) : null;

  useEffect(() => {
    void ensureBrowserUser().then((user) => {
      setBrowserUser(user);
      setNicknameDraft(user.nickname);
      setHostName(user.nickname);
    });
  }, []);

  useEffect(() => {
    if (view !== 'lobby' || !roomCode) {
      return;
    }

    const timer = window.setInterval(() => {
      void getServerRoom(roomCode)
        .then((room) => {
          setSlots(room.slots);
          if (room.status === 'active' && room.matchId) {
            setMatchId(room.matchId);
          }
        })
        .catch(() => undefined);
    }, 2500);

    return () => window.clearInterval(timer);
  }, [roomCode, view]);

  useEffect(() => {
    if (view !== 'game' || state.stage !== 'Roll' || currentPlayer.isHuman || state.winnerId) {
      return;
    }

    const timer = window.setTimeout(() => dispatch({ type: 'AI_TURN' }), 650);
    return () => window.clearTimeout(timer);
  }, [currentPlayer.isHuman, state.currentPlayerIndex, state.stage, state.turnNumber, state.winnerId, view]);

  useEffect(() => {
    if (view !== 'game' || state.stage !== 'Battle' || state.winnerId) {
      return;
    }

    const timer = window.setTimeout(() => dispatch({ type: 'FINISH_BATTLE' }), 850);
    return () => window.clearTimeout(timer);
  }, [state.lastMove?.id, state.stage, state.winnerId, view]);

  useEffect(() => {
    if (view !== 'game' || !winner || !matchId || reportedMatchId === matchId) {
      return;
    }

    const winnerConfig = gamePlayers.find((player) => player.id === winner.id);
    setReportedMatchId(matchId);
    void finishServerMatch(
      matchId,
      {
        id: winner.id,
        name: winner.name,
        userId: winnerConfig?.userId ?? null,
      },
      state.turnNumber,
      gamePlayers,
    ).catch(() => undefined);
  }, [gamePlayers, matchId, reportedMatchId, state.turnNumber, view, winner]);

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
      },
    };

    try {
      const room = browserUser ? await createServerRoom(browserUser, cleanHostName) : null;
      setRoomCode(room?.code ?? localRoomCode);
      setJoinCode(room?.code ?? localRoomCode);
      setSlots(room?.slots ?? fallbackSlots);
      setMessage(`房间 ${room?.code ?? localRoomCode} 已创建，等待其他玩家加入。`);
    } catch {
      setRoomCode(localRoomCode);
      setJoinCode(localRoomCode);
      setSlots(fallbackSlots);
      setMessage(`离线房间 ${localRoomCode} 已创建。生产服务启动后会自动记录房间。`);
    }
    setView('lobby');
  };

  const addPlayerToRoom = (name: string): boolean => {
    const nextPlayerId = PLAYER_ORDER.find((playerId) => !slots[playerId]);
    if (!nextPlayerId) {
      setMessage('房间已满。');
      return false;
    }

    const humanCount = PLAYER_ORDER.filter((playerId) => slots[playerId]?.isHuman).length;
    const cleanName = normalizeName(name, `玩家 ${humanCount + 1}`);
    setSlots((currentSlots) => ({
      ...currentSlots,
      [nextPlayerId]: {
        id: nextPlayerId,
        name: cleanName,
        isHuman: true,
        isHost: false,
        userId: null,
      },
    }));
    setJoinName(`玩家 ${humanCount + 2}`);
    setMessage(`${cleanName} 已加入 ${PLAYER_CONFIGS[nextPlayerId].name}。`);
    return true;
  };

  const joinRoom = async () => {
    const code = joinCode.trim().toUpperCase();
    if (!code) {
      setMessage('请输入房间号。');
      return;
    }

    if (browserUser) {
      try {
        const room = await joinServerRoom(code, browserUser);
        setRoomCode(room.code);
        setSlots(room.slots);
        setMessage(`${browserUser.nickname} 已加入房间 ${room.code}。`);
        setView('lobby');
        return;
      } catch (error) {
        setMessage(error instanceof Error ? error.message : '加入房间失败。');
        return;
      }
    }

    if (!roomCode || code !== roomCode) {
      setMessage('本地 MVP 需要先在当前页面创建房间，并输入当前房间号。');
      return;
    }

    if (addPlayerToRoom(joinName)) {
      setView('lobby');
    }
  };

  const removePlayer = (playerId: PlayerId) => {
    const slot = slots[playerId];
    if (!slot || slot.isHost) {
      return;
    }

    setSlots((currentSlots) => ({
      ...currentSlots,
      [playerId]: null,
    }));
    setMessage(`${slot.name} 已离开房间。`);
  };

  const startGame = async () => {
    const players = buildGamePlayers(slots);
    setGamePlayers(players);
    setReportedMatchId(null);
    try {
      const match = await startServerMatch(roomCode, players);
      setMatchId(match.id);
      if (roomCode) {
        await markServerRoomStarted(roomCode, slots, match.id);
      }
    } catch {
      setMatchId(null);
    }
    dispatch({ type: 'RESTART', players });
    setMessage('');
    setView('game');
  };

  const restartGame = () => {
    dispatch({ type: 'RESTART', players: gamePlayers });
  };

  const headerChip =
    view === 'game' && roomCode ? `房间 ${roomCode}` : view === 'lobby' ? '房间大厅' : view === 'admin' ? '后台管理' : '生产版';

  return (
    <div className="app-shell">
      <header className="app-header">
        <div>
          <p className="eyebrow">2D Ludo Battle / 本地房间 / Canvas 棋盘</p>
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
          joinName={joinName}
          message={message}
          onHostNameChange={setHostName}
          onJoinCodeChange={setJoinCode}
          onJoinNameChange={setJoinName}
          onCreateRoom={() => void createRoom()}
          onJoinRoom={() => void joinRoom()}
          onOpenRules={openRules}
        />
      )}

      {view === 'lobby' && (
        <RoomLobby
          roomCode={roomCode}
          slots={slots}
          joinName={joinName}
          message={message}
          onJoinNameChange={setJoinName}
          onAddPlayer={() => addPlayerToRoom(joinName)}
          onRemovePlayer={removePlayer}
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
            onPieceClick={(pieceId) => dispatch({ type: 'SELECT_PIECE', pieceId })}
            onCellClick={(coord) => dispatch({ type: 'MOVE_TO', coord })}
          />
          <ControlPanel state={state} onRoll={() => dispatch({ type: 'ROLL_DICE' })} onRestart={restartGame} />
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
            <button className="primary-button" type="button" onClick={restartGame}>
              再来一局
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
