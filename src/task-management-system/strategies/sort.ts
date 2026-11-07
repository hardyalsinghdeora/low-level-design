import { PRIORITY_RANK, type Task } from '../task';

/** Strategy pattern: how a board orders tasks is a view preference, not task logic. */
export interface TaskSortStrategy {
  compare(a: Task, b: Task): number;
}

/** Undated tasks sort after every dated one. */
function compareDue(a: Task, b: Task): number {
  const left = a.dueDate?.getTime() ?? Number.MAX_SAFE_INTEGER;
  const right = b.dueDate?.getTime() ?? Number.MAX_SAFE_INTEGER;
  return left - right;
}

/** `PAY-2` before `PAY-10`: creation order as the final, stable tie-break. */
function compareId(a: Task, b: Task): number {
  return a.id.localeCompare(b.id, 'en', { numeric: true });
}

/** Most urgent first; ties go to the earlier deadline. */
export class PrioritySort implements TaskSortStrategy {
  compare(a: Task, b: Task): number {
    return PRIORITY_RANK[b.priority] - PRIORITY_RANK[a.priority] || compareDue(a, b) || compareId(a, b);
  }
}

/** Earliest deadline first; ties go to the more urgent task. */
export class DueDateSort implements TaskSortStrategy {
  compare(a: Task, b: Task): number {
    return compareDue(a, b) || PRIORITY_RANK[b.priority] - PRIORITY_RANK[a.priority] || compareId(a, b);
  }
}
