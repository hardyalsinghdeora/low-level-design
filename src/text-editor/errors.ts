import { DomainError } from '../shared/errors';

export class TextEditorError extends DomainError {}

export class OffsetOutOfRangeError extends TextEditorError {
  constructor(offset: number, length: number) {
    super(`Offset ${offset} is outside the document (valid: 0..${length})`);
  }
}

export class InvalidRangeError extends TextEditorError {
  constructor(start: number, end: number) {
    super(`Range ${start}..${end} is invalid; start must be <= end`);
  }
}

export class LineOutOfRangeError extends TextEditorError {
  constructor(line: number, lineCount: number) {
    super(`Line ${line} does not exist (the document has ${lineCount} line(s))`);
  }
}

export class ColumnOutOfRangeError extends TextEditorError {
  constructor(line: number, column: number, maxColumn: number) {
    super(`Column ${column} is outside line ${line} (valid: 1..${maxColumn})`);
  }
}

export class NothingToUndoError extends TextEditorError {
  constructor() {
    super('There is nothing to undo');
  }
}

export class NothingToRedoError extends TextEditorError {
  constructor() {
    super('There is nothing to redo');
  }
}

export class InvalidCommandStateError extends TextEditorError {
  constructor(label: string, from: string, to: string) {
    super(`Command "${label}" cannot go from ${from} to ${to}`);
  }
}

export class EmptyMacroError extends TextEditorError {
  constructor(label: string) {
    super(`Macro "${label}" has no commands`);
  }
}

export class ForeignMementoError extends TextEditorError {
  constructor(mementoId: string, editorId: string) {
    super(`Save point ${mementoId} was not created by editor ${editorId}`);
  }
}
