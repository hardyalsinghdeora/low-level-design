/** A catalog course: what is taught and what it requires, independent of when or by whom. */
export class Course {
  readonly prerequisites: readonly string[];

  constructor(
    readonly code: string,
    readonly title: string,
    readonly credits: number,
    prerequisites: readonly string[] = [],
  ) {
    if (!Number.isInteger(credits) || credits < 1) throw new RangeError(`credits must be a positive integer, got ${credits}`);
    if (prerequisites.includes(code)) throw new RangeError(`${code} cannot be its own prerequisite`);
    this.prerequisites = [...prerequisites];
  }
}

/** One academic term and the two deadlines the clock is checked against. */
export class Term {
  constructor(
    readonly id: string,
    readonly opensAt: Date,
    /** Last moment to add a course; waitlist promotion also stops here. */
    readonly addDeadline: Date,
    /** Last moment to drop without a transcript entry. */
    readonly dropDeadline: Date,
  ) {
    if (!(opensAt < addDeadline && addDeadline <= dropDeadline)) {
      throw new RangeError('Expected opensAt < addDeadline <= dropDeadline');
    }
  }

  isAddOpen(at: Date): boolean {
    return at >= this.opensAt && at < this.addDeadline;
  }

  isDropOpen(at: Date): boolean {
    return at >= this.opensAt && at < this.dropDeadline;
  }
}
