export enum LibraryEventType {
  HOLD_OFFERED = 'HOLD_OFFERED',
  HOLD_EXPIRED = 'HOLD_EXPIRED',
  CHARGE_ADDED = 'CHARGE_ADDED',
}

export interface LibraryEvent {
  readonly type: LibraryEventType;
  readonly memberId: string;
  readonly at: Date;
  readonly message: string;
}

/**
 * Observer: the library announces what happened to a member; how the member
 * hears about it (email, SMS, app push) is a subscriber's concern.
 */
export interface LibraryObserver {
  onLibraryEvent(event: LibraryEvent): void;
}

/** In-memory stand-in for an email or SMS gateway: keeps each member's messages. */
export class MemberInbox implements LibraryObserver {
  private readonly messages = new Map<string, LibraryEvent[]>();

  onLibraryEvent(event: LibraryEvent): void {
    const inbox = this.messages.get(event.memberId) ?? [];
    inbox.push(event);
    this.messages.set(event.memberId, inbox);
  }

  for(memberId: string): readonly LibraryEvent[] {
    return [...(this.messages.get(memberId) ?? [])];
  }
}
