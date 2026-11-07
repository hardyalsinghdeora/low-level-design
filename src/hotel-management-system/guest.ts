/** The person who books and pays. Kept minimal: identity and contact only. */
export class Guest {
  constructor(
    readonly id: string,
    readonly name: string,
    readonly email: string,
  ) {}
}
