import { NodeAlreadyExistsError, NodeNotFoundError } from './errors';
import { FileSystemNode, NodeType } from './node';
import { joinPath } from './path';

/**
 * The composite node. Children are indexed by name, which is what enforces
 * "no two entries with the same name in one directory" (the unique
 * (parent_id, name) constraint of a database-backed version).
 */
export class Directory extends FileSystemNode {
  readonly type = NodeType.DIRECTORY;
  private readonly children = new Map<string, FileSystemNode>();

  constructor(id: string, name: string, createdAt: Date) {
    super(id, name, createdAt);
  }

  get childCount(): number {
    return this.children.size;
  }

  get(name: string): FileSystemNode | undefined {
    return this.children.get(name);
  }

  has(name: string): boolean {
    return this.children.has(name);
  }

  /** Children sorted by name in code-point order (locale-independent), so listings and searches are deterministic. */
  entries(): FileSystemNode[] {
    return [...this.children.values()].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  }

  add(node: FileSystemNode, at: Date): void {
    if (this.children.has(node.name)) throw new NodeAlreadyExistsError(joinPath(this.path, node.name));
    this.children.set(node.name, node);
    node.attachTo(this);
    this.touch(at);
  }

  remove(name: string, at: Date): FileSystemNode {
    const node = this.children.get(name);
    if (!node) throw new NodeNotFoundError(joinPath(this.path, name));
    this.children.delete(name);
    node.detach();
    this.touch(at);
    return node;
  }

  size(): number {
    let total = 0;
    for (const child of this.children.values()) total += child.size();
    return total;
  }
}
