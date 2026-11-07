export enum NotificationType {
  FRIEND_REQUEST_RECEIVED = 'FRIEND_REQUEST_RECEIVED',
  FRIEND_REQUEST_ACCEPTED = 'FRIEND_REQUEST_ACCEPTED',
  POST_LIKED = 'POST_LIKED',
  POST_COMMENTED = 'POST_COMMENTED',
}

export interface Notification {
  id: string;
  type: NotificationType;
  recipientId: string;
  actorId: string;
  /** The friend request or post the notification is about. */
  subjectId: string;
  createdAt: Date;
}

/** Observer: an in-app inbox, a push sender and an e-mail digest are all just listeners. */
export interface NotificationListener {
  onNotification(notification: Notification): void;
}

/** Subject side of the Observer. The network publishes here and never knows who listens. */
export class NotificationCenter {
  private readonly listeners = new Set<NotificationListener>();

  /** Returns an unsubscribe function. */
  subscribe(listener: NotificationListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  publish(notification: Notification): void {
    for (const listener of this.listeners) listener.onNotification(notification);
  }
}

/** The in-app notification list: one list per recipient, newest first when read. */
export class NotificationInbox implements NotificationListener {
  private readonly byRecipient = new Map<string, Notification[]>();

  onNotification(notification: Notification): void {
    const list = this.byRecipient.get(notification.recipientId) ?? [];
    list.push(notification);
    this.byRecipient.set(notification.recipientId, list);
  }

  for(userId: string): Notification[] {
    return [...(this.byRecipient.get(userId) ?? [])].reverse();
  }
}
