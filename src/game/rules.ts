import { MAX_LOGS, PIECES_PER_PLAYER, PLAYER_CONFIGS, PLAYER_ORDER, TILE_LABELS } from './constants';
import { coordKey, createBoard, findPortalPair, getCell, isGoalForPlayer, sameCoord } from './board';
import { explainInvalidStep, getReachableCells, getStepOptions, getStepReachableCells } from './movement';
import type {
  Board,
  Coord,
  GameLogEntry,
  GameNotice,
  GameState,
  MovePreview,
  MoveResult,
  Piece,
  Player,
  PlayerConfigInput,
  PlayerId,
  ReachableCell,
  TileType,
} from './types';

let logId = 1;
let moveId = 1;
let noticeId = 1;

export function createInitialState(playerConfigs: PlayerConfigInput[] = []): GameState {
  logId = 1;
  moveId = 1;
  noticeId = 1;

  const board = createBoard();
  const players: Player[] = PLAYER_ORDER.map((playerId) => {
    const override = playerConfigs.find((config) => config.id === playerId);
    return {
      ...PLAYER_CONFIGS[playerId],
      name: override?.name?.trim() || PLAYER_CONFIGS[playerId].name,
      isHuman: override?.isHuman ?? PLAYER_CONFIGS[playerId].isHuman,
      pendingMoveDelta: 0,
    };
  });

  const pieces: Piece[] = players.flatMap((player) =>
    board.spawnCells[player.id].slice(0, PIECES_PER_PLAYER).map((spawn, index) => ({
      id: `${player.id}-${index + 1}`,
      playerId: player.id,
      index,
      position: { ...spawn },
      spawn: { ...spawn },
      home: false,
    })),
  );

  return {
    board,
    players,
    pieces,
    currentPlayerIndex: 0,
    stage: 'Roll',
    dice: null,
    actionPower: null,
    selectedPieceId: null,
    moveDraft: null,
    reachableCells: [],
    logs: [
      {
        id: logId++,
        text: `对局开始。${players.filter((player) => player.isHuman).map((player) => player.name).join('、') || '无人'}为真人玩家。`,
        tone: 'info',
      },
    ],
    notice: null,
    winnerId: null,
    lastMove: null,
    turnNumber: 1,
  };
}

export function getCurrentPlayer(state: GameState): Player {
  return state.players[state.currentPlayerIndex];
}

export function getPlayerById(state: GameState, playerId: PlayerId): Player {
  return state.players.find((player) => player.id === playerId)!;
}

export function getPieceById(state: GameState, pieceId: string): Piece | undefined {
  return state.pieces.find((piece) => piece.id === pieceId);
}

export function getPlayerPieces(state: GameState, playerId: PlayerId): Piece[] {
  return state.pieces.filter((piece) => piece.playerId === playerId);
}

export function getHomeCount(state: GameState, playerId: PlayerId): number {
  return getPlayerPieces(state, playerId).filter((piece) => piece.home).length;
}

export function getActiveCount(state: GameState, playerId: PlayerId): number {
  return getPlayerPieces(state, playerId).filter((piece) => !piece.home).length;
}

export function getActivePiecesAt(state: GameState, coord: Coord, exceptPieceId?: string): Piece[] {
  return state.pieces.filter((piece) => {
    if (piece.home || piece.id === exceptPieceId) {
      return false;
    }
    return sameCoord(piece.position, coord);
  });
}

export function isPieceSelectable(state: GameState, piece: Piece): boolean {
  const canChoosePiece =
    state.stage === 'Select' || (state.stage === 'Move' && (state.moveDraft?.path.length ?? 0) === 0);

  if (!canChoosePiece) {
    return false;
  }

  const currentPlayer = getCurrentPlayer(state);
  if (piece.home || piece.playerId !== currentPlayer.id || !currentPlayer.isHuman) {
    return false;
  }

  return getReachableCells(state.board, state.pieces, piece, state.actionPower ?? 0).length > 0;
}

export function getSelectablePieceIds(state: GameState): string[] {
  const currentPlayer = getCurrentPlayer(state);
  return state.pieces
    .filter((piece) => piece.playerId === currentPlayer.id)
    .filter((piece) => getReachableCells(state.board, state.pieces, piece, state.actionPower ?? 0).length > 0)
    .map((piece) => piece.id);
}

