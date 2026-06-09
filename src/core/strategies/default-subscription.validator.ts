import {
  ISubscriptionValidationStrategy,
  ValidationResult,
} from './subscription-validation.strategy';
import {
  SubscriptionMessage,
  VALID_PROVIDER_IDS,
} from '../models/subscription.model';

const TOKEN_MIN_LENGTH = 20;
const TOKEN_FORMAT_REGEX = /^[a-zA-Z0-9.]{20,}$/;

export class DefaultSubscriptionValidator implements ISubscriptionValidationStrategy {

  validate(data: unknown): ValidationResult & { parsed?: SubscriptionMessage } {
    if (typeof data !== 'object' || data === null) {
      return { valid: false, reason: 'El mensaje debe ser un objeto JSON.' };
    }

    const msg = data as Record<string, unknown>;

    if (typeof msg.token !== 'string' || msg.token.trim() === '') {
      return { valid: false, reason: '"token" es requerido y debe ser un string no vacío.' };
    }

     if (msg.token.trim().length < TOKEN_MIN_LENGTH) {
      return {
        valid: false,
        reason: `"token" debe tener al menos ${TOKEN_MIN_LENGTH} caracteres.`,
      };
    }

    if (!TOKEN_FORMAT_REGEX.test(msg.token.trim())) {
      return {
        valid: false,
        reason: '"token" solo puede contener letras, números y el carácter punto (.).',
      };
    }

    const pt = msg.provider_type;

    if (!Array.isArray(pt)) {
      return {
        valid: false,
        reason: '"provider_type" debe ser un array de números. Ejemplo: [1] o [1, 2].',
      };
    }
    if (pt.length === 0) {
      return {
        valid: false,
        reason: '"provider_type" no puede ser un array vacío.',
      };
    }
    if (!pt.every((v) => typeof v === 'number')) {
      return {
        valid: false,
        reason: '"provider_type" debe contener solo valores numéricos.',
      };
    }
    const unknownIds = pt.filter(
      (id) => !(VALID_PROVIDER_IDS as readonly number[]).includes(id),
    );

    if (unknownIds.length > 0) {
      return {
        valid: false,
        reason: `IDs de proveedor desconocidos: ${unknownIds.join(', ')}. Válidos: ${VALID_PROVIDER_IDS.join(', ')}.`,
      };
    }

    return {
      valid: true,
      parsed: {
        token: msg.token.trim(),
        provider_type: pt as number[],
      },
    };
  }
}