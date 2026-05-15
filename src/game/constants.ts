import type { Coord, Player, PlayerId } from './types';

export const BOARD_SIZE = 13;
export const PIECES_PER_PLAYER = 4;
export const MAX_LOGS = 60;

export const PLAYER_ORDER: PlayerId[] = ['red', 'blue', 'green', 'yellow'];

export const PLAYER_CONFIGS: Record<PlayerId, Omit<Player, 'pendingMoveDelta'>> = {
  red: {
    id: 'red',
    name: '红队',
    color: '#dc2626',
    accent: '#fee2e2',
    isHuman: true,
  },
  blue: {
    id: 'blue',
    name: '蓝队',
    color: '#2563eb',
    accent: '#dbeafe',
    isHuman: false,
  },
  green: {
    id: 'green',
    name: '绿队',
    color: '#16a34a',
    accent: '#dcfce7',
    isHuman: false,
  },
  yellow: {
    id: 'yellow',
    name: '黄队',
    color: '#d97706',
    accent: '#fef3c7',
    isHuman: false,
  },
};

export const DIRECTIONS: Coord[] = [
  { x: 1, y: 0 },
  { x: -1, y: 0 },
  { x: 0, y: 1 },
  { x: 0, y: -1 },
];

export const TILE_LABELS = {
  empty: '空地',
  center: '争夺区',
  spawn: '出生区',
  goal: '目标区',
  obstacle: '障碍',
  safe: '安全格',
  boost: '加速格',
  trap: '陷阱格',
  portal: '传送门',
} as const;

export const TILE_SHORT_LABELS = {
  empty: '',
  center: '',
  spawn: '生',
  goal: '家',
  obstacle: '',
  safe: '安',
  boost: '+1',
  trap: '-1',
  portal: '传',
} as const;

export const STAGE_LABELS = {
  Roll: '掷骰',
  Select: '选子',
  Move: '移动',
  Battle: '战斗',
  End: '结束',
} as const;
