const NormalizerInterface = require('../../core/normalizers/normalizer.interface');

class EzugiNormalizer extends NormalizerInterface {

  normalize(message) {
    return {
      provider: 'ezugi',
      success: !message.error,
      event: message.type || 'unknown',
      data: { raw: message },
      timestamp: Date.now()
    };
  }
}

module.exports = EzugiNormalizer;