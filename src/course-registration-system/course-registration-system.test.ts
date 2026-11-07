import { beforeEach, describe, expect, it } from 'vitest';
import { FakeClock } from '../shared/clock';
import { SequentialIdGenerator } from '../shared/id-generator';
import {
  AlreadyRegisteredError, Course, CourseAlreadyCompletedError, CreditLimitExceededError, EventLog, InvalidTransitionError,
  NotFoundError, PrerequisiteNotMetError, PrerequisiteRule, Registrar, RegistrationClosedError, RegistrationEventType,
  RegistrationStatus, ScheduleConflictError, Section, SectionFullError, Student, Term, weekly, Weekday,
} from './index';

describe('Registrar', () => {
  let clock: FakeClock;
  let log: EventLog;
  let registrar: Registrar;

  function setup(r: Registrar): Registrar {
    r.addTerm(new Term('F26', new Date('2026-08-01T00:00:00Z'), new Date('2026-08-15T00:00:00Z'), new Date('2026-09-01T00:00:00Z')))
      .addCourse(new Course('CS101', 'Intro', 4))
      .addCourse(new Course('CS201', 'Data Structures', 4, ['CS101']))
      .addCourse(new Course('CS301', 'Algorithms', 4, ['CS201', 'MA101']))
      .addCourse(new Course('MA101', 'Calculus', 3))
      .addCourse(new Course('PH101', 'Physics', 3));
    r.addSection(new Section('CS201-A', 'CS201', 'F26', 'Rao', 2, [weekly(Weekday.MON, '10:00', '11:30')], 2))
      .addSection(new Section('CS201-B', 'CS201', 'F26', 'Rao', 10, [weekly(Weekday.FRI, '10:00', '11:30')]))
      .addSection(new Section('MA101-A', 'MA101', 'F26', 'Lee', 30, [weekly(Weekday.MON, '11:00', '12:00')]))
      .addSection(new Section('MA101-B', 'MA101', 'F26', 'Lee', 30, [weekly(Weekday.MON, '11:30', '12:30')]))
      .addSection(new Section('PH101-A', 'PH101', 'F26', 'Kim', 30, [weekly(Weekday.THU, '09:00', '10:00')]))
      .addSection(new Section('CS301-A', 'CS301', 'F26', 'Iyer', 30, [weekly(Weekday.TUE, '14:00', '15:30')]))
      .addSection(new Section('CS101-A', 'CS101', 'F26', 'Ng', 30, [weekly(Weekday.WED, '09:00', '10:00')]));
    for (const id of ['ana', 'bo', 'cy', 'dee', 'eve']) r.addStudent(new Student(id, id, ['CS101']));
    r.addStudent(new Student('fresh', 'Fresh', [], 7));
    return r;
  }

  beforeEach(() => {
    clock = new FakeClock('2026-08-03T09:00:00Z');
    log = new EventLog();
    registrar = setup(new Registrar({ clock, ids: new SequentialIdGenerator() }));
    registrar.subscribe(log);
  });

  it('enrolls a student who meets every rule and takes a seat', () => {
    const reg = registrar.register('ana', 'CS201-A');
    expect(reg.status).toBe(RegistrationStatus.ENROLLED);
    expect(registrar.section('CS201-A').seatsLeft).toBe(1);
    expect(log.forStudent('ana')).toEqual([RegistrationEventType.ENROLLED]);
  });

  it('rejects a course whose prerequisites are missing and lists them', () => {
    const error = (() => {
      try {
        registrar.register('ana', 'CS301-A');
      } catch (e) {
        return e;
      }
    })();
    expect(error).toBeInstanceOf(PrerequisiteNotMetError);
    expect((error as PrerequisiteNotMetError).missing).toEqual(['CS201', 'MA101']);
  });

  it('detects overlapping weekly slots but allows back-to-back classes', () => {
    registrar.register('ana', 'CS201-A'); // MON 10:00-11:30
    expect(() => registrar.register('ana', 'MA101-A')).toThrow(ScheduleConflictError); // MON 11:00
    expect(registrar.register('ana', 'MA101-B').status).toBe(RegistrationStatus.ENROLLED); // MON 11:30
  });

  it('enforces the per-term credit limit', () => {
    registrar.register('fresh', 'CS101-A'); // 4
    registrar.register('fresh', 'MA101-A'); // 7
    expect(() => registrar.register('fresh', 'PH101-A')).toThrow(CreditLimitExceededError);
  });

  it('rejects a second section of the same course and a course already passed', () => {
    registrar.register('ana', 'CS201-A');
    expect(() => registrar.register('ana', 'CS201-B')).toThrow(AlreadyRegisteredError);
    expect(() => registrar.register('ana', 'CS101-A')).toThrow(CourseAlreadyCompletedError);
  });

  it('waitlists once seats run out and refuses when the waitlist is full too', () => {
    const statuses = ['ana', 'bo', 'cy', 'dee'].map((s) => registrar.register(s, 'CS201-A').status);
    expect(statuses).toEqual(['ENROLLED', 'ENROLLED', 'WAITLISTED', 'WAITLISTED']);
    expect(registrar.section('CS201-A').waitlistIds).toEqual(['REG-3', 'REG-4']);
    expect(() => registrar.register('eve', 'CS201-A')).toThrow(SectionFullError);
  });

  it('promotes the first waitlisted student when an enrolled one drops', () => {
    const [ana, , cy, dee] = ['ana', 'bo', 'cy', 'dee'].map((s) => registrar.register(s, 'CS201-A'));
    clock.advanceHours(24);
    const promoted = registrar.drop(ana.id);
    expect(promoted).toBe(cy);
    expect(cy.status).toBe(RegistrationStatus.ENROLLED);
    expect(cy.updatedAt.toISOString()).toBe('2026-08-04T09:00:00.000Z');
    expect(dee.status).toBe(RegistrationStatus.WAITLISTED);
    expect(log.forStudent('cy')).toEqual([RegistrationEventType.WAITLISTED, RegistrationEventType.PROMOTED]);
    expect(registrar.section('CS201-A').seatsLeft).toBe(0);
  });

  it('dropping a waitlisted registration only leaves the line', () => {
    const regs = ['ana', 'bo', 'cy', 'dee'].map((s) => registrar.register(s, 'CS201-A'));
    expect(registrar.drop(regs[2].id)).toBeUndefined();
    expect(registrar.section('CS201-A').waitlistIds).toEqual([regs[3].id]);
    expect(registrar.section('CS201-A').enrolledCount).toBe(2);
  });

  it('checks the add window and the drop deadline with the clock', () => {
    clock.set('2026-07-31T23:59:00Z');
    expect(() => registrar.register('ana', 'CS201-A')).toThrow(RegistrationClosedError);
    clock.set('2026-08-03T09:00:00Z');
    const [ana, , cy] = ['ana', 'bo', 'cy'].map((s) => registrar.register(s, 'CS201-A'));

    clock.set('2026-08-15T00:00:00Z'); // add deadline is exclusive
    expect(() => registrar.register('dee', 'PH101-A')).toThrow(RegistrationClosedError);
    expect(registrar.drop(ana.id)).toBeUndefined(); // waitlist frozen after the add deadline
    expect(cy.status).toBe(RegistrationStatus.WAITLISTED);

    clock.set('2026-09-01T00:00:00Z');
    expect(() => registrar.drop(cy.id)).toThrow(RegistrationClosedError);
  });

  it('rejects invalid registration transitions', () => {
    const reg = registrar.register('ana', 'CS201-A');
    registrar.drop(reg.id);
    expect(() => registrar.drop(reg.id)).toThrow(InvalidTransitionError);
    expect(() => reg.promote(clock.now())).toThrow(InvalidTransitionError);
    expect(registrar.timetable('ana', 'F26')).toEqual([]);
  });

  it('reports unknown ids with NotFoundError', () => {
    expect(() => registrar.register('nobody', 'CS201-A')).toThrow(NotFoundError);
    expect(() => registrar.register('ana', 'XX-1')).toThrow(NotFoundError);
    expect(() => registrar.drop('REG-99')).toThrow(NotFoundError);
    expect(() => registrar.addSection(new Section('Z', 'NOPE', 'F26', 'x', 1, []))).toThrow(NotFoundError);
  });

  it('runs only the rules it is given (rules are pluggable)', () => {
    const lenient = setup(new Registrar({ rules: [new PrerequisiteRule()], clock, ids: new SequentialIdGenerator() }));
    lenient.register('ana', 'CS201-A');
    expect(lenient.register('ana', 'MA101-A').status).toBe(RegistrationStatus.ENROLLED); // no conflict rule
    expect(() => lenient.register('fresh', 'CS201-A')).toThrow(PrerequisiteNotMetError);
  });
});
