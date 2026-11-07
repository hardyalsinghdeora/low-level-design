import { Clock, SystemClock } from '../shared/clock';
import { IdGenerator, UuidGenerator } from '../shared/id-generator';
import { User } from './calendar';
import {
  AttendeeBusyError,
  InvalidIntervalError,
  MeetingNotFoundError,
  NoRoomAvailableError,
  NotOrganiserError,
  RecurrenceConflictError,
  RoomNotFoundError,
  RoomUnavailableError,
  UserNotFoundError,
} from './errors';
import { Interval } from './interval';
import { InvitationStatus, Meeting } from './meeting';
import type { Amenity, MeetingRoom } from './meeting-room';
import { WeeklyRecurrence } from './recurrence';
import { SlotFinder } from './services/slot-finder';
import { SmallestFitRoomStrategy, type RoomSelectionStrategy } from './strategies/room-selection';

export interface MeetingRequest {
  title: string;
  organiserId: string;
  attendeeIds: string[];
  start: Date;
  durationMinutes: number;
  amenities?: Amenity[];
  /** Ask for a specific room; otherwise the room strategy picks one. */
  roomId?: string;
}

export interface SchedulerOptions {
  roomSelection?: RoomSelectionStrategy;
  slotFinder?: SlotFinder;
  clock?: Clock;
  ids?: IdGenerator;
}

/**
 * Aggregate root for people, rooms and meetings. Every write to a room or
 * person calendar goes through here, after all checks for every occurrence
 * have passed, so a failed request never leaves a half-booked series.
 */
export class Scheduler {
  private readonly users = new Map<string, User>();
  private readonly rooms: MeetingRoom[] = [];
  private readonly meetings = new Map<string, Meeting>();
  private readonly roomSelection: RoomSelectionStrategy;
  private readonly slotFinder: SlotFinder;
  private readonly clock: Clock;
  private readonly ids: IdGenerator;

  constructor(options: SchedulerOptions = {}) {
    this.roomSelection = options.roomSelection ?? new SmallestFitRoomStrategy();
    this.slotFinder = options.slotFinder ?? new SlotFinder();
    this.clock = options.clock ?? new SystemClock();
    this.ids = options.ids ?? new UuidGenerator();
  }

  addUser(id: string, name: string): User {
    const user = new User(id, name);
    this.users.set(id, user);
    return user;
  }

  addRoom(room: MeetingRoom): this {
    this.rooms.push(room);
    return this;
  }

  /** Rooms that are free for the interval and satisfy capacity and amenities. */
  findRooms(interval: Interval, people: number, amenities: Amenity[] = []): MeetingRoom[] {
    return this.rooms.filter((r) => r.fits(people, amenities) && r.calendar.isFree(interval));
  }

  schedule(request: MeetingRequest): Meeting {
    return this.book(request, new WeeklyRecurrence(1))[0];
  }

  /** All occurrences use the same room and are booked only if every week is free. */
  scheduleWeekly(request: MeetingRequest, weeks: number): Meeting[] {
    return this.book(request, new WeeklyRecurrence(weeks));
  }

  respond(meetingId: string, userId: string, accept: boolean): InvitationStatus {
    const meeting = this.meeting(meetingId);
    const invitation = meeting.respond(userId, accept ? InvitationStatus.ACCEPTED : InvitationStatus.DECLINED);
    const user = this.user(userId);
    // A declined invitation frees the person's time; re-accepting blocks it again.
    user.calendar.removeMeeting(meeting.id);
    if (invitation.status === InvitationStatus.ACCEPTED) user.calendar.addBusy(meeting.interval, meeting.title, meeting.id);
    return invitation.status;
  }

  cancel(meetingId: string, userId: string): void {
    const meeting = this.meeting(meetingId);
    if (meeting.organiser.id !== userId) throw new NotOrganiserError(meetingId, userId);
    meeting.cancel();
    meeting.room.calendar.removeMeeting(meeting.id);
    for (const person of meeting.participants) person.calendar.removeMeeting(meeting.id);
  }

  /** Common free slots for these people inside working hours. */
  suggestSlots(userIds: string[], durationMinutes: number, from: Date, to: Date, limit = 5): Interval[] {
    const calendars = userIds.map((id) => this.user(id).calendar);
    return this.slotFinder.suggest(calendars, durationMinutes, new Interval(from, to), limit);
  }

  getMeeting(meetingId: string): Meeting {
    return this.meeting(meetingId);
  }

  private book(request: MeetingRequest, recurrence: WeeklyRecurrence): Meeting[] {
    const first = Interval.ofMinutes(request.start, request.durationMinutes);
    if (first.start.getTime() < this.clock.now().getTime()) throw new InvalidIntervalError('Cannot schedule a meeting in the past');
    const organiser = this.user(request.organiserId);
    const attendees = [...new Set(request.attendeeIds)].filter((id) => id !== organiser.id).map((id) => this.user(id));
    const people = [organiser, ...attendees];
    const amenities = request.amenities ?? [];
    const occurrences = recurrence.expand(first);

    // Check phase: people must be free in every occurrence.
    const busy: { when: Interval; userId: string }[] = [];
    for (const when of occurrences) {
      for (const person of people) if (!person.calendar.isFree(when)) busy.push({ when, userId: person.id });
    }
    if (busy.length > 0) {
      if (occurrences.length > 1) throw new RecurrenceConflictError(busy.map((b) => `${b.when} (${b.userId})`));
      throw new AttendeeBusyError(busy[0].userId, first.toString());
    }
    const room = this.pickRoom(request.roomId, occurrences, people.length, amenities);

    // Write phase: nothing below can fail.
    const seriesId = occurrences.length > 1 ? this.ids.next('SERIES') : undefined;
    return occurrences.map((when) => {
      const meeting = new Meeting(this.ids.next('MTG'), request.title, organiser, attendees, room, when, seriesId);
      room.calendar.addBusy(when, request.title, meeting.id);
      for (const person of people) person.calendar.addBusy(when, request.title, meeting.id);
      this.meetings.set(meeting.id, meeting);
      return meeting;
    });
  }

  private pickRoom(roomId: string | undefined, occurrences: Interval[], people: number, amenities: Amenity[]): MeetingRoom {
    const freeForAll = (room: MeetingRoom) => occurrences.every((when) => room.calendar.isFree(when));
    if (roomId !== undefined) {
      const room = this.rooms.find((r) => r.id === roomId);
      if (!room) throw new RoomNotFoundError(roomId);
      if (!room.fits(people, amenities)) throw new RoomUnavailableError(roomId, `needs ${people} seats and ${amenities.join(', ') || 'no amenities'}`);
      if (!freeForAll(room)) {
        const clash = occurrences.filter((when) => !room.calendar.isFree(when)).map(String);
        if (occurrences.length > 1) throw new RecurrenceConflictError(clash.map((c) => `${c} (room ${roomId})`));
        throw new RoomUnavailableError(roomId, `already booked during ${clash[0]}`);
      }
      return room;
    }
    const candidates = this.rooms.filter((r) => r.fits(people, amenities) && freeForAll(r));
    const room = this.roomSelection.choose(candidates, people);
    if (!room) throw new NoRoomAvailableError(people, occurrences.map(String).join(', '));
    return room;
  }

  private user(id: string): User {
    const user = this.users.get(id);
    if (!user) throw new UserNotFoundError(id);
    return user;
  }

  private meeting(id: string): Meeting {
    const meeting = this.meetings.get(id);
    if (!meeting) throw new MeetingNotFoundError(id);
    return meeting;
  }
}
