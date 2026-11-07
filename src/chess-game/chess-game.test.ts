import { describe, expect, it } from 'vitest';
import { FakeClock } from '../shared/clock';
import { SequentialIdGenerator } from '../shared/id-generator';
import {
  Color,
  EmptySquareError,
  Game,
  GameOverError,
  GameStatus,
  IllegalMoveError,
  InvalidFenError,
  InvalidPromotionError,
  InvalidSquareError,
  MoveLeavesKingInCheckError,
  NothingToUndoError,
  NotYourTurnError,
  PieceType,
  STANDARD_SETUP,
} from './index';

function newGame(fen?: string) {
  const clock = new FakeClock('2026-03-01T18:00:00Z');
  const options = { clock, ids: new SequentialIdGenerator() };
  return { game: fen ? Game.fromFen(fen, options) : new Game(options), clock };
}

function playAll(game: Game, moves: string): void {
  for (const pair of moves.split(' ')) game.move(pair.slice(0, 2), pair.slice(2, 4));
}

describe('Game rules', () => {
  it("scholar's mate ends in CHECKMATE and refuses further moves", () => {
    const { game, clock } = newGame();
    playAll(game, 'e2e4 e7e5 f1c4 b8c6 d1h5 g8f6');
    clock.advanceMinutes(3);
    const mate = game.move('h5', 'f7');

    expect(game.id).toBe('GAME-1');
    expect(mate.notation).toBe('Qh5xf7#');
    expect(mate.playedAt.toISOString()).toBe('2026-03-01T18:03:00.000Z');
    expect(game.status).toBe(GameStatus.CHECKMATE);
    expect(game.winner).toBe(Color.WHITE);
    expect(() => game.move('e8', 'e7')).toThrow(GameOverError);
  });

  it('rejects a move that exposes the own king and leaves the board untouched', () => {
    const { game } = newGame('4k3/4r3/8/8/8/8/4B3/4K3 w');
    const before = game.fen;
    expect(() => game.move('e2', 'd3')).toThrow(MoveLeavesKingInCheckError);
    expect(game.fen).toBe(before);
    expect(game.legalMoves('e2')).toEqual([]);
    expect(game.legalMoves('e1')).not.toContain('e2');
  });

  it('detects check when the king still has an escape', () => {
    const { game } = newGame('4k3/8/8/8/8/8/8/R3K3 w');
    expect(game.move('a1', 'a8').notation).toBe('Ra1-a8+');
    expect(game.status).toBe(GameStatus.CHECK);
    expect(game.legalMoves('e8')).toEqual(['d7', 'e7', 'f7']);
  });

  it('detects stalemate: no legal move and not in check', () => {
    const { game } = newGame('k7/8/1K6/8/8/8/8/2Q5 w');
    game.move('c1', 'c7');
    expect(game.status).toBe(GameStatus.STALEMATE);
    expect(game.winner).toBeUndefined();
    expect(() => game.move('a8', 'b8')).toThrow(GameOverError);
  });

  it('enforces turn order and reports bad input with domain errors', () => {
    const { game } = newGame();
    expect(() => game.move('e7', 'e5')).toThrow(NotYourTurnError);
    expect(() => game.move('e4', 'e5')).toThrow(EmptySquareError);
    expect(() => game.move('z9', 'e4')).toThrow(InvalidSquareError);
    expect(() => game.move('e2', 'e5')).toThrow(IllegalMoveError);
    expect(() => game.undo()).toThrow(NothingToUndoError);
    expect(() => Game.fromFen('8/8/8 w')).toThrow(InvalidFenError);
  });
});

describe('Pieces', () => {
  it('knights jump in an L from the corner and from the centre', () => {
    expect(newGame().game.legalMoves('b1')).toEqual(['a3', 'c3']);
    const { game } = newGame('4k3/8/8/8/3N4/8/8/4K3 w');
    expect(game.legalMoves('d4')).toEqual(['b3', 'b5', 'c2', 'c6', 'e2', 'e6', 'f3', 'f5']);
  });

  it('pawns double-step only from the start rank, are blocked ahead, and capture diagonally', () => {
    const { game } = newGame();
    expect(game.legalMoves('e2')).toEqual(['e3', 'e4']);
    playAll(game, 'e2e4 d7d5');
    expect(game.legalMoves('e4')).toEqual(['d5', 'e5']);
    const capture = game.move('e4', 'd5');
    expect(capture.notation).toBe('e4xd5');
    expect(game.pieceAt('d5')?.color).toBe(Color.WHITE);
    expect(newGame('4k3/8/8/8/4p3/4P3/8/4K3 w').game.legalMoves('e3')).toEqual([]);
  });

  it('promotes to a queen by default, to a chosen piece on request, never to a king', () => {
    const queen = newGame('8/P6k/8/8/8/8/8/K7 w').game;
    expect(queen.move('a7', 'a8').notation).toBe('a7-a8=Q');
    expect(queen.pieceAt('a8')?.type).toBe(PieceType.QUEEN);

    const knight = newGame('8/P6k/8/8/8/8/8/K7 w').game;
    knight.move('a7', 'a8', PieceType.KNIGHT);
    expect(knight.pieceAt('a8')?.letter).toBe('N');

    const king = newGame('8/P6k/8/8/8/8/8/K7 w').game;
    expect(() => king.move('a7', 'a8', PieceType.KING)).toThrow(InvalidPromotionError);
    expect(king.pieceAt('a7')?.type).toBe(PieceType.PAWN);
  });
});

describe('Undo (Command history)', () => {
  it('restores captured pieces, the turn and the start position', () => {
    const { game } = newGame();
    playAll(game, 'e2e4 d7d5 e4d5');
    expect(game.undo().notation).toBe('e4xd5');
    expect(game.pieceAt('d5')?.color).toBe(Color.BLACK);
    expect(game.turn).toBe(Color.WHITE);
    game.undo();
    game.undo();
    expect(game.fen).toBe(`${STANDARD_SETUP} w`);
    expect(game.moves).toHaveLength(0);
  });

  it('undoing a mate reopens the game and undoing a promotion brings the pawn back', () => {
    const { game } = newGame();
    playAll(game, 'e2e4 e7e5 f1c4 b8c6 d1h5 g8f6 h5f7');
    game.undo();
    expect(game.status).toBe(GameStatus.ACTIVE);
    expect(game.pieceAt('f7')?.type).toBe(PieceType.PAWN);

    const promo = newGame('8/P6k/8/8/8/8/8/K7 w').game;
    promo.move('a7', 'a8');
    promo.undo();
    expect(promo.pieceAt('a7')?.type).toBe(PieceType.PAWN);
    expect(promo.pieceAt('a8')).toBeNull();
  });
});
