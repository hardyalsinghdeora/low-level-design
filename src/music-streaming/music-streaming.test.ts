import { describe, expect, it } from 'vitest';
import { FakeClock } from '../shared/clock';
import { SequentialIdGenerator } from '../shared/id-generator';
import {
  AdInProgressError,
  Catalog,
  DuplicateSongError,
  EmptyQueueError,
  FreeTierPolicy,
  Genre,
  InvalidPlayerTransitionError,
  InvalidPositionError,
  ListeningHistory,
  MostListenedArtistStrategy,
  MostListenedGenreStrategy,
  MusicStreamingService,
  NotFoundError,
  NotPlaylistOwnerError,
  Player,
  PlayerState,
  Playlist,
  PremiumTierPolicy,
  RepeatMode,
  SkipLimitReachedError,
  type Song,
  SubscriptionTier,
  type TierPolicy,
} from './index';

function buildCatalog(): Catalog {
  const catalog = new Catalog();
  catalog.addArtist('A', 'Alpha');
  catalog.addArtist('B', 'Bravo');
  catalog.addAlbum('AL-A', 'Alpha One', 'A', 2020);
  catalog.addAlbum('AL-B', 'Bravo One', 'B', 2021);
  catalog.addSong('p1', 'Pop 1', 'AL-A', Genre.POP, 100);
  catalog.addSong('p2', 'Pop 2', 'AL-A', Genre.POP, 100);
  catalog.addSong('p3', 'Pop 3', 'AL-A', Genre.POP, 100);
  catalog.addSong('r1', 'Rock 1', 'AL-A', Genre.ROCK, 100);
  catalog.addSong('b1', 'Bravo Pop', 'AL-B', Genre.POP, 100);
  return catalog;
}

const catalog = buildCatalog();
const songs = (...ids: string[]): Song[] => ids.map((id) => catalog.song(id));

function setup(tier: TierPolicy = new PremiumTierPolicy(), repeat = RepeatMode.OFF, rng: () => number = () => 0) {
  const clock = new FakeClock('2026-06-01T18:00:00Z');
  const history = new ListeningHistory();
  const player = new Player('U1', tier, history, { clock, repeat, rng });
  const listen = (seconds: number) => {
    clock.advanceSeconds(seconds);
    player.tick(seconds);
  };
  return { clock, history, player, listen };
}

describe('Catalog and Playlist', () => {
  it('links songs to their album and artist and rejects unknown albums', () => {
    expect(catalog.albumSongs('AL-B').map((s) => s.title)).toEqual(['Bravo Pop']);
    expect(catalog.song('b1').artistId).toBe('B');
    expect(() => catalog.addSong('x', 'X', 'AL-404', Genre.JAZZ, 10)).toThrow(NotFoundError);
  });

  it('reorders items like drag and drop and validates positions', () => {
    const playlist = new Playlist('PL', 'U1', 'mix');
    for (const song of songs('p1', 'p2', 'p3', 'r1')) playlist.add(song, new Date(0));
    playlist.move(0, 2);
    expect(playlist.songs.map((s) => s.id)).toEqual(['p2', 'p3', 'p1', 'r1']);
    expect(playlist.totalDurationSec).toBe(400);
    expect(() => playlist.move(0, 4)).toThrow(InvalidPositionError);
  });

  it('refuses duplicates unless allowed, and dedupe keeps first occurrences', () => {
    const strict = new Playlist('PL1', 'U1', 'strict');
    strict.add(catalog.song('p1'), new Date(0));
    expect(() => strict.add(catalog.song('p1'), new Date(0))).toThrow(DuplicateSongError);

    const loose = new Playlist('PL2', 'U1', 'loose', true);
    for (const song of songs('p1', 'p2', 'p1', 'p3', 'p2')) loose.add(song, new Date(0));
    expect(loose.dedupe()).toBe(2);
    expect(loose.songs.map((s) => s.id)).toEqual(['p1', 'p2', 'p3']);
  });
});