export function getCellDisplayLabel(board: Board, coord: Coord): string {
  const cell = getCell(board, coord);
  const owner = cell.ownerId ? ` ${PLAYER_CONFIGS[cell.ownerId].name}` : '';
  const portal = cell.portalId ? ` ${cell.portalId.toUpperCase()}` : '';
  return `${coordKey(coord)} ${TILE_LABELS[cell.type]}${owner}${portal}`;
}

export function appendLog(
  state: GameState,
  text: string,
  tone: GameLogEntry['tone'] = 'info',
): GameState {
  return {
    ...state,
    logs: [{ id: logId++, text, tone }, ...state.logs].slice(0, MAX_LOGS),
  };
}

export function withNotice(
  state: GameState,
  text: string,
  tone: GameNotice['tone'] = 'info',
): GameState {
  return {
    ...state,
    notice: {
      id: noticeId++,
      text,
      tone,
    },
  };
}

export function rollDie(): number {
  return Math.floor(Math.random() * 6) + 1;
}

export function distanceToNearestGoal(board: Board, coord: Coord, playerId: PlayerId): number {
  return Math.min(
    ...board.goalCells[playerId].map((goal) => Math.abs(goal.x - coord.x) + Math.abs(goal.y - coord.y)),
  );
}

export function previewMove(state: GameState, piece: Piece, target: Coord): MovePreview {
  const targetCell = getCell(state.board, target);
  const final = targetCell.type === 'portal' ? findPortalPair(state.board, target) ?? target : target;
  const finalCell = getCell(state.board, final);
  const capturedPieceIds =
    finalCell.type === 'safe' || finalCell.type === 'center'
      ? []
      : getActivePiecesAt(state, final, piece.id)
          .filter((occupant) => occupant.playerId !== piece.playerId)
          .map((occupant) => occupant.id);

  const wouldHome = isGoalForPlayer(state.board, final, piece.playerId);
  const tileEffect: TileType | undefined = wouldHome ? 'goal' : finalCell.type;

  return {
    target,
    final,
    capturedPieceIds,
    wouldHome,
    tileEffect,
  };
}

function getPathPowerEffects(board: Board, path: Coord[]): { boostCount: number; trapCount: number } {
  return path.reduce(
    (effects, coord) => {
      const cell = getCell(board, coord);
      if (cell.type === 'boost') {
        return { ...effects, boostCount: effects.boostCount + 1 };
      }
      if (cell.type === 'trap') {
        return { ...effects, trapCount: effects.trapCount + 1 };
      }
      return effects;
    },
    { boostCount: 0, trapCount: 0 },
  );
}

function findPortalTransitionInPath(board: Board, path: Coord[]): Pick<MovePreview, 'portalFrom' | 'portalTo'> {
  for (let index = 0; index < path.length - 1; index += 1) {
    const from = path[index];
    const to = path[index + 1];
    const pair = findPortalPair(board, from);
    if (pair && sameCoord(pair, to)) {
      return { portalFrom: from, portalTo: to };
    }
  }

  return {};
}

function findRespawnCoord(board: Board, pieces: Piece[], victim: Piece, capturedIds: string[]): Coord {
  const activeFriendlyPieces = pieces.filter(
    (piece) => piece.playerId === victim.playerId && !piece.home && !capturedIds.includes(piece.id),
  );

  return (
    board.spawnCells[victim.playerId].find(
      (spawn) => !activeFriendlyPieces.some((piece) => sameCoord(piece.position, spawn)),
    ) ?? victim.spawn
  );
}

function finishTurn(state: GameState): GameState {
  const previousIndex = state.currentPlayerIndex;
  const nextIndex = (state.currentPlayerIndex + 1) % state.players.length;

  return {
    ...state,
    currentPlayerIndex: nextIndex,
    stage: 'Roll',
    dice: null,
    actionPower: null,
    selectedPieceId: null,
    moveDraft: null,
    reachableCells: [],
    turnNumber: nextIndex <= previousIndex ? state.turnNumber + 1 : state.turnNumber,
  };
}

