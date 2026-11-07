import { InvalidJumpError } from './errors';

export enum JumpKind {
  SNAKE = 'SNAKE',
  LADDER = 'LADDER',
}

/**
 * Snakes and ladders are the same thing to the board: land on `from`, end up
 * on `to`. The subclasses only enforce the direction that makes each one what
 * it is, so a "snake" that goes up can never be constructed.
 */
export abstract class Jump {
  protected constructor(
    readonly kind: JumpKind,
    readonly from: number,
    readonly to: number,
  ) {
    if (!Number.isInteger(from) || !Number.isInteger(to)) {
      throw new InvalidJumpError(this.describe(), 'cells must be whole numbers');
    }
  }

  describe(): string {
    return `${this.kind.toLowerCase()} ${this.from}->${this.to}`;
  }
}

export class Snake extends Jump {
  constructor(head: number, tail: number) {
    super(JumpKind.SNAKE, head, tail);
    if (head <= tail) throw new InvalidJumpError(this.describe(), 'the head must be above the tail');
  }
}

export class Ladder extends Jump {
  constructor(bottom: number, top: number) {
    super(JumpKind.LADDER, bottom, top);
    if (top <= bottom) throw new InvalidJumpError(this.describe(), 'the top must be above the bottom');
  }
}