describe('Player state machine and repeat strategies', () => {
  it('validates transitions and refuses to play an empty queue', () => {
    const { player } = setup();
    expect(() => player.play()).toThrow(EmptyQueueError);
    player.load(songs('p1', 'p2'));
    expect(() => player.pause()).toThrow(InvalidPlayerTransitionError);
    player.play();
    player.pause();
    expect(player.state).toBe(PlayerState.PAUSED);
    expect(() => player.pause()).toThrow(InvalidPlayerTransitionError);
    player.play();
    player.stop();
    expect(player.state).toBe(PlayerState.STOPPED);
  });

  it('repeat OFF plays through, records timestamped history and stops at the end', () => {
    const { player, history, listen } = setup();
    player.load(songs('p1', 'p2', 'p3'));
    player.play();
    listen(150);
    expect(player.current?.id).toBe('p2');
    expect(player.positionSec).toBe(50);
    listen(150);
    expect(player.state).toBe(PlayerState.STOPPED);
    expect(history.forListener('U1').map((e) => [e.songId, e.playedAt.toISOString()])).toEqual([
      ['p1', '2026-06-01T18:02:30.000Z'],
      ['p2', '2026-06-01T18:05:00.000Z'],
      ['p3', '2026-06-01T18:05:00.000Z'],
    ]);
  });

  it('repeat ONE replays on track end but a skip moves on; repeat ALL wraps both ways', () => {
    const one = setup(new PremiumTierPolicy(), RepeatMode.ONE);
    one.player.load(songs('p1', 'p2'));
    one.player.play();
    one.listen(100);
    expect(one.player.current?.id).toBe('p1');
    expect(one.player.next()?.id).toBe('p2');

    const all = setup(new PremiumTierPolicy(), RepeatMode.ALL);
    all.player.load(songs('p1', 'p2', 'p3'));
    all.player.play();
    expect(all.player.previous()?.id).toBe('p3');
    all.listen(100);
    expect(all.player.current?.id).toBe('p1');
    all.listen(10);
    expect(all.player.previous()?.id).toBe('p1'); // 10s in: restart, not back
  });

  it('shuffles deterministically with the injected rng and unshuffles back to the original order', () => {
    const { player } = setup(new PremiumTierPolicy(), RepeatMode.OFF, () => 0);
    player.load(songs('p1', 'p2', 'p3', 'r1'));
    player.setShuffle(true);
    expect([player.current?.id, ...player.upcoming().map((s) => s.id)]).toEqual(['p1', 'p3', 'r1', 'p2']);
    player.next(); // p3
    player.setShuffle(false);
    expect(player.current?.id).toBe('p3');
    expect(player.upcoming().map((s) => s.id)).toEqual(['r1']);
  });
});

describe('Tier rules', () => {
  it('FREE allows 6 skips in a rolling hour, measured with the clock', () => {
    const { player, clock } = setup(new FreeTierPolicy(), RepeatMode.ALL);
    player.load(songs('p1', 'p2', 'p3'));
    player.play();
    for (let i = 0; i < 6; i += 1) {
      player.next();
      clock.advanceMinutes(1);
    }
    expect(player.skipsRemaining).toBe(0);
    expect(() => player.next()).toThrow(SkipLimitReachedError);
    clock.advanceMinutes(54); // the first skip is now exactly an hour old
    expect(player.skipsRemaining).toBe(1);
    player.next();
    expect(() => player.next()).toThrow(SkipLimitReachedError);
  });

  it('FREE plays an unskippable ad every N songs; PREMIUM never does and skips freely', () => {
    const free = setup(new FreeTierPolicy({ songsBetweenAds: 2, adDurationSec: 15 }), RepeatMode.ALL);
    free.player.load(songs('p1', 'p2', 'p3'));
    free.player.play();
    free.listen(100);
    expect(free.player.isAdPlaying).toBe(false);
    free.listen(100);
    expect(free.player.isAdPlaying).toBe(true);
    expect(() => free.player.next()).toThrow(AdInProgressError);
    free.listen(20);
    expect(free.player.isAdPlaying).toBe(false);
    expect(free.player.adsPlayed).toBe(1);
    expect(free.player.positionSec).toBe(5);

    const premium = setup(new PremiumTierPolicy(), RepeatMode.ALL);
    premium.player.load(songs('p1', 'p2'));
    premium.player.play();
    premium.listen(1_000);
    for (let i = 0; i < 20; i += 1) premium.player.next();
    expect(premium.player.adsPlayed).toBe(0);
  });
});

describe('Recommendations and service', () => {
  it('recommends unheard songs from the most-listened genre or artist', () => {
    const history = new ListeningHistory();
    for (const id of ['p1', 'r1', 'p2']) history.record('U1', catalog.song(id), new Date(0));
    const events = history.forListener('U1');
    expect(new MostListenedGenreStrategy().recommend(events, catalog, 5).map((s) => s.id)).toEqual(['b1', 'p3']);
    expect(new MostListenedArtistStrategy().recommend(events, catalog, 5).map((s) => s.id)).toEqual(['p3']);
    expect(new MostListenedGenreStrategy().recommend([], catalog, 5)).toEqual([]);
  });

  it('only lets the owner edit a playlist and wires the tier policy into the player', () => {
    const service = new MusicStreamingService(catalog, {
      clock: new FakeClock(),
      ids: new SequentialIdGenerator(),
      freeTier: { maxSkipsPerHour: 1 },
    });
    const owner = service.register('Mira', SubscriptionTier.FREE);
    const other = service.register('Noor', SubscriptionTier.PREMIUM);
    const playlist = service.createPlaylist(owner.id, 'mix');
    service.addToPlaylist(playlist.id, owner.id, 'p1');
    service.addToPlaylist(playlist.id, owner.id, 'p2');
    expect(() => service.addToPlaylist(playlist.id, other.id, 'p3')).toThrow(NotPlaylistOwnerError);
    const player = service.playPlaylist(owner.id, playlist.id);
    expect(player.state).toBe(PlayerState.PLAYING);
    player.next();
    expect(() => player.next()).toThrow(SkipLimitReachedError);
    expect(service.playerFor(other.id).skipsRemaining).toBe(Number.POSITIVE_INFINITY);
  });
});
