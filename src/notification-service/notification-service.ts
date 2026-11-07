import { Clock, SystemClock } from '../shared/clock';
import { IdGenerator, UuidGenerator } from '../shared/id-generator';
import { type Channel, type NotificationProvider, Priority } from './channel';
import { ProviderError, ProviderNotConfiguredError } from './errors';
import { Notification, NotificationStatus } from './notification';
import type { PreferenceStore } from './preferences';
import { ScheduledQueue } from './scheduler';
import { ExponentialBackoffPolicy, type RetryPolicy } from './strategies/retry-policy';
import type { TemplateRegistry, TemplateVariables } from './template';

export interface NotificationRequest {
  userId: string;
  templateId: string;
  channels: Channel[];
  variables: TemplateVariables;
  /** Same key, same notification: a retried caller or a redelivered event never sends twice. */
  idempotencyKey: string;
  priority?: Priority;
}

export interface DeadLetter {
  readonly notification: Notification;
  readonly reason: string;
}

export interface NotificationServiceOptions {
  providers: NotificationProvider[];
  templates: TemplateRegistry;
  preferences: PreferenceStore;
  retryPolicy?: RetryPolicy;
  queue?: ScheduledQueue;
  clock?: Clock;
  ids?: IdGenerator;
}

/**
 * Orchestrates one request into per-channel notifications: dedup, render,
 * preferences, quiet hours, send, retry, dead-letter. Each Notification guards
 * its own status; this class only decides which transition comes next.
 */
export class NotificationService {
  readonly deadLetters: DeadLetter[] = [];
  private readonly providers = new Map<Channel, NotificationProvider>();
  private readonly byId = new Map<string, Notification>();
  private readonly byKey = new Map<string, Notification>();
  private readonly templates: TemplateRegistry;
  private readonly preferences: PreferenceStore;
  private readonly retryPolicy: RetryPolicy;
  private readonly queue: ScheduledQueue;
  private readonly clock: Clock;
  private readonly ids: IdGenerator;

  constructor(options: NotificationServiceOptions) {
    for (const provider of options.providers) this.providers.set(provider.channel, provider);
    this.templates = options.templates;
    this.preferences = options.preferences;
    this.retryPolicy = options.retryPolicy ?? new ExponentialBackoffPolicy();
    this.queue = options.queue ?? new ScheduledQueue();
    this.clock = options.clock ?? new SystemClock();
    this.ids = options.ids ?? new UuidGenerator();
  }

  /** Validates and renders every channel before sending any, so a bad request sends nothing. */
  notify(request: NotificationRequest): Notification[] {
    const user = this.preferences.get(request.userId);
    const rendered = request.channels.map((channel) => {
      if (!this.providers.has(channel)) throw new ProviderNotConfiguredError(channel);
      return this.templates.render(request.templateId, channel, request.variables);
    });

    return request.channels.map((channel, index) => {
      const key = `${request.idempotencyKey}:${channel}`;
      const existing = this.byKey.get(key);
      if (existing) return existing;

      const now = this.clock.now();
      const id = this.ids.next('ntf');
      const address = user.addressFor(channel);
      const notification = new Notification({
        id,
        userId: user.userId,
        channel,
        templateId: request.templateId,
        idempotencyKey: key,
        priority: request.priority ?? Priority.NORMAL,
        message: { notificationId: id, channel, to: address ?? '', ...rendered[index]! },
        createdAt: now,
      });
      this.byId.set(id, notification);
      this.byKey.set(key, notification);

      if (user.hasOptedOut(channel)) notification.skip(now, `user opted out of ${channel}`);
      else if (!address) notification.skip(now, `no ${channel} address`);
      else this.dispatch(notification);
      return notification;
    });
  }

  /** Runs every deferred send and retry that is due. The worker loop (or a test) calls this. */
  processDue(): number {
    let processed = 0;
    for (const id of this.queue.takeDue(this.clock.now())) {
      const notification = this.byId.get(id);
      if (!notification || notification.isTerminal) continue;
      this.dispatch(notification);
      processed += 1;
    }
    return processed;
  }

  get(id: string): Notification | undefined {
    return this.byId.get(id);
  }

  get pendingJobs(): number {
    return this.queue.size;
  }

  private dispatch(notification: Notification): void {
    const now = this.clock.now();
    const quiet = this.preferences.get(notification.userId).quietHours;
    if (notification.priority !== Priority.CRITICAL && quiet?.isQuiet(now)) {
      const until = quiet.nextAllowed(now);
      notification.defer(until, now);
      this.queue.schedule(until, notification.id);
      return;
    }

    const provider = this.providers.get(notification.channel);
    if (!provider) throw new ProviderNotConfiguredError(notification.channel);
    notification.recordAttempt();
    try {
      const receipt = provider.send(notification.message);
      notification.markSent(now, receipt.providerMessageId);
    } catch (error) {
      if (!(error instanceof ProviderError)) throw error;
      this.handleFailure(notification, error.message, now);
    }
  }

  private handleFailure(notification: Notification, reason: string, now: Date): void {
    if (notification.attempts >= this.retryPolicy.maxAttempts) {
      notification.fail(now, `${reason} after ${notification.attempts} attempts`);
      this.deadLetters.push({ notification, reason });
      return;
    }
    const retryAt = new Date(now.getTime() + this.retryPolicy.delayMs(notification.attempts));
    notification.scheduleRetry(retryAt, now, reason);
    this.queue.schedule(retryAt, notification.id);
  }

  countByStatus(): Record<NotificationStatus, number> {
    const counts = Object.fromEntries(Object.values(NotificationStatus).map((s) => [s, 0])) as Record<NotificationStatus, number>;
    for (const notification of this.byId.values()) counts[notification.status] += 1;
    return counts;
  }
}
