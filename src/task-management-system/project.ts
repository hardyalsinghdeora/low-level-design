import { Clock, SystemClock } from '../shared/clock';
import { IdGenerator, UuidGenerator } from '../shared/id-generator';
import { ActivityType, type TaskObserver } from './activity';
import { NotAProjectMemberError, TaskNotFoundError } from './errors';
import { type Reminder, ReminderService } from './reminders';
import type { Specification } from './specifications';
import type { TaskSortStrategy } from './strategies/sort';
import { type Comment, normalizeLabel, Priority, Task } from './task';
import { type TaskStatus, Workflow } from './workflow';

export interface NewTask {
  title: string;
  priority?: Priority;
  assigneeId?: string;
  labels?: readonly string[];
  dueDate?: Date;
}

export interface ProjectOptions {
  clock?: Clock;
  ids?: IdGenerator;
  workflow?: Workflow;
}

/**
 * Aggregate root. Every change goes through here so membership is checked in
 * one place, the task enforces the workflow, and exactly one event is published
 * per successful change (a failed command publishes nothing).
 */
export class Project {
  private readonly tasks = new Map<string, Task>();
  private readonly members = new Set<string>();
  private readonly observers = new Set<TaskObserver>();
  private readonly clock: Clock;
  private readonly ids: IdGenerator;
  private readonly workflow: Workflow;
  private readonly reminders: ReminderService;

  constructor(
    readonly key: string,
    readonly name: string,
    options: ProjectOptions = {},
  ) {
    if (!/^[A-Z][A-Z0-9]{1,9}$/.test(key)) throw new RangeError(`Project key must be 2-10 upper-case characters, got ${key}`);
    this.clock = options.clock ?? new SystemClock();
    this.ids = options.ids ?? new UuidGenerator();
    this.workflow = options.workflow ?? new Workflow();
    this.reminders = new ReminderService(this.clock);
  }

  addMember(userId: string): this {
    this.members.add(userId);
    return this;
  }

  /** Observer registration; returns the unsubscribe function. */
  subscribe(observer: TaskObserver): () => void {
    this.observers.add(observer);
    return () => this.observers.delete(observer);
  }

  createTask(input: NewTask, actorId: string): Task {
    return this.create(input, actorId, null);
  }

  createSubtask(parentId: string, input: NewTask, actorId: string): Task {
    return this.create(input, actorId, this.getTask(parentId));
  }

  getTask(taskId: string): Task {
    const task = this.tasks.get(taskId);
    if (!task) throw new TaskNotFoundError(taskId);
    return task;
  }

  transition(taskId: string, to: TaskStatus, actorId: string): Task {
    const task = this.prepare(taskId, actorId);
    const from = task.transitionTo(to);
    this.emit(ActivityType.STATUS_CHANGED, task, actorId, `${from} -> ${to}`);
    return task;
  }

  assign(taskId: string, assigneeId: string | null, actorId: string): Task {
    if (assigneeId !== null) this.assertMember(assigneeId);
    const task = this.prepare(taskId, actorId);
    task.assign(assigneeId);
    this.emit(ActivityType.ASSIGNED, task, actorId, assigneeId ?? 'unassigned');
    return task;
  }

  addLabel(taskId: string, label: string, actorId: string): Task {
    const task = this.prepare(taskId, actorId);
    if (task.addLabel(label)) this.emit(ActivityType.LABEL_ADDED, task, actorId, normalizeLabel(label));
    return task;
  }

  setPriority(taskId: string, priority: Priority, actorId: string): Task {
    const task = this.prepare(taskId, actorId);
    task.setPriority(priority);
    this.emit(ActivityType.PRIORITY_CHANGED, task, actorId, priority);
    return task;
  }

  setDueDate(taskId: string, dueDate: Date | null, actorId: string): Task {
    const task = this.prepare(taskId, actorId);
    task.setDueDate(dueDate);
    this.emit(ActivityType.DUE_DATE_SET, task, actorId, dueDate?.toISOString() ?? 'none');
    return task;
  }

  comment(taskId: string, body: string, actorId: string): Comment {
    const task = this.prepare(taskId, actorId);
    const comment: Comment = { id: this.ids.next('CMT'), authorId: actorId, body: body.trim(), createdAt: this.clock.now() };
    task.addComment(comment);
    this.emit(ActivityType.COMMENTED, task, actorId, comment.body);
    return comment;
  }

  /** Filter with any Specification, optionally ordered by a sort Strategy. */
  find(spec?: Specification<Task>, sort?: TaskSortStrategy): Task[] {
    const matches = [...this.tasks.values()].filter((task) => spec?.isSatisfiedBy(task) ?? true);
    return sort ? matches.sort((a, b) => sort.compare(a, b)) : matches;
  }

  remindersDueWithin(hours: number): Reminder[] {
    return this.reminders.dueWithin(this.tasks.values(), hours);
  }

  private create(input: NewTask, actorId: string, parent: Task | null): Task {
    this.assertMember(actorId);
    if (input.assigneeId !== undefined) this.assertMember(input.assigneeId);
    const task = new Task(this.ids.next(this.key), input.title, this.clock.now(), this.workflow, input.priority);
    parent?.addSubtask(task); // throws before anything is stored if the parent is DONE
    task.assign(input.assigneeId ?? null);
    for (const label of input.labels ?? []) task.addLabel(label);
    task.setDueDate(input.dueDate ?? null);
    this.tasks.set(task.id, task);

    this.emit(ActivityType.CREATED, task, actorId, task.title);
    if (parent) this.emit(ActivityType.SUBTASK_ADDED, parent, actorId, task.id);
    return task;
  }

  private prepare(taskId: string, actorId: string): Task {
    this.assertMember(actorId);
    return this.getTask(taskId);
  }

  private assertMember(userId: string): void {
    if (!this.members.has(userId)) throw new NotAProjectMemberError(userId, this.key);
  }

  private emit(type: ActivityType, task: Task, actorId: string, detail: string): void {
    const event = { type, taskId: task.id, actorId, at: this.clock.now(), detail };
    for (const observer of this.observers) observer.onTaskEvent(event);
  }
}
