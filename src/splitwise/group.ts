import { NotAGroupMemberError } from './errors';

/**
 * People who share expenses (a trip, a flat). Membership is the only rule it
 * guards; the group's balances are derived from the expenses filed under it.
 */
export class Group {
  private readonly members = new Set<string>();

  constructor(
    readonly id: string,
    readonly name: string,
    memberIds: readonly string[],
  ) {
    if (!name.trim()) throw new RangeError('name is required');
    for (const userId of memberIds) this.members.add(userId);
  }

  get memberIds(): string[] {
    return [...this.members];
  }

  hasMember(userId: string): boolean {
    return this.members.has(userId);
  }

  addMember(userId: string): void {
    this.members.add(userId);
  }

  assertMembers(userIds: Iterable<string>): void {
    for (const userId of userIds) {
      if (!this.members.has(userId)) throw new NotAGroupMemberError(userId, this.id);
    }
  }
}
