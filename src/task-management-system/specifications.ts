import type { Clock } from '../shared/clock';
import { normalizeLabel, type Task } from './task';
import type { TaskStatus } from './workflow';

/**
 * Specification pattern: each filter answers one yes/no question and filters
 * compose with and/or/not, so a new filter never widens a `search(...)`
 * signature or touches Project.
 */
export abstract class Specification<T> {
  abstract isSatisfiedBy(candidate: T): boolean;

  and(other: Specification<T>): Specification<T> {
    return new AndSpecification(this, other);
  }

  or(other: Specification<T>): Specification<T> {
    return new OrSpecification(this, other);
  }

  not(): Specification<T> {
    return new NotSpecification(this);
  }
}

class AndSpecification<T> extends Specification<T> {
  constructor(
    private readonly left: Specification<T>,
    private readonly right: Specification<T>,
  ) {
    super();
  }

  override isSatisfiedBy(candidate: T): boolean {
    return this.left.isSatisfiedBy(candidate) && this.right.isSatisfiedBy(candidate);
  }
}

class OrSpecification<T> extends Specification<T> {
  constructor(
    private readonly left: Specification<T>,
    private readonly right: Specification<T>,
  ) {
    super();
  }

  override isSatisfiedBy(candidate: T): boolean {
    return this.left.isSatisfiedBy(candidate) || this.right.isSatisfiedBy(candidate);
  }
}

class NotSpecification<T> extends Specification<T> {
  constructor(private readonly inner: Specification<T>) {
    super();
  }

  override isSatisfiedBy(candidate: T): boolean {
    return !this.inner.isSatisfiedBy(candidate);
  }
}

export class StatusIs extends Specification<Task> {
  private readonly statuses: ReadonlySet<TaskStatus>;

  constructor(...statuses: TaskStatus[]) {
    super();
    this.statuses = new Set(statuses);
  }

  override isSatisfiedBy(task: Task): boolean {
    return this.statuses.has(task.status);
  }
}

/** `null` matches unassigned tasks. */
export class AssignedTo extends Specification<Task> {
  constructor(private readonly userId: string | null) {
    super();
  }

  override isSatisfiedBy(task: Task): boolean {
    return task.assigneeId === this.userId;
  }
}

export class HasLabel extends Specification<Task> {
  private readonly label: string;

  constructor(label: string) {
    super();
    this.label = normalizeLabel(label);
  }

  override isSatisfiedBy(task: Task): boolean {
    return task.labels.includes(this.label);
  }
}

/** Reads the clock at evaluation time, so a saved filter always means "overdue now". */
export class Overdue extends Specification<Task> {
  constructor(private readonly clock: Clock) {
    super();
  }

  override isSatisfiedBy(task: Task): boolean {
    return task.isOverdue(this.clock.now());
  }
}

export class DueBefore extends Specification<Task> {
  constructor(private readonly instant: Date) {
    super();
  }

  override isSatisfiedBy(task: Task): boolean {
    return task.dueDate !== null && task.dueDate.getTime() < this.instant.getTime();
  }
}
