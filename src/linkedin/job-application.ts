import { InvalidApplicationTransitionError, NotApplicantError } from './errors';

export enum ApplicationStatus {
  APPLIED = 'APPLIED',
  IN_REVIEW = 'IN_REVIEW',
  REJECTED = 'REJECTED',
  OFFERED = 'OFFERED',
  ACCEPTED = 'ACCEPTED',
  WITHDRAWN = 'WITHDRAWN',
}

/** The hiring pipeline. A candidate declining an offer is a withdrawal, so OFFERED has no REJECTED edge. */
const TRANSITIONS: Record<ApplicationStatus, readonly ApplicationStatus[]> = {
  [ApplicationStatus.APPLIED]: [ApplicationStatus.IN_REVIEW, ApplicationStatus.REJECTED, ApplicationStatus.WITHDRAWN],
  [ApplicationStatus.IN_REVIEW]: [ApplicationStatus.OFFERED, ApplicationStatus.REJECTED, ApplicationStatus.WITHDRAWN],
  [ApplicationStatus.OFFERED]: [ApplicationStatus.ACCEPTED, ApplicationStatus.WITHDRAWN],
  [ApplicationStatus.REJECTED]: [],
  [ApplicationStatus.ACCEPTED]: [],
  [ApplicationStatus.WITHDRAWN]: [],
};

export interface StatusChange {
  status: ApplicationStatus;
  at: Date;
}

/**
 * A candidate's application to one job. The entity owns the transition table
 * and the candidate-only moves (accept, withdraw); recruiter moves are
 * authorised by the service, which knows who administers the company.
 * The full history is kept because "when did this move to review?" is the
 * first question a recruiter dashboard asks.
 */
export class JobApplication {
  private readonly _history: StatusChange[];

  constructor(
    readonly id: string,
    readonly jobId: string,
    readonly candidateId: string,
    appliedAt: Date,
  ) {
    this._history = [{ status: ApplicationStatus.APPLIED, at: appliedAt }];
  }

  get status(): ApplicationStatus {
    return this._history[this._history.length - 1].status;
  }

  get history(): readonly StatusChange[] {
    return this._history;
  }

  /** Terminal states have no outgoing edges; anything else is still in the pipeline. */
  get isActive(): boolean {
    return TRANSITIONS[this.status].length > 0;
  }

  startReview(at: Date): void {
    this.moveTo(ApplicationStatus.IN_REVIEW, at);
  }

  reject(at: Date): void {
    this.moveTo(ApplicationStatus.REJECTED, at);
  }

  offer(at: Date): void {
    this.moveTo(ApplicationStatus.OFFERED, at);
  }

  accept(byId: string, at: Date): void {
    this.requireCandidate(byId);
    this.moveTo(ApplicationStatus.ACCEPTED, at);
  }

  withdraw(byId: string, at: Date): void {
    this.requireCandidate(byId);
    this.moveTo(ApplicationStatus.WITHDRAWN, at);
  }

  private requireCandidate(userId: string): void {
    if (userId !== this.candidateId) throw new NotApplicantError(userId, this.id);
  }

  private moveTo(next: ApplicationStatus, at: Date): void {
    if (!TRANSITIONS[this.status].includes(next)) {
      throw new InvalidApplicationTransitionError(this.id, this.status, next);
    }
    this._history.push({ status: next, at });
  }
}
