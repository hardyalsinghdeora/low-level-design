import { EmptyMacroError } from '../errors';
import { assertCommandTransition, CommandStatus, type EditCommand, type EditorState } from './edit-command';

/**
 * Composite: a macro is a command made of commands, so the history stores it
 * as one entry and undo reverts it as a unit. Execution is all-or-nothing: if
 * a child fails, the children already applied are undone and the error is
 * rethrown, leaving every child re-runnable.
 */
export class MacroCommand implements EditCommand {
  private current = CommandStatus.PENDING;

  constructor(
    readonly label: string,
    private readonly children: readonly EditCommand[],
  ) {
    if (children.length === 0) throw new EmptyMacroError(label);
  }

  get status(): CommandStatus {
    return this.current;
  }

  get size(): number {
    return this.children.length;
  }

  execute(state: EditorState): EditorState {
    assertCommandTransition(this.label, this.current, CommandStatus.DONE);
    const applied: EditCommand[] = [];
    let next = state;
    try {
      for (const child of this.children) {
        next = child.execute(next);
        applied.push(child);
      }
    } catch (error) {
      for (const child of applied.reverse()) next = child.undo(next);
      throw error;
    }
    this.current = CommandStatus.DONE;
    return next;
  }

  undo(state: EditorState): EditorState {
    assertCommandTransition(this.label, this.current, CommandStatus.UNDONE);
    let next = state;
    for (const child of [...this.children].reverse()) next = child.undo(next);
    this.current = CommandStatus.UNDONE;
    return next;
  }
}
