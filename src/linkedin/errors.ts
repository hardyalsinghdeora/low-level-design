import { DomainError } from '../shared/errors';
import type { InvitationStatus } from './invitation';
import type { ApplicationStatus } from './job-application';

export class LinkedInError extends DomainError {}

export class NotFoundError extends LinkedInError {
  constructor(kind: string, id: string) {
    super(`No ${kind} ${id}`);
  }
}

export class SelfActionError extends LinkedInError {
  constructor(userId: string, action: string) {
    super(`Member ${userId} cannot ${action} themselves`);
  }
}

export class AlreadyConnectedError extends LinkedInError {
  constructor(a: string, b: string) {
    super(`${a} and ${b} are already connected`);
  }
}

export class DuplicateInvitationError extends LinkedInError {
  constructor(a: string, b: string) {
    super(`An invitation between ${a} and ${b} is already pending`);
  }
}

export class InvalidInvitationTransitionError extends LinkedInError {
  constructor(invitationId: string, from: InvitationStatus, to: InvitationStatus) {
    super(`Invitation ${invitationId} cannot move from ${from} to ${to}`);
  }
}

export class NotInvitationParticipantError extends LinkedInError {
  constructor(userId: string, invitationId: string, role: 'sender' | 'recipient') {
    super(`Only the ${role} of invitation ${invitationId} can do that, not ${userId}`);
  }
}

/** Messaging and endorsing both require a 1st-degree connection. */
export class NotConnectedError extends LinkedInError {
  constructor(fromId: string, toId: string, action: string) {
    super(`${fromId} must be a 1st-degree connection of ${toId} to ${action}`);
  }
}

export class SkillNotListedError extends LinkedInError {
  constructor(profileId: string, skill: string) {
    super(`Profile ${profileId} does not list the skill "${skill}"`);
  }
}

export class DuplicateEndorsementError extends LinkedInError {
  constructor(endorserId: string, profileId: string, skill: string) {
    super(`${endorserId} has already endorsed ${profileId} for "${skill}"`);
  }
}

export class NotCompanyAdminError extends LinkedInError {
  constructor(userId: string, companyId: string) {
    super(`Member ${userId} is not an admin of company ${companyId}`);
  }
}

export class JobClosedError extends LinkedInError {
  constructor(jobId: string) {
    super(`Job ${jobId} is closed`);
  }
}

export class DuplicateApplicationError extends LinkedInError {
  constructor(candidateId: string, jobId: string) {
    super(`${candidateId} has already applied to job ${jobId}`);
  }
}

export class InvalidApplicationTransitionError extends LinkedInError {
  constructor(applicationId: string, from: ApplicationStatus, to: ApplicationStatus) {
    super(`Application ${applicationId} cannot move from ${from} to ${to}`);
  }
}

export class NotApplicantError extends LinkedInError {
  constructor(userId: string, applicationId: string) {
    super(`Only the candidate can do that to application ${applicationId}, not ${userId}`);
  }
}
