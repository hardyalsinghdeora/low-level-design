import { ColumnOutOfRangeError, InvalidRangeError, LineOutOfRangeError, OffsetOutOfRangeError } from './errors';

/** Half-open character range [start, end) in UTF-16 offsets. */
export interface TextRange {
  readonly start: number;
  readonly end: number;
}

/** 1-based, as editors show it in the status bar. */
export interface LineColumn {
  readonly line: number;
  readonly column: number;
}

/**
 * Immutable text value. Every edit returns a new Document, which is what makes
 * mementos free (keep a reference) and commands easy to reason about. Line
 * starts are indexed once per value, so line/column lookups do not rescan.
 */
export class Document {
  private readonly lineStarts: readonly number[];

  constructor(readonly text: string = '') {
    const starts = [0];
    for (let i = 0; i < text.length; i++) if (text[i] === '\n') starts.push(i + 1);
    this.lineStarts = starts;
  }

  get length(): number {
    return this.text.length;
  }

  get lineCount(): number {
    return this.lineStarts.length;
  }

  /** Text of a 1-based line, without its newline. */
  line(line: number): string {
    this.assertLine(line);
    const start = this.lineStarts[line - 1];
    const next = line < this.lineCount ? this.lineStarts[line] - 1 : this.text.length;
    return this.text.slice(start, next);
  }

  positionAt(offset: number): LineColumn {
    this.assertOffset(offset);
    let line = 0;
    while (line + 1 < this.lineStarts.length && this.lineStarts[line + 1] <= offset) line++;
    return { line: line + 1, column: offset - this.lineStarts[line] + 1 };
  }

  /** Column may be one past the last character: that is the end-of-line caret. */
  offsetAt(line: number, column: number): number {
    const maxColumn = this.line(line).length + 1;
    if (!Number.isInteger(column) || column < 1 || column > maxColumn) {
      throw new ColumnOutOfRangeError(line, column, maxColumn);
    }
    return this.lineStarts[line - 1] + column - 1;
  }

  slice(range: TextRange): string {
    this.assertRange(range);
    return this.text.slice(range.start, range.end);
  }

  insert(offset: number, text: string): Document {
    this.assertOffset(offset);
    return new Document(this.text.slice(0, offset) + text + this.text.slice(offset));
  }

  delete(range: TextRange): Document {
    return this.replace(range, '');
  }

  replace(range: TextRange, text: string): Document {
    this.assertRange(range);
    return new Document(this.text.slice(0, range.start) + text + this.text.slice(range.end));
  }

  assertOffset(offset: number): void {
    if (!Number.isInteger(offset) || offset < 0 || offset > this.length) {
      throw new OffsetOutOfRangeError(offset, this.length);
    }
  }

  assertRange(range: TextRange): void {
    if (range.start > range.end) throw new InvalidRangeError(range.start, range.end);
    this.assertOffset(range.start);
    this.assertOffset(range.end);
  }

  private assertLine(line: number): void {
    if (!Number.isInteger(line) || line < 1 || line > this.lineCount) {
      throw new LineOutOfRangeError(line, this.lineCount);
    }
  }
}
