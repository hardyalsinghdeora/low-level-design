import type { Channel, OutboundMessage, Priority } from './channel';
import { InvalidNotificationTransitionError } from './errors';

export enum NotificationStatus {
  QUEUED = 'QUEUED',
  DEFERRED = 'DEFERRED',
  RETRY_SCHEDULED = 'RETRY_SCHEDULED',
  SENT = 'SENT',
  FAILED = 'FAILED',
  SKIPPED = 'SKIPPED',
}

const ALLOWED: Record<NotificationStatus, readonly NotificationStatus[]> = {
  [NotificationStatus.QUEUED]: [
    NotificationStatus.SENT,
    NotificationStatus.RETRY_SCHEDULED,
    NotificationStatus.FAILED,
    NotificationStatus.DEFERRED,
    NotificationStatus.SKIPPED,
  ],
  [NotificationStatus.DEFERRED]: [NotificationStatus.SENT, NotificationStatus.RETRY_SCHEDULED, NotificationStatus.FAILED],
  [NotificationStatus.RETRY_SCHEDULED]: [
    NotificationStatus.SENT,
    NotificationStatus.RETRY_SCHEDULED,
    NotificationStatus.FAILED,
    NotificationStatus.DEFERRED,
  ],
  [NotificationStatus.SENT]: [],
  [NotificationStatus.FAILED]: [],
  [NotificationStatus.SKIPPED]: [],
};

export interface StatusChange {
  readonly status: NotificationStatus;
  readonly at: Date;
  readonly note?: string;
}

export interface NotificationInit {
  id: string;
  userId: string;
  channel: Channel;
  templateId: string;
  idempotencyKey: string;
  priority: Priority;
  message: OutboundMessage;
  createdAt: Date;
}

/**
 * One message to one user on one channel. It guards its own lifecycle, so a
 * second "sent" or a retry after a terminal failure is impossible however
 * the service is called.
 */
export class Notification {
  readonly id: string;
  readonly userId: string;
  readonly channel: Channel;
  readonly templateId: string;
  readonly idempotencyKey: string;
  readonly priority: Priority;
  readonly message: OutboundMessage;
  readonly history: StatusChange[];
  private currentStatus = NotificationStatus.QUEUED;
  private attemptCount = 0;
  private nextAttemptAt: Date | undefined;

  constructor(init: NotificationInit) {
    this.id = init.id;
    this.userId = init.userId;
    this.channel = init.channel;
    this.templateId = init.templateId;
    this.idempotencyKey = init.idempotencyKey;
    this.priority = init.priority;
    this.message = init.message;
    this.history = [{ status: NotificationStatus.QUEUED, at: init.createdAt }];
  }

  get status(): NotificationStatus {
    return this.currentStatus;
  }

  get attempts(): number {
    return this.attemptCount;
  }

  get scheduledFor(): Date | undefined {
    return this.nextAttemptAt;
  }

  get isTerminal(): boolean {
    return ALLOWED[this.currentStatus].length === 0;
  }

  recordAttempt(): void {
    this.attemptCount += 1;
  }

  markSent(at: Date, providerMessageId: string): void {
    this.transition(NotificationStatus.SENT, at, providerMessageId);
    this.nextAttemptAt = undefined;
  }

  defer(until: Date, at: Date): void {
    this.transition(NotificationStatus.DEFERRED, at, `quiet hours until ${until.toISOString()}`);
    this.nextAttemptAt = until;
  }

  scheduleRetry(retryAt: Date, at: Date, reason: string): void {
    this.transition(NotificationStatus.RETRY_SCHEDULED, at, reason);
    this.nextAttemptAt = retryAt;
  }

  fail(at: Date, reason: string): void {
    this.transition(NotificationStatus.FAILED, at, reason);
    this.nextAttemptAt = undefined;
  }

  skip(at: Date, reason: string): void {
    this.transition(NotificationStatus.SKIPPED, at, reason);
  }

  private transition(to: NotificationStatus, at: Date, note?: string): void {
    if (!ALLOWED[this.currentStatus].includes(to)) {
      throw new InvalidNotificationTransitionError(this.id, this.currentStatus, to);
    }
    this.currentStatus = to;
    this.history.push(note !== undefined ? { status: to, at, note } : { status: to, at });
  }
}
