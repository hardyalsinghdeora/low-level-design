import { Calendar } from './calendar';

export enum Amenity {
  PROJECTOR = 'PROJECTOR',
  VIDEO_CONFERENCE = 'VIDEO_CONFERENCE',
  WHITEBOARD = 'WHITEBOARD',
}

/** A bookable room. Its calendar is the source of truth for "is the room taken". */
export class MeetingRoom {
  readonly calendar = new Calendar();
  readonly amenities: ReadonlySet<Amenity>;

  constructor(
    readonly id: string,
    readonly name: string,
    readonly capacity: number,
    amenities: Amenity[] = [],
  ) {
    this.amenities = new Set(amenities);
  }

  fits(people: number, required: Amenity[]): boolean {
    return this.capacity >= people && required.every((a) => this.amenities.has(a));
  }
}
