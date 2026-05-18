import { useEffect, useMemo, useRef, useState } from 'react';
import { TILE_LABELS, TILE_SHORT_LABELS } from '../game/constants';
import { getCellDisplayLabel, getCurrentPlayer, getPieceById, isPieceSelectable } from '../game/rules';
import { coordKey, getCell, getHomeBand, sameCoord } from '../game/board';
import type { Cell, Coord, GameState, Piece, Player, ReachableCell } from '../game/types';

interface GameCanvasProps {
  state: GameState;
  canInteract: boolean;
  onPieceClick: (pieceId: string) => void;
  onCellClick: (coord: Coord) => void;
}

interface BoardMetrics {
  cellSize: number;
  boardSizePx: number;
  offsetX: number;
  offsetY: number;
}

interface HoverState {
  coord: Coord;
  x: number;
  y: number;
}

const TILE_COLORS = {
  empty: '#f8f5ee',
  center: '#e8dfd2',
  spawn: '#f4f0e6',
  goal: '#fff7ed',
  obstacle: '#334155',
  safe: '#b7e4c7',
  boost: '#ffe08a',
  trap: '#f8b4b4',
  portal: '#c4b5fd',
} as const;

const PORTAL_COLORS: Record<string, { fill: string; stroke: string; text: string }> = {
  alpha: { fill: '#c4b5fd', stroke: '#7c3aed', text: 'A' },
  beta: { fill: '#99f6e4', stroke: '#0f766e', text: 'B' },
};

function getMetrics(width: number, height: number, boardSize: number): BoardMetrics {
  const padding = Math.max(16, Math.min(width, height) * 0.035);
  const boardSizePx = Math.floor(Math.min(width, height) - padding * 2);
  const cellSize = boardSizePx / boardSize;

  return {
    cellSize,
    boardSizePx,
    offsetX: (width - boardSizePx) / 2,
    offsetY: (height - boardSizePx) / 2,
  };
}

function cellCenter(metrics: BoardMetrics, coord: Coord): Coord {
  return {
    x: metrics.offsetX + coord.x * metrics.cellSize + metrics.cellSize / 2,
    y: metrics.offsetY + coord.y * metrics.cellSize + metrics.cellSize / 2,
  };
}

function pointerToCell(metrics: BoardMetrics, boardSize: number, x: number, y: number): Coord | null {
  const gridX = Math.floor((x - metrics.offsetX) / metrics.cellSize);
  const gridY = Math.floor((y - metrics.offsetY) / metrics.cellSize);

  if (gridX < 0 || gridY < 0 || gridX >= boardSize || gridY >= boardSize) {
    return null;
  }

  return { x: gridX, y: gridY };
}

