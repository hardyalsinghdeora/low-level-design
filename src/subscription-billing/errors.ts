import { DomainError } from '../shared/errors';

export class BillingError extends DomainError {}

export class InvalidPlanError extends BillingError {}

export class PlanNotFoundError extends BillingError {
  constructor(planId: string) {
    super(`No plan ${planId}`);
  }
}

export class SubscriptionNotFoundError extends BillingError {
  constructor(subscriptionId: string) {
    super(`No subscription ${subscriptionId}`);
  }
}

export class InvalidSubscriptionTransitionError extends BillingError {
  constructor(subscriptionId: string, from: string, to: string) {
    super(`Subscription ${subscriptionId} cannot go from ${from} to ${to}`);
  }
}

export class InvalidInvoiceTransitionError extends BillingError {
  constructor(invoiceId: string, from: string, to: string) {
    super(`Invoice ${invoiceId} cannot go from ${from} to ${to}`);
  }
}

/** A finalized invoice is a legal document: its lines and total cannot change. */
export class InvoiceLockedError extends BillingError {
  constructor(invoiceId: string) {
    super(`Invoice ${invoiceId} is finalized; issue a new invoice or a credit instead`);
  }
}

export class InvalidPlanChangeError extends BillingError {}
