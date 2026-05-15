interface StartScreenProps {
  hostName: string;
  joinCode: string;
  joinName: string;
  message: string;
  onHostNameChange: (value: string) => void;
  onJoinCodeChange: (value: string) => void;
  onJoinNameChange: (value: string) => void;
  onCreateRoom: () => void;
  onJoinRoom: () => void;
  onOpenRules: () => void;
}

export function StartScreen({
  hostName,
  joinCode,
  joinName,
  message,
  onHostNameChange,
  onJoinCodeChange,
  onJoinNameChange,
  onCreateRoom,
  onJoinRoom,
  onOpenRules,
}: StartScreenProps) {
  return (
    <main className="menu-screen">
      <section className="screen-card hero-card">
        <div>
          <p className="eyebrow">本地房间 MVP</p>
          <h2>创建房间，等玩家加入，然后开局</h2>
          <p className="screen-copy">当前版本先做同屏本地房间流程；未加入的颜色会由 AI 自动补位。</p>
        </div>
        <button className="secondary-button" type="button" onClick={onOpenRules}>
          规则说明
        </button>
      </section>

      <section className="home-grid">
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
          <label className="field-label" htmlFor="join-name">
            玩家昵称
          </label>
          <input
            id="join-name"
            className="text-input"
            value={joinName}
            maxLength={12}
            onChange={(event) => onJoinNameChange(event.target.value)}
            placeholder="例如：玩家 2"
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
