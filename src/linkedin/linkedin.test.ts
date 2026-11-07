import { beforeEach, describe, expect, it } from 'vitest';
import { FakeClock } from '../shared/clock';
import { SequentialIdGenerator } from '../shared/id-generator';
import {
  AlreadyConnectedError,
  ApplicationStatus,
  ConnectionDegree,
  DuplicateApplicationError,
  DuplicateEndorsementError,
  DuplicateInvitationError,
  HasSkill,
  InLocation,
  InvalidApplicationTransitionError,
  InvalidInvitationTransitionError,
  InvitationStatus,
  JobClosedError,
  LinkedIn,
  NotApplicantError,
  NotCompanyAdminError,
  NotConnectedError,
  NotFoundError,
  NotInvitationParticipantError,
  Profile,
  SelfActionError,
  SkillNotListedError,
  TitleContains,
} from './index';

let net: LinkedIn;
let clock: FakeClock;
let a: Profile;
let b: Profile;
let c: Profile;
let d: Profile;
let e: Profile;

function connect(x: Profile, y: Profile): void {
  net.accept(net.invite(x.id, y.id).id, y.id);
}

beforeEach(() => {
  clock = new FakeClock('2026-05-04T09:00:00Z');
  net = new LinkedIn({ clock, ids: new SequentialIdGenerator() });
  a = net.join({ name: 'Asha', headline: 'Engineering Manager', location: 'Bengaluru' });
  b = net.join({ name: 'Ben', headline: 'Backend Engineer', location: 'Bengaluru' });
  c = net.join({ name: 'Chen', headline: 'Staff Engineer', location: 'Bengaluru' });
  d = net.join({ name: 'Dev', headline: 'Platform Engineer', location: 'Pune' });
  e = net.join({ name: 'Eve', headline: 'Designer', location: 'Bengaluru' });
});

describe('Profile', () => {
  it('orders experience newest first, derives the current title and ranks skills by endorsements', () => {
    c.addExperience({ title: 'Engineer', company: 'Old', start: new Date('2018-01-01'), end: new Date('2021-12-31') });
    c.addExperience({ title: 'Staff Engineer', company: 'PayCo', start: new Date('2022-01-01'), end: null });
    c.addEducation({ school: 'IIT', degree: 'BTech', startYear: 2014, endYear: 2018 });
    c.addSkill('Go').addSkill('Kafka');
    connect(a, c);
    net.endorse(a.id, c.id, 'kafka');
    expect(c.experience.map((x) => x.company)).toEqual(['PayCo', 'Old']);
    expect(c.currentTitle).toBe('Staff Engineer');
    expect(c.topSkills()).toEqual([
      { skill: 'Kafka', endorsements: 1 },
      { skill: 'Go', endorsements: 0 },
    ]);
  });
});

describe('connections', () => {
  it('accepting an invitation creates a symmetric connection and clears the pending list', () => {
    const invitation = net.invite(a.id, b.id, 'hi');
    expect(net.pendingInvitationsFor(b.id)).toEqual([invitation]);
    clock.advanceMinutes(5);
    net.accept(invitation.id, b.id);
    expect(invitation.status).toBe(InvitationStatus.ACCEPTED);
    expect(invitation.resolvedAt?.toISOString()).toBe('2026-05-04T09:05:00.000Z');
    expect(net.connectionsOf(a.id).map((p) => p.id)).toEqual([b.id]);
    expect(net.connectionsOf(b.id).map((p) => p.id)).toEqual([a.id]);
    expect(net.pendingInvitationsFor(b.id)).toEqual([]);
  });

  it('rejects self, duplicate (either direction) and already-connected invitations', () => {
    expect(() => net.invite(a.id, a.id)).toThrow(SelfActionError);
    net.invite(a.id, b.id);
    expect(() => net.invite(b.id, a.id)).toThrow(DuplicateInvitationError);
    connect(c, d);
    expect(() => net.invite(d.id, c.id)).toThrow(AlreadyConnectedError);
    expect(() => net.invite(a.id, 'MBR-404')).toThrow(NotFoundError);
  });

  it('lets only the recipient accept or ignore, only the sender withdraw, and resolves once', () => {
    const invitation = net.invite(a.id, b.id);
    expect(() => net.accept(invitation.id, a.id)).toThrow(NotInvitationParticipantError);
    expect(() => net.withdraw(invitation.id, b.id)).toThrow(NotInvitationParticipantError);
    net.ignore(invitation.id, b.id);
    expect(() => net.accept(invitation.id, b.id)).toThrow(InvalidInvitationTransitionError);
    expect(net.degreeBetween(a.id, b.id)).toBe(ConnectionDegree.OUT_OF_NETWORK);

    const second = net.invite(a.id, b.id); // allowed again once the first is resolved
    net.withdraw(second.id, a.id);
    expect(second.status).toBe(InvitationStatus.WITHDRAWN);
  });

  it('computes 1st, 2nd and 3rd degree with a BFS capped at depth 3', () => {
    connect(a, b);
    connect(b, c);
    connect(c, d);
    connect(d, e);
    expect(net.degreeBetween(a.id, a.id)).toBe(ConnectionDegree.SELF);
    expect(net.degreeBetween(a.id, b.id)).toBe(ConnectionDegree.FIRST);
    expect(net.degreeBetween(a.id, c.id)).toBe(ConnectionDegree.SECOND);
    expect(net.degreeBetween(a.id, d.id)).toBe(ConnectionDegree.THIRD);
    expect(net.degreeBetween(a.id, e.id)).toBe(ConnectionDegree.OUT_OF_NETWORK);
    connect(a, c); // shortcut: Dev becomes 2nd degree
    expect(net.degreeBetween(a.id, d.id)).toBe(ConnectionDegree.SECOND);
  });
});

