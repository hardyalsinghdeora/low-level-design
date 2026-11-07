export enum Channel {
  EMAIL = 'EMAIL',
  SMS = 'SMS',
  PUSH = 'PUSH',
}

export enum Priority {
  NORMAL = 'NORMAL',
  /** One-time codes, security alerts: delivered even during quiet hours. */
  CRITICAL = 'CRITICAL',
}

/** A rendered, addressed message: everything a provider needs and nothing it should decide. */
export interface OutboundMessage {
  readonly notificationId: string;
  readonly channel: Channel;
  readonly to: string;
  readonly subject?: string;
  readonly body: string;
}

export interface ProviderReceipt {
  readonly providerMessageId: string;
}

/**
 * A delivery vendor for one channel (SES, Twilio, FCM). Implementations throw
 * ProviderError for retryable failures; the service owns retries.
 */
export interface NotificationProvider {
  readonly channel: Channel;
  send(message: OutboundMessage): ProviderReceipt;
}
