import { DIRECTIONS } from './constants';
import { coordKey, findPortalPair, getCell, getHomeBand, inBounds, sameCoord } from './board';
import type { Board, Coord, Piece, ReachableCell, StepOption } from './types';

function piecesAt(pieces: Piece[], coord: Coord, exceptPieceId?: string): Piece[] {
  return pieces.filter((piece) => {
    if (piece.home || piece.id === exceptPieceId) {
      return false;
    }
    return sameCoord(piece.position, coord);
  });
}

function getSpawnOrigin(board: Board, piece: Piece): Coord {
  const spawnCells = board.spawnCells[piece.playerId];
  const averageX = spawnCells.reduce((sum, coord) => sum + coord.x, 0) / spawnCells.length;
  const averageY = spawnCells.reduce((sum, coord) => sum + coord.y, 0) / spawnCells.length;

  return {
    x: averageX < board.size / 2 ? 0 : board.size - 1,
    y: averageY < board.size / 2 ? 0 : board.size - 1,
  };
}

function distanceFromOrigin(coord: Coord, origin: Coord): number {
  return Math.abs(coord.x - origin.x) + Math.abs(coord.y - origin.y);
}

function hasEnemyInCenter(board: Board, pieces: Piece[], piece: Piece): boolean {
  return pieces.some((candidate) => {
    if (candidate.home || candidate.id === piece.id || candidate.playerId === piece.playerId) {
      return false;
    }

    return getCell(board, candidate.position).type === 'center';
  });
}

function isForbiddenOwnedTile(board: Board, coord: Coord, piece: Piece): boolean {
  const cell = getCell(board, coord);
  return (cell.type === 'spawn' || cell.type === 'goal') && Boolean(cell.ownerId) && cell.ownerId !== piece.playerId;
}

function isInHomeBand(board: Board, coord: Coord, piece: Piece): boolean {
  const band = getHomeBand(board, piece.playerId);
  return band.orientation === 'rows'
    ? coord.y >= band.min && coord.y <= band.max
    : coord.x >= band.min && coord.x <= band.max;
}

function getTilePowerDelta(board: Board, coord: Coord): number {
  const cell = getCell(board, coord);
  if (cell.type === 'boost') {
    return 1;
  }
  if (cell.type === 'trap') {
    return -1;
  }
  return 0;
}

function isAdjacent(a: Coord, b: Coord): boolean {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y) === 1;
}

function toReachableCell(option: StepOption): ReachableCell {
  return {
    coord: option.coord,
    distance: option.path.length,
    path: option.path,
    tileType: option.tileType,
    isAttack: option.isAttack,
    occupantIds: option.occupantIds,
  };
}

