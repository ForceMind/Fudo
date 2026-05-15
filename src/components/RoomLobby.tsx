import { PLAYER_CONFIGS, PLAYER_ORDER } from '../game/constants';
import type { PlayerId } from '../game/types';

export interface LobbySlot {
  id: PlayerId;
  name: string;
  isHuman: boolean;
  isHost: boolean;
  userId?: string | null;
}

interface RoomLobbyProps {
  roomCode: string;
  slots: Record<PlayerId, LobbySlot | null>;
  joinName: string;
  message: string;
  onJoinNameChange: (value: string) => void;
  onAddPlayer: () => void;
  onRemovePlayer: (playerId: PlayerId) => void;
  onStartGame: () => void;
  onBackHome: () => void;
  onOpenRules: () => void;
}

export function RoomLobby({
  roomCode,
  slots,
  joinName,
  message,
  onJoinNameChange,
  onAddPlayer,
  onRemovePlayer,
  onStartGame,
  onBackHome,
  onOpenRules,
}: RoomLobbyProps) {
  const humanCount = PLAYER_ORDER.filter((playerId) => slots[playerId]?.isHuman).length;
  const full = humanCount >= PLAYER_ORDER.length;

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
          <button className="primary-button" type="button" onClick={onStartGame}>
            房主开始
          </button>
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
                      <div className="slot-meta">{slot.isHost ? '房主' : '已加入'}</div>
                      {!slot.isHost && (
                        <button className="secondary-button tiny-button" type="button" onClick={() => onRemovePlayer(playerId)}>
                          移除
                        </button>
                      )}
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

        <form
          className="screen-card form-card"
          onSubmit={(event) => {
            event.preventDefault();
            onAddPlayer();
          }}
        >
          <h3>加入一个玩家</h3>
          <label className="field-label" htmlFor="lobby-join-name">
            玩家昵称
          </label>
          <input
            id="lobby-join-name"
            className="text-input"
            value={joinName}
            maxLength={12}
            onChange={(event) => onJoinNameChange(event.target.value)}
            placeholder={full ? '房间已满' : '例如：玩家 2'}
            disabled={full}
          />
          <button className="primary-button" type="submit" disabled={full}>
            加入空位
          </button>
          <p className="muted-note">不足 4 人时，剩余颜色会在开局时自动变成 AI。</p>
        </form>
      </section>

      {message && <div className="status-strip">{message}</div>}
    </main>
  );
}
