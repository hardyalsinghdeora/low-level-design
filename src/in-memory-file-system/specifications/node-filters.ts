import { type FileSystemNode, NodeType } from '../node';
import { extensionOf } from '../path';
import { NodeSpecification } from './specification';

/** Shell-style glob on the node name: "*" is any run of characters, "?" is one character. */
export class NameMatches extends NodeSpecification {
  private readonly regex: RegExp;

  constructor(readonly glob: string) {
    super();
    const source = glob.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.');
    this.regex = new RegExp(`^${source}$`);
  }

  isSatisfiedBy(node: FileSystemNode): boolean {
    return this.regex.test(node.name);
  }
}

/** Files whose extension matches, case-insensitive; "ts" and ".ts" mean the same. */
export class HasExtension extends NodeSpecification {
  private readonly extension: string;

  constructor(extension: string) {
    super();
    this.extension = extension.replace(/^\./, '').toLowerCase();
  }

  isSatisfiedBy(node: FileSystemNode): boolean {
    return node.type === NodeType.FILE && extensionOf(node.name) === this.extension;
  }
}

export class MinSize extends NodeSpecification {
  constructor(readonly bytes: number) {
    super();
  }

  isSatisfiedBy(node: FileSystemNode): boolean {
    return node.size() >= this.bytes;
  }
}

export class MaxSize extends NodeSpecification {
  constructor(readonly bytes: number) {
    super();
  }

  isSatisfiedBy(node: FileSystemNode): boolean {
    return node.size() <= this.bytes;
  }
}

export class IsType extends NodeSpecification {
  constructor(readonly type: NodeType) {
    super();
  }

  isSatisfiedBy(node: FileSystemNode): boolean {
    return node.type === this.type;
  }
}
