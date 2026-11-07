import type { User } from './calendar';
import {
  InvalidInvitationTransitionError,
  InvalidMeetingTransitionError,
  InvitationNotFoundError,
  MeetingCancelledError,
} from './errors';
import type { Interval } from './interval';
import type { MeetingRoom } from './meeting-room';

export enum MeetingStatus {
  SCHEDULED = 'SCHEDULED',
  CANCELLED = 'CANCELLED',
}

export enum InvitationStatus {
  PENDING = 'PENDING',
  ACCEPTED = 'ACCEPTED',
  DECLINED = 'DECLINED',
}

/** People may change their mind, but every response must be a real change. */
const INVITATION_MOVES: Record<InvitationStatus, InvitationStatus[]> = {
  [InvitationStatus.PENDING]: [InvitationStatus.ACCEPTED, InvitationStatus.DECLINED],
  [InvitationStatus.ACCEPTED]: [InvitationStatus.DECLINED],
  [InvitationStatus.DECLINED]: [InvitationStatus.ACCEPTED],
};

export class Invitation {
  private current = InvitationStatus.PENDING;

  constructor(readonly invitee: User) {}

  get status(): InvitationStatus {
    return this.current;
  }

  respond(to: InvitationStatus): void {
    if (!INVITATION_MOVES[this.current].includes(to)) {
      throw new InvalidInvitationTransitionError(this.invitee.id, this.current, to);
    }
    this.current = to;
  }
}

/** A meeting in a room for an interval. The organiser is implicitly accepted and has no invitation. */
export class Meeting {
  private current = MeetingStatus.SCHEDULED;
  private readonly invitations = new Map<string, Invitation>();

  constructor(
    readonly id: string,
    readonly title: string,
    readonly organiser: User,
    readonly attendees: readonly User[],
    readonly room: MeetingRoom,
    readonly interval: Interval,
    readonly seriesId?: string,
  ) {
    for (const user of attendees) this.invitations.set(user.id, new Invitation(user));
  }

  get status(): MeetingStatus {
    return this.current;
  }

  get participants(): User[] {
    return [this.organiser, ...this.attendees];
  }

  invitation(userId: string): Invitation {
    const invitation = this.invitations.get(userId);
    if (!invitation) throw new InvitationNotFoundError(this.id, userId);
    return invitation;
  }

  respond(userId: string, response: InvitationStatus.ACCEPTED | InvitationStatus.DECLINED): Invitation {
    if (this.current === MeetingStatus.CANCELLED) throw new MeetingCancelledError(this.id);
    const invitation = this.invitation(userId);
    invitation.respond(response);
    return invitation;
  }

  cancel(): void {
    if (this.current !== MeetingStatus.SCHEDULED) {
      throw new InvalidMeetingTransitionError(this.id, this.current, MeetingStatus.CANCELLED);
    }
    this.current = MeetingStatus.CANCELLED;
  }
}