function roundedRect(ctx: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, radius: number) {
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + width - radius, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
  ctx.lineTo(x + width, y + height - radius);
  ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
  ctx.lineTo(x + radius, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
}

function colorWithAlpha(hex: string, alpha: number): string {
  const value = hex.replace('#', '');
  const bigint = Number.parseInt(value.length === 3 ? value.split('').map((char) => char + char).join('') : value, 16);
  const red = (bigint >> 16) & 255;
  const green = (bigint >> 8) & 255;
  const blue = bigint & 255;
  return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}

function getHomeBandOwner(state: GameState, coord: Coord): Player | undefined {
  return state.players.find((player) => {
    const band = getHomeBand(state.board, player.id);
    return band.orientation === 'rows'
      ? coord.y >= band.min && coord.y <= band.max
      : coord.x >= band.min && coord.x <= band.max;
  });
}

function drawTile(ctx: CanvasRenderingContext2D, cell: Cell, metrics: BoardMetrics, state: GameState) {
  const x = metrics.offsetX + cell.coord.x * metrics.cellSize;
  const y = metrics.offsetY + cell.coord.y * metrics.cellSize;
  const owner = cell.ownerId ? state.players.find((player) => player.id === cell.ownerId) : undefined;
  const homeBandOwner = getHomeBandOwner(state, cell.coord);

  ctx.save();
  const portalColor = cell.type === 'portal' && cell.portalId ? PORTAL_COLORS[cell.portalId] : undefined;
  ctx.fillStyle =
    portalColor?.fill ??
    (owner && (cell.type === 'spawn' || cell.type === 'goal')
      ? owner.accent
      : homeBandOwner && cell.type === 'empty'
        ? colorWithAlpha(homeBandOwner.color, 0.075)
        : TILE_COLORS[cell.type]);
  ctx.fillRect(x, y, metrics.cellSize, metrics.cellSize);

  if (homeBandOwner && cell.type === 'empty') {
    ctx.fillStyle = colorWithAlpha(homeBandOwner.color, 0.035);
    ctx.fillRect(x + 3, y + 3, metrics.cellSize - 6, metrics.cellSize - 6);
  }

  if (cell.type === 'center') {
    ctx.fillStyle = 'rgba(120, 113, 108, 0.10)';
    ctx.fillRect(x + 3, y + 3, metrics.cellSize - 6, metrics.cellSize - 6);
  }

  if (cell.type === 'obstacle') {
    ctx.fillStyle = '#1e293b';
    roundedRect(ctx, x + metrics.cellSize * 0.18, y + metrics.cellSize * 0.18, metrics.cellSize * 0.64, metrics.cellSize * 0.64, 5);
    ctx.fill();
  }

  const label = portalColor?.text ?? TILE_SHORT_LABELS[cell.type];
  if (label) {
    ctx.font = `700 ${Math.max(9, metrics.cellSize * 0.22)}px Inter, system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = portalColor?.stroke ?? (cell.type === 'obstacle' ? '#ffffff' : '#334155');
    ctx.fillText(label, x + metrics.cellSize / 2, y + metrics.cellSize / 2);
  }

  ctx.strokeStyle =
    portalColor?.stroke ??
    (owner && cell.type === 'goal'
      ? owner.color
      : homeBandOwner && cell.type === 'empty'
        ? colorWithAlpha(homeBandOwner.color, 0.2)
        : 'rgba(100, 116, 139, 0.20)');
  ctx.lineWidth = cell.type === 'goal' || portalColor || (homeBandOwner && cell.type === 'empty') ? 2 : 1;
  ctx.strokeRect(x, y, metrics.cellSize, metrics.cellSize);
  ctx.restore();
}

function drawHighlights(
  ctx: CanvasRenderingContext2D,
  state: GameState,
  metrics: BoardMetrics,
  hover: HoverState | null,
  selectablePieceIds: Set<string>,
) {
  const reachableByKey = new Map<string, ReachableCell>();
  state.reachableCells.forEach((cell) => reachableByKey.set(coordKey(cell.coord), cell));

  state.reachableCells.forEach((cell) => {
    const x = metrics.offsetX + cell.coord.x * metrics.cellSize;
    const y = metrics.offsetY + cell.coord.y * metrics.cellSize;
    ctx.save();
    ctx.fillStyle = cell.isAttack ? 'rgba(239, 68, 68, 0.34)' : 'rgba(14, 165, 233, 0.25)';
    ctx.fillRect(x + 2, y + 2, metrics.cellSize - 4, metrics.cellSize - 4);
    ctx.strokeStyle = cell.isAttack ? '#dc2626' : '#0284c7';
    ctx.lineWidth = 2;
    ctx.strokeRect(x + 4, y + 4, metrics.cellSize - 8, metrics.cellSize - 8);
    ctx.restore();
  });

  state.pieces.forEach((piece) => {
    if (piece.home || !selectablePieceIds.has(piece.id)) {
      return;
    }
    const center = cellCenter(metrics, piece.position);
    ctx.save();
    ctx.strokeStyle = '#f59e0b';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(center.x, center.y, metrics.cellSize * 0.36, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  });

  if (hover) {
    const x = metrics.offsetX + hover.coord.x * metrics.cellSize;
    const y = metrics.offsetY + hover.coord.y * metrics.cellSize;
    ctx.save();
    ctx.strokeStyle = reachableByKey.has(coordKey(hover.coord)) ? '#0f766e' : '#111827';
    ctx.lineWidth = 2;
    ctx.strokeRect(x + 3, y + 3, metrics.cellSize - 6, metrics.cellSize - 6);
    ctx.restore();
  }
}

function getMoveAnimationDuration(pathLength: number): number {
  return Math.min(1900, Math.max(420, pathLength * 180));
}

function getAnimationPosition(state: GameState, piece: Piece, metrics: BoardMetrics, now: number): Coord | null {
  const lastMove = state.lastMove;
  if (!lastMove || lastMove.pieceId !== piece.id) {
    return null;
  }

  const elapsed = now - lastMove.timestamp;
  const duration = getMoveAnimationDuration(lastMove.path.length);
  if (elapsed >= duration || lastMove.path.length === 0) {
    return null;
  }

  const points = [lastMove.from, ...lastMove.path].map((coord) => cellCenter(metrics, coord));
  const segmentProgress = (elapsed / duration) * (points.length - 1);
  const index = Math.floor(segmentProgress);
  const localProgress = segmentProgress - index;
  const from = points[index];
  const to = points[Math.min(index + 1, points.length - 1)];
  const eased = 1 - Math.pow(1 - localProgress, 3);

  return {
    x: from.x + (to.x - from.x) * eased,
    y: from.y + (to.y - from.y) * eased,
  };
}

function drawMovePath(ctx: CanvasRenderingContext2D, state: GameState, metrics: BoardMetrics, now: number) {
  if (state.moveDraft && state.moveDraft.path.length > 0) {
    const draftPoints = [state.moveDraft.from, ...state.moveDraft.path].map((coord) => cellCenter(metrics, coord));
    ctx.save();
    ctx.strokeStyle = 'rgba(2, 132, 199, 0.55)';
    ctx.lineWidth = Math.max(3, metrics.cellSize * 0.07);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    draftPoints.forEach((point, index) => {
      if (index === 0) {
        ctx.moveTo(point.x, point.y);
      } else {
        ctx.lineTo(point.x, point.y);
      }
    });
    ctx.stroke();
    ctx.restore();
  }

  const lastMove = state.lastMove;
  if (!lastMove || lastMove.path.length === 0) {
    return;
  }

  const elapsed = now - lastMove.timestamp;
  const duration = getMoveAnimationDuration(lastMove.path.length);
  if (elapsed > duration + 450) {
    return;
  }

  const points = [lastMove.from, ...lastMove.path].map((coord) => cellCenter(metrics, coord));
  ctx.save();
  ctx.strokeStyle = 'rgba(15, 118, 110, 0.55)';
  ctx.lineWidth = Math.max(3, metrics.cellSize * 0.08);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  points.forEach((point, index) => {
    if (index === 0) {
      ctx.moveTo(point.x, point.y);
    } else {
      ctx.lineTo(point.x, point.y);
    }
  });
  ctx.stroke();

  if (lastMove.capturedPieceIds.length > 0) {
    const capturePoint = cellCenter(metrics, lastMove.final);
    const pulse = Math.min(1, elapsed / Math.max(700, duration));
    ctx.strokeStyle = `rgba(220, 38, 38, ${1 - pulse * 0.75})`;
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(capturePoint.x, capturePoint.y, metrics.cellSize * (0.35 + pulse * 0.55), 0, Math.PI * 2);
    ctx.stroke();
  }

  ctx.restore();
}

function drawPieces(ctx: CanvasRenderingContext2D, state: GameState, metrics: BoardMetrics, now: number) {
  const piecesByCoord = new Map<string, Piece[]>();
  state.pieces.forEach((piece) => {
    const displayPosition = state.moveDraft?.pieceId === piece.id ? state.moveDraft.current : piece.position;
    const key = coordKey(displayPosition);
    piecesByCoord.set(key, [...(piecesByCoord.get(key) ?? []), piece]);
  });

  const drawPiece = (piece: Piece, position: Coord, offsetIndex: number, stackSize: number) => {
    const player = state.players.find((candidate) => candidate.id === piece.playerId)!;
    const selected = state.selectedPieceId === piece.id;
    const stackOffsets = [
      { x: 0, y: 0 },
      { x: -0.17, y: -0.17 },
      { x: 0.17, y: -0.17 },
      { x: -0.17, y: 0.17 },
      { x: 0.17, y: 0.17 },
    ];
    const offset = stackSize > 1 ? stackOffsets[offsetIndex % stackOffsets.length] : stackOffsets[0];
    const radius = metrics.cellSize * (stackSize > 1 ? 0.24 : 0.30);
    const x = position.x + offset.x * metrics.cellSize;
    const y = position.y + offset.y * metrics.cellSize;

    ctx.save();
    ctx.shadowColor = 'rgba(15, 23, 42, 0.28)';
    ctx.shadowBlur = 8;
    ctx.shadowOffsetY = 3;
    ctx.fillStyle = player.color;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowColor = 'transparent';
    ctx.lineWidth = selected ? 4 : 2;
    ctx.strokeStyle = selected ? '#facc15' : '#ffffff';
    ctx.stroke();
    ctx.fillStyle = '#ffffff';
    ctx.font = `800 ${Math.max(10, metrics.cellSize * 0.28)}px Inter, system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(piece.index + 1), x, y + 1);
    ctx.restore();
  };

  piecesByCoord.forEach((pieces) => {
    pieces.forEach((piece, index) => {
      const animationPosition = getAnimationPosition(state, piece, metrics, now);
      if (animationPosition) {
        return;
      }
      const displayPosition = state.moveDraft?.pieceId === piece.id ? state.moveDraft.current : piece.position;
      drawPiece(piece, cellCenter(metrics, displayPosition), index, pieces.length);
    });
  });

  if (state.lastMove) {
    const movingPiece = getPieceById(state, state.lastMove.pieceId);
    if (movingPiece) {
      const animationPosition = getAnimationPosition(state, movingPiece, metrics, now);
      if (animationPosition) {
        drawPiece(movingPiece, animationPosition, 0, 1);
      }
    }
  }
}

