import type { Song } from './catalog';
import { DuplicateSongError, InvalidPositionError, NotFoundError } from './errors';

export interface PlaylistItem {
  /** Items have their own id because the same song may appear twice. */
  itemId: string;
  song: Song;
  addedAt: Date;
}

/**
 * An ordered, user-curated list. Order is the whole point, so reordering is
 * a first-class move; duplicates are a per-playlist choice, and `dedupe()`
 * cleans up a playlist that allowed them.
 */
export class Playlist {
  private readonly _items: PlaylistItem[] = [];
  private nextItem = 0;

  constructor(
    readonly id: string,
    readonly ownerId: string,
    readonly name: string,
    readonly allowDuplicates = false,
  ) {}

  get items(): readonly PlaylistItem[] {
    return this._items;
  }

  get songs(): Song[] {
    return this._items.map((item) => item.song);
  }

  get totalDurationSec(): number {
    return this._items.reduce((sum, item) => sum + item.song.durationSec, 0);
  }

  add(song: Song, at: Date): PlaylistItem {
    if (!this.allowDuplicates && this._items.some((item) => item.song.id === song.id)) {
      throw new DuplicateSongError(this.id, song.id);
    }
    this.nextItem += 1;
    const item = { itemId: `${this.id}-${this.nextItem}`, song, addedAt: at };
    this._items.push(item);
    return item;
  }

  remove(itemId: string): void {
    const index = this._items.findIndex((item) => item.itemId === itemId);
    if (index < 0) throw new NotFoundError('playlist item', itemId);
    this._items.splice(index, 1);
  }

  /** Moves one item; everything between shifts by one, like drag and drop. */
  move(fromIndex: number, toIndex: number): void {
    this.requireIndex(fromIndex);
    this.requireIndex(toIndex);
    const [item] = this._items.splice(fromIndex, 1);
    this._items.splice(toIndex, 0, item);
  }

  /** Keeps the first occurrence of each song; returns how many items were removed. */
  dedupe(): number {
    const seen = new Set<string>();
    const before = this._items.length;
    const kept = this._items.filter((item) => !seen.has(item.song.id) && seen.add(item.song.id) !== undefined);
    this._items.splice(0, this._items.length, ...kept);
    return before - kept.length;
  }

  private requireIndex(index: number): void {
    if (!Number.isInteger(index) || index < 0 || index >= this._items.length) {
      throw new InvalidPositionError(index, this._items.length);
    }
  }
}
