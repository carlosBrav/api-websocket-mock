const ProviderInterface = require("../../core/providers/provider.interface");

const WebSocketClient = require("../../core/websocket/websocket.client");

const config = require("./pragmatic.config");

class PragmaticAdapter extends ProviderInterface {
  constructor(broadcast, normalizer) {
    super();

    this.broadcast = broadcast;

    this.normalizer = normalizer;
    this.client = new WebSocketClient({url: config.websocketUrl,adapter:this});
  }

  connect() {
    console.log("[PRAGMATIC] initializing");

    this.client.connect();
  }

  onOpen() {
    console.log("[PRAGMATIC] connected");
    this.client.send(
      JSON.stringify({
        type: "subscribe",
        isDeltaEnabled: true,
        casinoId: config.casinoId,
        currency: config.currency,
        key: config.tableKeys,
      }),
    );
  }

  onMessage(rawData) {
    try {
      const parsed = JSON.parse(rawData);

      const normalized = this.normalizer.normalize(parsed);

      this.broadcast.emit("provider.message", normalized);
    } catch (error) {
      console.error("[PRAGMATIC] parse error", rawData, '- ', error);
    }
  }

  onClose() {
    console.log("[PRAGMATIC] disconnected");
  }

  onError(error) {
    console.error("[PRAGMATIC] error", error);
  }
}

module.exports = PragmaticAdapter;
