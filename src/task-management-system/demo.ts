import { FakeClock } from '../shared/clock';
import { SequentialIdGenerator } from '../shared/id-generator';
import {
  ActivityLog,
  DEFAULT_TRANSITIONS,
  DueDateSort,
  HasLabel,
  Overdue,
  Priority,
  PrioritySort,
  Project,
  StatusIs,
  TaskStatus,
} from './index';

const clock = new FakeClock('2026-03-02T09:00:00Z');
const inHours = (hours: number): Date => new Date(clock.now().getTime() + hours * 3_600_000);
const ids = (tasks: { id: string }[]): string => tasks.map((task) => task.id).join(', ');

const log = new ActivityLog();
const project = new Project('PAY', 'Payments', { clock, ids: new SequentialIdGenerator() });
project.subscribe(log);
project.addMember('asha').addMember('ravi').addMember('meera');

console.log(`\n${project.key} (${project.name}) - sprint starts ${clock.now().toISOString()}`);
const epic = project.createTask({ title: 'Launch UPI autopay', priority: Priority.HIGH, dueDate: inHours(72) }, 'asha');
const api = project.createSubtask(epic.id, { title: 'Mandate API', assigneeId: 'ravi', labels: ['backend'], dueDate: inHours(20) }, 'asha');
const screens = project.createSubtask(epic.id, { title: 'Mandate screens', assigneeId: 'meera', dueDate: inHours(30) }, 'asha');
project.createSubtask(epic.id, { title: 'Merchant docs', priority: Priority.LOW }, 'asha');
project.createTask(
  { title: 'Refund webhook fires twice', priority: Priority.CRITICAL, assigneeId: 'ravi', labels: ['backend', 'bug'], dueDate: inHours(4) },
  'meera',
);
for (const task of project.find()) {
  console.log(`  ${task.id} ${task.title} [${task.priority}]${task.parent ? ` under ${task.parent.id}` : ''}`);
}

console.log('\n--- Ravi takes the API through the workflow; the epic progress is derived ---');
for (const status of [TaskStatus.IN_PROGRESS, TaskStatus.IN_REVIEW, TaskStatus.DONE]) {
  clock.advanceHours(1);
  project.transition(api.id, status, 'ravi');
  const progress = epic.progress();
  console.log(`  ${api.id} -> ${api.status}; ${epic.id} is ${progress.done}/${progress.total} leaves done (${progress.percent}%)`);
}

console.log('\n--- Meera tries to skip straight to DONE ---');
try {
  project.transition(screens.id, TaskStatus.DONE, 'meera');
} catch (error) {
  console.log(`  ${(error as Error).name}: ${(error as Error).message}`);
  console.log(`  From TODO the workflow allows: ${DEFAULT_TRANSITIONS[TaskStatus.TODO].join(', ')}`);
}
project.comment(screens.id, 'Waiting for sandbox keys from the bank', 'meera');
project.transition(screens.id, TaskStatus.BLOCKED, 'meera');

console.log('\n--- Board views: composable filters and swappable sort orders ---');
const openBackend = new HasLabel('backend').and(new StatusIs(TaskStatus.DONE).not());
console.log(`  open backend work by priority: ${ids(project.find(openBackend, new PrioritySort()))}`);
console.log(`  everything by due date:        ${ids(project.find(undefined, new DueDateSort()))}`);
console.log(`  blocked:                       ${ids(project.find(new StatusIs(TaskStatus.BLOCKED)))}`);

console.log('\n--- Three hours later ---');
clock.advanceHours(3);
console.log(`  overdue now: ${ids(project.find(new Overdue(clock)))}`);
for (const reminder of project.remindersDueWithin(24)) {
  const hoursLeft = Math.floor(reminder.minutesLeft / 60);
  console.log(`  reminder: ${reminder.taskId} "${reminder.title}" due in ${hoursLeft}h, ping ${reminder.assigneeId ?? 'nobody'}`);
}

console.log(`\n--- Activity log: ${log.all.length} entries, the last five ---`);
for (const entry of log.all.slice(-5)) {
  console.log(`  ${entry.at.toISOString()} ${entry.actorId.padEnd(5)} ${entry.taskId} ${entry.type}: ${entry.detail}`);
}
