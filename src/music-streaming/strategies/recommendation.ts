import type { Catalog, Song } from '../catalog';
import type { ListenEvent } from '../listening-history';

/** Strategy: how to turn a listening history into suggestions. */
export interface RecommendationStrategy {
  readonly name: string;
  recommend(history: readonly ListenEvent[], catalog: Catalog, limit: number): Song[];
}

/** Most frequent key; ties go to the key heard most recently, so the result is deterministic. */
function mostFrequent(history: readonly ListenEvent[], key: (event: ListenEvent) => string): string | null {
  const stats = new Map<string, { count: number; last: number }>();
  history.forEach((event, index) => {
    const entry = stats.get(key(event)) ?? { count: 0, last: -1 };
    stats.set(key(event), { count: entry.count + 1, last: index });
  });
  let best: string | null = null;
  let bestStats = { count: 0, last: -1 };
  for (const [k, s] of stats) {
    if (s.count > bestStats.count || (s.count === bestStats.count && s.last > bestStats.last)) {
      best = k;
      bestStats = s;
    }
  }
  return best;
}

/** Shared skeleton: pick the favourite key, suggest unheard songs that share it. */
abstract class FavouriteBasedStrategy implements RecommendationStrategy {
  abstract readonly name: string;
  protected abstract keyOf(item: { artistId: string; genre: string }): string;

  recommend(history: readonly ListenEvent[], catalog: Catalog, limit: number): Song[] {
    const favourite = mostFrequent(history, (event) => this.keyOf(event));
    if (favourite === null) return []; // cold start: a "popular now" strategy would fill this
    const heard = new Set(history.map((event) => event.songId));
    return catalog
      .allSongs()
      .filter((song) => this.keyOf(song) === favourite && !heard.has(song.id))
      .sort((a, b) => a.title.localeCompare(b.title))
      .slice(0, limit);
  }
}

export class MostListenedGenreStrategy extends FavouriteBasedStrategy {
  readonly name = 'most-listened-genre';

  protected keyOf(item: { genre: string }): string {
    return item.genre;
  }
}

export class MostListenedArtistStrategy extends FavouriteBasedStrategy {
  readonly name = 'most-listened-artist';

  protected keyOf(item: { artistId: string }): string {
    return item.artistId;
  }
}
