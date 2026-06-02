const ProviderInterface = require('../../core/providers/provider.interface');

const WebSocketClient = require('../../core/websocket/websocket.client');

const config = require('./ezugi.config');

class EzugiAdapter extends ProviderInterface {

  constructor(broadcast, normalizer) {

    super();

    this.broadcast = broadcast;

    this.normalizer = normalizer;
    this.client = new WebSocketClient({url: config.websocketUrl,adapter: this});
  }

  connect() {

    console.log('[EZUGI] initializing');

    this.client.connect();
  }

  onOpen() {

    console.log('[EZUGI] connected');

    /**
     * AUTH SI ES NECESARIA
     */
  }

  onMessage(rawData) {

    try {

      const parsed = JSON.parse(rawData);

      const normalized =
        this.normalizer.normalize(parsed);

      this.broadcast.emit(
        'provider.message',
        normalized
      );

    } catch(error) {

      console.error('[EZUGI] parse error', error);
    }
  }

  onClose() {

    console.log('[EZUGI] disconnected');
  }

  onError(error) {

    console.error('[EZUGI] error', error);
  }
}

module.exports = EzugiAdapter;