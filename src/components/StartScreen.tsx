import type { RoomSummary } from '../api';

interface StartScreenProps {
  hostName: string;
  joinCode: string;
  message: string;
  rooms: RoomSummary[];
  roomsLoading: boolean;
  onHostNameChange: (value: string) => void;
  onJoinCodeChange: (value: string) => void;
  onCreateRoom: () => void;
  onJoinRoom: () => void;
  onJoinListedRoom: (roomCode: string) => void;
  onRefreshRooms: () => void;
  onOpenRules: () => void;
}

export function StartScreen({
  hostName,
  joinCode,
  message,
  rooms,
  roomsLoading,
  onHostNameChange,
  onJoinCodeChange,
  onCreateRoom,
  onJoinRoom,
  onJoinListedRoom,
  onRefreshRooms,
  onOpenRules,
}: StartScreenProps) {
  return (
    <main className="menu-screen">
      <section className="screen-card hero-card">
        <div>
          <p className="eyebrow">Fudo MVP</p>
          <h2>创建房间，等玩家加入，然后开局</h2>
          <p className="screen-copy">Fudo 是二维飞行棋轻策略对战；未加入的颜色会由 AI 自动补位。</p>
        </div>
        <button className="secondary-button" type="button" onClick={onOpenRules}>
          规则说明
        </button>
      </section>

      <section className="home-grid home-room-grid">
        <section className="screen-card room-list-card">
          <div className="section-header">
            <div>
              <p className="eyebrow">当前房间</p>
              <h2>未开始房间</h2>
            </div>
            <button className="secondary-button header-button" type="button" onClick={onRefreshRooms}>
              刷新
            </button>
          </div>

          <div className="room-list">
            {roomsLoading && <div className="empty-room-list">正在获取房间...</div>}
            {!roomsLoading && rooms.length === 0 && <div className="empty-room-list">暂无未开始房间，可以创建一个。</div>}
            {!roomsLoading &&
              rooms.map((room) => {
                const full = room.playerCount >= room.capacity;
                return (
                  <button
                    className="room-list-item"
                    type="button"
                    key={room.code}
                    disabled={full}
                    onClick={() => onJoinListedRoom(room.code)}
                  >
                    <div>
                      <strong>{room.code}</strong>
                      <span>房主：{room.hostName}</span>
                    </div>
                    <div className="room-list-meta">
                      <b>
                        {room.playerCount}/{room.capacity}
                      </b>
                      <span>{full ? '已满' : '进入'}</span>
                    </div>
                  </button>
                );
              })}
          </div>
        </section>

        <form
          className="screen-card form-card"
          onSubmit={(event) => {
            event.preventDefault();
            onCreateRoom();
          }}
        >
          <h3>创建房间</h3>
          <label className="field-label" htmlFor="host-name">
            房主昵称
          </label>
          <input
            id="host-name"
            className="text-input"
            value={hostName}
            maxLength={12}
            onChange={(event) => onHostNameChange(event.target.value)}
            placeholder="例如：房主"
          />
          <button className="primary-button" type="submit">
            创建房间
          </button>
        </form>

        <form
          className="screen-card form-card"
          onSubmit={(event) => {
            event.preventDefault();
            onJoinRoom();
          }}
        >
          <h3>加入房间</h3>
          <label className="field-label" htmlFor="join-code">
            房间号
          </label>
          <input
            id="join-code"
            className="text-input"
            value={joinCode}
            maxLength={6}
            onChange={(event) => onJoinCodeChange(event.target.value.toUpperCase())}
            placeholder="输入房间号"
          />
          <button className="primary-button" type="submit">
            加入房间
          </button>
        </form>
      </section>

      {message && <div className="status-strip">{message}</div>}
    </main>
  );
}
