export enum ConnectionDegree {
  SELF = 'SELF',
  FIRST = 'FIRST',
  SECOND = 'SECOND',
  THIRD = 'THIRD',
  OUT_OF_NETWORK = 'OUT_OF_NETWORK',
}

const DEGREE_BY_DISTANCE: readonly ConnectionDegree[] = [
  ConnectionDegree.SELF,
  ConnectionDegree.FIRST,
  ConnectionDegree.SECOND,
  ConnectionDegree.THIRD,
];

/** LinkedIn shows degrees up to 3rd; beyond that a member is simply out of network. */
export const MAX_DEGREE = 3;

/**
 * The professional graph: undirected connections and the degree query. Edges
 * are only written in pairs, so a connection is always symmetric. The search
 * never goes deeper than 3 hops, which bounds the work by the size of a
 * member's 3rd-degree network instead of the whole graph.
 */
export class ConnectionGraph {
  private readonly adjacency = new Map<string, Set<string>>();

  connect(a: string, b: string): void {
    if (a === b) throw new RangeError('a member cannot connect to themselves');
    this.neighbours(a).add(b);
    this.neighbours(b).add(a);
  }

  areConnected(a: string, b: string): boolean {
    return this.adjacency.get(a)?.has(b) ?? false;
  }

  connectionsOf(memberId: string): string[] {
    return [...(this.adjacency.get(memberId) ?? [])];
  }

  mutualConnections(a: string, b: string): string[] {
    const ofB = this.adjacency.get(b) ?? new Set<string>();
    return this.connectionsOf(a).filter((id) => ofB.has(id));
  }

  /** Breadth-first search that stops as soon as the target is found or depth 3 is exhausted. */
  degreeBetween(from: string, to: string): ConnectionDegree {
    const distance = this.bfs(from, to).get(to);
    return distance === undefined ? ConnectionDegree.OUT_OF_NETWORK : DEGREE_BY_DISTANCE[distance];
  }

  /** Every member within 3 hops with their degree: one BFS, reused to rank a whole search page. */
  networkOf(memberId: string): Map<string, ConnectionDegree> {
    const network = new Map<string, ConnectionDegree>();
    for (const [id, distance] of this.bfs(memberId)) {
      if (distance > 0) network.set(id, DEGREE_BY_DISTANCE[distance]);
    }
    return network;
  }

  private bfs(from: string, target?: string): Map<string, number> {
    const distance = new Map<string, number>([[from, 0]]);
    let frontier = [from];
    for (let depth = 1; depth <= MAX_DEGREE && frontier.length > 0 && !distance.has(target ?? ''); depth += 1) {
      const next: string[] = [];
      for (const member of frontier) {
        for (const neighbour of this.adjacency.get(member) ?? []) {
          if (distance.has(neighbour)) continue;
          distance.set(neighbour, depth);
          next.push(neighbour);
        }
      }
      frontier = next;
    }
    return distance;
  }

  private neighbours(memberId: string): Set<string> {
    let set = this.adjacency.get(memberId);
    if (!set) {
      set = new Set();
      this.adjacency.set(memberId, set);
    }
    return set;
  }
}
