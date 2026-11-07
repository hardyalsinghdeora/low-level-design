import type { Document, TextRange } from '../document';
import { Selection } from '../selection';
import { BaseEditCommand, type EditorState } from './edit-command';

function preview(text: string): string {
  const flat = text.replace(/\n/g, '\\n');
  return flat.length > 12 ? `${flat.slice(0, 12)}...` : flat;
}

/** Inserts text at an offset; the caret ends after the inserted text. */
export class InsertText extends BaseEditCommand {
  constructor(
    readonly offset: number,
    readonly text: string,
  ) {
    super(`Insert "${preview(text)}"`);
  }

  protected apply(document: Document): EditorState {
    return {
      document: document.insert(this.offset, this.text),
      selection: Selection.caret(this.offset + this.text.length),
    };
  }

  protected revert(document: Document): Document {
    return document.delete({ start: this.offset, end: this.offset + this.text.length });
  }
}

/** Removes a range and remembers what it removed, so undo can put exactly that back. */
export class DeleteRange extends BaseEditCommand {
  private removed = '';

  constructor(readonly range: TextRange) {
    super(`Delete ${range.start}..${range.end}`);
  }

  protected apply(document: Document): EditorState {
    this.removed = document.slice(this.range);
    return { document: document.delete(this.range), selection: Selection.caret(this.range.start) };
  }

  protected revert(document: Document): Document {
    return document.insert(this.range.start, this.removed);
  }
}

/** Replace is its own command (not delete + insert) so typing over a selection is one undo step. */
export class ReplaceRange extends BaseEditCommand {
  private removed = '';

  constructor(
    readonly range: TextRange,
    readonly text: string,
    label = `Replace ${range.start}..${range.end} with "${preview(text)}"`,
  ) {
    super(label);
  }

  protected apply(document: Document): EditorState {
    this.removed = document.slice(this.range);
    return {
      document: document.replace(this.range, this.text),
      selection: Selection.caret(this.range.start + this.text.length),
    };
  }

  protected revert(document: Document): Document {
    return document.replace({ start: this.range.start, end: this.range.start + this.text.length }, this.removed);
  }
}
