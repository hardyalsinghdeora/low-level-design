/**
 * Friendships and blocks. A friendship is stored as two directed edges, but
 * they are only ever written and removed in pairs here, which is what keeps
 * "A is B's friend if and only if B is A's friend" true. Blocks are directed
 * (A decided to block B) but enforced in both directions.
 */
export class SocialGraph {
  private readonly friends = new Map<string, Set<string>>();
  private readonly blocks = new Map<string, Set<string>>();

  addFriendship(a: string, b: string): void {
    if (a === b) throw new RangeError('a user cannot befriend themselves');
    SocialGraph.edges(this.friends, a).add(b);
    SocialGraph.edges(this.friends, b).add(a);
  }

  /** Returns false when they were not friends. */
  removeFriendship(a: string, b: string): boolean {
    const removed = this.friends.get(a)?.delete(b) ?? false;
    this.friends.get(b)?.delete(a);
    return removed;
  }

  areFriends(a: string, b: string): boolean {
    return this.friends.get(a)?.has(b) ?? false;
  }

  friendsOf(userId: string): string[] {
    return [...(this.friends.get(userId) ?? [])];
  }

  /** Blocking also ends the friendship: you cannot be friends with someone you blocked. */
  block(blockerId: string, blockedId: string): void {
    SocialGraph.edges(this.blocks, blockerId).add(blockedId);
    this.removeFriendship(blockerId, blockedId);
  }

  unblock(blockerId: string, blockedId: string): void {
    this.blocks.get(blockerId)?.delete(blockedId);
  }

  isBlockedBetween(a: string, b: string): boolean {
    return (this.blocks.get(a)?.has(b) ?? false) || (this.blocks.get(b)?.has(a) ?? false);
  }

  private static edges(map: Map<string, Set<string>>, userId: string): Set<string> {
    let set = map.get(userId);
    if (!set) {
      set = new Set();
      map.set(userId, set);
    }
    return set;
  }
}
