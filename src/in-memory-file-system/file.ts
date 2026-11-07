import { FileSystemNode, NodeType } from './node';
import { extensionOf } from './path';

/** A leaf of the composite. Text content; size is its UTF-8 byte length, like a real disk. */
export class File extends FileSystemNode {
  readonly type = NodeType.FILE;
  private content: string;

  constructor(id: string, name: string, createdAt: Date, content = '') {
    super(id, name, createdAt);
    this.content = content;
  }

  get extension(): string {
    return extensionOf(this.name);
  }

  read(): string {
    return this.content;
  }

  write(content: string, at: Date): void {
    this.content = content;
    this.touch(at);
  }

  append(content: string, at: Date): void {
    this.content += content;
    this.touch(at);
  }

  size(): number {
    return Buffer.byteLength(this.content, 'utf8');
  }
}
