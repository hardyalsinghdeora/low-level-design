import { describe, expect, it } from 'vitest';
import { FakeClock } from '../shared/clock';
import { SequentialIdGenerator } from '../shared/id-generator';
import {
  Amenity,
  AttendeeBusyError,
  FirstListedRoomStrategy,
  Interval,
  InvalidIntervalError,
  InvalidInvitationTransitionError,
  InvalidMeetingTransitionError,
  InvitationNotFoundError,
  InvitationStatus,
  MeetingCancelledError,
  MeetingRoom,
  MeetingStatus,
  mergeIntervals,
  NoRoomAvailableError,
  NotOrganiserError,
  RecurrenceConflictError,
  RoomUnavailableError,
  Scheduler,
  type RoomSelectionStrategy,
} from './index';

const at = (hhmm: string, day = '2026-06-01') => new Date(`${day}T${hhmm}:00Z`); // 2026-06-01 is a Monday
const iv = (from: string, to: string, day?: string) => new Interval(at(from, day), at(to, day));

function build(roomSelection?: RoomSelectionStrategy) {
  const clock = new FakeClock('2026-06-01T08:00:00Z');
  const scheduler = new Scheduler({ roomSelection, clock, ids: new SequentialIdGenerator() });
  for (const id of ['ana', 'bo', 'cy', 'di']) scheduler.addUser(id, id.toUpperCase());
  scheduler
    .addRoom(new MeetingRoom('BIG', 'Boardroom', 10, [Amenity.PROJECTOR, Amenity.VIDEO_CONFERENCE]))
    .addRoom(new MeetingRoom('SMALL', 'Huddle', 3, [Amenity.WHITEBOARD]))
    .addRoom(new MeetingRoom('MID', 'Focus', 5, [Amenity.VIDEO_CONFERENCE]));
  const meet = (organiserId: string, attendeeIds: string[], start: Date, durationMinutes: number, extra: object = {}) =>
    scheduler.schedule({ title: 'Sync', organiserId, attendeeIds, start, durationMinutes, ...extra });
  return { clock, scheduler, meet };
}

describe('Interval', () => {
  it('uses half-open overlap: touching intervals do not conflict', () => {
    const nineToTen = iv('09:00', '10:00');
    expect(nineToTen.overlaps(iv('10:00', '11:00'))).toBe(false);
    expect(nineToTen.overlaps(iv('08:00', '09:00'))).toBe(false);
    expect(nineToTen.overlaps(iv('09:59', '10:30'))).toBe(true);
    expect(nineToTen.overlaps(iv('09:15', '09:45'))).toBe(true);
    expect(nineToTen.overlaps(iv('09:00', '10:00'))).toBe(true);
    expect(() => iv('10:00', '10:00')).toThrow(InvalidIntervalError);
  });

  it('merges overlapping and touching intervals but keeps gaps', () => {
    const merged = mergeIntervals([iv('13:00', '14:00'), iv('09:00', '10:00'), iv('09:30', '10:30'), iv('10:30', '11:00')]);
    expect(merged.map(String)).toEqual(['2026-06-01T09:00-11:00', '2026-06-01T13:00-14:00']);
  });
});

describe('Scheduling and rooms', () => {
  it('picks the smallest free room that fits capacity and amenities and blocks every calendar', () => {
    const { scheduler, meet } = build();
    const m = meet('ana', ['bo', 'cy'], at('09:00'), 60);
    expect(m.room.id).toBe('SMALL');
    expect(meet('di', [], at('09:00'), 60, { amenities: [Amenity.VIDEO_CONFERENCE] }).room.id).toBe('MID');
    expect(scheduler.findRooms(iv('09:30', '10:00'), 2).map((r) => r.id)).toEqual(['BIG']);
    expect(scheduler.findRooms(iv('10:00', '10:30'), 4, [Amenity.VIDEO_CONFERENCE]).map((r) => r.id)).toEqual(['BIG', 'MID']);
  });

  it('honours a different room-selection strategy', () => {
    const { meet } = build(new FirstListedRoomStrategy());
    expect(meet('ana', ['bo'], at('09:00'), 30).room.id).toBe('BIG');
  });

  it('detects room conflicts but allows back-to-back bookings', () => {
    const { meet } = build();
    meet('ana', [], at('09:00'), 60, { roomId: 'SMALL' });
    expect(() => meet('bo', [], at('09:30'), 60, { roomId: 'SMALL' })).toThrow(RoomUnavailableError);
    expect(meet('bo', [], at('10:00'), 30, { roomId: 'SMALL' }).room.id).toBe('SMALL');
    expect(() => meet('cy', ['ana', 'bo', 'di'], at('11:00'), 30, { roomId: 'SMALL' })).toThrow(RoomUnavailableError);
    expect(() => meet('cy', [], at('11:00'), 30, { amenities: [Amenity.WHITEBOARD, Amenity.PROJECTOR] })).toThrow(
      NoRoomAvailableError,
    );
  });

  it('rejects busy attendees, and a decline frees their time', () => {
    const { scheduler, meet } = build();
    const first = meet('ana', ['bo'], at('09:00'), 60);
    expect(() => meet('cy', ['bo'], at('09:30'), 30)).toThrow(AttendeeBusyError);
    expect(scheduler.respond(first.id, 'bo', false)).toBe(InvitationStatus.DECLINED);
    expect(meet('cy', ['bo'], at('09:30'), 30).attendees.map((u) => u.id)).toEqual(['bo']);
    expect(() => meet('ana', [], at('07:00'), 30)).toThrow(InvalidIntervalError);
  });
});

