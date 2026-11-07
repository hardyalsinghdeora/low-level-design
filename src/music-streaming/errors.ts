import { DomainError } from '../shared/errors';
import type { PlayerState } from './player';

export class MusicStreamingError extends DomainError {}

export class NotFoundError extends MusicStreamingError {
  constructor(kind: string, id: string) {
    super(`No ${kind} ${id}`);
  }
}

export class DuplicateSongError extends MusicStreamingError {
  constructor(playlistId: string, songId: string) {
    super(`Playlist ${playlistId} already contains song ${songId}`);
  }
}

export class InvalidPositionError extends MusicStreamingError {
  constructor(index: number, length: number) {
    super(`Position ${index} is outside a list of ${length} items`);
  }
}

export class NotPlaylistOwnerError extends MusicStreamingError {
  constructor(listenerId: string, playlistId: string) {
    super(`${listenerId} does not own playlist ${playlistId}`);
  }
}

export class InvalidPlayerTransitionError extends MusicStreamingError {
  constructor(from: PlayerState, to: PlayerState) {
    super(`Player cannot go from ${from} to ${to}`);
  }
}

export class EmptyQueueError extends MusicStreamingError {
  constructor() {
    super('The play queue is empty');
  }
}

/** FREE tier rule: a limited number of skips in any rolling hour. */
export class SkipLimitReachedError extends MusicStreamingError {
  constructor(listenerId: string, limit: number) {
    super(`${listenerId} has used all ${limit} skips for this hour`);
  }
}

export class AdInProgressError extends MusicStreamingError {
  constructor() {
    super('Ads cannot be skipped on the FREE tier');
  }
}
