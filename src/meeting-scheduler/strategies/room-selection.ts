import type { MeetingRoom } from '../meeting-room';

/** Strategy: which of the suitable free rooms to give a meeting. Candidates already fit and are free. */
export interface RoomSelectionStrategy {
  choose(candidates: MeetingRoom[], people: number): MeetingRoom | undefined;
}

/** Smallest room that fits, so the big boardroom stays free for big meetings. */
export class SmallestFitRoomStrategy implements RoomSelectionStrategy {
  choose(candidates: MeetingRoom[]): MeetingRoom | undefined {
    return [...candidates].sort((a, b) => a.capacity - b.capacity || a.id.localeCompare(b.id))[0];
  }
}

/** First room in registration order, e.g. rooms listed nearest-first on a floor. */
export class FirstListedRoomStrategy implements RoomSelectionStrategy {
  choose(candidates: MeetingRoom[]): MeetingRoom | undefined {
    return candidates[0];
  }
}
