const WebSocket = require("ws");

class WebSocketClient {
  constructor({ url, adapter }) {
    this.url = url;

    this.ws = null;

    this.adapter = adapter;
  }

  connect() {
    this.ws = new WebSocket(this.url);

    this.ws.on("open", () => {
      this.adapter.onOpen();
    });

    this.ws.on("message", (data) => {
      this.adapter.onMessage(data);
    });

    this.ws.on("close", () => {
      this.adapter.onClose();
    });

    this.ws.on("error", (error) => {
      this.adapter.onError(error);
    });

    this.ws.on("unexpected-response", (req, res) => {
      console.log("unexpected response");

      console.log(res.statusCode);
    });
  }

  send(payload) {
    if (this.ws.readyState !== 1) {
      return;
    }

    this.ws.send(JSON.stringify(payload));
  }
}

module.exports = WebSocketClient;
