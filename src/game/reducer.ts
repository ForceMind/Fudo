import { chooseAiMove } from './ai';
import {
  createInitialState,
  finishBattle,
  getCurrentPlayer,
  getPieceById,
  getSelectablePieceIds,
  movePieceToReachableCell,
  moveSelectedPiece,
  rollForCurrentPlayer,
  selectPiece,
} from './rules';
import { getReachableCells } from './movement';
import type { Coord, GameState, PlayerConfigInput } from './types';

export type GameAction =
  | { type: 'ROLL_DICE' }
  | { type: 'SELECT_PIECE'; pieceId: string }
  | { type: 'MOVE_TO'; coord: Coord }
  | { type: 'FINISH_BATTLE' }
  | { type: 'AI_TURN' }
  | { type: 'RESTART'; players?: PlayerConfigInput[] };

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

    case 'AI_TURN': {
      const currentPlayer = getCurrentPlayer(state);
      if (state.stage !== 'Roll' || currentPlayer.isHuman || state.winnerId) {
        return state;
      }

      let nextState = rollForCurrentPlayer(state);
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

    case 'RESTART':
      return createInitialState(action.players);

    default:
      return state;
  }
}

export { createInitialState, getSelectablePieceIds };
