import type { Clock } from '../shared/clock';
import type { Task } from './task';
import { TaskStatus } from './workflow';

export interface Reminder {
  readonly taskId: string;
  readonly title: string;
  readonly assigneeId: string | null;
  readonly dueDate: Date;
  readonly minutesLeft: number;
}

/**
 * Reminders are computed on demand from the clock instead of scheduling one
 * timer per task: a cron job asks "what is due in the next N hours?" and the
 * answer depends only on the data and the time, so restarts lose nothing.
 */
export class ReminderService {
  constructor(private readonly clock: Clock) {}

  /** Open tasks due in [now, now + hours]. Already overdue tasks belong to the Overdue filter. */
  dueWithin(tasks: Iterable<Task>, hours: number): Reminder[] {
    if (!(hours > 0)) throw new RangeError(`hours must be positive, got ${hours}`);
    const now = this.clock.now().getTime();
    const horizon = now + hours * 3_600_000;
    const reminders: Reminder[] = [];
    for (const task of tasks) {
      const due = task.dueDate?.getTime();
      if (due === undefined || task.status === TaskStatus.DONE || due < now || due > horizon) continue;
      reminders.push({
        taskId: task.id,
        title: task.title,
        assigneeId: task.assigneeId,
        dueDate: new Date(due),
        minutesLeft: Math.floor((due - now) / 60_000),
      });
    }
    return reminders.sort((a, b) => a.dueDate.getTime() - b.dueDate.getTime());
  }
}
