import type { TextRange } from './document';

/**
 * Cursor and selection in one value. `anchor` is where the selection started,
 * `head` is where the caret is; they are equal for a plain caret. Keeping the
 * direction lets shift+arrow extend the correct end.
 */
export class Selection {
  constructor(
    readonly anchor: number,
    readonly head: number,
  ) {}

  static caret(offset: number): Selection {
    return new Selection(offset, offset);
  }

  get start(): number {
    return Math.min(this.anchor, this.head);
  }

  get end(): number {
    return Math.max(this.anchor, this.head);
  }

  get isCollapsed(): boolean {
    return this.anchor === this.head;
  }

  get range(): TextRange {
    return { start: this.start, end: this.end };
  }
}
