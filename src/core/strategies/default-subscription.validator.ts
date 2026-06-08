import {
  ISubscriptionValidationStrategy,
  ValidationResult,
} from './subscription-validation.strategy';
import {
  SubscriptionMessage,
  VALID_PROVIDER_IDS,
  normalizeProviderTypes,
} from '../models/subscription.model';

export class DefaultSubscriptionValidator implements ISubscriptionValidationStrategy {

  validate(data: unknown): ValidationResult & { parsed?: SubscriptionMessage } {
    if (typeof data !== 'object' || data === null) {
      return { valid: false, reason: 'El mensaje debe ser un objeto JSON.' };
    }

    const msg = data as Record<string, unknown>;

    if (typeof msg.token !== 'string' || msg.token.trim() === '') {
      return { valid: false, reason: '"token" es requerido y debe ser un string no vacío.' };
    }

    const pt = msg.provider_type;
    const isValidSingle = typeof pt === 'number';
    const isValidArray  = Array.isArray(pt) && pt.length > 0 && pt.every(v => typeof v === 'number');

    if (!isValidSingle && !isValidArray) {
      return {
        valid: false,
        reason: '"provider_type" debe ser un número o un array de números.',
      };
    }

    const ids = normalizeProviderTypes(pt as number | number[]);
    const unknown = ids.filter(id => !(VALID_PROVIDER_IDS as readonly number[]).includes(id));

    if (unknown.length > 0) {
      return {
        valid: false,
        reason: `IDs de proveedor desconocidos: ${unknown.join(', ')}. Válidos: ${VALID_PROVIDER_IDS.join(', ')}.`,
      };
    }

    return {
      valid: true,
      parsed: {
        token: msg.token.trim(),
        provider_type: pt as number | number[],
      },
    };
  }
}