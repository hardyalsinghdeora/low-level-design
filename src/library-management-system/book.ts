/** Accepts ISBN-10 or ISBN-13 with or without hyphens and stores the bare digits. */
export function normalizeIsbn(raw: string): string {
  const isbn = raw.replace(/[-\s]/g, '').toUpperCase();
  if (!/^(\d{9}[\dX]|\d{13})$/.test(isbn)) throw new RangeError(`Invalid ISBN ${raw}`);
  return isbn;
}

/**
 * The catalog record: what a title *is*. It has no status and is never lent;
 * physical copies (BookItem) are. Keeping the two apart is the first thing an
 * interviewer looks for in this problem.
 */
export class Book {
  readonly isbn: string;
  readonly authors: readonly string[];

  constructor(
    isbn: string,
    readonly title: string,
    authors: readonly string[],
  ) {
    this.isbn = normalizeIsbn(isbn);
    if (!title.trim()) throw new RangeError('title is required');
    if (authors.length === 0) throw new RangeError('at least one author is required');
    this.authors = [...authors];
  }
}
