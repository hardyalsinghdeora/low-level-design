import { describe, expect, it } from 'vitest';
import { FakeClock } from '../shared/clock';
import { SequentialIdGenerator } from '../shared/id-generator';
import {
  Channel,
  EventBus,
  ExponentialBackoffPolicy,
  FakeProvider,
  InvalidConfigurationError,
  InvalidNotificationTransitionError,
  MeteredProvider,
  MissingTemplateVariableError,
  NotificationService,
  NotificationStatus,
  PreferenceStore,
  Priority,
  ProviderNotConfiguredError,
  QuietHours,
  registerNotificationRules,
  TemplateNotFoundError,
  TemplateRegistry,
  UnknownUserError,
  UserPreferences,
} from './index';

function setup(options: { quietHours?: QuietHours; optOuts?: Channel[]; withSms?: boolean } = {}) {
  const clock = new FakeClock('2026-01-01T12:00:00Z');
  const providers = { email: new FakeProvider(Channel.EMAIL), sms: new FakeProvider(Channel.SMS), push: new FakeProvider(Channel.PUSH) };
  const templates = new TemplateRegistry()
    .register('order-shipped', Channel.EMAIL, { subject: 'Order {{orderId}} shipped', body: 'Track: {{trackingUrl}}' })
    .register('order-shipped', Channel.PUSH, { body: '{{orderId}} via {{carrier}}' })
    .register('otp', Channel.SMS, { body: 'Code {{code}}' });
  const preferences = new PreferenceStore().upsert(
    new UserPreferences({
      userId: 'u1',
      email: 'u1@example.com',
      deviceToken: 'tok-1',
      ...(options.withSms === false ? {} : { phone: '+91-1' }),
      optOuts: options.optOuts ?? [],
      ...(options.quietHours ? { quietHours: options.quietHours } : {}),
    }),
  );
  const service = new NotificationService({
    providers: [providers.email, providers.sms, providers.push],
    templates,
    preferences,
    retryPolicy: new ExponentialBackoffPolicy({ maxAttempts: 3, baseDelayMs: 1_000 }),
    clock,
    ids: new SequentialIdGenerator(),
  });
  return { clock, providers, service };
}

const shipped = { orderId: 'ord-1', carrier: 'BlueDart', trackingUrl: 'https://t/1' };
const request = (overrides: Partial<Parameters<NotificationService['notify']>[0]> = {}) => ({
  userId: 'u1',
  templateId: 'order-shipped',
  channels: [Channel.EMAIL, Channel.PUSH],
  variables: shipped,
  idempotencyKey: 'order-shipped:ord-1',
  ...overrides,
});

