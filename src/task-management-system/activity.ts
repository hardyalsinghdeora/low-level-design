export enum ActivityType {
  CREATED = 'CREATED',
  SUBTASK_ADDED = 'SUBTASK_ADDED',
  STATUS_CHANGED = 'STATUS_CHANGED',
  ASSIGNED = 'ASSIGNED',
  LABEL_ADDED = 'LABEL_ADDED',
  COMMENTED = 'COMMENTED',
  DUE_DATE_SET = 'DUE_DATE_SET',
  PRIORITY_CHANGED = 'PRIORITY_CHANGED',
}

export interface TaskEvent {
  readonly type: ActivityType;
  readonly taskId: string;
  readonly actorId: string;
  readonly at: Date;
  readonly detail: string;
}

/**
 * Observer: the project publishes one event per change and does not know who
 * listens. Notifications, webhooks or a search index are new observers, not
 * edits to Project.
 */
export interface TaskObserver {
  onTaskEvent(event: TaskEvent): void;
}

/** The audit trail is just another observer: append-only, never edited. */
export class ActivityLog implements TaskObserver {
  private readonly entries: TaskEvent[] = [];

  onTaskEvent(event: TaskEvent): void {
    this.entries.push(event);
  }

  get all(): readonly TaskEvent[] {
    return [...this.entries];
  }

  forTask(taskId: string): TaskEvent[] {
    return this.entries.filter((entry) => entry.taskId === taskId);
  }
}
