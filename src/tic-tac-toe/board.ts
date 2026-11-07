import { CellOccupiedError, OutOfBoundsError } from './errors';
import type { PlayerSymbol } from './player';

/** Zero-based cell coordinates. */
export interface Position {
  readonly row: number;
  readonly col: number;
}

/**
 * The N x N grid. It guards cell-level invariants (inside the board, one
 * symbol per cell) and nothing else: turns and winners belong to Game.
 */
export class Board {
  private readonly cells: (PlayerSymbol | null)[][];
  private filledCells = 0;

  constructor(readonly size = 3) {
    if (!Number.isInteger(size) || size < 3) {
      throw new RangeError(`Board size must be an integer >= 3, got ${size}`);
    }
    this.cells = Array.from({ length: size }, () => new Array<PlayerSymbol | null>(size).fill(null));
  }

  get isFull(): boolean {
    return this.filledCells === this.size * this.size;
  }

  isInBounds({ row, col }: Position): boolean {
    return Number.isInteger(row) && Number.isInteger(col) && row >= 0 && col >= 0 && row < this.size && col < this.size;
  }

  symbolAt(position: Position): PlayerSymbol | null {
    if (!this.isInBounds(position)) throw new OutOfBoundsError(position.row, position.col, this.size);
    return this.cells[position.row][position.col];
  }

  /** Throws instead of overwriting, so a taken cell can never silently change hands. */
  place(position: Position, symbol: PlayerSymbol): void {
    const current = this.symbolAt(position);
    if (current !== null) throw new CellOccupiedError(position.row, position.col, current);
    this.cells[position.row][position.col] = symbol;
    this.filledCells += 1;
  }

  /** Empties a cell; only Game.undo() calls this, for the move it is taking back. */
  clear(position: Position): void {
    if (this.symbolAt(position) === null) {
      throw new RangeError(`Cell (${position.row}, ${position.col}) is already empty`);
    }
    this.cells[position.row][position.col] = null;
    this.filledCells -= 1;
  }

  emptyCells(): Position[] {
    const empty: Position[] = [];
    this.cells.forEach((cells, row) =>
      cells.forEach((cell, col) => {
        if (cell === null) empty.push({ row, col });
      }),
    );
    return empty;
  }

  toString(): string {
    return this.cells.map((cells) => cells.map((cell) => cell ?? '.').join(' ')).join('\n');
  }
}
