const NormalizerInterface = require('../../core/normalizers/normalizer.interface');

class PragmaticNormalizer extends NormalizerInterface {

  normalize(message) {
    return {
      provider: 'pragmatic',
      success: !message.error,
      event: message.type || 'unknown',
      data: { raw: message },
      timestamp: Date.now()
    };
  }
}

module.exports = PragmaticNormalizer;