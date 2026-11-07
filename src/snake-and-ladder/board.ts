import { ChainedJumpError, InvalidJumpError, OverlappingJumpError } from './errors';
import type { Jump } from './jump';

/** Every token starts here. */
export const START_CELL = 1;

/**
 * Cells 1..size plus the snakes and ladders on them. Every placement rule is
 * checked once, at construction, so the game loop can trust that a jump never
 * leads into another jump and never touches the start or the end cell.
 */
export class Board {
  private readonly jumpsByStart = new Map<number, Jump>();
  private readonly jumpEnds = new Set<number>();

  constructor(
    readonly size = 100,
    jumps: readonly Jump[] = [],
  ) {
    if (!Number.isInteger(size) || size < 2) throw new RangeError(`Board size must be an integer >= 2, got ${size}`);
    for (const jump of jumps) this.addJump(jump);
  }

  get lastCell(): number {
    return this.size;
  }

  get jumps(): Jump[] {
    return [...this.jumpsByStart.values()];
  }

  /** The snake or ladder that starts on `cell`, if any. O(1). */
  jumpAt(cell: number): Jump | undefined {
    return this.jumpsByStart.get(cell);
  }

  private addJump(jump: Jump): void {
    for (const cell of [jump.from, jump.to]) {
      if (cell < START_CELL || cell > this.size) {
        throw new InvalidJumpError(jump.describe(), `cell ${cell} is off a ${this.size}-cell board`);
      }
      if (cell === START_CELL || cell === this.lastCell) {
        throw new InvalidJumpError(jump.describe(), 'it may not touch the start or the end cell');
      }
    }
    if (this.jumpsByStart.has(jump.from)) throw new OverlappingJumpError(jump.from);
    // No chains: landing at the end of a jump must never trigger a second jump.
    if (this.jumpsByStart.has(jump.to)) throw new ChainedJumpError(jump.to);
    if (this.jumpEnds.has(jump.from)) throw new ChainedJumpError(jump.from);
    this.jumpsByStart.set(jump.from, jump);
    this.jumpEnds.add(jump.to);
  }
}
