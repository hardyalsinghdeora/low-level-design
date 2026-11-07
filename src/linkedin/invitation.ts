import { InvalidInvitationTransitionError, NotInvitationParticipantError } from './errors';

export enum InvitationStatus {
  PENDING = 'PENDING',
  ACCEPTED = 'ACCEPTED',
  IGNORED = 'IGNORED',
  WITHDRAWN = 'WITHDRAWN',
}

const TRANSITIONS: Record<InvitationStatus, readonly InvitationStatus[]> = {
  [InvitationStatus.PENDING]: [InvitationStatus.ACCEPTED, InvitationStatus.IGNORED, InvitationStatus.WITHDRAWN],
  [InvitationStatus.ACCEPTED]: [],
  [InvitationStatus.IGNORED]: [],
  [InvitationStatus.WITHDRAWN]: [],
};

/**
 * A connection invitation. Each side has its own moves, and the entity checks
 * them: the recipient accepts or ignores, only the sender withdraws, and each
 * invitation is resolved exactly once.
 */
export class Invitation {
  private _status = InvitationStatus.PENDING;
  private _resolvedAt: Date | null = null;

  constructor(
    readonly id: string,
    readonly fromId: string,
    readonly toId: string,
    readonly note: string | null,
    readonly sentAt: Date,
  ) {
    if (note !== null && note.length > 300) throw new RangeError('an invitation note is limited to 300 characters');
  }

  get status(): InvitationStatus {
    return this._status;
  }

  get resolvedAt(): Date | null {
    return this._resolvedAt;
  }

  isPendingBetween(a: string, b: string): boolean {
    const sameMembers = (this.fromId === a && this.toId === b) || (this.fromId === b && this.toId === a);
    return sameMembers && this._status === InvitationStatus.PENDING;
  }

  accept(byId: string, at: Date): void {
    this.requireRole(byId, 'recipient');
    this.transitionTo(InvitationStatus.ACCEPTED, at);
  }

  ignore(byId: string, at: Date): void {
    this.requireRole(byId, 'recipient');
    this.transitionTo(InvitationStatus.IGNORED, at);
  }

  withdraw(byId: string, at: Date): void {
    this.requireRole(byId, 'sender');
    this.transitionTo(InvitationStatus.WITHDRAWN, at);
  }

  private requireRole(userId: string, role: 'sender' | 'recipient'): void {
    const expected = role === 'sender' ? this.fromId : this.toId;
    if (userId !== expected) throw new NotInvitationParticipantError(userId, this.id, role);
  }

  private transitionTo(next: InvitationStatus, at: Date): void {
    if (!TRANSITIONS[this._status].includes(next)) {
      throw new InvalidInvitationTransitionError(this.id, this._status, next);
    }
    this._status = next;
    this._resolvedAt = at;
  }
}
