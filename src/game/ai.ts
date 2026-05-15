import { getCell, sameCoord } from './board';
import { getReachableCells } from './movement';
import { distanceToNearestGoal, getCurrentPlayer, previewMove } from './rules';
import type { Coord, GameState, Piece, ReachableCell } from './types';

interface AiChoice {
  piece: Piece;
  reachable: ReachableCell;
  score: number;
}

function scoreCandidate(state: GameState, piece: Piece, reachable: ReachableCell): number {
  const preview = previewMove(state, piece, reachable.coord);
  const finalCell = getCell(state.board, preview.final);
  const beforeDistance = distanceToNearestGoal(state.board, piece.position, piece.playerId);
  const afterDistance = preview.wouldHome
    ? 0
    : distanceToNearestGoal(state.board, preview.final, piece.playerId);

  let score = 0;
  score += preview.capturedPieceIds.length * 1100;
  score += preview.wouldHome ? 950 : 0;
  score += finalCell.type === 'boost' ? 190 : 0;
  score += finalCell.type === 'safe' ? 150 : 0;
  score += finalCell.type === 'trap' ? -320 : 0;
  score += finalCell.type === 'portal' || preview.portalTo ? 45 : 0;
  score += (beforeDistance - afterDistance) * 22;
  score -= reachable.distance * 0.6;

  if (preview.portalBlocked) {
    score -= 60;
  }

  return score;
}

export function chooseAiMove(state: GameState): { pieceId: string; target: Coord } | null {
  const currentPlayer = getCurrentPlayer(state);
  const choices: AiChoice[] = state.pieces
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

  const best = choices[0];
  return {
    pieceId: best.piece.id,
    target: best.reachable.coord,
  };
}
