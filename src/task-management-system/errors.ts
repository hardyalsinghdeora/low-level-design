import { DomainError } from '../shared/errors';
import type { TaskStatus } from './workflow';

export class TaskManagementError extends DomainError {}

export class TaskNotFoundError extends TaskManagementError {
  constructor(taskId: string) {
    super(`No task ${taskId}`);
  }
}

export class InvalidTransitionError extends TaskManagementError {
  constructor(taskId: string, from: TaskStatus, to: TaskStatus) {
    super(`Task ${taskId} cannot move from ${from} to ${to}`);
  }
}

export class IncompleteSubtasksError extends TaskManagementError {
  constructor(taskId: string, openSubtasks: number) {
    super(`Task ${taskId} has ${openSubtasks} open subtask(s) and cannot be DONE`);
  }
}

export class ParentTaskDoneError extends TaskManagementError {
  constructor(parentId: string) {
    super(`Parent task ${parentId} is DONE; reopen it before changing its subtasks`);
  }
}

export class NotAProjectMemberError extends TaskManagementError {
  constructor(userId: string, projectKey: string) {
    super(`User ${userId} is not a member of project ${projectKey}`);
  }
}