describe('Invitations and cancellation', () => {
  it('validates invitation transitions', () => {
    const { scheduler, meet } = build();
    const m = meet('ana', ['bo'], at('09:00'), 30);
    expect(m.invitation('bo').status).toBe(InvitationStatus.PENDING);
    expect(scheduler.respond(m.id, 'bo', true)).toBe(InvitationStatus.ACCEPTED);
    expect(() => scheduler.respond(m.id, 'bo', true)).toThrow(InvalidInvitationTransitionError);
    expect(() => scheduler.respond(m.id, 'cy', true)).toThrow(InvitationNotFoundError);
  });

  it('frees the room and calendars on cancel; only the organiser may cancel, once', () => {
    const { scheduler, meet } = build();
    const m = meet('ana', ['bo', 'cy'], at('09:00'), 60);
    expect(() => scheduler.cancel(m.id, 'bo')).toThrow(NotOrganiserError);
    scheduler.cancel(m.id, 'ana');
    expect(m.status).toBe(MeetingStatus.CANCELLED);
    expect(scheduler.findRooms(iv('09:00', '10:00'), 3).map((r) => r.id)).toContain('SMALL');
    expect(meet('di', ['bo', 'cy'], at('09:00'), 60).room.id).toBe('SMALL');
    expect(() => scheduler.cancel(m.id, 'ana')).toThrow(InvalidMeetingTransitionError);
    expect(() => scheduler.respond(m.id, 'bo', true)).toThrow(MeetingCancelledError);
  });
});

describe('Free-slot suggestions', () => {
  it('merges attendee busy time and returns gaps inside working hours', () => {
    const { scheduler, meet } = build();
    meet('ana', [], at('09:00'), 60); // ana 9-10
    meet('bo', [], at('09:30'), 60); // bo 9:30-10:30, merged with ana: 9-10:30
    meet('ana', [], at('11:00'), 60); // 11-12: the 10:30-11 gap is too short for 45 min
    meet('bo', [], at('12:45'), 255); // 12:45-17:00
    const slots = scheduler.suggestSlots(['ana', 'bo'], 45, at('08:00'), at('10:00', '2026-06-02'));
    expect(slots.map(String)).toEqual(['2026-06-01T12:00-12:45', '2026-06-02T09:00-09:45']);
  });

  it('skips weekends and respects the limit', () => {
    const { scheduler } = build();
    const slots = scheduler.suggestSlots(['ana'], 60, at('16:30', '2026-06-05'), at('12:00', '2026-06-09'), 2);
    expect(slots.map(String)).toEqual(['2026-06-08T09:00-10:00', '2026-06-08T10:00-11:00']);
  });
});

describe('Weekly recurrence', () => {
  it('expands N weeks in one room with a shared series id', () => {
    const { meet, scheduler } = build();
    const series = scheduler.scheduleWeekly({ title: 'Weekly', organiserId: 'ana', attendeeIds: ['bo'], start: at('14:00'), durationMinutes: 30 }, 3);
    expect(series.map((m) => m.interval.start.toISOString().slice(0, 10))).toEqual(['2026-06-01', '2026-06-08', '2026-06-15']);
    expect(new Set(series.map((m) => m.room.id))).toEqual(new Set(['SMALL']));
    expect(series[0].seriesId).toBeDefined();
    expect(() => meet('cy', ['bo'], at('14:15', '2026-06-08'), 30)).toThrow(AttendeeBusyError);
  });

  it('books nothing when any occurrence conflicts', () => {
    const { meet, scheduler } = build();
    meet('bo', [], at('14:00', '2026-06-15'), 30);
    const request = { title: 'Weekly', organiserId: 'ana', attendeeIds: ['bo'], start: at('14:00'), durationMinutes: 30 };
    expect(() => scheduler.scheduleWeekly(request, 3)).toThrow(RecurrenceConflictError);
    expect(scheduler.suggestSlots(['ana'], 30, at('14:00'), at('14:30'))).toHaveLength(1);
  });
});
