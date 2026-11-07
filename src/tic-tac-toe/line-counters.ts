import type { Position } from './board';
import type { PlayerSymbol } from './player';

export enum LineKind {
  ROW = 'ROW',
  COLUMN = 'COLUMN',
  DIAGONAL = 'DIAGONAL',
  ANTI_DIAGONAL = 'ANTI_DIAGONAL',
}

export interface WinningLine {
  kind: LineKind;
  /** Row or column index; always 0 for the two diagonals. */
  index: number;
}

/** How many cells of each line one symbol holds. */
export interface LineCounts {
  rows: number[];
  cols: number[];
  diagonal: number;
  antiDiagonal: number;
}

/**
 * Win detection without rescanning the board. Each symbol keeps 2N + 2
 * counters (one per row, column and diagonal); a move touches at most four of
 * them, so "did this move win?" is answered in O(1) with O(N) memory instead
 * of an O(N^2) scan. Undo decrements the same counters, so they never drift
 * from the board.
 */
export class LineCounters {
  private readonly counts = new Map<PlayerSymbol, LineCounts>();

  constructor(readonly size: number) {}

  /** Counts the move and returns the line it completed, if any. */
  record(position: Position, symbol: PlayerSymbol): WinningLine | undefined {
    this.apply(position, symbol, 1);
    return this.completedLine(position, symbol);
  }

  revert(position: Position, symbol: PlayerSymbol): void {
    this.apply(position, symbol, -1);
  }

  /** A copy, so callers can compare before/after without touching the live counters. */
  snapshot(symbol: PlayerSymbol): LineCounts {
    const counts = this.countsFor(symbol);
    return { rows: [...counts.rows], cols: [...counts.cols], diagonal: counts.diagonal, antiDiagonal: counts.antiDiagonal };
  }

  private apply({ row, col }: Position, symbol: PlayerSymbol, delta: 1 | -1): void {
    const counts = this.countsFor(symbol);
    counts.rows[row] += delta;
    counts.cols[col] += delta;
    if (row === col) counts.diagonal += delta;
    if (row + col === this.size - 1) counts.antiDiagonal += delta;
  }

  private completedLine({ row, col }: Position, symbol: PlayerSymbol): WinningLine | undefined {
    const counts = this.countsFor(symbol);
    const n = this.size;
    if (counts.rows[row] === n) return { kind: LineKind.ROW, index: row };
    if (counts.cols[col] === n) return { kind: LineKind.COLUMN, index: col };
    if (row === col && counts.diagonal === n) return { kind: LineKind.DIAGONAL, index: 0 };
    if (row + col === n - 1 && counts.antiDiagonal === n) return { kind: LineKind.ANTI_DIAGONAL, index: 0 };
    return undefined;
  }

  private countsFor(symbol: PlayerSymbol): LineCounts {
    let counts = this.counts.get(symbol);
    if (!counts) {
      counts = { rows: new Array<number>(this.size).fill(0), cols: new Array<number>(this.size).fill(0), diagonal: 0, antiDiagonal: 0 };
      this.counts.set(symbol, counts);
    }
    return counts;
  }
}
