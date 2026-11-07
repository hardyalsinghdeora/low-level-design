import { DomainError } from '../shared/errors';

export class RegistrationError extends DomainError {}

export class NotFoundError extends RegistrationError {
  constructor(kind: 'Course' | 'Section' | 'Student' | 'Term' | 'Registration', id: string) {
    super(`No ${kind.toLowerCase()} ${id}`);
  }
}

export class PrerequisiteNotMetError extends RegistrationError {
  constructor(
    studentId: string,
    courseCode: string,
    readonly missing: readonly string[],
  ) {
    super(`${studentId} cannot take ${courseCode} without ${missing.join(', ')}`);
  }
}

export class ScheduleConflictError extends RegistrationError {
  constructor(sectionId: string, clashesWith: string) {
    super(`Section ${sectionId} clashes with ${clashesWith}`);
  }
}

export class CreditLimitExceededError extends RegistrationError {
  constructor(studentId: string, limit: number, wouldHave: number) {
    super(`${studentId} would have ${wouldHave} credits, over the term limit of ${limit}`);
  }
}

export class AlreadyRegisteredError extends RegistrationError {
  constructor(studentId: string, courseCode: string) {
    super(`${studentId} is already registered for ${courseCode} this term`);
  }
}

export class CourseAlreadyCompletedError extends RegistrationError {
  constructor(studentId: string, courseCode: string) {
    super(`${studentId} has already completed ${courseCode}`);
  }
}

/** The section and its waitlist are both full. */
export class SectionFullError extends RegistrationError {
  constructor(sectionId: string) {
    super(`Section ${sectionId} and its waitlist are full`);
  }
}

export class RegistrationClosedError extends RegistrationError {
  constructor(termId: string, action: string, reason: string) {
    super(`Cannot ${action} in ${termId}: ${reason}`);
  }
}

export class InvalidTransitionError extends RegistrationError {
  constructor(id: string, state: string, attempted: string) {
    super(`Registration ${id} cannot ${attempted} while ${state}`);
  }
}
