const ProviderInterface = require("../../core/providers/provider.interface");

const WebSocketClient = require("../../core/websocket/websocket.client");

const config = require("./playtech.config");

class PlaytechAdapter extends ProviderInterface {
  constructor(broadcast,normalizer) {
    super();

    this.broadcast = broadcast;

    this.normalizer = normalizer;
    this.client = new WebSocketClient(
      {
        url: config.websocketUrl,

        headers: {
          Authorization: `Bearer ${config.token}`,
        },
        adapter:this,
      },
    );
  }

  connect() {
    console.log("[PLAYTECH] initializing");

    this.client.connect();
  }

  onOpen() {
    console.log("[PLAYTECH] connected");
  }

  onMessage(rawData) {
    try {
      const parsed = JSON.parse(rawData);

      const normalized = this.normalizer.normalize(parsed);

      this.broadcast.emit("provider.message", normalized);
    } catch (error) {
      console.error("[PLAYTECH] parse error", error);
    }
  }

  onClose() {
    console.log("[PLAYTECH] disconnected");
  }

  onError(error) {
    console.error("[PLAYTECH] error", error);
  }
}

module.exports = PlaytechAdapter;
