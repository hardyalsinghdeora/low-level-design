import { JobClosedError, NotCompanyAdminError } from './errors';

/** A company page. Only its admins may post jobs and move applications. */
export class Company {
  private readonly admins = new Set<string>();

  constructor(
    readonly id: string,
    readonly name: string,
    founderAdminId: string,
  ) {
    if (!name.trim()) throw new RangeError('company name is required');
    this.admins.add(founderAdminId);
  }

  isAdmin(memberId: string): boolean {
    return this.admins.has(memberId);
  }

  addAdmin(byId: string, memberId: string): void {
    this.requireAdmin(byId);
    this.admins.add(memberId);
  }

  requireAdmin(memberId: string): void {
    if (!this.isAdmin(memberId)) throw new NotCompanyAdminError(memberId, this.id);
  }
}

export enum JobStatus {
  OPEN = 'OPEN',
  CLOSED = 'CLOSED',
}

/**
 * A job posted by a company. Closing stops new applications; applications
 * already in the pipeline keep moving, which is how real hiring works.
 */
export class JobPosting {
  private _status = JobStatus.OPEN;

  constructor(
    readonly id: string,
    readonly companyId: string,
    readonly title: string,
    readonly location: string,
    readonly postedBy: string,
    readonly postedAt: Date,
    readonly skills: readonly string[] = [],
  ) {
    if (!title.trim()) throw new RangeError('job title is required');
  }

  get status(): JobStatus {
    return this._status;
  }

  requireOpen(): void {
    if (this._status !== JobStatus.OPEN) throw new JobClosedError(this.id);
  }

  close(): void {
    this.requireOpen();
    this._status = JobStatus.CLOSED;
  }
}
