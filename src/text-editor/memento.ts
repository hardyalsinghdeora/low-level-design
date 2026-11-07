import type { EditorState } from './commands/edit-command';

/**
 * Memento: a save point. Because Document and Selection are immutable values,
 * the snapshot is just a reference, O(1) to take. Callers treat it as opaque;
 * only the editor that created it reads `state` (checked through `editorId`).
 */
export class EditorMemento {
  constructor(
    readonly id: string,
    readonly editorId: string,
    readonly label: string,
    readonly savedAt: Date,
    readonly state: EditorState,
  ) {}
}
