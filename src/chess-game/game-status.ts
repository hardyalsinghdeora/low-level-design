import { GameOverError } from './errors';

export enum GameStatus {
  ACTIVE = 'ACTIVE',
  CHECK = 'CHECK',
  CHECKMATE = 'CHECKMATE',
  STALEMATE = 'STALEMATE',
}

const LIVE = [GameStatus.ACTIVE, GameStatus.CHECK, GameStatus.CHECKMATE, GameStatus.STALEMATE];

/** Forward transitions a played move may cause. Terminal states have none; only undo leaves them. */
const NEXT: Record<GameStatus, readonly GameStatus[]> = {
  [GameStatus.ACTIVE]: LIVE,
  [GameStatus.CHECK]: LIVE,
  [GameStatus.CHECKMATE]: [],
  [GameStatus.STALEMATE]: [],
};

export function isTerminal(status: GameStatus): boolean {
  return NEXT[status].length === 0;
}

export function assertTransition(from: GameStatus, to: GameStatus): void {
  if (!NEXT[from].includes(to)) throw new GameOverError(from);
}
