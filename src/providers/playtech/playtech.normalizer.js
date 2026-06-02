const NormalizerInterface = require('../../core/normalizers/normalizer.interface');

class PlaytechNormalizer extends NormalizerInterface {

  normalize(message) {
    return {
      provider: 'playtech',
      success: !message.error,
      event: message.type || 'unknown',
      data: { raw: message },
      timestamp: Date.now()
    };
  }
}

module.exports = PlaytechNormalizer;