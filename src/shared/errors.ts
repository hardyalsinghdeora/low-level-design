/**
 * Base class for every domain error in this repository.
 * `name` is set to the concrete class name so stack traces, logs and test
 * assertions read `NoSpotAvailableError: ...` instead of `Error: ...`.
 */
export class DomainError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}
