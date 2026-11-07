import { FakeClock } from '../shared/clock';
import { SequentialIdGenerator } from '../shared/id-generator';
import { Amenity, Interval, MeetingRoom, Scheduler } from './index';

const clock = new FakeClock('2026-06-01T08:00:00Z'); // Monday
const scheduler = new Scheduler({ clock, ids: new SequentialIdGenerator() });
const at = (hhmm: string, day = '2026-06-01') => new Date(`${day}T${hhmm}:00Z`);

for (const [id, name] of [['priya', 'Priya'], ['arjun', 'Arjun'], ['lena', 'Lena'], ['tom', 'Tom']]) scheduler.addUser(id, name);
scheduler
  .addRoom(new MeetingRoom('HUDDLE', 'Huddle', 3, [Amenity.WHITEBOARD]))
  .addRoom(new MeetingRoom('FOCUS', 'Focus', 4, [Amenity.VIDEO_CONFERENCE]))
  .addRoom(new MeetingRoom('BOARD', 'Boardroom', 12, [Amenity.VIDEO_CONFERENCE, Amenity.PROJECTOR]));

console.log('\n--- Monday: Priya books a 9:00 design review for three ---');
const review = scheduler.schedule({ title: 'Design review', organiserId: 'priya', attendeeIds: ['arjun', 'lena'], start: at('09:00'), durationMinutes: 60 });
console.log(`  ${review.id} ${review.interval} in ${review.room.name} (smallest room that fits)`);

console.log('\n--- Tom books a call with video right after, 10:00-10:30 (touching is fine) ---');
const call = scheduler.schedule({
  title: 'Vendor call',
  organiserId: 'tom',
  attendeeIds: ['arjun'],
  start: at('10:00'),
  durationMinutes: 30,
  amenities: [Amenity.VIDEO_CONFERENCE],
});
console.log(`  ${call.id} ${call.interval} in ${call.room.name}`);

console.log('\n--- Lena tries to grab Arjun at 10:15 ---');
try {
  scheduler.schedule({ title: '1:1', organiserId: 'lena', attendeeIds: ['arjun'], start: at('10:15'), durationMinutes: 30 });
} catch (error) {
  console.log(`  ${(error as Error).name}: ${(error as Error).message}`);
  const slots = scheduler.suggestSlots(['lena', 'arjun'], 30, at('09:00'), at('17:00'), 3);
  console.log(`  Suggested instead: ${slots.map(String).join(', ')}`);
  const oneOnOne = scheduler.schedule({ title: '1:1', organiserId: 'lena', attendeeIds: ['arjun'], start: slots[0].start, durationMinutes: 30 });
  console.log(`  Booked ${oneOnOne.id} ${oneOnOne.interval} in ${oneOnOne.room.name}`);
}

console.log('\n--- Arjun accepts the review, declines the vendor call ---');
console.log(`  review: ${scheduler.respond(review.id, 'arjun', true)}, call: ${scheduler.respond(call.id, 'arjun', false)}`);

console.log('\n--- Priya sets up a weekly Monday 14:00 sync for 4 weeks; week 3 has a clash ---');
scheduler.schedule({ title: 'Offsite prep', organiserId: 'tom', attendeeIds: [], start: at('14:30', '2026-06-15'), durationMinutes: 60 });
const weekly = { title: 'Team sync', organiserId: 'priya', attendeeIds: ['arjun', 'lena', 'tom'], start: at('14:00'), durationMinutes: 45 };
try {
  scheduler.scheduleWeekly(weekly, 4);
} catch (error) {
  console.log(`  ${(error as Error).name}: ${(error as Error).message}`);
}
const series = scheduler.scheduleWeekly({ ...weekly, start: at('15:30') }, 4);
console.log(`  Moved to 15:30: ${series.map((m) => m.interval.start.toISOString().slice(0, 10)).join(', ')} in ${series[0].room.name}`);

console.log('\n--- Priya cancels the design review; Huddle is free again ---');
scheduler.cancel(review.id, 'priya');
const free = scheduler.findRooms(new Interval(at('09:00'), at('10:00')), 3).map((r) => r.id);
console.log(`  ${review.status}; free rooms 9:00-10:00 for 3: ${free.join(', ')}`);
