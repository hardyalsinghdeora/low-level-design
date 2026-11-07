import { IncompleteSubtasksError, InvalidTransitionError, ParentTaskDoneError } from './errors';
import { TaskStatus, type Workflow } from './workflow';

export enum Priority {
  LOW = 'LOW',
  MEDIUM = 'MEDIUM',
  HIGH = 'HIGH',
  CRITICAL = 'CRITICAL',
}

/** Higher rank means more urgent. */
export const PRIORITY_RANK: Record<Priority, number> = {
  [Priority.LOW]: 0,
  [Priority.MEDIUM]: 1,
  [Priority.HIGH]: 2,
  [Priority.CRITICAL]: 3,
};

export interface Comment {
  readonly id: string;
  readonly authorId: string;
  readonly body: string;
  readonly createdAt: Date;
}

/** Counted in leaf tasks: a parent is as far along as the work underneath it. */
export interface Progress {
  readonly done: number;
  readonly total: number;
  readonly percent: number;
}

export function normalizeLabel(label: string): string {
  const normalized = label.trim().toLowerCase();
  if (!normalized) throw new RangeError('label must not be blank');
  return normalized;
}

/**
 * A unit of work and, through its subtasks, a Composite. A parent's progress is
 * never stored; it is derived from the leaves on every call, so it cannot drift
 * out of sync with the children.
 */
export class Task {
  private _status = TaskStatus.TODO;
  private _priority: Priority;
  private _assigneeId: string | null = null;
  private _dueDate: Date | null = null;
  private _parent: Task | null = null;
  private readonly _labels = new Set<string>();
  private readonly _comments: Comment[] = [];
  private readonly _subtasks: Task[] = [];

  constructor(
    readonly id: string,
    readonly title: string,
    readonly createdAt: Date,
    private readonly workflow: Workflow,
    priority: Priority = Priority.MEDIUM,
  ) {
    if (!title.trim()) throw new RangeError('title is required');
    this._priority = priority;
  }

  get status(): TaskStatus {
    return this._status;
  }

  get priority(): Priority {
    return this._priority;
  }

  get assigneeId(): string | null {
    return this._assigneeId;
  }

  get dueDate(): Date | null {
    return this._dueDate;
  }

  get parent(): Task | null {
    return this._parent;
  }

  get labels(): readonly string[] {
    return [...this._labels];
  }

  get comments(): readonly Comment[] {
    return [...this._comments];
  }

  get subtasks(): readonly Task[] {
    return [...this._subtasks];
  }

  /**
   * Moves along the workflow and returns the previous status. The table decides
   * what is legal in general; the task adds the rules only it can check.
   */
  transitionTo(next: TaskStatus): TaskStatus {
    if (this._parent?.status === TaskStatus.DONE) throw new ParentTaskDoneError(this._parent.id);
    if (!this.workflow.canTransition(this._status, next)) {
      throw new InvalidTransitionError(this.id, this._status, next);
    }
    if (next === TaskStatus.DONE) {
      const open = this._subtasks.filter((task) => task.status !== TaskStatus.DONE).length;
      if (open > 0) throw new IncompleteSubtasksError(this.id, open);
    }
    const previous = this._status;
    this._status = next;
    return previous;
  }

  /** A DONE parent must only have DONE children, so it refuses new work. */
  addSubtask(child: Task): void {
    if (this._status === TaskStatus.DONE) throw new ParentTaskDoneError(this.id);
    if (child === this || child._parent !== null) {
      throw new RangeError(`Task ${child.id} cannot become a subtask of ${this.id}`);
    }
    child._parent = this;
    this._subtasks.push(child);
  }

  /** Composite: a leaf is one unit of work; a parent sums its children. */
  progress(): Progress {
    const { done, total } = this.countLeaves();
    return { done, total, percent: Math.floor((done * 100) / total) };
  }

  isOverdue(now: Date): boolean {
    return this._dueDate !== null && this._status !== TaskStatus.DONE && this._dueDate.getTime() < now.getTime();
  }

  assign(userId: string | null): void {
    this._assigneeId = userId;
  }

  setPriority(priority: Priority): void {
    this._priority = priority;
  }

  setDueDate(dueDate: Date | null): void {
    this._dueDate = dueDate ? new Date(dueDate) : null;
  }

  /** Returns false when the label was already present, so callers only log real changes. */
  addLabel(label: string): boolean {
    const normalized = normalizeLabel(label);
    if (this._labels.has(normalized)) return false;
    this._labels.add(normalized);
    return true;
  }

  addComment(comment: Comment): void {
    if (!comment.body.trim()) throw new RangeError('comment body is required');
    this._comments.push(comment);
  }

  private countLeaves(): { done: number; total: number } {
    if (this._subtasks.length === 0) return { done: this._status === TaskStatus.DONE ? 1 : 0, total: 1 };
    let done = 0;
    let total = 0;
    for (const child of this._subtasks) {
      const counts = child.countLeaves();
      done += counts.done;
      total += counts.total;
    }
    return { done, total };
  }
}
