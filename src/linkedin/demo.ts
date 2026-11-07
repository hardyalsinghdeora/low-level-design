import { FakeClock } from '../shared/clock';
import { SequentialIdGenerator } from '../shared/id-generator';
import { HasSkill, InLocation, LinkedIn, TitleContains } from './index';

const clock = new FakeClock('2026-05-04T09:00:00Z');
const net = new LinkedIn({ clock, ids: new SequentialIdGenerator() });

const asha = net.join({ name: 'Asha Rao', headline: 'Engineering Manager', location: 'Bengaluru' });
const ben = net.join({ name: 'Ben Okafor', headline: 'Backend engineer', location: 'Bengaluru' });
const chen = net.join({ name: 'Chen Li', headline: 'Staff Engineer, payments', location: 'Bengaluru' });
const dev = net.join({ name: 'Dev Mehta', headline: 'Platform engineer', location: 'Pune' });

asha.addExperience({ title: 'Engineering Manager', company: 'Acme', start: new Date('2023-01-01'), end: null });
for (const p of [ben, chen, dev]) p.addSkill('TypeScript').addSkill('Distributed Systems');
chen.addExperience({ title: 'Staff Engineer', company: 'PayCo', start: new Date('2022-06-01'), end: null });

console.log('\n--- Building the graph: Asha - Ben - Chen - Dev ---');
for (const [from, to] of [[asha, ben], [ben, chen], [chen, dev]] as const) {
  const invitation = net.invite(from.id, to.id, 'Good to meet you');
  net.accept(invitation.id, to.id);
  console.log(`  ${from.name} <-> ${to.name} (${invitation.status})`);
}
for (const p of [ben, chen, dev]) console.log(`  Asha -> ${p.name}: ${net.degreeBetween(asha.id, p.id)}`);

console.log('\n--- Asha tries to message Chen, a 2nd-degree connection ---');
try {
  net.sendMessage(asha.id, chen.id, 'Are you open to a staff role?');
} catch (error) {
  console.log(`  ${(error as Error).name}: ${(error as Error).message}`);
  const mutual = net.mutualConnections(asha.id, chen.id).map((p) => p.name);
  console.log(`  Mutual connections: ${mutual.join(', ')}. She sends an invitation instead.`);
  const invitation = net.invite(asha.id, chen.id, 'Ben suggested we talk');
  clock.advanceHours(3);
  net.accept(invitation.id, chen.id);
  net.sendMessage(asha.id, chen.id, 'Are you open to a staff role?');
  console.log(`  Now ${net.degreeBetween(asha.id, chen.id)}; messages in thread: ${net.conversation(chen.id, asha.id).length}`);
}

console.log('\n--- Endorsements (one per endorser per skill) ---');
net.endorse(ben.id, chen.id, 'Distributed Systems');
net.endorse(asha.id, chen.id, 'Distributed Systems');
net.endorse(dev.id, chen.id, 'TypeScript');
for (const s of chen.topSkills()) console.log(`  Chen: ${s.skill} x${s.endorsements}`);

console.log('\n--- Search: engineers in Bengaluru with Distributed Systems ---');
const spec = new TitleContains('engineer').and(new InLocation('Bengaluru')).and(new HasSkill('distributed systems'));
console.log(`  ${spec.describe()}`);
for (const r of net.search(asha.id, spec)) console.log(`  ${r.profile.name} [${r.degree}]`);

console.log('\n--- Hiring pipeline ---');
const acme = net.createCompany('Acme', asha.id);
const job = net.postJob(acme.id, asha.id, { title: 'Staff Engineer', location: 'Bengaluru', skills: ['TypeScript'] });
const app = net.apply(job.id, chen.id);
net.reviewApplication(app.id, asha.id);
clock.advanceHours(48);
net.makeOffer(app.id, asha.id);
net.acceptOffer(app.id, chen.id);
console.log(`  ${app.history.map((h) => h.status).join(' -> ')}`);
net.closeJob(job.id, asha.id);
console.log(`  ${job.title} is now ${job.status}`);
