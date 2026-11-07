import type { Genre, Song } from './catalog';

export interface ListenEvent {
  listenerId: string;
  songId: string;
  artistId: string;
  genre: Genre;
  playedAt: Date;
}

/**
 * Append-only log of completed plays, timestamped by the injected clock.
 * Denormalising artist and genre into the event keeps recommendations a
 * single scan instead of a join per play.
 */
export class ListeningHistory {
  private readonly events: ListenEvent[] = [];

  record(listenerId: string, song: Song, playedAt: Date): ListenEvent {
    const event = { listenerId, songId: song.id, artistId: song.artistId, genre: song.genre, playedAt };
    this.events.push(event);
    return event;
  }

  /** Oldest first. */
  forListener(listenerId: string): ListenEvent[] {
    return this.events.filter((event) => event.listenerId === listenerId);
  }
}
