export type PlayerId = 'red' | 'blue' | 'green' | 'yellow';

export type TileType =
  | 'empty'
  | 'center'
  | 'spawn'
  | 'goal'
  | 'obstacle'
  | 'safe'
  | 'boost'
  | 'trap'
  | 'portal';

export type TurnStage = 'Roll' | 'Select' | 'Move' | 'Battle' | 'End';

export interface Coord {
  x: number;
  y: number;
}

export interface Cell {
  coord: Coord;
  type: TileType;
  ownerId?: PlayerId;
  portalId?: string;
}

export interface Board {
  size: number;
  cells: Cell[];
  spawnCells: Record<PlayerId, Coord[]>;
  goalCells: Record<PlayerId, Coord[]>;
  portals: Record<string, Coord[]>;
}

export interface Player {
  id: PlayerId;
  name: string;
  color: string;
  accent: string;
  isHuman: boolean;
  pendingMoveDelta: number;
}

export interface PlayerConfigInput {
  id: PlayerId;
  name?: string;
  isHuman?: boolean;
}

export interface Piece {
  id: string;
  playerId: PlayerId;
  index: number;
  position: Coord;
  spawn: Coord;
  home: boolean;
}

export interface ReachableCell {
  coord: Coord;
  distance: number;
  path: Coord[];
  tileType: TileType;
  isAttack: boolean;
  occupantIds: string[];
}

export interface MoveDraft {
  pieceId: string;
  from: Coord;
  current: Coord;
  remainingPower: number;
  path: Coord[];
}

export interface StepOption {
  coord: Coord;
  final: Coord;
  remainingPower: number;
  path: Coord[];
  tileType: TileType;
  isAttack: boolean;
  occupantIds: string[];
  portalTo?: Coord;
}

export interface MovePreview {
  target: Coord;
  final: Coord;
  capturedPieceIds: string[];
  wouldHome: boolean;
  tileEffect?: TileType;
  portalFrom?: Coord;
  portalTo?: Coord;
  portalBlocked?: boolean;
}

export interface MoveResult extends MovePreview {
  id: number;
  pieceId: string;
  playerId: PlayerId;
  from: Coord;
  path: Coord[];
  timestamp: number;
}

export interface GameLogEntry {
  id: number;
  text: string;
  tone: 'info' | 'success' | 'warning' | 'danger';
}

export interface GameNotice {
  id: number;
  text: string;
  tone: 'info' | 'success' | 'warning' | 'danger';
}

export interface GameState {
  board: Board;
  players: Player[];
  pieces: Piece[];
  currentPlayerIndex: number;
  stage: TurnStage;
  dice: number | null;
  actionPower: number | null;
  selectedPieceId: string | null;
  moveDraft: MoveDraft | null;
  reachableCells: ReachableCell[];
  logs: GameLogEntry[];
  notice: GameNotice | null;
  winnerId: PlayerId | null;
  lastMove: MoveResult | null;
  turnNumber: number;
}
