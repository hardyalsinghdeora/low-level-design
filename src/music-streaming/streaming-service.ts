import { Clock, SystemClock } from '../shared/clock';
import { IdGenerator, UuidGenerator } from '../shared/id-generator';
import type { Catalog, Song } from './catalog';
import { NotFoundError, NotPlaylistOwnerError } from './errors';
import { ListeningHistory } from './listening-history';
import { Player } from './player';
import { Playlist } from './playlist';
import { MostListenedGenreStrategy, type RecommendationStrategy } from './strategies/recommendation';
import { policyFor, SubscriptionTier, type FreeTierOptions } from './strategies/tier';

export interface Listener {
  id: string;
  name: string;
  tier: SubscriptionTier;
}

export interface StreamingServiceOptions {
  clock?: Clock;
  ids?: IdGenerator;
  rng?: () => number;
  recommendation?: RecommendationStrategy;
  freeTier?: FreeTierOptions;
}

/**
 * Composition root and application service: listeners, playlists, one
 * player per listener, the shared history and the recommendation strategy.
 * It wires the right TierPolicy into each player so tier logic stays out of
 * the player itself.
 */
export class MusicStreamingService {
  readonly history = new ListeningHistory();
  private readonly listeners = new Map<string, Listener>();
  private readonly playlists = new Map<string, Playlist>();
  private readonly players = new Map<string, Player>();
  private recommendation: RecommendationStrategy;
  private readonly clock: Clock;
  private readonly ids: IdGenerator;
  private readonly rng: () => number;

  constructor(
    readonly catalog: Catalog,
    private readonly options: StreamingServiceOptions = {},
  ) {
    this.clock = options.clock ?? new SystemClock();
    this.ids = options.ids ?? new UuidGenerator();
    this.rng = options.rng ?? Math.random;
    this.recommendation = options.recommendation ?? new MostListenedGenreStrategy();
  }

  register(name: string, tier: SubscriptionTier): Listener {
    const listener = { id: this.ids.next('USR'), name, tier };
    this.listeners.set(listener.id, listener);
    return listener;
  }

  createPlaylist(ownerId: string, name: string, allowDuplicates = false): Playlist {
    this.listener(ownerId);
    const playlist = new Playlist(this.ids.next('PL'), ownerId, name, allowDuplicates);
    this.playlists.set(playlist.id, playlist);
    return playlist;
  }

  addToPlaylist(playlistId: string, byId: string, songId: string): Playlist {
    const playlist = this.ownedPlaylist(playlistId, byId);
    playlist.add(this.catalog.song(songId), this.clock.now());
    return playlist;
  }

  playerFor(listenerId: string): Player {
    const listener = this.listener(listenerId);
    let player = this.players.get(listenerId);
    if (!player) {
      player = new Player(listener.id, policyFor(listener.tier, this.options.freeTier), this.history, {
        clock: this.clock,
        rng: this.rng,
      });
      this.players.set(listenerId, player);
    }
    return player;
  }

  playPlaylist(listenerId: string, playlistId: string): Player {
    const playlist = this.playlists.get(playlistId);
    if (!playlist) throw new NotFoundError('playlist', playlistId);
    const player = this.playerFor(listenerId);
    player.load(playlist.songs);
    player.play();
    return player;
  }

  setRecommendationStrategy(strategy: RecommendationStrategy): void {
    this.recommendation = strategy;
  }

  recommend(listenerId: string, limit = 5): Song[] {
    this.listener(listenerId);
    return this.recommendation.recommend(this.history.forListener(listenerId), this.catalog, limit);
  }

  private listener(id: string): Listener {
    const listener = this.listeners.get(id);
    if (!listener) throw new NotFoundError('listener', id);
    return listener;
  }

  private ownedPlaylist(id: string, byId: string): Playlist {
    const playlist = this.playlists.get(id);
    if (!playlist) throw new NotFoundError('playlist', id);
    if (playlist.ownerId !== byId) throw new NotPlaylistOwnerError(byId, id);
    return playlist;
  }
}
