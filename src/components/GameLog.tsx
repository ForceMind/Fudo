import type { GameLogEntry } from '../game/types';

interface GameLogProps {
  logs: GameLogEntry[];
}

export function GameLog({ logs }: GameLogProps) {
  return (
    <ol className="game-log">
      {logs.slice(0, 7).map((entry) => (
        <li key={entry.id} className={`log-entry ${entry.tone}`}>
          {entry.text}
        </li>
      ))}
    </ol>
  );
}
