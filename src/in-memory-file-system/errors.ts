import { DomainError } from '../shared/errors';

export class FileSystemError extends DomainError {}

export class InvalidPathError extends FileSystemError {
  constructor(path: string, reason: string) {
    super(`Invalid path "${path}": ${reason}`);
  }
}

export class NodeNotFoundError extends FileSystemError {
  constructor(path: string) {
    super(`No such file or directory: ${path}`);
  }
}

export class NodeAlreadyExistsError extends FileSystemError {
  constructor(path: string) {
    super(`Already exists: ${path}`);
  }
}

export class NotADirectoryError extends FileSystemError {
  constructor(path: string) {
    super(`Not a directory: ${path}`);
  }
}

export class IsADirectoryError extends FileSystemError {
  constructor(path: string) {
    super(`Is a directory: ${path}`);
  }
}

export class DirectoryNotEmptyError extends FileSystemError {
  constructor(path: string) {
    super(`Directory not empty: ${path} (use recursive: true)`);
  }
}

export class MoveIntoSelfError extends FileSystemError {
  constructor(source: string, destination: string) {
    super(`Cannot move ${source} into itself (${destination})`);
  }
}

export class RootOperationError extends FileSystemError {
  constructor(operation: string) {
    super(`Cannot ${operation} the root directory`);
  }
}
