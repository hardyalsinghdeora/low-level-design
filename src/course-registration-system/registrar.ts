import { Clock, SystemClock } from '../shared/clock';
import { IdGenerator, UuidGenerator } from '../shared/id-generator';
import type { Course, Term } from './course';
import { NotFoundError, RegistrationClosedError } from './errors';
import { RegistrationEventType, type RegistrationObserver } from './events';
import { Registration, RegistrationStatus } from './registration';
import { defaultRules, type RegistrationRule } from './rules/registration-rules';
import type { Section } from './section';
import type { Student } from './student';

export interface RegistrarOptions {
  rules?: RegistrationRule[];
  clock?: Clock;
  ids?: IdGenerator;
}

/**
 * Aggregate root for registration. It runs the rule chain, asks the section
 * for a seat or a waitlist place, and on a drop promotes the next student in
 * line while the add window is open.
 */
export class Registrar {
  private readonly courses = new Map<string, Course>();
  private readonly terms = new Map<string, Term>();
  private readonly sections = new Map<string, Section>();
  private readonly students = new Map<string, Student>();
  private readonly registrations = new Map<string, Registration>();
  private readonly observers = new Set<RegistrationObserver>();
  private readonly rules: RegistrationRule[];
  private readonly clock: Clock;
  private readonly ids: IdGenerator;

  constructor(options: RegistrarOptions = {}) {
    this.rules = options.rules ?? defaultRules();
    this.clock = options.clock ?? new SystemClock();
    this.ids = options.ids ?? new UuidGenerator();
  }

  addCourse(course: Course): this {
    this.courses.set(course.code, course);
    return this;
  }

  addTerm(term: Term): this {
    this.terms.set(term.id, term);
    return this;
  }

  addSection(section: Section): this {
    this.course(section.courseCode);
    this.term(section.termId);
    this.sections.set(section.id, section);
    return this;
  }

  addStudent(student: Student): this {
    this.students.set(student.id, student);
    return this;
  }

  subscribe(observer: RegistrationObserver): () => void {
    this.observers.add(observer);
    return () => this.observers.delete(observer);
  }

  register(studentId: string, sectionId: string): Registration {
    const student = this.lookup(this.students, 'Student', studentId);
    const section = this.lookup(this.sections, 'Section', sectionId);
    const course = this.course(section.courseCode);
    const term = this.term(section.termId);
    const now = this.clock.now();
    if (!term.isAddOpen(now)) throw new RegistrationClosedError(term.id, 'register', 'outside the add window');

    const current = this.activeFor(student.id, term.id).map((r) => {
      const s = this.lookup(this.sections, 'Section', r.sectionId);
      return { section: s, course: this.course(s.courseCode) };
    });
    for (const rule of this.rules) rule.check({ student, course, section, current });

    const id = this.ids.next('REG');
    const seated = section.admit(id);
    const status = seated ? RegistrationStatus.ENROLLED : RegistrationStatus.WAITLISTED;
    const registration = new Registration(id, student.id, section.id, course.code, term.id, course.credits, status, now);
    this.registrations.set(id, registration);
    this.publish(seated ? RegistrationEventType.ENROLLED : RegistrationEventType.WAITLISTED, registration);
    return registration;
  }

  /** Dropping frees a seat; the first waitlisted student takes it, but only while adding is still allowed. */
  drop(registrationId: string): Registration | undefined {
    const registration = this.lookup(this.registrations, 'Registration', registrationId);
    const term = this.term(registration.termId);
    const now = this.clock.now();
    if (!term.isDropOpen(now)) throw new RegistrationClosedError(term.id, 'drop', 'the drop deadline has passed');

    registration.drop(now);
    const section = this.lookup(this.sections, 'Section', registration.sectionId);
    const seatFreed = section.release(registration.id);
    this.publish(RegistrationEventType.DROPPED, registration);
    if (!seatFreed || !term.isAddOpen(now)) return undefined;

    const promotedId = section.promoteNext();
    if (promotedId === undefined) return undefined;
    const promoted = this.lookup(this.registrations, 'Registration', promotedId);
    promoted.promote(now);
    this.publish(RegistrationEventType.PROMOTED, promoted);
    return promoted;
  }

  timetable(studentId: string, termId: string): Registration[] {
    return this.activeFor(studentId, termId);
  }

  section(sectionId: string): Section {
    return this.lookup(this.sections, 'Section', sectionId);
  }

  private activeFor(studentId: string, termId: string): Registration[] {
    return [...this.registrations.values()].filter((r) => r.studentId === studentId && r.termId === termId && r.isActive);
  }

  private course(code: string): Course {
    return this.lookup(this.courses, 'Course', code);
  }

  private term(id: string): Term {
    return this.lookup(this.terms, 'Term', id);
  }

  private lookup<T>(map: Map<string, T>, kind: ConstructorParameters<typeof NotFoundError>[0], id: string): T {
    const found = map.get(id);
    if (found === undefined) throw new NotFoundError(kind, id);
    return found;
  }

  private publish(type: RegistrationEventType, registration: Registration): void {
    const event = { type, studentId: registration.studentId, sectionId: registration.sectionId, at: this.clock.now() };
    for (const observer of this.observers) observer.onRegistrationEvent(event);
  }
}
