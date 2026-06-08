import { SubscriptionMessage } from '../models/subscription.model';

export interface ValidationResult {
  valid: boolean;
  reason?: string;
}

export interface ISubscriptionValidationStrategy {
  validate(data: unknown): ValidationResult & { parsed?: SubscriptionMessage };
}