function evaluateStep(
  board: Board,
  pieces: Piece[],
  piece: Piece,
  current: Coord,
  remainingPower: number,
  next: Coord,
  path: Coord[],
): { option?: StepOption; reason?: string } {
  if (remainingPower <= 0) {
    return { reason: '行动力已经用完。' };
  }

  if (!isAdjacent(current, next)) {
    return { reason: '必须一步一步走，只能点击相邻一格。' };
  }

  if (!inBounds(board, next)) {
    return { reason: '不能走出棋盘。' };
  }

  const spawnOrigin = getSpawnOrigin(board, piece);
  const currentInHomeBand = isInHomeBand(board, current, piece);
  const nextInHomeBand = isInHomeBand(board, next, piece);
  const leavingPortal = path.length === 0 && getCell(board, current).type === 'portal';
  if (currentInHomeBand && !nextInHomeBand) {
    return { reason: '已经进入家门区，不能再离开。' };
  }

  if (!currentInHomeBand && !leavingPortal && distanceFromOrigin(next, spawnOrigin) <= distanceFromOrigin(current, spawnOrigin)) {
    return { reason: '不能折返，只能往远离出生地的方向走。' };
  }

  const cell = getCell(board, next);
  if (cell.type === 'obstacle') {
    return { reason: '障碍格不能进入。' };
  }

  if (isForbiddenOwnedTile(board, next, piece)) {
    return { reason: cell.type === 'spawn' ? '不能进入其他玩家的出生区。' : '不能进入其他玩家的目标区。' };
  }

  if (cell.type === 'center' && hasEnemyInCenter(board, pieces, piece)) {
    return { reason: '争夺区已被敌方占据。' };
  }

  const nextRemainingPower = remainingPower - 1 + getTilePowerDelta(board, next);
  if (cell.type === 'portal' && nextRemainingPower !== 0) {
    return { reason: '传送门只能作为最后一步的终点。' };
  }

  if (nextRemainingPower < 0) {
    return { reason: '行动力不足，经过陷阱会额外扣 1。' };
  }

  const isLanding = nextRemainingPower === 0;
  const portalExit = isLanding && cell.type === 'portal' ? findPortalPair(board, next) : null;
  const finalCoord = portalExit ?? next;
  const finalCell = getCell(board, finalCoord);
  const entryOccupants = piecesAt(pieces, next, piece.id);
  const entryFriendlyOccupants = entryOccupants.filter((occupant) => occupant.playerId === piece.playerId);
  const entryEnemyOccupants = entryOccupants.filter((occupant) => occupant.playerId !== piece.playerId && !occupant.home);

  if (!portalExit && cell.type !== 'safe' && cell.type !== 'center') {
    if (entryFriendlyOccupants.length > 0) {
      return { reason: '目标位置已有己方棋子。' };
    }
    if (entryEnemyOccupants.length > 0 && !isLanding) {
      return { reason: '路径中不能穿过敌方棋子。' };
    }
  }

  if (isForbiddenOwnedTile(board, finalCoord, piece)) {
    return { reason: finalCell.type === 'spawn' ? '传送出口是其他玩家出生区。' : '传送出口是其他玩家目标区。' };
  }

  if (finalCell.type === 'center' && hasEnemyInCenter(board, pieces, piece)) {
    return { reason: '传送出口的争夺区已被敌方占据。' };
  }

  const finalOccupants = piecesAt(pieces, finalCoord, piece.id);
  const friendlyOccupants = finalOccupants.filter((occupant) => occupant.playerId === piece.playerId);
  if (friendlyOccupants.length > 0 && finalCell.type !== 'safe' && finalCell.type !== 'center') {
    return { reason: '目标位置已有己方棋子。' };
  }

  if (finalOccupants.some((occupant) => occupant.playerId !== piece.playerId) && finalCell.type === 'center') {
    return { reason: '争夺区只允许当前占据方进入。' };
  }

  const enemyOccupants =
    finalCell.type === 'safe' || finalCell.type === 'center'
      ? []
      : finalOccupants.filter((occupant) => !occupant.home && occupant.playerId !== piece.playerId);
  const nextPath = portalExit ? [...path, next, portalExit] : [...path, next];

  return {
    option: {
      coord: next,
      final: finalCoord,
      remainingPower: nextRemainingPower,
      path: nextPath,
      tileType: cell.type,
      isAttack: isLanding && enemyOccupants.length > 0,
      occupantIds: isLanding ? enemyOccupants.map((occupant) => occupant.id) : [],
      portalTo: portalExit ?? undefined,
    },
  };
}

function canCompleteFromOption(board: Board, pieces: Piece[], piece: Piece, option: StepOption): boolean {
  if (option.remainingPower === 0) {
    return true;
  }

  const virtualPiece = {
    ...piece,
    position: option.final,
  };

  return getReachableCells(board, pieces, virtualPiece, option.remainingPower).length > 0;
}

export function getStepOptions(
  board: Board,
  pieces: Piece[],
  piece: Piece,
  current: Coord,
  remainingPower: number,
  path: Coord[] = [],
): StepOption[] {
  return DIRECTIONS.flatMap((direction) => {
    const next = {
      x: current.x + direction.x,
      y: current.y + direction.y,
    };
    const result = evaluateStep(board, pieces, piece, current, remainingPower, next, path);
    if (!result.option || !canCompleteFromOption(board, pieces, piece, result.option)) {
      return [];
    }
    return [result.option];
  });
}

export function getStepReachableCells(
  board: Board,
  pieces: Piece[],
  piece: Piece,
  current: Coord,
  remainingPower: number,
  path: Coord[] = [],
): ReachableCell[] {
  return getStepOptions(board, pieces, piece, current, remainingPower, path).map(toReachableCell);
}

export function explainInvalidStep(
  board: Board,
  pieces: Piece[],
  piece: Piece,
  current: Coord,
  remainingPower: number,
  next: Coord,
  path: Coord[] = [],
): string {
  const result = evaluateStep(board, pieces, piece, current, remainingPower, next, path);
  if (result.reason) {
    return result.reason;
  }

  if (result.option && !canCompleteFromOption(board, pieces, piece, result.option)) {
    return '这一步之后无法走完整个行动力。';
  }

  return '该格不可进入。';
}

