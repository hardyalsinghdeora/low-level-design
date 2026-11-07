import type { Course } from '../course';
import {
  AlreadyRegisteredError,
  CourseAlreadyCompletedError,
  CreditLimitExceededError,
  PrerequisiteNotMetError,
  ScheduleConflictError,
} from '../errors';
import { schedulesOverlap } from '../schedule';
import type { Section } from '../section';
import type { Student } from '../student';

/** What a rule may look at: the request, and the student's other active registrations this term. */
export interface RegistrationContext {
  readonly student: Student;
  readonly course: Course;
  readonly section: Section;
  readonly current: readonly { readonly course: Course; readonly section: Section }[];
}

/**
 * Strategy / chain of rules: each rule throws its own domain error. The
 * registrar runs them in order, so the student hears the most basic problem
 * first, and a school can add "major only" or "year 3 and above" as one class.
 */
export interface RegistrationRule {
  check(context: RegistrationContext): void;
}

export class NotAlreadyTakenRule implements RegistrationRule {
  check({ student, course, current }: RegistrationContext): void {
    if (student.hasCompleted(course.code)) throw new CourseAlreadyCompletedError(student.id, course.code);
    if (current.some((c) => c.course.code === course.code)) throw new AlreadyRegisteredError(student.id, course.code);
  }
}

export class PrerequisiteRule implements RegistrationRule {
  check({ student, course }: RegistrationContext): void {
    const missing = course.prerequisites.filter((code) => !student.hasCompleted(code));
    if (missing.length > 0) throw new PrerequisiteNotMetError(student.id, course.code, missing);
  }
}

export class ScheduleConflictRule implements RegistrationRule {
  check({ section, current }: RegistrationContext): void {
    const clash = current.find((c) => schedulesOverlap(c.section.slots, section.slots));
    if (clash) throw new ScheduleConflictError(section.id, clash.section.id);
  }
}

export class CreditLimitRule implements RegistrationRule {
  check({ student, course, current }: RegistrationContext): void {
    const wouldHave = current.reduce((sum, c) => sum + c.course.credits, 0) + course.credits;
    if (wouldHave > student.creditLimit) throw new CreditLimitExceededError(student.id, student.creditLimit, wouldHave);
  }
}

export function defaultRules(): RegistrationRule[] {
  return [new NotAlreadyTakenRule(), new PrerequisiteRule(), new ScheduleConflictRule(), new CreditLimitRule()];
}
