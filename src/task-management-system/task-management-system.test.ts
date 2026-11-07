import { describe, expect, it } from 'vitest';
import { FakeClock } from '../shared/clock';
import { SequentialIdGenerator } from '../shared/id-generator';
import {
  ActivityLog,
  ActivityType,
  AssignedTo,
  DEFAULT_TRANSITIONS,
  DueBefore,
  DueDateSort,
  HasLabel,
  IncompleteSubtasksError,
  InvalidTransitionError,
  NotAProjectMemberError,
  Overdue,
  ParentTaskDoneError,
  Priority,
  PrioritySort,
  Project,
  StatusIs,
  type Task,
  TaskNotFoundError,
  TaskStatus,
  Workflow,
} from './index';

const { TODO, IN_PROGRESS, IN_REVIEW, BLOCKED, DONE } = TaskStatus;

function buildProject(workflow?: Workflow) {
  const clock = new FakeClock('2026-03-02T09:00:00Z');
  const log = new ActivityLog();
  const project = new Project('PAY', 'Payments', { clock, ids: new SequentialIdGenerator(), workflow });
  const unsubscribe = project.subscribe(log);
  project.addMember('asha').addMember('ravi');
  const inHours = (hours: number): Date => new Date(clock.now().getTime() + hours * 3_600_000);
  return { project, clock, log, unsubscribe, inHours };
}

function walk(project: Project, task: Task, ...statuses: TaskStatus[]): void {
  for (const status of statuses) project.transition(task.id, status, 'asha');
}

const idsOf = (tasks: Task[]): string[] => tasks.map((task) => task.id);

describe('Workflow state machine', () => {
  it('walks the happy path, detours through BLOCKED and reopens a finished task', () => {
    const { project } = buildProject();
    const task = project.createTask({ title: 'Ship checkout' }, 'asha');
    expect(task.id).toBe('PAY-1');
    expect(task.status).toBe(TODO);

    walk(project, task, IN_PROGRESS, BLOCKED, IN_PROGRESS, IN_REVIEW, DONE);
    expect(task.status).toBe(DONE);
    project.transition(task.id, TODO, 'ravi');
    expect(task.status).toBe(TODO);
  });

  it('rejects moves that are not in the transition table and keeps the status', () => {
    const { project } = buildProject();
    const task = project.createTask({ title: 'Ship checkout' }, 'asha');
    expect(() => project.transition(task.id, DONE, 'asha')).toThrow(InvalidTransitionError);
    expect(task.status).toBe(TODO);

    walk(project, task, IN_PROGRESS, IN_REVIEW, DONE);
    expect(() => project.transition(task.id, IN_REVIEW, 'asha')).toThrow(InvalidTransitionError);
    expect(task.status).toBe(DONE);
  });

  it('runs a custom table, e.g. a team without code review', () => {
    const noReview = new Workflow({ ...DEFAULT_TRANSITIONS, [IN_PROGRESS]: [DONE, BLOCKED] });
    const { project } = buildProject(noReview);
    const task = project.createTask({ title: 'Hotfix' }, 'asha');
    walk(project, task, IN_PROGRESS, DONE);
    expect(task.status).toBe(DONE);
    expect(noReview.allowedFrom(IN_PROGRESS)).not.toContain(IN_REVIEW);
  });
});

describe('Subtasks (Composite)', () => {
  it('derives parent progress from the leaves at every depth', () => {
    const { project } = buildProject();
    const epic = project.createTask({ title: 'Autopay' }, 'asha');
    const api = project.createSubtask(epic.id, { title: 'API' }, 'asha');
    const ui = project.createSubtask(epic.id, { title: 'UI' }, 'asha');
    const form = project.createSubtask(ui.id, { title: 'Form' }, 'asha');
    const list = project.createSubtask(ui.id, { title: 'List' }, 'asha');
    expect(epic.progress()).toEqual({ done: 0, total: 3, percent: 0 });

    walk(project, api, IN_PROGRESS, IN_REVIEW, DONE);
    walk(project, form, IN_PROGRESS, IN_REVIEW, DONE);
    expect(ui.progress()).toEqual({ done: 1, total: 2, percent: 50 });
    expect(epic.progress()).toEqual({ done: 2, total: 3, percent: 66 });

    walk(project, list, IN_PROGRESS, IN_REVIEW, DONE);
    expect(epic.progress().percent).toBe(100);
  });

  it('keeps a parent open while subtasks are open and freezes the subtasks of a DONE parent', () => {
    const { project } = buildProject();
    const epic = project.createTask({ title: 'Autopay' }, 'asha');
    const api = project.createSubtask(epic.id, { title: 'API' }, 'asha');
    walk(project, epic, IN_PROGRESS, IN_REVIEW);
    expect(() => project.transition(epic.id, DONE, 'asha')).toThrow(IncompleteSubtasksError);

    walk(project, api, IN_PROGRESS, IN_REVIEW, DONE);
    project.transition(epic.id, DONE, 'asha');
    expect(() => project.createSubtask(epic.id, { title: 'Late extra' }, 'asha')).toThrow(ParentTaskDoneError);
    expect(() => project.transition(api.id, TODO, 'asha')).toThrow(ParentTaskDoneError);
    expect(api.status).toBe(DONE);
  });
});

