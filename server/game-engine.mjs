const DIRECTIONS = [
  { x: 1, y: 0 },
  { x: -1, y: 0 },
  { x: 0, y: 1 },
  { x: 0, y: -1 },
];
const PIECES_PER_PLAYER = 4;
const MAX_LOGS = 60;

function coordKey(coord) {
  return `${coord.x},${coord.y}`;
}

function sameCoord(a, b) {
  return a.x === b.x && a.y === b.y;
}

function inBounds(board, coord) {
  return coord.x >= 0 && coord.y >= 0 && coord.x < board.size && coord.y < board.size;
}

function getCell(board, coord) {
  const cell = board.cells[coord.y * board.size + coord.x];
  if (!cell) {
    throw new Error(`Cell out of bounds: ${coordKey(coord)}`);
  }
  return cell;
}

function findPortalPair(board, coord) {
  const cell = getCell(board, coord);
  if (cell.type !== 'portal' || !cell.portalId) {
    return null;
  }

  const pair = board.portals[cell.portalId] ?? [];
  return pair.find((portalCoord) => !sameCoord(portalCoord, coord)) ?? null;
}

function isGoalForPlayer(board, coord, playerId) {
  return board.goalCells[playerId].some((goal) => sameCoord(goal, coord));
}

function piecesAt(pieces, coord, exceptPieceId) {
  return pieces.filter((piece) => piece.id !== exceptPieceId && sameCoord(piece.position, coord));
}

function getSpawnOrigin(board, piece) {
  const spawnCells = board.spawnCells[piece.playerId];
  const averageX = spawnCells.reduce((sum, coord) => sum + coord.x, 0) / spawnCells.length;
  const averageY = spawnCells.reduce((sum, coord) => sum + coord.y, 0) / spawnCells.length;

  return {
    x: averageX < board.size / 2 ? 0 : board.size - 1,
    y: averageY < board.size / 2 ? 0 : board.size - 1,
  };
}

function distanceFromOrigin(coord, origin) {
  return Math.abs(coord.x - origin.x) + Math.abs(coord.y - origin.y);
}

function hasEnemyInCenter(board, pieces, piece) {
  return pieces.some((candidate) => {
    if (candidate.home || candidate.id === piece.id || candidate.playerId === piece.playerId) {
      return false;
    }

    return getCell(board, candidate.position).type === 'center';
  });
}

function isForbiddenOwnedTile(board, coord, piece) {
  const cell = getCell(board, coord);
  return (cell.type === 'spawn' || cell.type === 'goal') && Boolean(cell.ownerId) && cell.ownerId !== piece.playerId;
}

function getHomeBand(board, piece) {
  const goals = board.goalCells[piece.playerId];
  const minX = Math.min(...goals.map((goal) => goal.x));
  const maxX = Math.max(...goals.map((goal) => goal.x));
  const minY = Math.min(...goals.map((goal) => goal.y));
  const maxY = Math.max(...goals.map((goal) => goal.y));
  const touchesTopOrBottom = minY === 0 || maxY === board.size - 1;

  return touchesTopOrBottom
    ? { orientation: 'rows', min: minY, max: maxY }
    : { orientation: 'columns', min: minX, max: maxX };
}

function isInHomeBand(board, coord, piece) {
  const band = getHomeBand(board, piece);
  return band.orientation === 'rows'
    ? coord.y >= band.min && coord.y <= band.max
    : coord.x >= band.min && coord.x <= band.max;
}

function getTilePowerDelta(board, coord) {
  const cell = getCell(board, coord);
  if (cell.type === 'boost') {
    return 1;
  }
  if (cell.type === 'trap') {
    return -1;
  }
  return 0;
}

