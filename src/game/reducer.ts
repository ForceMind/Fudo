import { chooseAiMove } from './ai';
import {
  appendLog,
  createInitialState,
  distanceToNearestGoal,
  finishBattle,
  getCurrentPlayer,
  getPieceById,
  getSelectablePieceIds,
  movePieceToReachableCell,
  moveSelectedPiece,
  previewMove,
  rollForCurrentPlayer,
  selectPiece,
  withGlobalNotice,
} from './rules';
import { getReachableCells } from './movement';
import { getCell } from './board';
import type { Coord, GameState, PlayerConfigInput } from './types';

export type GameAction =
  | { type: 'ROLL_DICE' }
  | { type: 'SELECT_PIECE'; pieceId: string }
  | { type: 'MOVE_TO'; coord: Coord }
  | { type: 'FINISH_BATTLE' }
  | { type: 'AI_TURN' }
  | { type: 'TIMEOUT_AI_TURN' }
  | { type: 'RESTART'; players?: PlayerConfigInput[] };

function chooseReachableForPiece(state: GameState, pieceId: string, from: Coord, power: number) {
  const piece = getPieceById(state, pieceId);
  if (!piece) {
    return null;
  }

  const virtualPiece = { ...piece, position: from };
  const choices = getReachableCells(state.board, state.pieces, virtualPiece, power);
  if (choices.length === 0) {
    return null;
  }

  return choices
    .map((reachable) => {
      const preview = previewMove(state, piece, reachable.coord);
      const finalCell = getCell(state.board, preview.final);
      const beforeDistance = distanceToNearestGoal(state.board, from, piece.playerId);
      const afterDistance = preview.wouldHome
        ? 0
        : distanceToNearestGoal(state.board, preview.final, piece.playerId);
      return {
        reachable,
        score:
          preview.capturedPieceIds.length * 1000 +
          (preview.wouldHome ? 900 : 0) +
          (finalCell.type === 'boost' || finalCell.type === 'safe' ? 140 : 0) -
          (finalCell.type === 'trap' ? 260 : 0) +
          (beforeDistance - afterDistance) * 20,
      };
    })
    .sort((a, b) => b.score - a.score || b.reachable.distance - a.reachable.distance)[0].reachable;
}

function runAiTurn(state: GameState, allowHuman = false): GameState {
  const currentPlayer = getCurrentPlayer(state);
  if (state.winnerId || (!allowHuman && currentPlayer.isHuman)) {
    return state;
  }

  if (state.stage === 'Battle') {
    return finishBattle(state);
  }

  if (state.stage === 'Move' && state.moveDraft) {
    const selectedPiece = getPieceById(state, state.moveDraft.pieceId);
    const reachable = chooseReachableForPiece(
      state,
      state.moveDraft.pieceId,
      state.moveDraft.current,
      state.moveDraft.remainingPower,
    );
    if (!selectedPiece || !reachable) {
      return state;
    }

    return movePieceToReachableCell(state, selectedPiece, {
      ...reachable,
      distance: state.moveDraft.path.length + reachable.path.length,
      path: [...state.moveDraft.path, ...reachable.path],
    });
  }

  const nextState = state.stage === 'Roll' ? rollForCurrentPlayer(state) : state;
  if (nextState.stage !== 'Select') {
    return nextState;
  }

  const choice = chooseAiMove(nextState);
  if (!choice) {
    return nextState;
  }

  const piece = getPieceById(nextState, choice.pieceId);
  if (!piece) {
    return nextState;
  }

  const reachable = getReachableCells(nextState.board, nextState.pieces, piece, nextState.actionPower ?? 0).find(
    (cell) => cell.coord.x === choice.target.x && cell.coord.y === choice.target.y,
  );

  if (!reachable) {
    return nextState;
  }

  return movePieceToReachableCell(
    {
      ...nextState,
      selectedPieceId: piece.id,
      reachableCells: getReachableCells(nextState.board, nextState.pieces, piece, nextState.actionPower ?? 0),
      stage: 'Move',
    },
    piece,
    reachable,
  );
}

export function gameReducer(state: GameState, action: GameAction): GameState {
  switch (action.type) {
    case 'ROLL_DICE':
      return getCurrentPlayer(state).isHuman ? rollForCurrentPlayer(state) : state;

    case 'SELECT_PIECE':
      return selectPiece(state, action.pieceId);

    case 'MOVE_TO':
      return moveSelectedPiece(state, action.coord);

    case 'FINISH_BATTLE':
      return finishBattle(state);

    case 'AI_TURN':
      return state.stage === 'Roll' ? runAiTurn(state) : state;

    case 'TIMEOUT_AI_TURN': {
      const currentPlayer = getCurrentPlayer(state);
      if (!currentPlayer.isHuman || state.winnerId) {
        return state;
      }

      const timeoutMessage = `${currentPlayer.name} 回合超时，AI 接管本次行动。`;
      return runAiTurn(appendLog(withGlobalNotice(state, timeoutMessage, 'warning'), timeoutMessage, 'warning'), true);
    }

    case 'RESTART':
      return createInitialState(action.players);

    default:
      return state;
  }
}

export { createInitialState, getSelectablePieceIds };