export function finishBattle(state: GameState): GameState {
  if (state.stage !== 'Battle' || state.winnerId) {
    return state;
  }

  return finishTurn(state);
}

export function rollForCurrentPlayer(state: GameState, dice = rollDie()): GameState {
  if (state.stage !== 'Roll' || state.winnerId) {
    return state;
  }

  const currentPlayer = getCurrentPlayer(state);
  const actionPower = Math.max(0, dice + currentPlayer.pendingMoveDelta);
  const players = state.players.map((player) =>
    player.id === currentPlayer.id ? { ...player, pendingMoveDelta: 0 } : player,
  );

  const modifierText =
    currentPlayer.pendingMoveDelta === 0
      ? ''
      : currentPlayer.pendingMoveDelta > 0
        ? `，加速 ${currentPlayer.pendingMoveDelta > 0 ? '+' : ''}${currentPlayer.pendingMoveDelta}`
        : `，陷阱 ${currentPlayer.pendingMoveDelta}`;

  let nextState: GameState = {
    ...state,
    players,
    dice,
    actionPower,
    selectedPieceId: null,
    moveDraft: null,
    reachableCells: [],
    stage: 'Select',
  };

  nextState = appendLog(
    nextState,
    `${currentPlayer.name}掷出 ${dice}${modifierText}，行动力 ${actionPower}。`,
  );

  const selectablePieceIds = getSelectablePieceIds(nextState);
  if (selectablePieceIds.length === 0) {
    nextState = appendLog(nextState, `${currentPlayer.name}没有可移动棋子，跳过。`, 'warning');
    return finishTurn(nextState);
  }

  return nextState;
}

export function selectPiece(state: GameState, pieceId: string): GameState {
  const piece = getPieceById(state, pieceId);
  if (!piece || !isPieceSelectable(state, piece)) {
    return state;
  }

  const stepReachableCells = getStepReachableCells(
    state.board,
    state.pieces,
    piece,
    piece.position,
    state.actionPower ?? 0,
  );

  return {
    ...state,
    stage: 'Move',
    selectedPieceId: pieceId,
    moveDraft: {
      pieceId,
      from: { ...piece.position },
      current: { ...piece.position },
      remainingPower: state.actionPower ?? 0,
      path: [],
    },
    reachableCells: stepReachableCells,
  };
}

export function moveSelectedPiece(state: GameState, target: Coord): GameState {
  if (state.stage !== 'Move' || !state.selectedPieceId || !state.moveDraft) {
    return state;
  }

  const selectedPiece = getPieceById(state, state.selectedPieceId);
  if (!selectedPiece) {
    return state;
  }

  const stepOptions = getStepOptions(
    state.board,
    state.pieces,
    selectedPiece,
    state.moveDraft.current,
    state.moveDraft.remainingPower,
    state.moveDraft.path,
  );
  const stepOption = stepOptions.find((option) => sameCoord(option.coord, target));
  if (!stepOption) {
    const reason = explainInvalidStep(
      state.board,
      state.pieces,
      selectedPiece,
      state.moveDraft.current,
      state.moveDraft.remainingPower,
      target,
      state.moveDraft.path,
    );
    return withNotice(state, reason, 'warning');
  }

  const steppedOnCell = getCell(state.board, stepOption.coord);
  let nextState = state;
  if (steppedOnCell.type === 'boost') {
    nextState = withNotice(nextState, `经过加速格：行动力 +1，剩余 ${stepOption.remainingPower}`, 'success');
  } else if (steppedOnCell.type === 'trap') {
    nextState = withNotice(nextState, `经过陷阱格：行动力 -1，剩余 ${stepOption.remainingPower}`, 'warning');
  }

  if (stepOption.remainingPower > 0) {
    return {
      ...nextState,
      actionPower: stepOption.remainingPower,
      moveDraft: {
        ...state.moveDraft,
        current: { ...stepOption.final },
        remainingPower: stepOption.remainingPower,
        path: stepOption.path,
      },
      reachableCells: getStepReachableCells(
        state.board,
        state.pieces,
        selectedPiece,
        stepOption.final,
        stepOption.remainingPower,
        stepOption.path,
      ),
    };
  }

  return movePieceToReachableCell(nextState, selectedPiece, {
    coord: stepOption.coord,
    distance: stepOption.path.length,
    path: stepOption.path,
    tileType: stepOption.tileType,
    isAttack: stepOption.isAttack,
    occupantIds: stepOption.occupantIds,
  });
}

