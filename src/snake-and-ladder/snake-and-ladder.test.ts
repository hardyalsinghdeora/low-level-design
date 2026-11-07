import { describe, expect, it } from 'vitest';
import { SequentialIdGenerator } from '../shared/id-generator';
import {
  Board,
  ChainedJumpError,
  Game,
  GameAlreadyStartedError,
  GameFinishedError,
  GameNotStartedError,
  GameStatus,
  InvalidJumpError,
  JumpKind,
  Ladder,
  MoveEvent,
  NotEnoughPlayersError,
  OverlappingJumpError,
  RandomDice,
  ScriptedDice,
  Snake,
} from './index';

/** A 20-cell board with a ladder 3->11 and a snake 15->5; Asha moves first, then Ravi. */
function startedGame(rolls: Array<number | number[]>) {
  const board = new Board(20, [new Ladder(3, 11), new Snake(15, 5)]);
  const game = new Game(board, { dice: new ScriptedDice(rolls), ids: new SequentialIdGenerator() });
  const asha = game.addPlayer('Asha');
  const ravi = game.addPlayer('Ravi');
  game.start();
  return { game, asha, ravi };
}

describe('Board setup', () => {
  it('refuses a snake that goes up and a ladder that goes down', () => {
    expect(() => new Snake(5, 12)).toThrow(InvalidJumpError);
    expect(() => new Snake(7, 7)).toThrow(InvalidJumpError);
    expect(() => new Ladder(12, 5)).toThrow(InvalidJumpError);
  });

  it('refuses jumps that touch the start or end cell or leave the board', () => {
    expect(() => new Board(20, [new Ladder(1, 8)])).toThrow(InvalidJumpError);
    expect(() => new Board(20, [new Snake(20, 4)])).toThrow(InvalidJumpError);
    expect(() => new Board(20, [new Ladder(5, 20)])).toThrow(InvalidJumpError);
    expect(() => new Board(20, [new Ladder(5, 25)])).toThrow(InvalidJumpError);
  });

  it('refuses two jumps from the same cell and jumps that chain in either order', () => {
    expect(() => new Board(20, [new Ladder(4, 9), new Snake(4, 2)])).toThrow(OverlappingJumpError);
    expect(() => new Board(20, [new Ladder(4, 9), new Snake(9, 2)])).toThrow(ChainedJumpError);
    expect(() => new Board(20, [new Snake(12, 4), new Ladder(4, 9)])).toThrow(ChainedJumpError);
    expect(new Board(20, [new Ladder(4, 9), new Snake(12, 9)]).jumps).toHaveLength(2); // shared tail is fine
  });
});

describe('Game lifecycle', () => {
  it('needs two players, refuses turns before start and locks the line-up afterwards', () => {
    const game = new Game(new Board(20), { dice: new ScriptedDice([1]) });
    game.addPlayer('Solo');

    expect(game.status).toBe(GameStatus.NOT_STARTED);
    expect(() => game.playTurn()).toThrow(GameNotStartedError);
    expect(() => game.start()).toThrow(NotEnoughPlayersError);

    game.addPlayer('Duo');
    game.start();
    expect(game.status).toBe(GameStatus.IN_PROGRESS);
    expect(() => game.start()).toThrow(GameAlreadyStartedError);
    expect(() => game.addPlayer('Late')).toThrow(GameAlreadyStartedError);
  });
});

describe('Game turns', () => {
  it('moves the player at the front of the queue, then rotates the queue', () => {
    const { game, asha, ravi } = startedGame([4, 5]);

    expect(game.playTurn()).toMatchObject({ turn: 1, playerId: asha.id, from: 1, landedOn: 5, to: 5, event: MoveEvent.MOVED });
    expect(game.currentPlayer).toBe(ravi);
    expect(game.playTurn()).toMatchObject({ playerId: ravi.id, to: 6 });
    expect(game.currentPlayer).toBe(asha);
  });

  it('climbs a ladder and reports it', () => {
    const { game, asha } = startedGame([2]);
    const result = game.playTurn();

    expect(result).toMatchObject({ from: 1, landedOn: 3, to: 11, event: MoveEvent.LADDER_CLIMBED });
    expect(result.jump?.kind).toBe(JumpKind.LADDER);
    expect(asha.position).toBe(11);
  });

  it('slides down a snake and reports it', () => {
    const { game, asha } = startedGame([2, 1, 4]);
    game.playTurn(); // Asha 1 -> 3, ladder to 11
    game.playTurn(); // Ravi 1 -> 2

    expect(game.playTurn()).toMatchObject({ from: 11, landedOn: 15, to: 5, event: MoveEvent.SNAKE_BITTEN });
    expect(asha.position).toBe(5);
  });

  it('keeps the token where it is when the roll overshoots the last cell', () => {
    const { game, asha } = startedGame([2, 1, 6, 1, 5]);
    for (let turn = 0; turn < 4; turn += 1) game.playTurn(); // Asha ends on 17

    expect(game.playTurn()).toMatchObject({ from: 17, landedOn: 22, to: 17, event: MoveEvent.OVERSHOT });
    expect(asha.position).toBe(17);
    expect(game.status).toBe(GameStatus.IN_PROGRESS);
  });

  it('wins on an exact landing, ranks everyone and rejects further moves', () => {
    const { game, asha } = startedGame([2, 4, 6, 3, 3]);
    while (game.status === GameStatus.IN_PROGRESS) game.playTurn();

    expect(game.status).toBe(GameStatus.FINISHED);
    expect(game.winner).toBe(asha);
    expect(game.history.map((result) => result.event)).toEqual([
      MoveEvent.LADDER_CLIMBED,
      MoveEvent.MOVED,
      MoveEvent.MOVED,
      MoveEvent.MOVED,
      MoveEvent.WON,
    ]);
    expect(game.ranking().map((s) => [s.place, s.player.name, s.position])).toEqual([
      [1, 'Asha', 20],
      [2, 'Ravi', 8],
    ]);
    expect(() => game.playTurn()).toThrow(GameFinishedError);
    expect(game.currentPlayer).toBeUndefined();
  });
});

describe('Dice', () => {
  it('RandomDice maps the injected rng onto faces and sums several dice', () => {
    const values = [0, 0.5, 0.999];
    const dice = new RandomDice({ count: 3, rng: () => values.shift() ?? 0 });

    expect(dice.roll()).toEqual({ faces: [1, 4, 6], total: 11 });
    expect(() => new RandomDice({ count: 0 })).toThrow(RangeError);
  });

  it('moves by the sum of all dice and fails loudly when a script runs out', () => {
    const { game } = startedGame([[2, 3]]);

    expect(game.playTurn()).toMatchObject({ roll: { faces: [2, 3], total: 5 }, to: 6 });
    expect(() => game.playTurn()).toThrow(RangeError);
  });
});
