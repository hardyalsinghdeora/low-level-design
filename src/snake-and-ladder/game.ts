import { type IdGenerator, UuidGenerator } from '../shared/id-generator';
import type { Board } from './board';
import { type Dice, RandomDice } from './dice';
import { GameAlreadyStartedError, GameFinishedError, GameNotStartedError, NotEnoughPlayersError } from './errors';
import { type Jump, JumpKind } from './jump';
import { MoveEvent, type MoveResult } from './move-result';
import { Player } from './player';

/** NOT_STARTED -> IN_PROGRESS -> FINISHED. There is no way back. */
export enum GameStatus {
  NOT_STARTED = 'NOT_STARTED',
  IN_PROGRESS = 'IN_PROGRESS',
  FINISHED = 'FINISHED',
}

export interface Standing {
  place: number;
  player: Player;
  position: number;
}

export interface GameOptions {
  dice?: Dice;
  ids?: IdGenerator;
}

const EVENT_FOR_JUMP: Record<JumpKind, MoveEvent> = {
  [JumpKind.SNAKE]: MoveEvent.SNAKE_BITTEN,
  [JumpKind.LADDER]: MoveEvent.LADDER_CLIMBED,
};

/**
 * Aggregate root. Owns the turn queue and the status machine. The board
 * answers "where does this cell lead", the dice answer "how far"; only the
 * game moves tokens, so every movement rule lives in `playTurn()`.
 */
export class Game {
  private _status = GameStatus.NOT_STARTED;
  private _winner: Player | null = null;
  private readonly players: Player[] = [];
  private readonly turnQueue: Player[] = [];
  private readonly results: MoveResult[] = [];
  private readonly dice: Dice;
  private readonly ids: IdGenerator;

  constructor(
    readonly board: Board,
    options: GameOptions = {},
  ) {
    this.dice = options.dice ?? new RandomDice();
    this.ids = options.ids ?? new UuidGenerator();
  }

  get status(): GameStatus {
    return this._status;
  }

  get winner(): Player | null {
    return this._winner;
  }

  /** Front of the turn queue; undefined unless the game is in progress. */
  get currentPlayer(): Player | undefined {
    return this._status === GameStatus.IN_PROGRESS ? this.turnQueue[0] : undefined;
  }

  get history(): readonly MoveResult[] {
    return [...this.results];
  }

  addPlayer(name: string): Player {
    if (this._status !== GameStatus.NOT_STARTED) throw new GameAlreadyStartedError();
    const player = new Player(this.ids.next('P'), name);
    this.players.push(player);
    return player;
  }

  /** Locks the line-up; players take turns in the order they joined. */
  start(): void {
    if (this._status !== GameStatus.NOT_STARTED) throw new GameAlreadyStartedError();
    if (this.players.length < 2) throw new NotEnoughPlayersError(this.players.length);
    this.turnQueue.push(...this.players);
    this._status = GameStatus.IN_PROGRESS;
  }

  /** One turn for the player at the front of the queue: roll, move, apply the board, rotate the queue. */
  playTurn(): MoveResult {
    this.assertInProgress();
    const [player] = this.turnQueue;
    const roll = this.dice.roll();
    const from = player.position;
    const landedOn = from + roll.total;

    // Exact-landing rule: a roll past the last cell is wasted and the token stays.
    let to = from;
    let event = MoveEvent.OVERSHOT;
    let jump: Jump | undefined;
    if (landedOn === this.board.lastCell) {
      to = landedOn;
      event = MoveEvent.WON;
    } else if (landedOn < this.board.lastCell) {
      jump = this.board.jumpAt(landedOn);
      to = jump?.to ?? landedOn;
      event = jump ? EVENT_FOR_JUMP[jump.kind] : MoveEvent.MOVED;
    }

    player.moveTo(to);
    const result: MoveResult = {
      turn: this.results.length + 1,
      playerId: player.id,
      playerName: player.name,
      roll,
      from,
      landedOn,
      to,
      event,
      jump,
    };
    this.results.push(result);

    if (event === MoveEvent.WON) this.finish(player);
    else this.turnQueue.push(...this.turnQueue.splice(0, 1));
    return result;
  }

  /** Winner first, then everyone else by how far they got; ties keep turn order. */
  ranking(): Standing[] {
    return [...this.players]
      .sort((a, b) => b.position - a.position)
      .map((player, index) => ({ place: index + 1, player, position: player.position }));
  }

  private finish(winner: Player): void {
    this._winner = winner;
    this._status = GameStatus.FINISHED;
    this.turnQueue.length = 0;
  }

  private assertInProgress(): void {
    if (this._status === GameStatus.NOT_STARTED) throw new GameNotStartedError();
    if (this._status === GameStatus.FINISHED) throw new GameFinishedError(this._winner?.name ?? 'someone');
  }
}