describe('endorsements and messaging', () => {
  it('allows one endorsement per endorser per listed skill, from 1st-degree connections only', () => {
    c.addSkill('Kafka');
    expect(() => net.endorse(a.id, c.id, 'Kafka')).toThrow(NotConnectedError);
    connect(a, c);
    net.endorse(a.id, c.id, 'Kafka');
    expect(() => net.endorse(a.id, c.id, 'KAFKA')).toThrow(DuplicateEndorsementError);
    expect(() => net.endorse(a.id, c.id, 'Rust')).toThrow(SkillNotListedError);
    expect(() => net.endorse(c.id, c.id, 'Kafka')).toThrow(SelfActionError);
    expect(c.endorsementCount('kafka')).toBe(1);
  });

  it('only delivers messages between 1st-degree connections, in one shared thread', () => {
    connect(a, b);
    connect(b, c);
    expect(() => net.sendMessage(a.id, c.id, 'hello')).toThrow(NotConnectedError);
    net.sendMessage(a.id, b.id, 'hello');
    clock.advanceMinutes(1);
    net.sendMessage(b.id, a.id, 'hi back');
    expect(net.conversation(b.id, a.id).map((m) => m.body)).toEqual(['hello', 'hi back']);
    expect(net.conversation(a.id, c.id)).toEqual([]);
  });
});

describe('jobs', () => {
  function postJob() {
    const company = net.createCompany('Acme', a.id);
    const job = net.postJob(company.id, a.id, { title: 'Staff Engineer', location: 'Bengaluru' });
    return { company, job };
  }

  it('moves an application through review, offer and acceptance with a timestamped history', () => {
    const { job } = postJob();
    const app = net.apply(job.id, c.id);
    net.reviewApplication(app.id, a.id);
    clock.advanceHours(24);
    net.makeOffer(app.id, a.id);
    net.acceptOffer(app.id, c.id);
    expect(app.status).toBe(ApplicationStatus.ACCEPTED);
    expect(app.isActive).toBe(false);
    expect(app.history.map((h) => h.status)).toEqual(['APPLIED', 'IN_REVIEW', 'OFFERED', 'ACCEPTED']);
    expect(app.history[2].at.toISOString()).toBe('2026-05-05T09:00:00.000Z');
  });

  it('rejects invalid application transitions', () => {
    const { job } = postJob();
    const app = net.apply(job.id, c.id);
    expect(() => net.makeOffer(app.id, a.id)).toThrow(InvalidApplicationTransitionError);
    net.rejectApplication(app.id, a.id);
    expect(() => net.withdrawApplication(app.id, c.id)).toThrow(InvalidApplicationTransitionError);
    expect(app.status).toBe(ApplicationStatus.REJECTED);
  });

  it('lets only company admins move applications and only the candidate accept or withdraw', () => {
    const { company, job } = postJob();
    expect(() => net.postJob(company.id, b.id, { title: 'X', location: 'Y' })).toThrow(NotCompanyAdminError);
    const app = net.apply(job.id, c.id);
    expect(() => net.reviewApplication(app.id, b.id)).toThrow(NotCompanyAdminError);
    company.addAdmin(a.id, b.id);
    net.reviewApplication(app.id, b.id);
    net.makeOffer(app.id, b.id);
    expect(() => net.acceptOffer(app.id, a.id)).toThrow(NotApplicantError);
    net.withdrawApplication(app.id, c.id); // declining an offer
    expect(app.status).toBe(ApplicationStatus.WITHDRAWN);
  });

  it('refuses duplicate applications and applications to a closed job', () => {
    const { job } = postJob();
    net.apply(job.id, c.id);
    expect(() => net.apply(job.id, c.id)).toThrow(DuplicateApplicationError);
    net.closeJob(job.id, a.id);
    expect(() => net.apply(job.id, d.id)).toThrow(JobClosedError);
    expect(() => net.closeJob(job.id, a.id)).toThrow(JobClosedError);
    expect(net.applicationsFor(job.id)).toHaveLength(1);
  });
});

describe('search', () => {
  it('composes specifications and ranks results by degree, then name', () => {
    for (const p of [b, c, d]) p.addSkill('TypeScript');
    connect(a, c);
    connect(c, b);
    const engineers = new TitleContains('engineer').and(new HasSkill('typescript'));
    expect(net.search(a.id, engineers).map((r) => [r.profile.name, r.degree])).toEqual([
      ['Chen', ConnectionDegree.FIRST],
      ['Ben', ConnectionDegree.SECOND],
      ['Dev', ConnectionDegree.OUT_OF_NETWORK],
    ]);
    const notInPune = engineers.and(new InLocation('pune').not());
    expect(net.search(a.id, notInPune).map((r) => r.profile.name)).toEqual(['Chen', 'Ben']);
    const designerOrPune = new TitleContains('designer').or(new InLocation('Pune'));
    expect(net.search(a.id, designerOrPune).map((r) => r.profile.name)).toEqual(['Dev', 'Eve']);
  });
});
