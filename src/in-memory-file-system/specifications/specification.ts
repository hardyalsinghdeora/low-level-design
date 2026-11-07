import type { FileSystemNode } from '../node';

/**
 * Specification pattern: a search filter is an object with one predicate, and
 * filters combine with and / or / not into new filters. `find` never grows a
 * parameter per criterion; callers compose what they need.
 */
export abstract class NodeSpecification {
  abstract isSatisfiedBy(node: FileSystemNode): boolean;

  and(other: NodeSpecification): NodeSpecification {
    return new AndSpecification(this, other);
  }

  or(other: NodeSpecification): NodeSpecification {
    return new OrSpecification(this, other);
  }

  not(): NodeSpecification {
    return new NotSpecification(this);
  }
}

export class AndSpecification extends NodeSpecification {
  constructor(
    private readonly left: NodeSpecification,
    private readonly right: NodeSpecification,
  ) {
    super();
  }

  isSatisfiedBy(node: FileSystemNode): boolean {
    return this.left.isSatisfiedBy(node) && this.right.isSatisfiedBy(node);
  }
}

export class OrSpecification extends NodeSpecification {
  constructor(
    private readonly left: NodeSpecification,
    private readonly right: NodeSpecification,
  ) {
    super();
  }

  isSatisfiedBy(node: FileSystemNode): boolean {
    return this.left.isSatisfiedBy(node) || this.right.isSatisfiedBy(node);
  }
}

export class NotSpecification extends NodeSpecification {
  constructor(private readonly inner: NodeSpecification) {
    super();
  }

  isSatisfiedBy(node: FileSystemNode): boolean {
    return !this.inner.isSatisfiedBy(node);
  }
}
