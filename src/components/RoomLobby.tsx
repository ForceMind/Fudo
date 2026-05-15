import { PLAYER_CONFIGS, PLAYER_ORDER } from '../game/constants';
import type { PlayerId } from '../game/types';

export interface LobbySlot {
  id: PlayerId;
  name: string;
  isHuman: boolean;
  isHost: boolean;
  userId?: string | null;
  ready?: boolean;
  lastSeenAt?: string | null;
}

interface RoomLobbyProps {
  roomCode: string;
  slots: Record<PlayerId, LobbySlot | null>;
  message: string;
  localUserId?: string | null;
  startRequested: boolean;
  onToggleReady: () => void;
  onStartGame: () => void;
  onBackHome: () => void;
  onOpenRules: () => void;
}

export function RoomLobby({
  roomCode,
  slots,
  message,
  localUserId,
  startRequested,
  onToggleReady,
  onStartGame,
  onBackHome,
  onOpenRules,
}: RoomLobbyProps) {
  const humanCount = PLAYER_ORDER.filter((playerId) => slots[playerId]?.isHuman).length;
  const localSlot = PLAYER_ORDER.map((playerId) => slots[playerId]).find((slot) => slot?.userId === localUserId) ?? null;
  const isHost = Boolean(localSlot?.isHost);
  const readyCount = PLAYER_ORDER.filter((playerId) => {
    const slot = slots[playerId];
    return slot?.isHuman && !slot.isHost && slot.ready;
  }).length;
  const readyTotal = PLAYER_ORDER.filter((playerId) => {
    const slot = slots[playerId];
    return slot?.isHuman && !slot.isHost;
  }).length;

  return (
    <main className="menu-screen room-screen">
      <section className="screen-card room-toolbar">
        <div>
          <p className="eyebrow">房间号</p>
          <div className="room-code">{roomCode}</div>
        </div>
        <div className="toolbar-actions">
          <button className="secondary-button" type="button" onClick={onOpenRules}>
            规则
          </button>
          <button className="secondary-button" type="button" onClick={onBackHome}>
            返回
          </button>
          {isHost && (
            <button className="primary-button" type="button" onClick={onStartGame} disabled={startRequested}>
              {startRequested ? '等待准备' : '房主开始'}
            </button>
          )}
        </div>
      </section>

      <section className="room-layout">
        <div className="screen-card">
          <div className="section-header">
            <h2>玩家席位</h2>
            <span className="mini-badge">{humanCount}/4 真人</span>
          </div>
          <div className="slot-grid">
            {PLAYER_ORDER.map((playerId) => {
              const slot = slots[playerId];
              const config = PLAYER_CONFIGS[playerId];
              return (
                <div className="slot-card" key={playerId}>
                  <div className="slot-head">
                    <span className="player-dot large" style={{ background: config.color }} />
                    <strong>{config.name}</strong>
                  </div>
                  {slot ? (
                    <>
                      <div className="slot-name">{slot.name}</div>
                      <div className="slot-meta">
                        {slot.isHost ? '房主' : slot.ready ? '已准备' : '未准备'}
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="slot-name muted">等待玩家</div>
                      <div className="slot-meta">开局后 AI 替补</div>
                    </>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        <section className="screen-card form-card">
          <h3>{isHost ? '房主控制' : '我的状态'}</h3>
          {isHost ? (
            <>
              <div className="ready-summary">
                <strong>{readyCount}/{readyTotal}</strong>
                <span>真人玩家已准备</span>
              </div>
              <button className="primary-button" type="button" onClick={onStartGame} disabled={startRequested}>
                {startRequested ? '等待其他玩家准备' : '开始匹配'}
              </button>
              <p className="muted-note">点击开始后，已加入的真人玩家都准备就会自动开局，空位由 AI 替补。</p>
            </>
          ) : localSlot ? (
            <>
              <div className="ready-summary">
                <strong>{localSlot.ready ? '已准备' : '未准备'}</strong>
                <span>{startRequested ? '房主已请求开始' : '等待房主开始'}</span>
              </div>
              <button className={localSlot.ready ? 'secondary-button' : 'primary-button'} type="button" onClick={onToggleReady}>
                {localSlot.ready ? '取消准备' : '准备'}
              </button>
              <p className="muted-note">准备后等待房主开始；开局后只能控制自己的颜色。</p>
            </>
          ) : (
            <>
              <div className="ready-summary">
                <strong>旁观</strong>
                <span>你不在这个房间中</span>
              </div>
              <p className="muted-note">请返回首页选择未满房间加入。</p>
            </>
          )}
        </section>
      </section>

      {message && <div className="status-strip">{message}</div>}
    </main>
  );
}
