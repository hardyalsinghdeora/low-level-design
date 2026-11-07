import { FakeClock } from '../shared/clock';
import { SequentialIdGenerator } from '../shared/id-generator';
import { Catalog, Genre, MostListenedArtistStrategy, MusicStreamingService, RepeatMode, SubscriptionTier } from './index';

const catalog = new Catalog();
catalog.addArtist('ART-1', 'The Monsoons');
catalog.addArtist('ART-2', 'Blue Note Trio');
catalog.addAlbum('ALB-1', 'Petrichor', 'ART-1', 2024);
catalog.addAlbum('ALB-2', 'Late Set', 'ART-2', 2021);
catalog.addSong('S1', 'First Rain', 'ALB-1', Genre.ROCK, 200);
catalog.addSong('S2', 'Thunder Road', 'ALB-1', Genre.ROCK, 180);
catalog.addSong('S3', 'Wet Streets', 'ALB-1', Genre.ROCK, 210);
catalog.addSong('S4', 'Blue Hour', 'ALB-2', Genre.JAZZ, 300);
catalog.addSong('S5', 'Afterglow', 'ALB-1', Genre.ROCK, 190);
catalog.addSong('S6', 'Quiet Storm', 'ALB-2', Genre.JAZZ, 240);
catalog.addSong('S7', 'Smoky Riff', 'ALB-2', Genre.ROCK, 200);

const clock = new FakeClock('2026-06-01T18:00:00Z');
const rngValues = [0.7, 0.2, 0.9, 0.4];
let r = 0;
const rng = () => rngValues[r++ % rngValues.length];
const service = new MusicStreamingService(catalog, {
  clock,
  rng,
  ids: new SequentialIdGenerator(),
  freeTier: { maxSkipsPerHour: 2, songsBetweenAds: 2, adDurationSec: 15 },
});

const mira = service.register('Mira', SubscriptionTier.FREE);
const mix = service.createPlaylist(mira.id, 'Evening mix', true);
for (const id of ['S1', 'S2', 'S4', 'S1', 'S3']) service.addToPlaylist(mix.id, mira.id, id);
console.log(`\n${mix.name}: ${mix.songs.map((s) => s.title).join(', ')}`);
console.log(`  dedupe removed ${mix.dedupe()}; move 'Blue Hour' to the end`);
mix.move(2, 3);
console.log(`  now: ${mix.songs.map((s) => s.title).join(', ')} (${mix.totalDurationSec}s)`);

const player = service.playPlaylist(mira.id, mix.id);
const listen = (seconds: number) => {
  clock.advanceSeconds(seconds);
  player.tick(seconds);
};
console.log(`\n--- ${player.state}: ${player.current?.title} ---`);
listen(200);
listen(180);
console.log(`  two songs done -> ad playing: ${player.isAdPlaying}, next up ${player.current?.title}`);
try {
  player.next();
} catch (error) {
  console.log(`  ${(error as Error).name}: ${(error as Error).message}`);
}
listen(15);
console.log(`  ad over, now ${player.current?.title}; ads so far ${player.adsPlayed}`);

console.log('\n--- Skipping on FREE (2 per rolling hour in this demo) ---');
player.setRepeat(RepeatMode.ALL);
player.next();
player.next();
try {
  player.next();
} catch (error) {
  console.log(`  ${(error as Error).name}: ${(error as Error).message}`);
}
clock.advanceHours(1);
console.log(`  an hour later: ${player.skipsRemaining} skips available, next -> ${player.next()?.title}`);

console.log('\n--- Shuffle with an injected rng, then pause ---');
player.setShuffle(true);
console.log(`  ${player.current?.title} then ${player.upcoming().map((s) => s.title).join(', ')}`);
player.pause();
console.log(`  state ${player.state}`);

console.log('\n--- Recommendations ---');
console.log(`  by genre:  ${service.recommend(mira.id).map((s) => s.title).join(', ')}`);
service.setRecommendationStrategy(new MostListenedArtistStrategy());
console.log(`  by artist: ${service.recommend(mira.id).map((s) => s.title).join(', ')}`);
