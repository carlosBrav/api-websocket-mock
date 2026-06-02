const NormalizerInterface = require('../../core/normalizers/normalizer.interface');

class EvolutionNormalizer extends NormalizerInterface {

  normalize(message) {
    return {
      provider: 'evolution',
      success: !message.error,
      event: message.type || 'unknown',
      data: { raw: message },
      timestamp: Date.now()
    };
  }
}

module.exports = EvolutionNormalizer;