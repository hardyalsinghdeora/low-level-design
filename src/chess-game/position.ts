import { InvalidSquareError } from './errors';

const FILES = 'abcdefgh';

/**
 * Immutable board coordinate. Inside, file and rank are 0..7; the outside
 * world speaks algebraic squares like "e4", and this is the only class that
 * translates between the two.
 */
export class Position {
  private constructor(
    readonly file: number,
    readonly rank: number,
  ) {}

  static of(file: number, rank: number): Position {
    if (!Position.isOnBoard(file, rank)) throw new RangeError(`(${file}, ${rank}) is off the board`);
    return new Position(file, rank);
  }

  static parse(square: string): Position {
    const match = /^([a-h])([1-8])$/.exec(square.trim().toLowerCase());
    if (!match) throw new InvalidSquareError(square);
    return new Position(FILES.indexOf(match[1]), Number(match[2]) - 1);
  }

  static isOnBoard(file: number, rank: number): boolean {
    return Number.isInteger(file) && Number.isInteger(rank) && file >= 0 && file < 8 && rank >= 0 && rank < 8;
  }

  /** The square `df` files and `dr` ranks away, or undefined when that is off the board. */
  offset(df: number, dr: number): Position | undefined {
    const file = this.file + df;
    const rank = this.rank + dr;
    return Position.isOnBoard(file, rank) ? new Position(file, rank) : undefined;
  }

  equals(other: Position): boolean {
    return this.file === other.file && this.rank === other.rank;
  }

  toString(): string {
    return `${FILES[this.file]}${this.rank + 1}`;
  }
}
