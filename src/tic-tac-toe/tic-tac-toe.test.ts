import { beforeEach, describe, expect, it } from 'vitest';
import {
  Board,
  CellOccupiedError,
  Game,
  GameOverError,
  GameStatus,
  HumanMoveStrategy,
  LineKind,
  type MoveOutcome,
  NoMoveProvidedError,
  NothingToUndoError,
  NotYourTurnError,
  OutOfBoundsError,
  Player,
  PlayerSymbol,
  RandomMoveStrategy,
} from './index';

/** Plays the cells in order, alternating players, and returns the last outcome. */
function play(game: Game, cells: Array<[number, number]>): MoveOutcome {
  let last: MoveOutcome | undefined;
  for (const [row, col] of cells) last = game.makeMove(game.currentPlayer, row, col);
  if (!last) throw new Error('play() needs at least one cell');
  return last;
}

/** Deterministic stand-in for Math.random: returns the given values in order. */
function sequence(...values: number[]): () => number {
  return () => {
    const next = values.shift();
    if (next === undefined) throw new Error('rng sequence exhausted');
    return next;
  };
}

describe('Game on a 3x3 board', () => {
  let x: Player;
  let o: Player;
  let game: Game;

  beforeEach(() => {
    x = new Player('Xena', PlayerSymbol.X);
    o = new Player('Omar', PlayerSymbol.O);
    game = new Game(x, o);
  });

  it('detects a completed row and then refuses further moves', () => {
    const outcome = play(game, [[0, 0], [1, 0], [0, 1], [1, 1], [0, 2]]);

    expect(outcome.status).toBe(GameStatus.WON);
    expect(outcome.winner).toBe(x);
    expect(outcome.winningLine).toEqual({ kind: LineKind.ROW, index: 0 });
    expect(() => game.makeMove(o, 2, 2)).toThrow(GameOverError);
    expect(() => game.playTurn()).toThrow(GameOverError);
  });

  it('detects a completed column for the second player', () => {
    const outcome = play(game, [[0, 0], [0, 1], [2, 2], [1, 1], [1, 0], [2, 1]]);

    expect(outcome.winner).toBe(o);
    expect(game.winningLine).toEqual({ kind: LineKind.COLUMN, index: 1 });
  });

  it('detects both diagonals', () => {
    play(game, [[0, 0], [0, 1], [1, 1], [0, 2], [2, 2]]);
    expect(game.winningLine?.kind).toBe(LineKind.DIAGONAL);

    const other = new Game(x, o);
    play(other, [[0, 2], [0, 0], [1, 1], [0, 1], [2, 0]]);
    expect(other.winningLine?.kind).toBe(LineKind.ANTI_DIAGONAL);
    expect(other.winner).toBe(x);
  });

  it('declares a draw when the board fills up without a line', () => {
    const outcome = play(game, [[0, 0], [0, 1], [0, 2], [1, 1], [1, 0], [1, 2], [2, 1], [2, 0], [2, 2]]);

    expect(outcome.status).toBe(GameStatus.DRAW);
    expect(outcome.winner).toBeNull();
    expect(game.board.isFull).toBe(true);
    expect(() => game.makeMove(o, 0, 0)).toThrow(GameOverError);
  });

  it('rejects out-of-bounds and occupied cells without using up the turn', () => {
    game.makeMove(x, 1, 1);

    expect(() => game.makeMove(o, 3, 0)).toThrow(OutOfBoundsError);
    expect(() => game.makeMove(o, 0, -1)).toThrow(OutOfBoundsError);
    expect(() => game.makeMove(o, 1, 1)).toThrow(CellOccupiedError);
    expect(game.currentPlayer).toBe(o);
    expect(game.moves).toHaveLength(1);
  });

  it('enforces turn order, including for a player who is not seated', () => {
    game.makeMove(x, 0, 0);

    expect(() => game.makeMove(x, 1, 1)).toThrow(NotYourTurnError);
    expect(() => game.makeMove(new Player('Mallory', PlayerSymbol.O), 1, 1)).toThrow(NotYourTurnError);
    expect(game.board.symbolAt({ row: 1, col: 1 })).toBeNull();
  });

  it('undo restores the board, the turn and the line counters', () => {
    expect(() => game.undo()).toThrow(NothingToUndoError);
    play(game, [[0, 0], [1, 1]]);
    const before = game.lineCounts(PlayerSymbol.X);

    game.makeMove(x, 0, 1);
    expect(game.lineCounts(PlayerSymbol.X)).not.toEqual(before);
    const undone = game.undo();

    expect(undone.position).toEqual({ row: 0, col: 1 });
    expect(game.lineCounts(PlayerSymbol.X)).toEqual(before);
    expect(game.board.symbolAt({ row: 0, col: 1 })).toBeNull();
    expect(game.currentPlayer).toBe(x);
    expect(game.moves).toHaveLength(2);
  });

  it('undoing the winning move reopens the game', () => {
    play(game, [[0, 0], [1, 0], [0, 1], [1, 1], [0, 2]]);
    game.undo();

    expect(game.status).toBe(GameStatus.IN_PROGRESS);
    expect(game.winner).toBeNull();
    expect(game.winningLine).toBeUndefined();
    expect(play(game, [[2, 2]]).status).toBe(GameStatus.IN_PROGRESS);
  });
});

describe('Game on a 4x4 board', () => {
  it('needs four in a line; three is not enough', () => {
    const game = new Game(new Player('A', PlayerSymbol.X), new Player('B', PlayerSymbol.O), { size: 4 });

    const afterThree = play(game, [[0, 0], [1, 0], [0, 1], [1, 1], [0, 2], [1, 2]]);
    expect(afterThree.status).toBe(GameStatus.IN_PROGRESS);
    const outcome = play(game, [[0, 3]]);
    expect(outcome.status).toBe(GameStatus.WON);
    expect(outcome.winningLine).toEqual({ kind: LineKind.ROW, index: 0 });
    expect(game.lineCounts(PlayerSymbol.X).rows).toEqual([4, 0, 0, 0]);
  });

  it('rejects boards smaller than 3x3 and two players with the same symbol', () => {
    expect(() => new Board(2)).toThrow(RangeError);
    expect(() => new Game(new Player('A', PlayerSymbol.X), new Player('B', PlayerSymbol.X))).toThrow(RangeError);
  });
});

describe('Player strategies', () => {
  it('RandomMoveStrategy picks among the empty cells with the injected rng', () => {
    const bot = new Player('Bot', PlayerSymbol.O, new RandomMoveStrategy(sequence(0, 0.99)));
    const human = new Player('Hana', PlayerSymbol.X);
    const game = new Game(human, bot);

    game.makeMove(human, 0, 0);
    expect(game.playTurn().move.position).toEqual({ row: 0, col: 1 }); // first empty cell
    game.makeMove(human, 1, 1);
    expect(game.playTurn().move.position).toEqual({ row: 2, col: 2 }); // last empty cell
  });

  it('HumanMoveStrategy plays the cells handed to it and complains when none is queued', () => {
    const input = new HumanMoveStrategy().choose(1, 1).choose(0, 0);
    const human = new Player('Hana', PlayerSymbol.X, input);
    const other = new Player('Otto', PlayerSymbol.O, new HumanMoveStrategy().choose(2, 2));
    const game = new Game(human, other);

    expect(game.playTurn().move.position).toEqual({ row: 1, col: 1 });
    expect(game.playTurn().move.player).toBe(other);
    expect(game.playTurn().move.position).toEqual({ row: 0, col: 0 });
    expect(() => game.playTurn()).toThrow(NoMoveProvidedError);
  });
});
