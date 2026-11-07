import { type Book, normalizeIsbn } from './book';

/**
 * Specification pattern: each catalog filter answers one question and filters
 * compose with and/or/not, so the search screen can grow without changing
 * `Library.search()`.
 */
export abstract class Specification<T> {
  abstract isSatisfiedBy(candidate: T): boolean;

  and(other: Specification<T>): Specification<T> {
    return new AndSpecification(this, other);
  }

  or(other: Specification<T>): Specification<T> {
    return new OrSpecification(this, other);
  }

  not(): Specification<T> {
    return new NotSpecification(this);
  }
}

class AndSpecification<T> extends Specification<T> {
  constructor(
    private readonly left: Specification<T>,
    private readonly right: Specification<T>,
  ) {
    super();
  }

  override isSatisfiedBy(candidate: T): boolean {
    return this.left.isSatisfiedBy(candidate) && this.right.isSatisfiedBy(candidate);
  }
}

class OrSpecification<T> extends Specification<T> {
  constructor(
    private readonly left: Specification<T>,
    private readonly right: Specification<T>,
  ) {
    super();
  }

  override isSatisfiedBy(candidate: T): boolean {
    return this.left.isSatisfiedBy(candidate) || this.right.isSatisfiedBy(candidate);
  }
}

class NotSpecification<T> extends Specification<T> {
  constructor(private readonly inner: Specification<T>) {
    super();
  }

  override isSatisfiedBy(candidate: T): boolean {
    return !this.inner.isSatisfiedBy(candidate);
  }
}

/** Case-insensitive substring match on the title. */
export class TitleContains extends Specification<Book> {
  private readonly text: string;

  constructor(text: string) {
    super();
    this.text = text.trim().toLowerCase();
  }

  override isSatisfiedBy(book: Book): boolean {
    return book.title.toLowerCase().includes(this.text);
  }
}

/** Case-insensitive substring match on any of the authors. */
export class ByAuthor extends Specification<Book> {
  private readonly name: string;

  constructor(name: string) {
    super();
    this.name = name.trim().toLowerCase();
  }

  override isSatisfiedBy(book: Book): boolean {
    return book.authors.some((author) => author.toLowerCase().includes(this.name));
  }
}

/** Exact match after normalising hyphens, so `978-0-13-235088-4` finds `9780132350884`. */
export class IsbnIs extends Specification<Book> {
  private readonly isbn: string;

  constructor(isbn: string) {
    super();
    this.isbn = normalizeIsbn(isbn);
  }

  override isSatisfiedBy(book: Book): boolean {
    return book.isbn === this.isbn;
  }
}
