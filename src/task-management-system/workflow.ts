export enum TaskStatus {
  TODO = 'TODO',
  IN_PROGRESS = 'IN_PROGRESS',
  IN_REVIEW = 'IN_REVIEW',
  BLOCKED = 'BLOCKED',
  DONE = 'DONE',
}

export type TransitionTable = Readonly<Record<TaskStatus, readonly TaskStatus[]>>;

/**
 * The default board: forward through review, park in BLOCKED from any active
 * state, send a review back, and reopen a finished task.
 */
export const DEFAULT_TRANSITIONS: TransitionTable = {
  [TaskStatus.TODO]: [TaskStatus.IN_PROGRESS, TaskStatus.BLOCKED],
  [TaskStatus.IN_PROGRESS]: [TaskStatus.IN_REVIEW, TaskStatus.BLOCKED, TaskStatus.TODO],
  [TaskStatus.IN_REVIEW]: [TaskStatus.DONE, TaskStatus.IN_PROGRESS, TaskStatus.BLOCKED],
  [TaskStatus.BLOCKED]: [TaskStatus.TODO, TaskStatus.IN_PROGRESS],
  [TaskStatus.DONE]: [TaskStatus.TODO],
};

/**
 * State machine as data. Every legal move lives in one table instead of being
 * scattered across if-statements, so a team that skips code review ships a
 * different table, not different code.
 */
export class Workflow {
  constructor(private readonly transitions: TransitionTable = DEFAULT_TRANSITIONS) {}

  allowedFrom(status: TaskStatus): readonly TaskStatus[] {
    return this.transitions[status];
  }

  canTransition(from: TaskStatus, to: TaskStatus): boolean {
    return this.transitions[from].includes(to);
  }
}
