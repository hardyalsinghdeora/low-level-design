import { DomainError } from '../shared/errors';

export class PubSubError extends DomainError {}

export class TopicNotFoundError extends PubSubError {
  constructor(topic: string) {
    super(`Topic "${topic}" does not exist`);
  }
}

export class TopicAlreadyExistsError extends PubSubError {
  constructor(topic: string) {
    super(`Topic "${topic}" already exists`);
  }
}

export class SubscriptionExistsError extends PubSubError {
  constructor(topic: string, group: string) {
    super(`Group "${group}" on topic "${topic}" already exists`);
  }
}

export class DeliveryNotFoundError extends PubSubError {
  constructor(group: string, offset: number) {
    super(`Group "${group}" has no outstanding delivery for offset ${offset}`);
  }
}

export class InvalidDeliveryTransitionError extends PubSubError {
  constructor(offset: number, from: string, to: string) {
    super(`Delivery of offset ${offset} cannot go from ${from} to ${to}`);
  }
}

export class InvalidConfigurationError extends PubSubError {
  constructor(field: string, value: number) {
    super(`${field} must be a positive integer, got ${value}`);
  }
}

export function assertPositiveInteger(field: string, value: number): void {
  if (!Number.isInteger(value) || value <= 0) throw new InvalidConfigurationError(field, value);
}
