import { InvalidTransitionError } from './errors';

export enum RegistrationStatus {
  ENROLLED = 'ENROLLED',
  WAITLISTED = 'WAITLISTED',
  DROPPED = 'DROPPED',
}

const TRANSITIONS: Record<RegistrationStatus, readonly RegistrationStatus[]> = {
  [RegistrationStatus.WAITLISTED]: [RegistrationStatus.ENROLLED, RegistrationStatus.DROPPED],
  [RegistrationStatus.ENROLLED]: [RegistrationStatus.DROPPED],
  [RegistrationStatus.DROPPED]: [],
};

/** A student's claim on one section. Dropped registrations are kept as history and never revived. */
export class Registration {
  private _status: RegistrationStatus;
  private _updatedAt: Date;

  constructor(
    readonly id: string,
    readonly studentId: string,
    readonly sectionId: string,
    readonly courseCode: string,
    readonly termId: string,
    readonly credits: number,
    status: RegistrationStatus.ENROLLED | RegistrationStatus.WAITLISTED,
    readonly createdAt: Date,
  ) {
    this._status = status;
    this._updatedAt = createdAt;
  }

  get status(): RegistrationStatus {
    return this._status;
  }

  get updatedAt(): Date {
    return this._updatedAt;
  }

  /** ENROLLED and WAITLISTED both hold a place in the student's timetable and credit total. */
  get isActive(): boolean {
    return this._status !== RegistrationStatus.DROPPED;
  }

  promote(at: Date): void {
    this.moveTo(RegistrationStatus.ENROLLED, 'be promoted', at);
  }

  drop(at: Date): void {
    this.moveTo(RegistrationStatus.DROPPED, 'be dropped', at);
  }

  private moveTo(next: RegistrationStatus, attempted: string, at: Date): void {
    if (!TRANSITIONS[this._status].includes(next)) throw new InvalidTransitionError(this.id, this._status, attempted);
    this._status = next;
    this._updatedAt = at;
  }
}