function getReachableCells(board, pieces, piece, power) {
  if (piece.home || power <= 0) {
    return [];
  }

  const spawnOrigin = getSpawnOrigin(board, piece);
  const enemyOwnsCenter = hasEnemyInCenter(board, pieces, piece);
  const resultByKey = new Map();
  const visited = new Set();
  const startKey = coordKey(piece.position);
  const queue = [{ coord: piece.position, remaining: power, steps: 0, path: [] }];

  visited.add(`${startKey}|${power}`);

  while (queue.length > 0) {
    const current = queue.shift();

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

      if (
        !currentInHomeBand &&
        !leavingPortal &&
        distanceFromOrigin(next, spawnOrigin) <= distanceFromOrigin(current.coord, spawnOrigin)
      ) {
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

function getCurrentPlayer(state) {
  return state.players[state.currentPlayerIndex];
}

function getPlayerById(state, playerId) {
  return state.players.find((player) => player.id === playerId);
}

function getPieceById(state, pieceId) {
  return state.pieces.find((piece) => piece.id === pieceId);
}

function getActivePiecesAt(state, coord, exceptPieceId) {
  return state.pieces.filter((piece) => {
    if (piece.home || piece.id === exceptPieceId) {
      return false;
    }
    return sameCoord(piece.position, coord);
  });
}

function distanceToNearestGoal(board, coord, playerId) {
  return Math.min(...board.goalCells[playerId].map((goal) => Math.abs(goal.x - coord.x) + Math.abs(goal.y - coord.y)));
}

function previewMove(state, piece, target) {
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
  const tileEffect = wouldHome ? 'goal' : finalCell.type;

  return {
    target,
    final,
    capturedPieceIds,
    wouldHome,
    tileEffect,
  };
}

function nextLogId(state) {
  return Math.max(0, ...(state.logs ?? []).map((log) => Number(log.id) || 0)) + 1;
}

function appendLog(state, text, tone = 'info') {
  return {
    ...state,
    logs: [{ id: nextLogId(state), text, tone }, ...(state.logs ?? [])].slice(0, MAX_LOGS),
  };
}

function rollDie() {
  return Math.floor(Math.random() * 6) + 1;
}

function getSelectablePieceIds(state) {
  const currentPlayer = getCurrentPlayer(state);
  return state.pieces
    .filter((piece) => piece.playerId === currentPlayer.id)
    .filter((piece) => getReachableCells(state.board, state.pieces, piece, state.actionPower ?? 0).length > 0)
    .map((piece) => piece.id);
}

function finishTurn(state) {
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

function finishBattle(state) {
  if (state.stage !== 'Battle' || state.winnerId) {
    return state;
  }

  return finishTurn(state);
}

function rollForCurrentPlayer(state, dice = rollDie()) {
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

  let nextState = {
    ...state,
    players,
    dice,
    actionPower,
    selectedPieceId: null,
    moveDraft: null,
    reachableCells: [],
    stage: 'Select',
  };

  nextState = appendLog(nextState, `${currentPlayer.name}掷出 ${dice}${modifierText}，行动力 ${actionPower}。`);

  const selectablePieceIds = getSelectablePieceIds(nextState);
  if (selectablePieceIds.length === 0) {
    nextState = appendLog(nextState, `${currentPlayer.name}没有可移动棋子，跳过。`, 'warning');
    return finishTurn(nextState);
  }

  return nextState;
}

function findRespawnCoord(board, pieces, victim, capturedIds) {
  const activeFriendlyPieces = pieces.filter(
    (piece) => piece.playerId === victim.playerId && !piece.home && !capturedIds.includes(piece.id),
  );

  return (
    board.spawnCells[victim.playerId].find(
      (spawn) => !activeFriendlyPieces.some((piece) => sameCoord(piece.position, spawn)),
    ) ?? victim.spawn
  );
}

function getPathPowerEffects(board, path) {
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

function findPortalTransitionInPath(board, path) {
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

function nextMoveId(state) {
  return Number(state.lastMove?.id ?? 0) + 1;
}

function movePieceToReachableCell(state, piece, reachable) {
  const currentPlayer = getPlayerById(state, piece.playerId);
  const preview = previewMove(state, piece, reachable.coord);
  const capturedPieces = preview.capturedPieceIds.map((pieceId) => getPieceById(state, pieceId)).filter(Boolean);

  const nextPieces = state.pieces.map((candidate) => {
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
    nextPieces.filter((candidate) => candidate.playerId === piece.playerId && candidate.home).length === PIECES_PER_PLAYER
      ? piece.playerId
      : null;

  const portalTransition = findPortalTransitionInPath(state.board, reachable.path);
  const pathEffects = getPathPowerEffects(state.board, reachable.path);
  const moveResult = {
    ...preview,
    ...portalTransition,
    id: nextMoveId(state),
    pieceId: piece.id,
    playerId: piece.playerId,
    from: { ...piece.position },
    path: reachable.path,
    timestamp: Date.now(),
  };

  let nextState = {
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

  nextState = appendLog(nextState, `${currentPlayer.name}${piece.index + 1}号移动到 ${coordKey(preview.final)}。`);

  if (portalTransition.portalTo) {
    nextState = appendLog(
      nextState,
      `${currentPlayer.name}使用传送门 ${coordKey(portalTransition.portalFrom)} -> ${coordKey(portalTransition.portalTo)}。`,
      'success',
    );
  }

  if (pathEffects.boostCount > 0 || pathEffects.trapCount > 0) {
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
      `${currentPlayer.name}吃掉 ${capturedPieces
        .map((captured) => `${getPlayerById(state, captured.playerId).name}${captured.index + 1}号`)
        .join('、')}。`,
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

function scoreCandidate(state, piece, reachable) {
  const preview = previewMove(state, piece, reachable.coord);
  const finalCell = getCell(state.board, preview.final);
  const beforeDistance = distanceToNearestGoal(state.board, piece.position, piece.playerId);
  const afterDistance = preview.wouldHome ? 0 : distanceToNearestGoal(state.board, preview.final, piece.playerId);

  let score = 0;
  score += preview.capturedPieceIds.length * 1100;
  score += preview.wouldHome ? 950 : 0;
  score += finalCell.type === 'boost' ? 190 : 0;
  score += finalCell.type === 'safe' ? 150 : 0;
  score += finalCell.type === 'trap' ? -320 : 0;
  score += finalCell.type === 'portal' || preview.portalTo ? 45 : 0;
  score += (beforeDistance - afterDistance) * 22;
  score -= reachable.distance * 0.6;
  return score;
}

function chooseAiMove(state) {
  const currentPlayer = getCurrentPlayer(state);
  const choices = state.pieces
    .filter((piece) => piece.playerId === currentPlayer.id && !piece.home)
    .flatMap((piece) =>
      getReachableCells(state.board, state.pieces, piece, state.actionPower ?? 0).map((reachable) => ({
        piece,
        reachable,
        score: scoreCandidate(state, piece, reachable),
      })),
    );

  if (choices.length === 0) {
    return null;
  }

  choices.sort((a, b) => {
    if (b.score !== a.score) {
      return b.score - a.score;
    }

    if (a.reachable.distance !== b.reachable.distance) {
      return b.reachable.distance - a.reachable.distance;
    }

    if (!sameCoord(a.reachable.coord, b.reachable.coord)) {
      return a.reachable.coord.y - b.reachable.coord.y || a.reachable.coord.x - b.reachable.coord.x;
    }

    return a.piece.index - b.piece.index;
  });

  return choices[0];
}

function moveAiFromSelect(state) {
  const choice = chooseAiMove(state);
  if (!choice) {
    return state;
  }

  return movePieceToReachableCell(
    {
      ...state,
      selectedPieceId: choice.piece.id,
      reachableCells: getReachableCells(state.board, state.pieces, choice.piece, state.actionPower ?? 0),
      stage: 'Move',
    },
    choice.piece,
    choice.reachable,
  );
}

function advanceOneAiStep(state) {
  const currentPlayer = getCurrentPlayer(state);
  if (!currentPlayer || currentPlayer.isHuman || state.winnerId || state.stage === 'End') {
    return state;
  }

  if (state.stage === 'Battle') {
    return finishBattle(state);
  }

  if (state.stage === 'Roll') {
    const rolledState = rollForCurrentPlayer(state);
    return rolledState.stage === 'Select' ? moveAiFromSelect(rolledState) : rolledState;
  }

  if (state.stage === 'Select') {
    return moveAiFromSelect(state);
  }

  return state;
}

export function advanceServerAiTurns(gameState, maxSteps = 12) {
  let state = gameState;
  let changed = false;

  for (let step = 0; step < maxSteps; step += 1) {
    const nextState = advanceOneAiStep(state);
    if (nextState === state) {
      break;
    }

    state = nextState;
    changed = true;

    const currentPlayer = getCurrentPlayer(state);
    if (!currentPlayer || currentPlayer.isHuman || state.winnerId || state.stage === 'End') {
      break;
    }
  }

  return { gameState: state, changed };
}
