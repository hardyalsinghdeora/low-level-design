import { type Clock, SystemClock } from '../shared/clock';
import { type IdGenerator, UuidGenerator } from '../shared/id-generator';
import type { EditCommand, EditorState } from './commands/edit-command';
import { MacroCommand } from './commands/macro-command';
import { DeleteRange, InsertText, ReplaceRange } from './commands/text-commands';
import { Document, type LineColumn } from './document';
import { ForeignMementoError } from './errors';
import { CommandHistory } from './history';
import { EditorMemento } from './memento';
import { Selection } from './selection';

export interface TextEditorOptions {
  initialText?: string;
  historyLimit?: number;
  clock?: Clock;
  ids?: IdGenerator;
}

/**
 * Aggregate root: owns the current state (document + selection), runs every
 * edit through the history, and creates and restores save points. Cursor moves
 * are not commands; like real editors, undo only covers text changes.
 */
export class TextEditor {
  readonly id: string;
  private state: EditorState;
  private savedText: string;
  private readonly history: CommandHistory;
  private readonly clock: Clock;
  private readonly ids: IdGenerator;

  constructor(options: TextEditorOptions = {}) {
    this.clock = options.clock ?? new SystemClock();
    this.ids = options.ids ?? new UuidGenerator();
    this.id = this.ids.next('EDITOR');
    this.history = new CommandHistory(options.historyLimit);
    const document = new Document(options.initialText ?? '');
    this.state = { document, selection: Selection.caret(document.length) };
    this.savedText = document.text;
  }

  get text(): string {
    return this.state.document.text;
  }

  get document(): Document {
    return this.state.document;
  }

  get selection(): Selection {
    return this.state.selection;
  }

  get selectedText(): string {
    return this.state.document.slice(this.state.selection.range);
  }

  get cursor(): LineColumn {
    return this.state.document.positionAt(this.state.selection.head);
  }

  get canUndo(): boolean {
    return this.history.canUndo;
  }

  get canRedo(): boolean {
    return this.history.canRedo;
  }

  get undoLabels(): string[] {
    return this.history.undoLabels;
  }

  /** True when the text differs from the last save point (or the initial text). */
  get isDirty(): boolean {
    return this.text !== this.savedText;
  }

  execute(command: EditCommand): void {
    this.state = this.history.execute(command, this.state);
  }

  /** Keyboard typing: inserts at the caret, or replaces the selection as one undo step. */
  type(text: string): void {
    const { selection } = this.state;
    this.execute(selection.isCollapsed ? new InsertText(selection.head, text) : new ReplaceRange(selection.range, text));
  }

  /** Deletes the selection, or the character before the caret. At offset 0 there is nothing to delete. */
  backspace(): void {
    const { selection } = this.state;
    if (!selection.isCollapsed) this.execute(new DeleteRange(selection.range));
    else if (selection.head > 0) this.execute(new DeleteRange({ start: selection.head - 1, end: selection.head }));
  }

  insertAt(offset: number, text: string): void {
    this.execute(new InsertText(offset, text));
  }

  deleteRange(start: number, end: number): void {
    this.execute(new DeleteRange({ start, end }));
  }

  replaceRange(start: number, end: number, text: string): void {
    this.execute(new ReplaceRange({ start, end }, text));
  }

  macro(label: string, commands: EditCommand[]): void {
    this.execute(new MacroCommand(label, commands));
  }

  undo(): void {
    this.state = this.history.undo(this.state);
  }

  redo(): void {
    this.state = this.history.redo(this.state);
  }

  moveCursor(offset: number): void {
    this.state.document.assertOffset(offset);
    this.state = { ...this.state, selection: Selection.caret(offset) };
  }

  moveTo(line: number, column: number): void {
    this.moveCursor(this.state.document.offsetAt(line, column));
  }

  select(anchor: number, head: number): void {
    this.state.document.assertOffset(anchor);
    this.state.document.assertOffset(head);
    this.state = { ...this.state, selection: new Selection(anchor, head) };
  }

  selectAll(): void {
    this.select(0, this.state.document.length);
  }

  save(label: string): EditorMemento {
    this.savedText = this.text;
    return new EditorMemento(this.ids.next('SAVE'), this.id, label, this.clock.now(), this.state);
  }

  /**
   * Restoring is itself an undoable edit (a whole-document replace), so the
   * history stays consistent instead of being thrown away.
   */
  restore(memento: EditorMemento): void {
    if (memento.editorId !== this.id) throw new ForeignMementoError(memento.id, this.id);
    const whole = { start: 0, end: this.state.document.length };
    this.execute(new ReplaceRange(whole, memento.state.document.text, `Restore "${memento.label}"`));
    this.state = { ...this.state, selection: memento.state.selection };
    this.savedText = memento.state.document.text;
  }
}
