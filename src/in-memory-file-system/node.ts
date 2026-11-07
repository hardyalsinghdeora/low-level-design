import type { Directory } from './directory';
import { assertValidName, joinPath } from './path';

export enum NodeType {
  FILE = 'FILE',
  DIRECTORY = 'DIRECTORY',
}

/**
 * Composite pattern: the common base of files and directories. Callers can
 * ask any node for its path and size without knowing which kind it is; the
 * directory's size is the recursive sum of its children.
 *
 * A node knows its parent so `path` is always derived, never stored, and stays
 * correct after a move.
 */
export abstract class FileSystemNode {
  abstract readonly type: NodeType;
  private parentDir: Directory | null = null;
  private nodeName: string;
  private modified: Date;

  protected constructor(
    readonly id: string,
    name: string,
    readonly createdAt: Date,
  ) {
    this.nodeName = name;
    this.modified = createdAt;
  }

  /** Size in bytes; recursive for directories. */
  abstract size(): number;

  get name(): string {
    return this.nodeName;
  }

  get parent(): Directory | null {
    return this.parentDir;
  }

  get modifiedAt(): Date {
    return this.modified;
  }

  get path(): string {
    return this.parentDir ? joinPath(this.parentDir.path, this.nodeName) : '/';
  }

  /** True when `other` is this node or lives somewhere below it. */
  contains(other: FileSystemNode): boolean {
    for (let node: FileSystemNode | null = other; node; node = node.parent) {
      if (node === this) return true;
    }
    return false;
  }

  /** Only Directory calls these, so the parent pointer and the child map never disagree. */
  attachTo(parent: Directory): void {
    this.parentDir = parent;
  }

  detach(): void {
    this.parentDir = null;
  }

  /** Renaming is only allowed while detached; otherwise the parent's index would go stale. */
  rename(name: string): void {
    if (this.parentDir) throw new RangeError(`Detach ${this.path} before renaming it`);
    assertValidName(name);
    this.nodeName = name;
  }

  protected touch(at: Date): void {
    this.modified = at;
  }
}
