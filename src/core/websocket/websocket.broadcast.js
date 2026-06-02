class WebSocketBroadcast {

  constructor(clientManager) {

    this.clientManager = clientManager;
  }

  emit(event, payload) {

    const message = JSON.stringify({
      event,
      data: payload
    });

    this.clientManager.getClients().forEach((client) => {

      if(client.readyState === 1) {
        client.send(message);
      }
    });
  }
}

module.exports = WebSocketBroadcast;