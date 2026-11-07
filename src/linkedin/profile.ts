import { DuplicateEndorsementError, SelfActionError, SkillNotListedError } from './errors';

export interface Experience {
  title: string;
  company: string;
  start: Date;
  /** `null` means this is a current role. */
  end: Date | null;
}

export interface Education {
  school: string;
  degree: string;
  startYear: number;
  endYear: number;
}

interface SkillEntry {
  name: string;
  endorsers: Set<string>;
}

/**
 * A member's professional identity: work history, education, and skills with
 * endorsements. Endorsers are kept as a set per skill, which makes "one
 * endorsement per endorser per skill" structural rather than a lookup someone
 * can forget.
 */
export class Profile {
  private readonly _experience: Experience[] = [];
  private readonly _education: Education[] = [];
  private readonly skills = new Map<string, SkillEntry>();

  constructor(
    readonly id: string,
    readonly name: string,
    readonly headline: string,
    readonly location: string,
  ) {
    if (!name.trim()) throw new RangeError('name is required');
  }

  /** Most recent role first. */
  get experience(): readonly Experience[] {
    return this._experience;
  }

  get education(): readonly Education[] {
    return this._education;
  }

  get currentTitle(): string | null {
    return this._experience.find((entry) => entry.end === null)?.title ?? null;
  }

  addExperience(entry: Experience): this {
    if (entry.end && entry.end.getTime() < entry.start.getTime()) {
      throw new RangeError(`${entry.title} at ${entry.company} ends before it starts`);
    }
    this._experience.push({ ...entry });
    this._experience.sort((a, b) => b.start.getTime() - a.start.getTime());
    return this;
  }

  addEducation(entry: Education): this {
    if (entry.endYear < entry.startYear) throw new RangeError(`${entry.school} ends before it starts`);
    this._education.push({ ...entry });
    return this;
  }

  addSkill(skill: string): this {
    const key = Profile.key(skill);
    if (!key) throw new RangeError('skill name is required');
    if (!this.skills.has(key)) this.skills.set(key, { name: skill.trim(), endorsers: new Set() });
    return this;
  }

  hasSkill(skill: string): boolean {
    return this.skills.has(Profile.key(skill));
  }

  endorsementCount(skill: string): number {
    return this.skills.get(Profile.key(skill))?.endorsers.size ?? 0;
  }

  /** Skills ordered by endorsements, the way the profile page shows them. */
  topSkills(): { skill: string; endorsements: number }[] {
    return [...this.skills.values()]
      .map((entry) => ({ skill: entry.name, endorsements: entry.endorsers.size }))
      .sort((a, b) => b.endorsements - a.endorsements || a.skill.localeCompare(b.skill));
  }

  endorse(skill: string, endorserId: string): void {
    if (endorserId === this.id) throw new SelfActionError(endorserId, 'endorse');
    const entry = this.skills.get(Profile.key(skill));
    if (!entry) throw new SkillNotListedError(this.id, skill);
    if (entry.endorsers.has(endorserId)) throw new DuplicateEndorsementError(endorserId, this.id, entry.name);
    entry.endorsers.add(endorserId);
  }

  private static key(skill: string): string {
    return skill.trim().toLowerCase();
  }
}
