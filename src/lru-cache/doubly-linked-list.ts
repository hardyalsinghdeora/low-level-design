/** A list node. Owners keep a reference to it so they can unlink it in O(1). */
export class ListNode<T> {
  prev: ListNode<T> | null = null;
  next: ListNode<T> | null = null;

  constructor(readonly value: T) {}
}

/**
 * Minimal doubly linked list: O(1) insert at the front, insert after a node,
 * unlink a node and read both ends. It is the half of an LRU cache a Map cannot
 * provide: an order that can be changed in O(1).
 */
export class DoublyLinkedList<T> {
  private head: ListNode<T> | null = null;
  private tail: ListNode<T> | null = null;
  private length = 0;

  get size(): number {
    return this.length;
  }

  get first(): ListNode<T> | null {
    return this.head;
  }

  get last(): ListNode<T> | null {
    return this.tail;
  }

  pushFront(node: ListNode<T>): void {
    node.prev = null;
    node.next = this.head;
    if (this.head) this.head.prev = node;
    else this.tail = node;
    this.head = node;
    this.length += 1;
  }

  insertAfter(anchor: ListNode<T>, node: ListNode<T>): void {
    node.prev = anchor;
    node.next = anchor.next;
    if (anchor.next) anchor.next.prev = node;
    else this.tail = node;
    anchor.next = node;
    this.length += 1;
  }

  remove(node: ListNode<T>): void {
    if (node.prev) node.prev.next = node.next;
    else this.head = node.next;
    if (node.next) node.next.prev = node.prev;
    else this.tail = node.prev;
    node.prev = null;
    node.next = null;
    this.length -= 1;
  }

  moveToFront(node: ListNode<T>): void {
    if (this.head === node) return;
    this.remove(node);
    this.pushFront(node);
  }

  clear(): void {
    this.head = null;
    this.tail = null;
    this.length = 0;
  }

  /** Nodes front to back, copied into an array so callers may unlink while iterating. */
  nodes(): ListNode<T>[] {
    const out: ListNode<T>[] = [];
    for (let node = this.head; node; node = node.next) out.push(node);
    return out;
  }
}