export function getReachableCells(board: Board, pieces: Piece[], piece: Piece, power: number): ReachableCell[] {
  if (piece.home || power <= 0) {
    return [];
  }

  const spawnOrigin = getSpawnOrigin(board, piece);
  const enemyOwnsCenter = hasEnemyInCenter(board, pieces, piece);
  const resultByKey = new Map<string, ReachableCell>();
  const visited = new Set<string>();
  const startKey = coordKey(piece.position);
  const queue: Array<{ coord: Coord; remaining: number; steps: number; path: Coord[] }> = [
    { coord: piece.position, remaining: power, steps: 0, path: [] },
  ];

  visited.add(`${startKey}|${power}`);

  while (queue.length > 0) {
    const current = queue.shift()!;

    if (current.remaining <= 0) {
      continue;
    }

    DIRECTIONS.forEach((direction) => {
      const next = {
        x: current.coord.x + direction.x,
        y: current.coord.y + direction.y,
      };

      if (!inBounds(board, next)) {
        return;
      }

      const currentInHomeBand = isInHomeBand(board, current.coord, piece);
      const nextInHomeBand = isInHomeBand(board, next, piece);
      const leavingPortal = current.path.length === 0 && getCell(board, current.coord).type === 'portal';
      if (currentInHomeBand && !nextInHomeBand) {
        return;
      }

      if (!currentInHomeBand && !leavingPortal && distanceFromOrigin(next, spawnOrigin) <= distanceFromOrigin(current.coord, spawnOrigin)) {
        return;
      }

      const cell = getCell(board, next);
      if (cell.type === 'obstacle') {
        return;
      }

      if (isForbiddenOwnedTile(board, next, piece)) {
        return;
      }

      if (cell.type === 'center' && enemyOwnsCenter) {
        return;
      }

      const remaining = current.remaining - 1 + getTilePowerDelta(board, next);
      if (remaining < 0) {
        return;
      }

      if (cell.type === 'portal' && remaining !== 0) {
        return;
      }

      const isLanding = remaining === 0;
      const portalExit = isLanding && cell.type === 'portal' ? findPortalPair(board, next) : null;
      const finalCoord = portalExit ?? next;
      const finalCell = getCell(board, finalCoord);
      const entryOccupants = piecesAt(pieces, next, piece.id);
      const entryFriendlyOccupants = entryOccupants.filter((occupant) => occupant.playerId === piece.playerId);
      const entryEnemyOccupants = entryOccupants.filter((occupant) => occupant.playerId !== piece.playerId && !occupant.home);

      if (!portalExit && cell.type !== 'safe' && cell.type !== 'center') {
        if (entryFriendlyOccupants.length > 0) {
          return;
        }
        if (entryEnemyOccupants.length > 0 && !isLanding) {
          return;
        }
      }

      if (isForbiddenOwnedTile(board, finalCoord, piece)) {
        return;
      }

      if (finalCell.type === 'center' && enemyOwnsCenter) {
        return;
      }

      const path = portalExit ? [...current.path, next, portalExit] : [...current.path, next];
      const finalOccupants = piecesAt(pieces, finalCoord, piece.id);
      const friendlyOccupants = finalOccupants.filter((occupant) => occupant.playerId === piece.playerId);
      if (friendlyOccupants.length > 0 && finalCell.type !== 'safe' && finalCell.type !== 'center') {
        return;
      }

      const enemyOccupants =
        finalCell.type === 'safe' || finalCell.type === 'center'
          ? []
          : finalOccupants.filter((occupant) => !occupant.home && occupant.playerId !== piece.playerId);
      if (finalOccupants.some((occupant) => occupant.playerId !== piece.playerId) && finalCell.type === 'center') {
        return;
      }

      const steps = current.steps + 1;
      const targetKey = coordKey(next);

      if (isLanding) {
        const existing = resultByKey.get(targetKey);
        if (!existing || steps < existing.distance) {
          resultByKey.set(targetKey, {
            coord: next,
            distance: steps,
            path,
            tileType: cell.type,
            isAttack: enemyOccupants.length > 0,
            occupantIds: enemyOccupants.map((occupant) => occupant.id),
          });
        }
        return;
      }

      if (enemyOccupants.length > 0) {
        return;
      }

      const visitKey = `${targetKey}|${remaining}`;
      if (visited.has(visitKey)) {
        return;
      }

      visited.add(visitKey);
      queue.push({ coord: next, remaining, steps, path });
    });
  }

  return [...resultByKey.values()].sort((a, b) => a.distance - b.distance);
}
