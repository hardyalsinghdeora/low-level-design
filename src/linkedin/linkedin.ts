import { Clock, SystemClock } from '../shared/clock';
import { IdGenerator, UuidGenerator } from '../shared/id-generator';
import { Company, JobPosting } from './company';
import { ConnectionDegree, ConnectionGraph } from './connection-graph';
import { Conversation, type Message } from './conversation';
import {
  AlreadyConnectedError,
  DuplicateApplicationError,
  DuplicateInvitationError,
  NotConnectedError,
  NotFoundError,
  SelfActionError,
} from './errors';
import { Invitation, InvitationStatus } from './invitation';
import { JobApplication } from './job-application';
import { Profile } from './profile';
import type { ProfileSpecification } from './strategies/profile-specification';

export interface LinkedInOptions {
  clock?: Clock;
  ids?: IdGenerator;
}

export interface NewMember {
  name: string;
  headline: string;
  location: string;
}

export interface NewJob {
  title: string;
  location: string;
  skills?: string[];
}

export interface SearchResult {
  profile: Profile;
  degree: ConnectionDegree;
}

const DEGREE_RANK: Record<ConnectionDegree, number> = {
  [ConnectionDegree.SELF]: 0,
  [ConnectionDegree.FIRST]: 1,
  [ConnectionDegree.SECOND]: 2,
  [ConnectionDegree.THIRD]: 3,
  [ConnectionDegree.OUT_OF_NETWORK]: 4,
};

/**
 * Application service for the professional network. It is the only place
 * that writes the connection graph (so edges appear only through an accepted
 * invitation) and the only place that checks cross-entity rules: messaging
 * and endorsing need a 1st-degree connection, recruiter moves need a company
 * admin, one application per candidate per job.
 */
export class LinkedIn {
  private readonly profiles = new Map<string, Profile>();
  private readonly invitations = new Map<string, Invitation>();
  private readonly graph = new ConnectionGraph();
  private readonly companies = new Map<string, Company>();
  private readonly jobs = new Map<string, JobPosting>();
  private readonly applications = new Map<string, JobApplication>();
  /** `${jobId}|${candidateId}` -> application id: the unique constraint, in memory. */
  private readonly applicationKey = new Map<string, string>();
  private readonly conversations = new Map<string, Conversation>();
  private readonly clock: Clock;
  private readonly ids: IdGenerator;

  constructor(options: LinkedInOptions = {}) {
    this.clock = options.clock ?? new SystemClock();
    this.ids = options.ids ?? new UuidGenerator();
  }

  // ---- members -------------------------------------------------------------

  join(member: NewMember): Profile {
    const profile = new Profile(this.ids.next('MBR'), member.name, member.headline, member.location);
    this.profiles.set(profile.id, profile);
    return profile;
  }

  profile(memberId: string): Profile {
    const profile = this.profiles.get(memberId);
    if (!profile) throw new NotFoundError('member', memberId);
    return profile;
  }

  // ---- connections ---------------------------------------------------------

  invite(fromId: string, toId: string, note: string | null = null): Invitation {
    if (fromId === toId) throw new SelfActionError(fromId, 'invite');
    this.profile(fromId);
    this.profile(toId);
    if (this.graph.areConnected(fromId, toId)) throw new AlreadyConnectedError(fromId, toId);
    for (const existing of this.invitations.values()) {
      if (existing.isPendingBetween(fromId, toId)) throw new DuplicateInvitationError(fromId, toId);
    }
    const invitation = new Invitation(this.ids.next('INV'), fromId, toId, note, this.clock.now());
    this.invitations.set(invitation.id, invitation);
    return invitation;
  }

  accept(invitationId: string, byId: string): void {
    const invitation = this.invitation(invitationId);
    invitation.accept(byId, this.clock.now());
    this.graph.connect(invitation.fromId, invitation.toId);
  }

  ignore(invitationId: string, byId: string): void {
    this.invitation(invitationId).ignore(byId, this.clock.now());
  }

  withdraw(invitationId: string, byId: string): void {
    this.invitation(invitationId).withdraw(byId, this.clock.now());
  }

  pendingInvitationsFor(memberId: string): Invitation[] {
    return [...this.invitations.values()].filter(
      (invitation) => invitation.toId === memberId && invitation.status === InvitationStatus.PENDING,
    );
  }

  connectionsOf(memberId: string): Profile[] {
    return this.graph.connectionsOf(memberId).map((id) => this.profile(id));
  }

  degreeBetween(from: string, to: string): ConnectionDegree {
    return this.graph.degreeBetween(from, to);
  }

  mutualConnections(a: string, b: string): Profile[] {
    return this.graph.mutualConnections(a, b).map((id) => this.profile(id));
  }

  // ---- endorsements and messaging -----------------------------------------

  endorse(endorserId: string, profileId: string, skill: string): void {
    if (endorserId === profileId) throw new SelfActionError(endorserId, 'endorse');
    this.requireFirstDegree(endorserId, profileId, 'endorse their skills');
    this.profile(profileId).endorse(skill, endorserId);
  }