export function movePieceToReachableCell(state: GameState, piece: Piece, reachable: ReachableCell): GameState {
  const currentPlayer = getPlayerById(state, piece.playerId);
  const preview = previewMove(state, piece, reachable.coord);
  const capturedPieces = preview.capturedPieceIds
    .map((pieceId) => getPieceById(state, pieceId))
    .filter((capturedPiece): capturedPiece is Piece => Boolean(capturedPiece));

  let nextPieces = state.pieces.map((candidate) => {
    if (preview.capturedPieceIds.includes(candidate.id)) {
      return {
        ...candidate,
        position: findRespawnCoord(state.board, state.pieces, candidate, preview.capturedPieceIds),
        home: false,
      };
    }

    if (candidate.id === piece.id) {
      return {
        ...candidate,
        position: { ...preview.final },
        home: preview.wouldHome,
      };
    }

    return candidate;
  });

  const winnerId =
    nextPieces.filter((candidate) => candidate.playerId === piece.playerId && candidate.home).length ===
    PIECES_PER_PLAYER
      ? piece.playerId
      : null;

  const portalTransition = findPortalTransitionInPath(state.board, reachable.path);
  const pathEffects = getPathPowerEffects(state.board, reachable.path);
  const moveResult: MoveResult = {
    ...preview,
    ...portalTransition,
    id: moveId++,
    pieceId: piece.id,
    playerId: piece.playerId,
    from: { ...piece.position },
    path: reachable.path,
    timestamp: Date.now(),
  };

  let nextState: GameState = {
    ...state,
    pieces: nextPieces,
    winnerId,
    selectedPieceId: null,
    moveDraft: null,
    reachableCells: [],
    lastMove: moveResult,
    stage: winnerId ? 'End' : capturedPieces.length > 0 ? 'Battle' : 'Roll',
    dice: winnerId ? state.dice : capturedPieces.length > 0 ? state.dice : null,
    actionPower: winnerId ? state.actionPower : capturedPieces.length > 0 ? state.actionPower : null,
  };

  const moveText = `${currentPlayer.name}${piece.index + 1}号移动到 ${coordKey(preview.final)}。`;
  nextState = appendLog(nextState, moveText);

  if (portalTransition.portalTo) {
    nextState = appendLog(
      nextState,
      `${currentPlayer.name}使用传送门 ${coordKey(portalTransition.portalFrom!)} -> ${coordKey(portalTransition.portalTo)}。`,
      'success',
    );
  }

  if (!state.moveDraft && (pathEffects.boostCount > 0 || pathEffects.trapCount > 0)) {
    const boostText = pathEffects.boostCount > 0 ? `加速 +${pathEffects.boostCount}` : '';
    const trapText = pathEffects.trapCount > 0 ? `陷阱 -${pathEffects.trapCount}` : '';
    nextState = appendLog(
      nextState,
      `路径效果：${[boostText, trapText].filter(Boolean).join('，')}。`,
      pathEffects.trapCount > pathEffects.boostCount ? 'warning' : 'success',
    );
  }

  if (capturedPieces.length > 0) {
    nextState = appendLog(
      nextState,
      `${currentPlayer.name}吃掉 ${capturedPieces.map((captured) => `${getPlayerById(state, captured.playerId).name}${captured.index + 1}号`).join('、')}。`,
      'danger',
    );
  }

  if (preview.wouldHome) {
    nextState = appendLog(nextState, `${currentPlayer.name}${piece.index + 1}号回家。`, 'success');
  }

  if (winnerId) {
    nextState = appendLog(nextState, `${currentPlayer.name}获胜。`, 'success');
  }

  if (!winnerId && capturedPieces.length === 0) {
    nextState = finishTurn(nextState);
  }

  return nextState;
}
