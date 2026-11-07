import { describe, expect, it } from 'vitest';
import { FakeClock } from '../shared/clock';
import { SequentialIdGenerator } from '../shared/id-generator';
import {
  ColumnOutOfRangeError,
  CommandStatus,
  DeleteRange,
  Document,
  EmptyMacroError,
  ForeignMementoError,
  InsertText,
  InvalidCommandStateError,
  InvalidRangeError,
  LineOutOfRangeError,
  MacroCommand,
  NothingToRedoError,
  NothingToUndoError,
  OffsetOutOfRangeError,
  Selection,
  TextEditor,
} from './index';

function newEditor(initialText = '') {
  const clock = new FakeClock('2026-03-01T10:00:00Z');
  return { editor: new TextEditor({ initialText, clock, ids: new SequentialIdGenerator() }), clock };
}

describe('Document', () => {
  it('maps offsets to 1-based line/column and back', () => {
    const doc = new Document('ab\ncde\n');
    expect(doc.lineCount).toBe(3);
    expect(doc.line(2)).toBe('cde');
    expect(doc.line(3)).toBe('');
    expect(doc.positionAt(4)).toEqual({ line: 2, column: 2 });
    expect(doc.positionAt(7)).toEqual({ line: 3, column: 1 });
    expect(doc.offsetAt(2, 4)).toBe(6);
    expect(() => doc.line(4)).toThrow(LineOutOfRangeError);
    expect(() => doc.offsetAt(1, 4)).toThrow(ColumnOutOfRangeError);
  });

  it('rejects offsets and ranges outside the text', () => {
    const doc = new Document('abc');
    expect(() => doc.insert(4, 'x')).toThrow(OffsetOutOfRangeError);
    expect(() => doc.insert(-1, 'x')).toThrow(OffsetOutOfRangeError);
    expect(() => doc.delete({ start: 2, end: 1 })).toThrow(InvalidRangeError);
    expect(doc.insert(3, 'd').text).toBe('abcd');
    expect(doc.text).toBe('abc');
  });
});

describe('TextEditor editing and selection', () => {
  it('types at the caret and replaces a selection in one step', () => {
    const { editor } = newEditor();
    editor.type('Hello world');
    expect(editor.cursor).toEqual({ line: 1, column: 12 });
    editor.select(11, 6); // backwards selection of "world"
    expect(editor.selectedText).toBe('world');
    editor.type('team');
    expect(editor.text).toBe('Hello team');
    expect(editor.selection.isCollapsed).toBe(true);
    editor.undo();
    expect(editor.text).toBe('Hello world');
    expect(editor.selection).toEqual(new Selection(11, 6));
  });

  it('backspace deletes the selection or the previous character, and is a no-op at offset 0', () => {
    const { editor } = newEditor('ab\ncd');
    editor.moveTo(2, 1);
    editor.backspace();
    expect(editor.text).toBe('abcd');
    editor.moveCursor(0);
    editor.backspace();
    expect(editor.canUndo).toBe(true);
    expect(editor.undoLabels).toHaveLength(1);
    expect(() => editor.select(0, 9)).toThrow(OffsetOutOfRangeError);
  });
});

describe('Undo / redo', () => {
  it('undoes and redoes in stack order', () => {
    const { editor } = newEditor();
    editor.type('a');
    editor.type('b');
    editor.type('c');
    editor.undo();
    editor.undo();
    expect(editor.text).toBe('a');
    editor.redo();
    expect(editor.text).toBe('ab');
    editor.redo();
    expect(editor.text).toBe('abc');
    expect(() => editor.redo()).toThrow(NothingToRedoError);
  });

  it('clears the redo stack when a new edit is made', () => {
    const { editor } = newEditor();
    editor.type('one');
    editor.type(' two');
    editor.undo();
    expect(editor.canRedo).toBe(true);
    editor.type(' three');
    expect(editor.canRedo).toBe(false);
    expect(editor.text).toBe('one three');
    expect(() => editor.redo()).toThrow(NothingToRedoError);
  });

  it('throws when there is nothing to undo, and a failed edit leaves history untouched', () => {
    const { editor } = newEditor('abc');
    expect(() => editor.undo()).toThrow(NothingToUndoError);
    expect(() => editor.deleteRange(1, 10)).toThrow(OffsetOutOfRangeError);
    expect(editor.canUndo).toBe(false);
    expect(editor.text).toBe('abc');
  });

  it('commands validate their own status transitions', () => {
    const insert = new InsertText(0, 'x');
    const state = { document: new Document(''), selection: Selection.caret(0) };
    expect(() => insert.undo(state)).toThrow(InvalidCommandStateError);
    const next = insert.execute(state);
    expect(insert.status).toBe(CommandStatus.DONE);
    expect(() => insert.execute(next)).toThrow(InvalidCommandStateError);
    insert.undo(next);
    expect(insert.status).toBe(CommandStatus.UNDONE);
  });
});

describe('MacroCommand (composite)', () => {
  it('undoes and redoes all of its children as one unit', () => {
    const { editor } = newEditor('world');
    editor.macro('Greet', [new InsertText(0, 'hello '), new InsertText(11, '!'), new DeleteRange({ start: 0, end: 1 })]);
    expect(editor.text).toBe('ello world!');
    expect(editor.undoLabels).toEqual(['Greet']);
    editor.undo();
    expect(editor.text).toBe('world');
    editor.redo();
    expect(editor.text).toBe('ello world!');
  });

  it('rolls back the children already applied when one fails, and refuses an empty macro', () => {
    const { editor } = newEditor('abc');
    const first = new InsertText(0, 'x');
    const macro = new MacroCommand('Broken', [first, new DeleteRange({ start: 2, end: 50 })]);
    expect(() => editor.execute(macro)).toThrow(OffsetOutOfRangeError);
    expect(editor.text).toBe('abc');
    expect(editor.canUndo).toBe(false);
    expect(first.status).toBe(CommandStatus.UNDONE);
    expect(macro.status).toBe(CommandStatus.PENDING);
    expect(() => new MacroCommand('Nothing', [])).toThrow(EmptyMacroError);
  });
});

describe('Memento save points', () => {
  it('restores a save point as an undoable edit and tracks dirtiness', () => {
    const { editor, clock } = newEditor();
    editor.type('draft');
    clock.advanceMinutes(2);
    const save = editor.save('v1');
    expect(save.savedAt.toISOString()).toBe('2026-03-01T10:02:00.000Z');
    expect(editor.isDirty).toBe(false);

    editor.selectAll();
    editor.type('oops');
    expect(editor.isDirty).toBe(true);
    editor.restore(save);
    expect(editor.text).toBe('draft');
    expect(editor.isDirty).toBe(false);
    editor.undo();
    expect(editor.text).toBe('oops');
  });

  it("refuses another editor's save point", () => {
    const save = newEditor('a').editor.save('a1');
    expect(save.editorId).toBe('EDITOR-1');
    const other = new TextEditor({ initialText: 'b', ids: { next: (prefix = 'id') => `${prefix}-other` } });
    expect(() => other.restore(save)).toThrow(ForeignMementoError);
    expect(other.text).toBe('b');
  });
});
