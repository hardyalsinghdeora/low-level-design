import { type Clock, SystemClock } from '../shared/clock';
import { type IdGenerator, UuidGenerator } from '../shared/id-generator';
import { Directory } from './directory';
import {
  DirectoryNotEmptyError,
  IsADirectoryError,
  MoveIntoSelfError,
  NodeAlreadyExistsError,
  NodeNotFoundError,
  NotADirectoryError,
  RootOperationError,
} from './errors';
import { File } from './file';
import type { FileSystemNode, NodeType } from './node';
import { assertValidName, formatPath, parsePath } from './path';
import type { NodeSpecification } from './specifications/specification';

export interface FileSystemOptions {
  clock?: Clock;
  ids?: IdGenerator;
}

export interface NodeStats {
  id: string;
  path: string;
  name: string;
  type: NodeType;
  size: number;
  createdAt: Date;
  modifiedAt: Date;
  childCount?: number;
}

/**
 * Aggregate root and the only public entry point: it turns path strings into
 * nodes and applies every structural change (create, move, remove), so the
 * tree's invariants (unique names per directory, no cycles, a root that never
 * goes away) are checked in one place.
 */
export class InMemoryFileSystem {
  private readonly root: Directory;
  private readonly clock: Clock;
  private readonly ids: IdGenerator;

  constructor(options: FileSystemOptions = {}) {
    this.clock = options.clock ?? new SystemClock();
    this.ids = options.ids ?? new UuidGenerator();
    this.root = new Directory(this.ids.next('INODE'), '', this.clock.now());
  }

  /** Like `mkdir`, or `mkdir -p` with `recursive`, which also accepts an existing directory. */
  mkdir(path: string, options: { recursive?: boolean } = {}): Directory {
    const segments = parsePath(path);
    if (!options.recursive) {
      const parent = this.parentDirectory(segments);
      return this.attach(parent, new Directory(this.ids.next('INODE'), this.leafName(segments), this.clock.now()));
    }
    let current = this.root;
    for (const name of segments) {
      const child = current.get(name);
      if (child instanceof Directory) current = child;
      else if (child) throw new NotADirectoryError(child.path);
      else current = this.attach(current, new Directory(this.ids.next('INODE'), name, this.clock.now()));
    }
    return current;
  }

  /** Creates a new file; fails if anything already has that path. */
  createFile(path: string, content = ''): File {
    const segments = parsePath(path);
    const parent = this.parentDirectory(segments);
    return this.attach(parent, new File(this.ids.next('INODE'), this.leafName(segments), this.clock.now(), content));
  }

  readFile(path: string): string {
    return this.fileAt(path).read();
  }

  /** Overwrites a file, creating it when missing (like fs.writeFile). */
  writeFile(path: string, content: string): File {
    const file = this.existingFileOrUndefined(path);
    if (!file) return this.createFile(path, content);
    file.write(content, this.clock.now());
    return file;
  }

  /** Appends to a file, creating it when missing (like fs.appendFile). */
  appendFile(path: string, content: string): File {
    const file = this.existingFileOrUndefined(path);
    if (!file) return this.createFile(path, content);
    file.append(content, this.clock.now());
    return file;
  }

  /** Sorted names in a directory (directories end with "/"), or the name itself for a file. */
  ls(path = '/'): string[] {
    const node = this.resolve(path);
    if (!(node instanceof Directory)) return [node.name];
    return node.entries().map((child) => (child instanceof Directory ? `${child.name}/` : child.name));
  }

  stat(path: string): NodeStats {
    const node = this.resolve(path);
    return {
      id: node.id,
      path: node.path,
      name: node.name || '/',
      type: node.type,
      size: node.size(),
      createdAt: node.createdAt,
      modifiedAt: node.modifiedAt,
      ...(node instanceof Directory ? { childCount: node.childCount } : {}),
    };
  }

  exists(path: string): boolean {
    try {
      this.resolve(path);
      return true;
    } catch (error) {
      if (error instanceof NodeNotFoundError || error instanceof NotADirectoryError) return false;
      throw error;
    }
  }

