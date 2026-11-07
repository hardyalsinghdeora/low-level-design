/** A student's academic record as far as registration cares: what they have passed and how much they may take. */
export class Student {
  private readonly completed: Set<string>;

  constructor(
    readonly id: string,
    readonly name: string,
    completedCourses: readonly string[] = [],
    readonly creditLimit = 18,
  ) {
    if (!Number.isInteger(creditLimit) || creditLimit < 1) throw new RangeError('creditLimit must be a positive integer');
    this.completed = new Set(completedCourses);
  }

  hasCompleted(courseCode: string): boolean {
    return this.completed.has(courseCode);
  }

  recordCompletion(courseCode: string): void {
    this.completed.add(courseCode);
  }
}
