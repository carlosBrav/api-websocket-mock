const { WebSocketServer } = require('ws');

class WebSocketServerManager {

  constructor(server) {

    this.wss = new WebSocketServer({ server });

    this.clients = new Set();
  }

  initialize() {

    this.wss.on('connection', (ws) => {

      this.clients.add(ws);

      console.log('frontend connected');

      ws.on('close', () => {

        this.clients.delete(ws);

        console.log('frontend disconnected');
      });
    });
  }

  getClients() {
    return this.clients;
  }
}

module.exports = WebSocketServerManager;