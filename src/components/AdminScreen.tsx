import { useEffect, useState } from 'react';
import { AdminSummary, getAdminSummary } from '../api';

interface AdminScreenProps {
  onBack: () => void;
}

function formatTime(value?: string | null): string {
  if (!value) {
    return '-';
  }
  return new Date(value).toLocaleString('zh-CN', { hour12: false });
}

export function AdminScreen({ onBack }: AdminScreenProps) {
  const [summary, setSummary] = useState<AdminSummary | null>(null);
  const [token, setToken] = useState('');
  const [message, setMessage] = useState('加载中...');

  const loadSummary = async (nextToken = token) => {
    setMessage('加载中...');
    try {
      const data = await getAdminSummary(nextToken.trim() || undefined);
      setSummary(data);
      setMessage('后台数据已刷新。');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '后台数据加载失败。');
    }
  };

  useEffect(() => {
    void loadSummary('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <main className="admin-screen">
      <section className="screen-card admin-toolbar">
        <div>
          <p className="eyebrow">后台管理</p>
          <h2>用户、战绩与对局</h2>
        </div>
        <div className="admin-actions">
          <input
            className="text-input admin-token"
            value={token}
            onChange={(event) => setToken(event.target.value)}
            placeholder="ADMIN_TOKEN，可选"
          />
          <button className="secondary-button" type="button" onClick={() => void loadSummary()}>
            刷新
          </button>
          <button className="secondary-button" type="button" onClick={onBack}>
            返回
          </button>
        </div>
      </section>

      {summary && (
        <section className="admin-stats">
          <div className="stat-card">
            <span>用户</span>
            <strong>{summary.stats.userCount}</strong>
          </div>
          <div className="stat-card">
            <span>房间</span>
            <strong>{summary.stats.roomCount}</strong>
          </div>
          <div className="stat-card">
            <span>对局</span>
            <strong>{summary.stats.matchCount}</strong>
          </div>
          <div className="stat-card">
            <span>已结束</span>
            <strong>{summary.stats.finishedMatchCount}</strong>
          </div>
        </section>
      )}

      <section className="admin-grid">
        <div className="screen-card admin-panel">
          <h3>所有用户</h3>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>昵称</th>
                  <th>战绩</th>
                  <th>最后在线</th>
                </tr>
              </thead>
              <tbody>
                {(summary?.users ?? []).map((user) => (
                  <tr key={user.id}>
                    <td>{user.nickname}</td>
                    <td>
                      {user.wins ?? 0}/{user.gamesPlayed ?? 0}
                    </td>
                    <td>{formatTime(user.lastSeenAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="screen-card admin-panel">
          <h3>对局信息</h3>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>房间</th>
                  <th>状态</th>
                  <th>胜者</th>
                  <th>开始</th>
                </tr>
              </thead>
              <tbody>
                {(summary?.matches ?? []).map((match) => (
                  <tr key={match.id}>
                    <td>{match.roomCode ?? '-'}</td>
                    <td>{match.status === 'finished' ? '结束' : '进行中'}</td>
                    <td>{match.winner?.name ?? '-'}</td>
                    <td>{formatTime(match.startedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="screen-card admin-panel">
          <h3>房间信息</h3>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>房间号</th>
                  <th>状态</th>
                  <th>玩家</th>
                  <th>更新时间</th>
                </tr>
              </thead>
              <tbody>
                {(summary?.rooms ?? []).map((room) => (
                  <tr key={room.code}>
                    <td>{room.code}</td>
                    <td>{room.status === 'active' ? '已开始' : '等待'}</td>
                    <td>{Object.values(room.slots).filter(Boolean).length}/4</td>
                    <td>{formatTime(room.updatedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {message && <div className="status-strip">{message}</div>}
    </main>
  );
}
