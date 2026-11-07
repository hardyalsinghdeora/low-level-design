import { DomainError } from '../shared/errors';

export class SchedulerError extends DomainError {}

export class InvalidIntervalError extends SchedulerError {}

export class UserNotFoundError extends SchedulerError {
  constructor(userId: string) {
    super(`No user ${userId}`);
  }
}

export class RoomNotFoundError extends SchedulerError {
  constructor(roomId: string) {
    super(`No room ${roomId}`);
  }
}

export class MeetingNotFoundError extends SchedulerError {
  constructor(meetingId: string) {
    super(`No meeting ${meetingId}`);
  }
}

export class AttendeeBusyError extends SchedulerError {
  constructor(userId: string, when: string) {
    super(`${userId} is busy during ${when}`);
  }
}

export class RoomUnavailableError extends SchedulerError {
  constructor(roomId: string, reason: string) {
    super(`Room ${roomId} cannot be used: ${reason}`);
  }
}

export class NoRoomAvailableError extends SchedulerError {
  constructor(people: number, when: string) {
    super(`No free room for ${people} people with the required amenities during ${when}`);
  }
}

export class RecurrenceConflictError extends SchedulerError {
  constructor(readonly conflicts: string[]) {
    super(`Recurring meeting conflicts on: ${conflicts.join('; ')}`);
  }
}

export class InvitationNotFoundError extends SchedulerError {
  constructor(meetingId: string, userId: string) {
    super(`${userId} is not invited to ${meetingId}`);
  }
}

export class InvalidInvitationTransitionError extends SchedulerError {
  constructor(userId: string, from: string, to: string) {
    super(`Invitation for ${userId} cannot move from ${from} to ${to}`);
  }
}

export class InvalidMeetingTransitionError extends SchedulerError {
  constructor(meetingId: string, from: string, to: string) {
    super(`Meeting ${meetingId} cannot move from ${from} to ${to}`);
  }
}

export class MeetingCancelledError extends SchedulerError {
  constructor(meetingId: string) {
    super(`Meeting ${meetingId} has been cancelled`);
  }
}

export class NotOrganiserError extends SchedulerError {
  constructor(meetingId: string, userId: string) {
    super(`${userId} did not organise ${meetingId}`);
  }
}
