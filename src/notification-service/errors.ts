import { DomainError } from '../shared/errors';

export class NotificationError extends DomainError {}

export class TemplateNotFoundError extends NotificationError {
  constructor(templateId: string, channel: string) {
    super(`No template "${templateId}" for channel ${channel}`);
  }
}

export class MissingTemplateVariableError extends NotificationError {
  constructor(
    templateId: string,
    readonly missing: readonly string[],
  ) {
    super(`Template "${templateId}" is missing variables: ${missing.join(', ')}`);
  }
}

export class UnknownUserError extends NotificationError {
  constructor(userId: string) {
    super(`No preferences registered for user "${userId}"`);
  }
}

export class ProviderNotConfiguredError extends NotificationError {
  constructor(channel: string) {
    super(`No provider configured for channel ${channel}`);
  }
}

/** Thrown by providers for failures worth retrying (timeouts, 5xx). */
export class ProviderError extends NotificationError {}

export class InvalidNotificationTransitionError extends NotificationError {
  constructor(id: string, from: string, to: string) {
    super(`Notification ${id} cannot go from ${from} to ${to}`);
  }
}

export class InvalidConfigurationError extends NotificationError {}