  sendMessage(fromId: string, toId: string, body: string): Message {
    if (fromId === toId) throw new SelfActionError(fromId, 'message');
    this.requireFirstDegree(fromId, toId, 'send a message');
    if (!body.trim()) throw new RangeError('message body is required');
    const key = Conversation.keyFor(fromId, toId);
    let conversation = this.conversations.get(key);
    if (!conversation) {
      conversation = new Conversation([fromId, toId]);
      this.conversations.set(key, conversation);
    }
    const message: Message = { id: this.ids.next('MSG'), fromId, toId, body, sentAt: this.clock.now() };
    conversation.append(message);
    return message;
  }

  conversation(a: string, b: string): readonly Message[] {
    return this.conversations.get(Conversation.keyFor(a, b))?.messages ?? [];
  }

  // ---- companies, jobs and applications -----------------------------------

  createCompany(name: string, adminId: string): Company {
    this.profile(adminId);
    const company = new Company(this.ids.next('CMP'), name, adminId);
    this.companies.set(company.id, company);
    return company;
  }

  postJob(companyId: string, byId: string, job: NewJob): JobPosting {
    const company = this.company(companyId);
    company.requireAdmin(byId);
    const posting = new JobPosting(
      this.ids.next('JOB'),
      company.id,
      job.title,
      job.location,
      byId,
      this.clock.now(),
      job.skills ?? [],
    );
    this.jobs.set(posting.id, posting);
    return posting;
  }

  closeJob(jobId: string, byId: string): void {
    const job = this.job(jobId);
    this.company(job.companyId).requireAdmin(byId);
    job.close();
  }

  apply(jobId: string, candidateId: string): JobApplication {
    const job = this.job(jobId);
    this.profile(candidateId);
    job.requireOpen();
    const key = `${jobId}|${candidateId}`;
    if (this.applicationKey.has(key)) throw new DuplicateApplicationError(candidateId, jobId);
    const application = new JobApplication(this.ids.next('APP'), jobId, candidateId, this.clock.now());
    this.applications.set(application.id, application);
    this.applicationKey.set(key, application.id);
    return application;
  }

  reviewApplication(applicationId: string, byId: string): JobApplication {
    const application = this.recruiterOwned(applicationId, byId);
    application.startReview(this.clock.now());
    return application;
  }

  rejectApplication(applicationId: string, byId: string): JobApplication {
    const application = this.recruiterOwned(applicationId, byId);
    application.reject(this.clock.now());
    return application;
  }

  makeOffer(applicationId: string, byId: string): JobApplication {
    const application = this.recruiterOwned(applicationId, byId);
    application.offer(this.clock.now());
    return application;
  }

  acceptOffer(applicationId: string, byId: string): JobApplication {
    const application = this.application(applicationId);
    application.accept(byId, this.clock.now());
    return application;
  }

  withdrawApplication(applicationId: string, byId: string): JobApplication {
    const application = this.application(applicationId);
    application.withdraw(byId, this.clock.now());
    return application;
  }

  applicationsFor(jobId: string): JobApplication[] {
    return [...this.applications.values()].filter((application) => application.jobId === jobId);
  }

  // ---- search --------------------------------------------------------------

  /**
   * Filters with a composable specification, then ranks by degree (closer
   * first) and name. One bounded BFS computes every degree for the page.
   */
  search(viewerId: string, spec: ProfileSpecification, limit = 20): SearchResult[] {
    this.profile(viewerId);
    const network = this.graph.networkOf(viewerId);
    return [...this.profiles.values()]
      .filter((profile) => profile.id !== viewerId && spec.isSatisfiedBy(profile))
      .map((profile) => ({ profile, degree: network.get(profile.id) ?? ConnectionDegree.OUT_OF_NETWORK }))
      .sort((a, b) => DEGREE_RANK[a.degree] - DEGREE_RANK[b.degree] || a.profile.name.localeCompare(b.profile.name))
      .slice(0, limit);
  }

  // ---- lookups -------------------------------------------------------------

  private requireFirstDegree(fromId: string, toId: string, action: string): void {
    this.profile(fromId);
    this.profile(toId);
    if (!this.graph.areConnected(fromId, toId)) throw new NotConnectedError(fromId, toId, action);
  }

  private recruiterOwned(applicationId: string, byId: string): JobApplication {
    const application = this.application(applicationId);
    this.company(this.job(application.jobId).companyId).requireAdmin(byId);
    return application;
  }

  private invitation(id: string): Invitation {
    const invitation = this.invitations.get(id);
    if (!invitation) throw new NotFoundError('invitation', id);
    return invitation;
  }

  private company(id: string): Company {
    const company = this.companies.get(id);
    if (!company) throw new NotFoundError('company', id);
    return company;
  }

  private job(id: string): JobPosting {
    const job = this.jobs.get(id);
    if (!job) throw new NotFoundError('job', id);
    return job;
  }

  private application(id: string): JobApplication {
    const application = this.applications.get(id);
    if (!application) throw new NotFoundError('application', id);
    return application;
  }
}
