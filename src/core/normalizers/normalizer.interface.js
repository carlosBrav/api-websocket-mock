class NormalizerInterface {

  /**
   * Transforma el mensaje crudo del proveedor al formato interno.
   */
  normalize(message) {
    throw new Error('normalize() not implemented');
  }
}

module.exports = NormalizerInterface;