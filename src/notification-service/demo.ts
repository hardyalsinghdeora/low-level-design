import { FakeClock } from '../shared/clock';
import { SequentialIdGenerator } from '../shared/id-generator';
import {
  Channel,
  EventBus,
  ExponentialBackoffPolicy,
  FakeProvider,
  MeteredProvider,
  MissingTemplateVariableError,
  NotificationService,
  PreferenceStore,
  QuietHours,
  registerNotificationRules,
  TemplateRegistry,
  UserPreferences,
} from './index';

const clock = new FakeClock('2026-03-01T17:00:00Z'); // 22:30 in India (UTC+5:30)
const email = new FakeProvider(Channel.EMAIL).failNext(1, 'SMTP 503');
const sms = new FakeProvider(Channel.SMS).failAlways('carrier timeout');
const push = new FakeProvider(Channel.PUSH);
const log = (line: string): void => console.log(`    [provider] ${line}`);

const templates = new TemplateRegistry()
  .register('order-shipped', Channel.EMAIL, { subject: 'Order {{orderId}} is on its way', body: 'Track it with {{carrier}}: {{trackingUrl}}' })
  .register('order-shipped', Channel.PUSH, { body: '{{orderId}} shipped via {{carrier}}' })
  .register('password-reset', Channel.SMS, { body: 'Your reset code is {{code}}' });
const preferences = new PreferenceStore()
  .upsert(new UserPreferences({ userId: 'asha', email: 'asha@example.com', deviceToken: 'tok-a', quietHours: new QuietHours('22:00', '07:00', 330) }))
  .upsert(new UserPreferences({ userId: 'ravi', email: 'ravi@example.com', deviceToken: 'tok-r', phone: '+91-98450-00000', optOuts: [Channel.PUSH] }));

const service = new NotificationService({
  providers: [email, sms, push].map((p) => new MeteredProvider(p, log)),
  templates,
  preferences,
  retryPolicy: new ExponentialBackoffPolicy({ maxAttempts: 3, baseDelayMs: 60_000 }),
  clock,
  ids: new SequentialIdGenerator(),
});
const bus = new EventBus();
registerNotificationRules(bus, service);
const status = (): string => Object.entries(service.countByStatus()).filter(([, n]) => n > 0).map(([s, n]) => `${s}:${n}`).join(' ');

console.log('\n--- 22:30 IST: two orders ship (the event for ord-1 is delivered twice) ---');
bus.publish({ type: 'OrderShipped', orderId: 'ord-1', userId: 'asha', carrier: 'BlueDart', trackingUrl: 'https://t.example/1' });
bus.publish({ type: 'OrderShipped', orderId: 'ord-1', userId: 'asha', carrier: 'BlueDart', trackingUrl: 'https://t.example/1' });
bus.publish({ type: 'OrderShipped', orderId: 'ord-2', userId: 'ravi', carrier: 'Delhivery', trackingUrl: 'https://t.example/2' });
console.log(`  asha is in quiet hours, ravi opted out of push, ravi's email failed once -> ${status()}`);

console.log('\n--- Ravi requests a password reset: critical, but the SMS carrier is down ---');
bus.publish({ type: 'PasswordResetRequested', requestId: 'pr-1', userId: 'ravi', code: '482913' });
for (let minute = 0; minute < 4; minute += 1) {
  clock.advanceMinutes(1);
  service.processDue();
}
for (const dead of service.deadLetters) console.log(`  dead letter ${dead.notification.id} (${dead.notification.channel}): ${dead.reason}`);

console.log('\n--- 07:00 IST: quiet hours end and asha\'s deferred messages go out ---');
clock.set('2026-03-02T01:30:00Z');
service.processDue();
console.log(`  ${status()}, jobs left: ${service.pendingJobs}`);

console.log('\n--- A template variable is missing: rejected before anything is sent ---');
try {
  service.notify({ userId: 'asha', templateId: 'order-shipped', channels: [Channel.EMAIL], variables: { orderId: 'ord-3' }, idempotencyKey: 'x' });
} catch (error) {
  if (!(error instanceof MissingTemplateVariableError)) throw error;
  console.log(`  ${error.name}: ${error.message}`);
}
