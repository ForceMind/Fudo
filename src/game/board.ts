import { BOARD_SIZE, PLAYER_ORDER } from './constants';
import type { Board, Cell, Coord, PlayerId, TileType } from './types';

export function coordKey(coord: Coord): string {
  return `${coord.x},${coord.y}`;
}

export function sameCoord(a: Coord, b: Coord): boolean {
  return a.x === b.x && a.y === b.y;
}

export function inBounds(board: Board, coord: Coord): boolean {
  return coord.x >= 0 && coord.y >= 0 && coord.x < board.size && coord.y < board.size;
}

export function getCell(board: Board, coord: Coord): Cell {
  const cell = board.cells[coord.y * board.size + coord.x];
  if (!cell) {
    throw new Error(`Cell out of bounds: ${coordKey(coord)}`);
  }
  return cell;
}

export function isGoalForPlayer(board: Board, coord: Coord, playerId: PlayerId): boolean {
  return board.goalCells[playerId].some((goal) => sameCoord(goal, coord));
}

export function findPortalPair(board: Board, coord: Coord): Coord | null {
  const cell = getCell(board, coord);
  if (cell.type !== 'portal' || !cell.portalId) {
    return null;
  }

  const pair = board.portals[cell.portalId] ?? [];
  return pair.find((portalCoord) => !sameCoord(portalCoord, coord)) ?? null;
}

export function createBoard(): Board {
  const spawnCells: Record<PlayerId, Coord[]> = {
    red: [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 0, y: 1 },
      { x: 1, y: 1 },
    ],
    blue: [
      { x: 11, y: 0 },
      { x: 12, y: 0 },
      { x: 11, y: 1 },
      { x: 12, y: 1 },
    ],
    green: [
      { x: 11, y: 11 },
      { x: 12, y: 11 },
      { x: 11, y: 12 },
      { x: 12, y: 12 },
    ],
    yellow: [
      { x: 0, y: 11 },
      { x: 1, y: 11 },
      { x: 0, y: 12 },
      { x: 1, y: 12 },
    ],
  };

  const goalCells: Record<PlayerId, Coord[]> = {
    red: [
      { x: 5, y: 12 },
      { x: 6, y: 12 },
      { x: 7, y: 12 },
      { x: 6, y: 11 },
    ],
    blue: [
      { x: 0, y: 5 },
      { x: 0, y: 6 },
      { x: 0, y: 7 },
      { x: 1, y: 6 },
    ],
    green: [
      { x: 5, y: 0 },
      { x: 6, y: 0 },
      { x: 7, y: 0 },
      { x: 6, y: 1 },
    ],
    yellow: [
      { x: 12, y: 5 },
      { x: 12, y: 6 },
      { x: 12, y: 7 },
      { x: 11, y: 6 },
    ],
  };

  const cells: Cell[] = [];
  for (let y = 0; y < BOARD_SIZE; y += 1) {
    for (let x = 0; x < BOARD_SIZE; x += 1) {
      const isCenter = x >= 5 && x <= 7 && y >= 5 && y <= 7;
      cells.push({
        coord: { x, y },
        type: isCenter ? 'center' : 'empty',
      });
    }
  }

  const board: Board = {
    size: BOARD_SIZE,
    cells,
    spawnCells,
    goalCells,
    portals: {
      alpha: [
        { x: 2, y: 2 },
        { x: 10, y: 10 },
      ],
      beta: [
        { x: 10, y: 2 },
        { x: 2, y: 10 },
      ],
    },
  };

  const setTile = (coord: Coord, type: TileType, ownerId?: PlayerId, portalId?: string) => {
    const cell = getCell(board, coord);
    cell.type = type;
    cell.ownerId = ownerId;
    cell.portalId = portalId;
  };

  PLAYER_ORDER.forEach((playerId) => {
    spawnCells[playerId].forEach((coord) => setTile(coord, 'spawn', playerId));
    goalCells[playerId].forEach((coord) => setTile(coord, 'goal', playerId));
  });

  [
    { x: 4, y: 4 },
    { x: 8, y: 4 },
    { x: 4, y: 8 },
    { x: 8, y: 8 },
    { x: 6, y: 3 },
    { x: 6, y: 9 },
    { x: 3, y: 6 },
    { x: 9, y: 6 },
  ].forEach((coord) => setTile(coord, 'obstacle'));

  [
    { x: 6, y: 2 },
    { x: 10, y: 6 },
    { x: 6, y: 10 },
    { x: 2, y: 6 },
    { x: 5, y: 5 },
    { x: 7, y: 5 },
    { x: 5, y: 7 },
    { x: 7, y: 7 },
  ].forEach((coord) => setTile(coord, 'safe'));

  [
    { x: 2, y: 5 },
    { x: 5, y: 2 },
    { x: 10, y: 5 },
    { x: 7, y: 2 },
    { x: 10, y: 7 },
    { x: 7, y: 10 },
    { x: 5, y: 10 },
    { x: 2, y: 7 },
  ].forEach((coord) => setTile(coord, 'boost'));

  [
    { x: 4, y: 2 },
    { x: 8, y: 2 },
    { x: 10, y: 4 },
    { x: 10, y: 8 },
    { x: 8, y: 10 },
    { x: 4, y: 10 },
    { x: 2, y: 8 },
    { x: 2, y: 4 },
  ].forEach((coord) => setTile(coord, 'trap'));

  Object.entries(board.portals).forEach(([portalId, portalCoords]) => {
    portalCoords.forEach((coord) => setTile(coord, 'portal', undefined, portalId));
  });

  return board;
}
