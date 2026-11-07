import { FakeClock } from '../shared/clock';
import { SequentialIdGenerator } from '../shared/id-generator';
import { FanOutOnWriteFeed, NotificationInbox, SocialNetwork, Visibility } from './index';

const clock = new FakeClock('2026-06-01T08:00:00Z');
const feedStrategy = new FanOutOnWriteFeed();
const network = new SocialNetwork({ feedStrategy, clock, ids: new SequentialIdGenerator() });
const inbox = new NotificationInbox();
network.notifications.subscribe(inbox);

const ana = network.register('ana', { displayName: 'Ana Silva', city: 'Lisbon' });
const ben = network.register('ben', { displayName: 'Ben Okafor' });
const cai = network.register('cai', { displayName: 'Cai Wen' });

console.log('\n--- Ana sends Ben a friend request; Ben accepts ---');
const request = network.sendFriendRequest(ana.id, ben.id);
console.log(`  ${request.id} ana -> ben: ${request.status}`);
network.acceptFriendRequest(request.id, ben.id);
console.log(`  ${request.id}: ${request.status}`);
console.log(`  ana friends with ben: ${network.areFriends(ana.id, ben.id)}, ben with ana: ${network.areFriends(ben.id, ana.id)}`);

console.log('\n--- Ana posts with each visibility ---');
const announcement = network.createPost(ana.id, 'Moved to Lisbon!', Visibility.PUBLIC);
clock.advanceMinutes(5);
const party = network.createPost(ana.id, 'Housewarming on Saturday', Visibility.FRIENDS);
clock.advanceMinutes(5);
const note = network.createPost(ana.id, 'Remember to buy chairs', Visibility.PRIVATE);
for (const viewer of [ana, ben, cai]) {
  const visible = [announcement, party, note].filter((post) => network.canView(viewer.id, post.id));
  console.log(`  ${viewer.handle} can see: ${visible.map((post) => post.visibility).join(', ')}`);
}
const sizes = [ana, ben, cai].map((u) => `${u.handle}=${feedStrategy.inboxSize(u.id)}`);
console.log(`  inbox entries pushed at write time: ${sizes.join(' ')}`);

console.log('\n--- Ben scrolls his feed, one post per page ---');
let page = network.feed(ben.id, { limit: 1 });
for (let n = 1; ; n += 1) {
  for (const post of page.items) console.log(`  page ${n}: "${post.text}" (${post.visibility})`);
  if (!page.nextCursor) break;
  console.log(`          next cursor ${page.nextCursor}`);
  page = network.feed(ben.id, { limit: 1, cursor: page.nextCursor });
}

console.log('\n--- Ben reacts; Ana is notified through the observer ---');
network.like(party.id, ben.id);
network.comment(party.id, ben.id, 'I will bring snacks');
for (const notification of inbox.for(ana.id)) {
  console.log(`  ana <- ${notification.type} by ${network.user(notification.actorId).handle}`);
}

console.log('\n--- Ana blocks Cai; Cai tries to send a friend request anyway ---');
network.block(ana.id, cai.id);
try {
  network.sendFriendRequest(cai.id, ana.id);
} catch (error) {
  console.log(`  ${(error as Error).name}: ${(error as Error).message}`);
}
console.log(`  cai can still see the public post: ${network.canView(cai.id, announcement.id)}`);
console.log(`  ana's feed: ${network.feed(ana.id).items.map((post) => `"${post.text}"`).join(', ')}`);
