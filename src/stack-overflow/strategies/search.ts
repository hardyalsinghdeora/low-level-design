import { normaliseTag, type Question } from '../question';

/**
 * Strategy + Composite: each criterion is a predicate, and predicates combine
 * with AllOf / AnyOf, so "tag:typescript AND (author:asha OR 'debounce')"
 * needs no new code.
 */
export interface SearchStrategy {
  matches(question: Question): boolean;
}

export class TagSearch implements SearchStrategy {
  private readonly tag: string;

  constructor(tag: string) {
    this.tag = normaliseTag(tag);
  }

  matches(question: Question): boolean {
    return question.tags.has(this.tag);
  }
}

/** Every word must appear in the title or body, case-insensitively. */
export class KeywordSearch implements SearchStrategy {
  private readonly words: string[];

  constructor(text: string) {
    this.words = text.toLowerCase().split(/\s+/).filter(Boolean);
    if (this.words.length === 0) throw new RangeError('keyword search needs at least one word');
  }

  matches(question: Question): boolean {
    const haystack = `${question.title} ${question.body}`.toLowerCase();
    return this.words.every((word) => haystack.includes(word));
  }
}

export class AuthorSearch implements SearchStrategy {
  constructor(private readonly authorId: string) {}

  matches(question: Question): boolean {
    return question.author.id === this.authorId;
  }
}

export class AllOf implements SearchStrategy {
  private readonly parts: readonly SearchStrategy[];

  constructor(...parts: SearchStrategy[]) {
    this.parts = parts;
  }

  matches(question: Question): boolean {
    return this.parts.every((part) => part.matches(question));
  }
}

export class AnyOf implements SearchStrategy {
  private readonly parts: readonly SearchStrategy[];

  constructor(...parts: SearchStrategy[]) {
    this.parts = parts;
  }

  matches(question: Question): boolean {
    return this.parts.some((part) => part.matches(question));
  }
}
