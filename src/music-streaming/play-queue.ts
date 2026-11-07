import type { Song } from './catalog';
import { EmptyQueueError, InvalidPositionError } from './errors';

/**
 * Tracks plus a play order. Shuffle permutes the order, never the tracks, so
 * turning shuffle off returns to the original sequence at the current song.
 */
export class PlayQueue {
  private tracks: Song[] = [];
  private order: number[] = [];
  private _position = 0;
  private _shuffled = false;

  load(songs: readonly Song[], startIndex = 0): void {
    if (songs.length === 0) throw new EmptyQueueError();
    if (startIndex < 0 || startIndex >= songs.length) throw new InvalidPositionError(startIndex, songs.length);
    this.tracks = [...songs];
    this.order = this.tracks.map((_, i) => i);
    this._position = startIndex;
    this._shuffled = false;
  }

  get length(): number {
    return this.order.length;
  }

  get position(): number {
    return this._position;
  }

  get isShuffled(): boolean {
    return this._shuffled;
  }

  get current(): Song | null {
    return this.length === 0 ? null : this.tracks[this.order[this._position]];
  }

  upcoming(): Song[] {
    return this.order.slice(this._position + 1).map((i) => this.tracks[i]);
  }

  moveTo(position: number): void {
    if (position < 0 || position >= this.length) throw new InvalidPositionError(position, this.length);
    this._position = position;
  }

  /** Fisher-Yates over everything except the current song, which stays first. */
  shuffle(rng: () => number): void {
    if (this.length === 0) throw new EmptyQueueError();
    const current = this.order[this._position];
    const rest = this.order.filter((i) => i !== current);
    for (let i = rest.length - 1; i > 0; i -= 1) {
      const j = Math.floor(rng() * (i + 1));
      [rest[i], rest[j]] = [rest[j], rest[i]];
    }
    this.order = [current, ...rest];
    this._position = 0;
    this._shuffled = true;
  }

  unshuffle(): void {
    if (this.length === 0) return;
    const current = this.order[this._position];
    this.order = this.tracks.map((_, i) => i);
    this._position = current;
    this._shuffled = false;
  }
}
