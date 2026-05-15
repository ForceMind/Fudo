import { useEffect, useState } from 'react';
import { PIECES_PER_PLAYER, STAGE_LABELS, TILE_LABELS, TURN_TIMEOUT_MS } from '../game/constants';
import {
  getActiveCount,
  getCurrentPlayer,
  getHomeCount,
  getPieceById,
  getSelectablePieceIds,
} from '../game/rules';
import type { GameState, Player } from '../game/types';
import { GameLog } from './GameLog';

interface ControlPanelProps {
  state: GameState;
  canAct: boolean;
  canRestart: boolean;
  onRoll: () => void;
  onRestart: () => void;
}

const LEGEND_ITEMS = [
  { key: 'empty', label: TILE_LABELS.empty },
  { key: 'spawn', label: TILE_LABELS.spawn },
  { key: 'goal', label: TILE_LABELS.goal },
  { key: 'home-band', label: '家门区' },
  { key: 'center', label: TILE_LABELS.center },
  { key: 'safe', label: TILE_LABELS.safe },
  { key: 'boost', label: TILE_LABELS.boost },
  { key: 'trap', label: TILE_LABELS.trap },
  { key: 'portal', label: TILE_LABELS.portal },
  { key: 'obstacle', label: TILE_LABELS.obstacle },
] as const;

function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

function PlayerRow({ player, state }: { player: Player; state: GameState }) {
  const home = getHomeCount(state, player.id);
  const active = getActiveCount(state, player.id);
  const isCurrent = getCurrentPlayer(state).id === player.id;

  return (
    <div className={`player-row ${isCurrent ? 'active' : ''}`}>
      <div className="player-name">
        <span className="player-dot" style={{ background: player.color }} />
        <span>{player.name}</span>
        {!player.isHuman && <span className="ai-tag">AI</span>}
      </div>
      <div className="player-stats">
        <span>场上 {active}</span>
        <span>回家 {home}/{PIECES_PER_PLAYER}</span>
        {player.pendingMoveDelta !== 0 && (
          <span className={player.pendingMoveDelta > 0 ? 'delta good' : 'delta bad'}>
            下回合 {player.pendingMoveDelta > 0 ? '+' : ''}
            {player.pendingMoveDelta}
          </span>
        )}
      </div>
    </div>
  );
}

export function ControlPanel({ state, canAct, canRestart, onRoll, onRestart }: ControlPanelProps) {
  const [now, setNow] = useState(() => Date.now());
  const currentPlayer = getCurrentPlayer(state);
  const selectedPiece = state.selectedPieceId ? getPieceById(state, state.selectedPieceId) : null;
  const selectableCount = getSelectablePieceIds(state).length;
  const selectedCellType =
    selectedPiece && state.reachableCells.length > 0
      ? `${state.reachableCells.length} 个可走下一格`
      : '未选择目标';
  const canRoll = canAct && currentPlayer.isHuman && state.stage === 'Roll' && !state.winnerId;
  const startedAt = state.startedAt ?? now;
  const turnStartedAt = state.turnStartedAt ?? now;
  const elapsedText = formatDuration(now - startedAt);
  const remainingSeconds = state.winnerId
    ? 0
    : Math.max(0, Math.ceil((turnStartedAt + TURN_TIMEOUT_MS - now) / 1000));

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(timer);
  }, []);

  return (
    <aside className="control-panel">
      <section className="panel-section turn-section">
        <div className="section-header">
          <h2>回合</h2>
          <span className={`stage-badge ${state.stage.toLowerCase()}`}>{STAGE_LABELS[state.stage]}</span>
        </div>

        <div className="current-player-line">
          <span className="player-dot large" style={{ background: currentPlayer.color }} />
          <strong>{currentPlayer.name}</strong>
          <span>{currentPlayer.isHuman ? '玩家' : 'AI'}</span>
        </div>

        <div className="metric-grid">
          <div>
            <span className="metric-label">骰子</span>
            <strong className="dice-face">{state.dice ?? '-'}</strong>
          </div>
          <div>
            <span className="metric-label">行动</span>
            <strong>{state.actionPower ?? '-'}</strong>
          </div>
          <div>
            <span className="metric-label">轮次</span>
            <strong>{state.turnNumber}</strong>
          </div>
          <div>
            <span className="metric-label">时长</span>
            <strong>{elapsedText}</strong>
          </div>
          <div>
            <span className="metric-label">倒计时</span>
            <strong className={remainingSeconds <= 5 && !state.winnerId ? 'timer-danger' : ''}>{remainingSeconds}s</strong>
          </div>
        </div>

        <div className="action-row">
          <button className="primary-button" type="button" onClick={onRoll} disabled={!canRoll}>
            掷骰
          </button>
          <button className="secondary-button" type="button" onClick={onRestart} disabled={!canRestart}>
            重开
          </button>
        </div>

        <div className="turn-hint">
          {state.winnerId
            ? '对局结束。'
            : !canAct && currentPlayer.isHuman
              ? `等待 ${currentPlayer.name} 操作。`
              : currentPlayer.isHuman
              ? state.stage === 'Roll'
                ? '点击掷骰开始行动。'
                : state.stage === 'Select'
                  ? `可移动棋子：${selectableCount} 个，路径会即时结算加速/陷阱。`
                  : state.stage === 'Move'
                    ? selectedPiece
                      ? `${selectedPiece.index + 1}号：${selectedCellType}，剩余 ${state.moveDraft?.remainingPower ?? state.actionPower}。`
                      : '选择一个棋子。'
                    : '战斗结算中。'
              : 'AI 行动中。'}
        </div>
      </section>

      <section className="panel-section">
        <div className="section-header">
          <h2>玩家</h2>
        </div>
        <div className="player-list">
          {state.players.map((player) => (
            <PlayerRow key={player.id} player={player} state={state} />
          ))}
        </div>
      </section>

      <section className="panel-section compact">
        <div className="section-header">
          <h2>格子</h2>
        </div>
        <div className="legend-grid">
          {LEGEND_ITEMS.map((item) => (
            <div key={item.key} className="legend-item">
              <span className={`legend-swatch ${item.key}`} />
              <span>{item.label}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="panel-section log-section">
        <div className="section-header">
          <h2>日志</h2>
        </div>
        <GameLog logs={state.logs} />
      </section>
    </aside>
  );
}