  /**
   * Moves or renames. An existing directory as destination means "move into
   * it"; an existing file is never overwritten. A directory cannot move into
   * itself or its own subtree, which would detach it from the root as a cycle.
   */
  mv(source: string, destination: string): FileSystemNode {
    const sourceSegments = parsePath(source);
    if (sourceSegments.length === 0) throw new RootOperationError('move');
    const node = this.resolveSegments(sourceSegments);
    const destinationSegments = parsePath(destination);
    const existing = this.lookup(destinationSegments);

    let target: Directory;
    let name: string;
    if (existing instanceof Directory) {
      target = existing;
      name = node.name;
    } else if (existing) {
      throw new NodeAlreadyExistsError(existing.path);
    } else {
      target = this.parentDirectory(destinationSegments);
      name = this.leafName(destinationSegments);
    }

    if (node.contains(target)) throw new MoveIntoSelfError(node.path, formatPath(destinationSegments));
    if (target.get(name) === node) return node;
    if (target.has(name)) throw new NodeAlreadyExistsError(target.get(name)?.path ?? destination);
    assertValidName(name);

    const now = this.clock.now();
    node.parent?.remove(node.name, now);
    node.rename(name);
    target.add(node, now);
    return node;
  }

  /** Removes a file, an empty directory, or with `recursive` a whole subtree. */
  rm(path: string, options: { recursive?: boolean } = {}): void {
    const segments = parsePath(path);
    if (segments.length === 0) throw new RootOperationError('remove');
    const node = this.resolveSegments(segments);
    if (node instanceof Directory && node.childCount > 0 && !options.recursive) {
      throw new DirectoryNotEmptyError(node.path);
    }
    node.parent?.remove(node.name, this.clock.now());
  }

  /** Depth-first search below `path`; returns matching paths in sorted, pre-order sequence. */
  find(path: string, spec: NodeSpecification): string[] {
    const start = this.resolve(path);
    const matches: string[] = [];
    const visit = (dir: Directory): void => {
      for (const child of dir.entries()) {
        if (spec.isSatisfiedBy(child)) matches.push(child.path);
        if (child instanceof Directory) visit(child);
      }
    };
    if (start instanceof Directory) visit(start);
    else if (spec.isSatisfiedBy(start)) matches.push(start.path);
    return matches;
  }

  /** Indented listing with sizes, for demos and debugging. */
  tree(path = '/'): string {
    const lines: string[] = [];
    const visit = (node: FileSystemNode, depth: number): void => {
      const label = node instanceof Directory ? `${node.name || '/'}${node.name ? '/' : ''}` : node.name;
      lines.push(`${'  '.repeat(depth)}${label} (${node.size()} B)`);
      if (node instanceof Directory) for (const child of node.entries()) visit(child, depth + 1);
    };
    visit(this.resolve(path), 0);
    return lines.join('\n');
  }

  private attach<T extends FileSystemNode>(parent: Directory, node: T): T {
    parent.add(node, this.clock.now());
    return node;
  }

  private resolve(path: string): FileSystemNode {
    return this.resolveSegments(parsePath(path));
  }

  private resolveSegments(segments: readonly string[]): FileSystemNode {
    const node = this.lookup(segments);
    if (!node) throw new NodeNotFoundError(formatPath(segments));
    return node;
  }

  /** Walks the tree; undefined when the last step is missing, an error when a middle step is a file. */
  private lookup(segments: readonly string[]): FileSystemNode | undefined {
    let current: FileSystemNode = this.root;
    for (const name of segments) {
      if (!(current instanceof Directory)) throw new NotADirectoryError(current.path);
      const next = current.get(name);
      if (!next) return undefined;
      current = next;
    }
    return current;
  }

  private parentDirectory(segments: readonly string[]): Directory {
    if (segments.length === 0) throw new NodeAlreadyExistsError('/');
    const parent = this.lookup(segments.slice(0, -1));
    if (!parent) throw new NodeNotFoundError(formatPath(segments.slice(0, -1)));
    if (!(parent instanceof Directory)) throw new NotADirectoryError(parent.path);
    if (parent.has(this.leafName(segments))) throw new NodeAlreadyExistsError(formatPath(segments));
    return parent;
  }

  private leafName(segments: readonly string[]): string {
    const name = segments[segments.length - 1] ?? '';
    assertValidName(name);
    return name;
  }

  private fileAt(path: string): File {
    const node = this.resolve(path);
    if (node instanceof Directory) throw new IsADirectoryError(node.path);
    if (!(node instanceof File)) throw new NodeNotFoundError(node.path);
    return node;
  }

  private existingFileOrUndefined(path: string): File | undefined {
    const segments = parsePath(path);
    const node = this.lookup(segments);
    if (!node) return undefined;
    if (node instanceof Directory) throw new IsADirectoryError(node.path);
    return node instanceof File ? node : undefined;
  }
}
