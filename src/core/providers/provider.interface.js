class ProviderInterface {
  /**
   * Inicia la conexión al WebSocket del proveedor.
   * @returns {void}
   */
  connect() {
    throw new Error('connect() not implemented');
  }

  /**
   * Callback invocado cuando la conexión se establece.
   * Útil para enviar mensajes de autenticación o suscripción.
   * @returns {void}
   */
  onOpen() {
    throw new Error('onOpen() not implemented');
  }

  /**
   * Callback invocado cuando llega un mensaje crudo del proveedor.
   * Debe parsear, normalizar y emitir via this.broadcast.
   * @param {string} rawData - mensaje crudo en string/JSON
   * @returns {void}
   */
  onMessage(rawData) {
    throw new Error('onMessage() not implemented');
  }

  /**
   * Callback invocado cuando la conexión se cierra.
   * @returns {void}
   */
  onClose() {
    throw new Error('onClose() not implemented');
  }

  /**
   * Callback invocado cuando ocurre un error en la conexión.
   * @param {Error} error
   * @returns {void}
   */
  onError(error) {
    throw new Error('onError() not implemented');
  }
}

module.exports = ProviderInterface;