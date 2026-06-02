const ProviderInterface = require('../../core/providers/provider.interface');

const WebSocketClient = require('../../core/websocket/websocket.client');

const config = require('./evolution.config');

class EvolutionAdapter extends ProviderInterface {

  constructor(broadcast, normalizer) {

    super();

    this.broadcast = broadcast;

    this.normalizer = normalizer;
    this.client = new WebSocketClient({url: config.websocketUrl,adapter: this});
  }

  connect() {

    console.log('[EVOLUTION] initializing');

    this.client.connect();
  }

  onOpen() {

    console.log('[EVOLUTION] connected');

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

      console.error('[EVOLUTION] parse error', error);
    }
  }

  onClose() {

    console.log('[EVOLUTION] disconnected');
  }

  onError(error) {

    console.error('[EVOLUTION] error', error);
  }
}

module.exports = EvolutionAdapter;