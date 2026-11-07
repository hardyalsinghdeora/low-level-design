import type { Document } from '../document';
import { InvalidCommandStateError } from '../errors';
import type { Selection } from '../selection';

export enum CommandStatus {
  PENDING = 'PENDING',
  DONE = 'DONE',
  UNDONE = 'UNDONE',
}

const TRANSITIONS: Record<CommandStatus, readonly CommandStatus[]> = {
  [CommandStatus.PENDING]: [CommandStatus.DONE],
  [CommandStatus.DONE]: [CommandStatus.UNDONE],
  [CommandStatus.UNDONE]: [CommandStatus.DONE],
};

/** Guards the PENDING -> DONE -> UNDONE -> DONE cycle: no double execute, no undo of an unexecuted edit. */
export function assertCommandTransition(label: string, from: CommandStatus, to: CommandStatus): void {
  if (!TRANSITIONS[from].includes(to)) throw new InvalidCommandStateError(label, from, to);
}

export interface EditorState {
  readonly document: Document;
  readonly selection: Selection;
}

/**
 * Command pattern: every edit is an object that can apply itself and revert
 * itself. The editor and the history only see this interface, so a new kind
 * of edit (indent block, sort lines) never touches them.
 */
export interface EditCommand {
  readonly label: string;
  readonly status: CommandStatus;
  execute(state: EditorState): EditorState;
  undo(state: EditorState): EditorState;
}

/** Template Method: status bookkeeping and selection restore live here; subclasses only change text. */
export abstract class BaseEditCommand implements EditCommand {
  private current = CommandStatus.PENDING;
  private selectionBefore: Selection | null = null;

  protected constructor(readonly label: string) {}

  get status(): CommandStatus {
    return this.current;
  }

  execute(state: EditorState): EditorState {
    assertCommandTransition(this.label, this.current, CommandStatus.DONE);
    const result = this.apply(state.document); // throws before any status change on bad input
    this.selectionBefore = state.selection;
    this.current = CommandStatus.DONE;
    return result;
  }

  undo(state: EditorState): EditorState {
    assertCommandTransition(this.label, this.current, CommandStatus.UNDONE);
    const document = this.revert(state.document);
    this.current = CommandStatus.UNDONE;
    return { document, selection: this.selectionBefore ?? state.selection };
  }

  protected abstract apply(document: Document): EditorState;
  protected abstract revert(document: Document): Document;
}
