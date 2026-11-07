import type { EditCommand, EditorState } from './commands/edit-command';
import { NothingToRedoError, NothingToUndoError } from './errors';

/**
 * Two stacks. A new edit clears the redo stack, because the redo entries were
 * computed against a text that no longer exists. A command moves between the
 * stacks only after it succeeded, so a failing undo leaves both stacks intact.
 */
export class CommandHistory {
  private readonly undoStack: EditCommand[] = [];
  private readonly redoStack: EditCommand[] = [];

  constructor(private readonly limit = 200) {}

  execute(command: EditCommand, state: EditorState): EditorState {
    const next = command.execute(state);
    this.undoStack.push(command);
    if (this.undoStack.length > this.limit) this.undoStack.shift();
    this.redoStack.length = 0;
    return next;
  }

  undo(state: EditorState): EditorState {
    const command = this.undoStack.at(-1);
    if (!command) throw new NothingToUndoError();
    const next = command.undo(state);
    this.undoStack.pop();
    this.redoStack.push(command);
    return next;
  }

  redo(state: EditorState): EditorState {
    const command = this.redoStack.at(-1);
    if (!command) throw new NothingToRedoError();
    const next = command.execute(state);
    this.redoStack.pop();
    this.undoStack.push(command);
    return next;
  }

  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  /** Labels for an Edit menu, most recent first. */
  get undoLabels(): string[] {
    return this.undoStack.map((c) => c.label).reverse();
  }
}
