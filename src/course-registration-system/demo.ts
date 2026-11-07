import { FakeClock } from '../shared/clock';
import { SequentialIdGenerator } from '../shared/id-generator';
import { Course, EventLog, formatSlot, Registrar, Section, Student, Term, weekly, Weekday } from './index';

const clock = new FakeClock('2026-08-01T09:00:00Z');
const log = new EventLog();
const registrar = new Registrar({ clock, ids: new SequentialIdGenerator() });
registrar.subscribe(log);

registrar
  .addTerm(new Term('F26', new Date('2026-08-01T00:00:00Z'), new Date('2026-08-15T00:00:00Z'), new Date('2026-09-01T00:00:00Z')))
  .addCourse(new Course('CS101', 'Intro to Programming', 4))
  .addCourse(new Course('CS201', 'Data Structures', 4, ['CS101']))
  .addCourse(new Course('CS301', 'Algorithms', 4, ['CS201']))
  .addCourse(new Course('MA101', 'Calculus', 3));
registrar
  .addSection(new Section('CS201-A', 'CS201', 'F26', 'Dr. Rao', 2, [weekly(Weekday.MON, '10:00', '11:30'), weekly(Weekday.WED, '10:00', '11:30')]))
  .addSection(new Section('MA101-A', 'MA101', 'F26', 'Dr. Lee', 40, [weekly(Weekday.MON, '11:00', '12:00')]))
  .addSection(new Section('CS301-A', 'CS301', 'F26', 'Dr. Iyer', 30, [weekly(Weekday.TUE, '14:00', '15:30')]));
for (const [id, done] of [['ana', ['CS101']], ['bo', ['CS101']], ['cy', ['CS101']], ['dee', ['CS101']]] as const) {
  registrar.addStudent(new Student(id, id.toUpperCase(), done));
}

function attempt(label: string, action: () => unknown): void {
  try {
    action();
  } catch (error) {
    console.log(`  ${label}: ${(error as Error).name}: ${(error as Error).message}`);
  }
}

console.log(`\nFall 2026 registration opens ${clock.now().toISOString()}`);
const section = registrar.section('CS201-A');
console.log(`  CS201-A meets ${section.slots.map(formatSlot).join(', ')}, ${section.capacity} seats`);

console.log('\n--- Four students want two seats in Data Structures ---');
const regs = ['ana', 'bo', 'cy', 'dee'].map((s) => registrar.register(s, 'CS201-A'));
for (const r of regs) console.log(`  ${r.studentId}: ${r.status}`);

console.log('\n--- Validation failures ---');
attempt('ana adds Algorithms', () => registrar.register('ana', 'CS301-A'));
attempt('ana adds Calculus', () => registrar.register('ana', 'MA101-A'));

console.log('\n--- Bo drops on Aug 10: the first waitlisted student is promoted ---');
clock.set('2026-08-10T12:00:00Z');
const promoted = registrar.drop(regs[1].id);
console.log(`  promoted ${promoted?.studentId}; waitlist is now [${section.waitlistIds.join(', ')}]`);
console.log(`  cy heard: ${log.forStudent('cy').join(' -> ')}`);

console.log('\n--- After the add deadline: drops still allowed, no more promotions ---');
clock.set('2026-08-20T09:00:00Z');
attempt('bo re-registers', () => registrar.register('bo', 'CS201-A'));
console.log(`  ana drops; promoted: ${registrar.drop(regs[0].id)?.studentId ?? 'nobody (waitlist frozen)'}`);
console.log(`  seats left ${section.seatsLeft}, dee still ${regs[3].status}`);

clock.set('2026-09-02T09:00:00Z');
attempt('cy drops in September', () => registrar.drop(regs[2].id));
