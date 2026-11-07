import type { Profile } from '../profile';

/**
 * Specification pattern: each search filter is a small predicate object, and
 * filters compose with and/or/not instead of growing one search method with
 * a parameter per filter.
 */
export interface ProfileSpecification {
  isSatisfiedBy(profile: Profile): boolean;
  describe(): string;
}

/** Gives every concrete specification the fluent combinators. */
export abstract class Specification implements ProfileSpecification {
  abstract isSatisfiedBy(profile: Profile): boolean;
  abstract describe(): string;

  and(other: ProfileSpecification): Specification {
    return new AllOf([this, other]);
  }

  or(other: ProfileSpecification): Specification {
    return new AnyOf([this, other]);
  }

  not(): Specification {
    return new Not(this);
  }
}

export class HasSkill extends Specification {
  constructor(private readonly skill: string) {
    super();
  }

  isSatisfiedBy(profile: Profile): boolean {
    return profile.hasSkill(this.skill);
  }

  describe(): string {
    return `skill=${this.skill}`;
  }
}

export class InLocation extends Specification {
  constructor(private readonly location: string) {
    super();
  }

  isSatisfiedBy(profile: Profile): boolean {
    return profile.location.toLowerCase() === this.location.toLowerCase();
  }

  describe(): string {
    return `location=${this.location}`;
  }
}

/** Matches the current job title or, failing that, the headline. */
export class TitleContains extends Specification {
  constructor(private readonly keyword: string) {
    super();
  }

  isSatisfiedBy(profile: Profile): boolean {
    const needle = this.keyword.toLowerCase();
    return [profile.currentTitle ?? '', profile.headline].some((text) => text.toLowerCase().includes(needle));
  }

  describe(): string {
    return `title~${this.keyword}`;
  }
}

export class AllOf extends Specification {
  constructor(private readonly parts: readonly ProfileSpecification[]) {
    super();
  }

  isSatisfiedBy(profile: Profile): boolean {
    return this.parts.every((part) => part.isSatisfiedBy(profile));
  }

  describe(): string {
    return `(${this.parts.map((part) => part.describe()).join(' AND ')})`;
  }
}

export class AnyOf extends Specification {
  constructor(private readonly parts: readonly ProfileSpecification[]) {
    super();
  }

  isSatisfiedBy(profile: Profile): boolean {
    return this.parts.some((part) => part.isSatisfiedBy(profile));
  }

  describe(): string {
    return `(${this.parts.map((part) => part.describe()).join(' OR ')})`;
  }
}

export class Not extends Specification {
  constructor(private readonly inner: ProfileSpecification) {
    super();
  }

  isSatisfiedBy(profile: Profile): boolean {
    return !this.inner.isSatisfiedBy(profile);
  }

  describe(): string {
    return `NOT ${this.inner.describe()}`;
  }
}