describe('NotificationService', () => {
  it('renders the template per channel and sends to each address', () => {
    const { service, providers } = setup();
    const [mail, push] = service.notify(request());
    expect(mail?.status).toBe(NotificationStatus.SENT);
    expect(push?.status).toBe(NotificationStatus.SENT);
    expect(providers.email.sent).toEqual([
      { notificationId: 'ntf-1', channel: Channel.EMAIL, to: 'u1@example.com', subject: 'Order ord-1 shipped', body: 'Track: https://t/1' },
    ]);
    expect(providers.push.sent[0]?.body).toBe('ord-1 via BlueDart');
    expect(mail?.history.map((h) => h.status)).toEqual([NotificationStatus.QUEUED, NotificationStatus.SENT]);
  });

  it('rejects bad requests before sending anything', () => {
    const { service, providers } = setup();
    expect(() => service.notify(request({ variables: { orderId: 'ord-1' } }))).toThrow(MissingTemplateVariableError);
    expect(() => service.notify(request({ templateId: 'nope' }))).toThrow(TemplateNotFoundError);
    expect(() => service.notify(request({ userId: 'ghost' }))).toThrow(UnknownUserError);
    const emailOnly = new NotificationService({
      providers: [providers.email],
      templates: new TemplateRegistry(),
      preferences: new PreferenceStore().upsert(new UserPreferences({ userId: 'u1' })),
    });
    expect(() => emailOnly.notify(request({ channels: [Channel.PUSH] }))).toThrow(ProviderNotConfiguredError);
    expect(providers.email.sent).toHaveLength(0);
  });

  it('skips opted-out channels and channels without an address', () => {
    const { service, providers } = setup({ optOuts: [Channel.EMAIL], withSms: false });
    const [mail, push] = service.notify(request());
    expect(mail?.status).toBe(NotificationStatus.SKIPPED);
    expect(push?.status).toBe(NotificationStatus.SENT);
    const [sms] = service.notify({ userId: 'u1', templateId: 'otp', channels: [Channel.SMS], variables: { code: 1 }, idempotencyKey: 'otp-1' });
    expect(sms?.history.at(-1)).toMatchObject({ status: NotificationStatus.SKIPPED, note: 'no SMS address' });
    expect(providers.email.sent).toHaveLength(0);
  });

  it('defers normal notifications during quiet hours, but not critical ones', () => {
    // 12:00Z is 17:30 in UTC+5:30; quiet from 17:00 to 18:00 local.
    const { service, providers, clock } = setup({ quietHours: new QuietHours('17:00', '18:00', 330) });
    const [mail] = service.notify(request({ channels: [Channel.EMAIL] }));
    expect(mail?.status).toBe(NotificationStatus.DEFERRED);
    expect(mail?.scheduledFor?.toISOString()).toBe('2026-01-01T12:30:00.000Z');

    const [otp] = service.notify({ userId: 'u1', templateId: 'otp', channels: [Channel.SMS], variables: { code: 7 }, idempotencyKey: 'otp', priority: Priority.CRITICAL });
    expect(otp?.status).toBe(NotificationStatus.SENT);

    clock.advanceMinutes(29);
    expect(service.processDue()).toBe(0);
    clock.advanceMinutes(1);
    expect(service.processDue()).toBe(1);
    expect(mail?.status).toBe(NotificationStatus.SENT);
    expect(providers.email.sent).toHaveLength(1);
  });

  it('retries with backoff and succeeds once the provider recovers', () => {
    const { service, providers, clock } = setup();
    providers.email.failNext(1);
    const [mail] = service.notify(request({ channels: [Channel.EMAIL] }));
    expect(mail?.status).toBe(NotificationStatus.RETRY_SCHEDULED);
    expect(mail?.scheduledFor?.toISOString()).toBe('2026-01-01T12:00:01.000Z');
    clock.set('2026-01-01T12:00:00.999Z');
    expect(service.processDue()).toBe(0);
    clock.advanceSeconds(0.001);
    service.processDue();
    expect(mail?.status).toBe(NotificationStatus.SENT);
    expect(mail?.attempts).toBe(2);
  });

  it('dead-letters after max attempts with exponentially growing gaps', () => {
    const { service, providers, clock } = setup();
    providers.email.failAlways('SMTP 503');
    const [mail] = service.notify(request({ channels: [Channel.EMAIL] }));
    const retryTimes = [mail?.scheduledFor?.toISOString()];
    clock.advanceSeconds(1);
    service.processDue();
    retryTimes.push(mail?.scheduledFor?.toISOString());
    clock.advanceSeconds(2);
    service.processDue();

    expect(retryTimes).toEqual(['2026-01-01T12:00:01.000Z', '2026-01-01T12:00:03.000Z']);
    expect(mail?.status).toBe(NotificationStatus.FAILED);
    expect(mail?.attempts).toBe(3);
    expect(service.deadLetters).toEqual([{ notification: mail, reason: 'EMAIL SMTP 503' }]);
    expect(service.pendingJobs).toBe(0);
  });

  it('sends once per idempotency key and channel, even when the event is redelivered', () => {
    const { service, providers } = setup();
    const bus = new EventBus();
    const [unsubscribeShipped] = registerNotificationRules(bus, service);
    const event = { type: 'OrderShipped' as const, userId: 'u1', ...shipped };
    bus.publish(event);
    bus.publish(event);
    expect(providers.email.sent).toHaveLength(1);
    expect(providers.push.sent).toHaveLength(1);
    expect(service.notify(request())[0]?.id).toBe('ntf-1'); // a direct retry by the caller returns the original

    unsubscribeShipped?.();
    bus.publish({ ...event, orderId: 'ord-2' });
    expect(providers.email.sent).toHaveLength(1);
  });

  it('refuses invalid status transitions on a notification', () => {
    const { service } = setup();
    const [mail] = service.notify(request({ channels: [Channel.EMAIL] }));
    expect(() => mail?.markSent(new Date(), 'again')).toThrow(InvalidNotificationTransitionError);
    expect(() => mail?.scheduleRetry(new Date(), new Date(), 'late')).toThrow(InvalidNotificationTransitionError);
  });
});

describe('Building blocks', () => {
  it('evaluates same-day and overnight quiet hours in local time', () => {
    const overnight = new QuietHours('22:00', '07:00', 330); // IST
    expect(overnight.isQuiet(new Date('2026-01-01T16:29:00Z'))).toBe(false); // 21:59 IST
    expect(overnight.isQuiet(new Date('2026-01-01T16:30:00Z'))).toBe(true); // 22:00 IST
    expect(overnight.nextAllowed(new Date('2026-01-01T20:00:00Z')).toISOString()).toBe('2026-01-02T01:30:00.000Z');
    const lunch = new QuietHours('12:00', '13:00');
    expect(lunch.isQuiet(new Date('2026-01-01T13:00:00Z'))).toBe(false);
    expect(() => new QuietHours('25:00', '07:00')).toThrow(InvalidConfigurationError);
  });

  it('decorates a provider with metrics and log lines without changing its behaviour', () => {
    const lines: string[] = [];
    const inner = new FakeProvider(Channel.SMS).failNext(1, 'timeout');
    const metered = new MeteredProvider(inner, (line) => lines.push(line));
    const message = { notificationId: 'n1', channel: Channel.SMS, to: '+91-1', body: 'hi' };
    expect(() => metered.send(message)).toThrow('SMS timeout');
    expect(metered.send(message)).toEqual({ providerMessageId: 'sms-1' });
    expect(metered.metrics).toEqual({ calls: 2, successes: 1, failures: 1 });
    expect(lines).toEqual(['SMS -> +91-1 failed: SMS timeout', 'SMS -> +91-1 ok (sms-1)']);
  });

  it('adds deterministic jitter from the injected rng', () => {
    const policy = new ExponentialBackoffPolicy({ baseDelayMs: 1_000, maxDelayMs: 3_000, jitterRatio: 0.5, rng: () => 0.5 });
    expect([1, 2, 3].map((attempt) => policy.delayMs(attempt))).toEqual([1_250, 2_500, 3_750]);
    expect(() => new ExponentialBackoffPolicy({ maxAttempts: 0 })).toThrow(InvalidConfigurationError);
  });
});