describe('Project', () => {
  it('lets only members act or be assigned, and reports unknown tasks', () => {
    const { project } = buildProject();
    expect(() => project.createTask({ title: 'Spam' }, 'mallory')).toThrow(NotAProjectMemberError);
    const task = project.createTask({ title: 'Ledger export' }, 'asha');
    expect(() => project.assign(task.id, 'mallory', 'asha')).toThrow(NotAProjectMemberError);
    expect(() => project.transition('PAY-99', IN_PROGRESS, 'asha')).toThrow(TaskNotFoundError);

    project.assign(task.id, 'ravi', 'asha');
    expect(task.assigneeId).toBe('ravi');
  });

  it('composes filters with and, or and not', () => {
    const { project } = buildProject();
    project.createTask({ title: 'A', labels: ['backend'], assigneeId: 'ravi' }, 'asha');
    const b = project.createTask({ title: 'B', labels: ['backend'], assigneeId: 'asha' }, 'asha');
    project.createTask({ title: 'C', labels: ['frontend'] }, 'asha');
    walk(project, b, IN_PROGRESS);

    expect(idsOf(project.find(new StatusIs(TODO).and(new HasLabel(' Backend '))))).toEqual(['PAY-1']);
    expect(idsOf(project.find(new AssignedTo('asha').or(new AssignedTo(null))))).toEqual(['PAY-2', 'PAY-3']);
    expect(idsOf(project.find(new HasLabel('backend').not()))).toEqual(['PAY-3']);
  });

  it('evaluates overdue against the clock and never flags DONE tasks', () => {
    const { project, clock, inHours } = buildProject();
    project.createTask({ title: 'Report', dueDate: inHours(2) }, 'asha');
    const audit = project.createTask({ title: 'Audit', dueDate: inHours(1) }, 'asha');
    project.createTask({ title: 'Someday' }, 'asha');
    const overdue = new Overdue(clock);
    expect(project.find(overdue)).toEqual([]);
    expect(idsOf(project.find(new DueBefore(inHours(1.5))))).toEqual(['PAY-2']);

    clock.advanceHours(3);
    expect(idsOf(project.find(overdue))).toEqual(['PAY-1', 'PAY-2']);
    walk(project, audit, IN_PROGRESS, IN_REVIEW, DONE);
    expect(idsOf(project.find(overdue))).toEqual(['PAY-1']);
  });

  it('sorts by priority or by due date with undated tasks last', () => {
    const { project, inHours } = buildProject();
    project.createTask({ title: 'Low', priority: Priority.LOW, dueDate: inHours(1) }, 'asha');
    project.createTask({ title: 'Critical', priority: Priority.CRITICAL, dueDate: inHours(10) }, 'asha');
    project.createTask({ title: 'High', priority: Priority.HIGH }, 'asha');
    project.createTask({ title: 'Medium', dueDate: inHours(5) }, 'asha');

    const titles = (tasks: Task[]): string[] => tasks.map((task) => task.title);
    expect(titles(project.find(undefined, new PrioritySort()))).toEqual(['Critical', 'High', 'Medium', 'Low']);
    expect(titles(project.find(undefined, new DueDateSort()))).toEqual(['Low', 'Medium', 'Critical', 'High']);
  });

  it('computes reminders on demand for open tasks due within N hours', () => {
    const { project, clock, inHours } = buildProject();
    project.createTask({ title: 'Soon', dueDate: inHours(3), assigneeId: 'ravi' }, 'asha');
    project.createTask({ title: 'Later', dueDate: inHours(30) }, 'asha');
    const finished = project.createTask({ title: 'Finished', dueDate: inHours(2) }, 'asha');
    project.createTask({ title: 'Missed', dueDate: inHours(-1) }, 'asha');
    walk(project, finished, IN_PROGRESS, IN_REVIEW, DONE);

    expect(project.remindersDueWithin(24)).toEqual([
      { taskId: 'PAY-1', title: 'Soon', assigneeId: 'ravi', dueDate: inHours(3), minutesLeft: 180 },
    ]);
    clock.advanceHours(10);
    expect(project.remindersDueWithin(24).map((reminder) => reminder.taskId)).toEqual(['PAY-2']);
  });

  it('appends exactly one activity entry per successful change and none for failures', () => {
    const { project, clock, log, unsubscribe } = buildProject();
    const task = project.createTask({ title: 'Ship', labels: ['release'] }, 'asha');
    clock.advanceMinutes(5);
    project.assign(task.id, 'ravi', 'asha');
    project.addLabel(task.id, 'release', 'asha'); // already present: not a change
    project.addLabel(task.id, 'urgent', 'asha');
    project.comment(task.id, '  On it  ', 'ravi');
    project.transition(task.id, IN_PROGRESS, 'ravi');
    expect(() => project.transition(task.id, DONE, 'ravi')).toThrow(InvalidTransitionError);
    project.createSubtask(task.id, { title: 'Release notes' }, 'ravi');

    expect(log.forTask(task.id).map((entry) => entry.type)).toEqual([
      ActivityType.CREATED,
      ActivityType.ASSIGNED,
      ActivityType.LABEL_ADDED,
      ActivityType.COMMENTED,
      ActivityType.STATUS_CHANGED,
      ActivityType.SUBTASK_ADDED,
    ]);
    expect(log.all[1]).toEqual({
      type: ActivityType.ASSIGNED,
      taskId: 'PAY-1',
      actorId: 'asha',
      at: new Date('2026-03-02T09:05:00Z'),
      detail: 'ravi',
    });
    expect(task.comments[0]?.body).toBe('On it');

    unsubscribe();
    project.setPriority(task.id, Priority.HIGH, 'asha');
    expect(log.all).toHaveLength(7);
  });
});