function drawBoard(
  ctx: CanvasRenderingContext2D,
  state: GameState,
  metrics: BoardMetrics,
  hover: HoverState | null,
  selectablePieceIds: Set<string>,
  now: number,
) {
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);

  const gradient = ctx.createLinearGradient(0, 0, ctx.canvas.width, ctx.canvas.height);
  gradient.addColorStop(0, '#f1f5f9');
  gradient.addColorStop(0.55, '#ecfeff');
  gradient.addColorStop(1, '#fff7ed');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);

  ctx.save();
  ctx.fillStyle = 'rgba(15, 23, 42, 0.08)';
  roundedRect(
    ctx,
    metrics.offsetX - 10,
    metrics.offsetY - 10,
    metrics.boardSizePx + 20,
    metrics.boardSizePx + 20,
    8,
  );
  ctx.fill();
  ctx.restore();

  state.board.cells.forEach((cell) => drawTile(ctx, cell, metrics, state));
  drawHighlights(ctx, state, metrics, hover, selectablePieceIds);
  drawMovePath(ctx, state, metrics, now);
  drawPieces(ctx, state, metrics, now);
}

export function GameCanvas({ state, canInteract, onPieceClick, onCellClick }: GameCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const metricsRef = useRef<BoardMetrics | null>(null);
  const [hover, setHover] = useState<HoverState | null>(null);
  const [size, setSize] = useState({ width: 760, height: 760 });

  const selectablePieceIds = useMemo(() => {
    const ids = new Set<string>();
    if (!canInteract) {
      return ids;
    }
    state.pieces.forEach((piece) => {
      if (isPieceSelectable(state, piece)) {
        ids.add(piece.id);
      }
    });
    return ids;
  }, [canInteract, state]);

  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) {
      return;
    }

    const observer = new ResizeObserver(([entry]) => {
      const rect = entry.contentRect;
      setSize({ width: rect.width, height: rect.height });
    });

    observer.observe(wrap);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }

    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.floor(size.width * dpr);
    canvas.height = Math.floor(size.height * dpr);
    canvas.style.width = `${size.width}px`;
    canvas.style.height = `${size.height}px`;

    const ctx = canvas.getContext('2d');
    if (!ctx) {
      return;
    }

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    metricsRef.current = getMetrics(size.width, size.height, state.board.size);

    let frame = 0;
    const render = () => {
      const metrics = metricsRef.current;
      if (!metrics) {
        return;
      }

      const now = Date.now();
      drawBoard(ctx, state, metrics, hover, selectablePieceIds, now);

      const animationWindow = state.lastMove ? getMoveAnimationDuration(state.lastMove.path.length) + 500 : 0;
      const shouldAnimate = state.lastMove && now - state.lastMove.timestamp < animationWindow;
      if (shouldAnimate) {
        frame = requestAnimationFrame(render);
      }
    };

    render();
    return () => cancelAnimationFrame(frame);
  }, [hover, selectablePieceIds, size, state]);

  const handlePointerMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    const metrics = metricsRef.current;
    if (!canvas || !metrics) {
      return;
    }

    const rect = canvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    const coord = pointerToCell(metrics, state.board.size, x, y);
    setHover(coord ? { coord, x, y } : null);
  };

  const handleClick = () => {
    if (!hover || state.winnerId || !canInteract) {
      return;
    }

    const currentPlayer = getCurrentPlayer(state);
    if (!currentPlayer.isHuman) {
      return;
    }

    const piecesAtCell = state.pieces.filter((piece) => !piece.home && sameCoord(piece.position, hover.coord));
    const selectablePiece = piecesAtCell.find((piece) => selectablePieceIds.has(piece.id));

    if (selectablePiece) {
      onPieceClick(selectablePiece.id);
      return;
    }

    if (state.stage === 'Move') {
      onCellClick(hover.coord);
    }
  };

  const hoverLabel = hover ? getCellDisplayLabel(state.board, hover.coord) : '';
  const hoverCell = hover ? getCell(state.board, hover.coord) : null;
  const hoverHomeBandOwner = hover ? getHomeBandOwner(state, hover.coord) : null;

  return (
    <div className="canvas-wrap" ref={wrapRef}>
      <canvas
        ref={canvasRef}
        className="game-canvas"
        onPointerMove={handlePointerMove}
        onPointerLeave={() => setHover(null)}
        onClick={handleClick}
      />
      {hover && hoverCell && (
        <div
          className="cell-tooltip"
          style={{
            left: Math.min(hover.x + 14, size.width - 180),
            top: Math.max(hover.y - 36, 10),
          }}
        >
          <strong>{coordKey(hover.coord)}</strong>
          <span>{TILE_LABELS[hoverCell.type]}</span>
          {hoverHomeBandOwner && hoverCell.type === 'empty' && <span>{hoverHomeBandOwner.name}家门区</span>}
          {hoverCell.ownerId && <span>{hoverCell.ownerId}</span>}
          {hoverCell.portalId && <span>{hoverCell.portalId}</span>}
        </div>
      )}
      <div className="canvas-status">{hoverLabel || '悬停查看格子'}</div>
    </div>
  );
}
