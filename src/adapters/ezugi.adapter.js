const WebSocket = require('ws');

class EzugiAdapter {

  constructor(onMessageCallback) {

    this.providerName = 'ezugi';

    this.ws = null;

    this.onMessageCallback = onMessageCallback;
    this.url = 'wss://boint.tableslive.com/office.php?action=documentation&sub_act=websocket_api&path=1_websocket%E2%80%A6';

    this.reconnectDelay = 5000;
  }

  connect() {

    console.log('[EZUGI] connecting...');

    this.ws = new WebSocket(this.url);

    this.ws.on('open', () => {

      console.log('[EZUGI] connected');

      this.authenticate();
    });

    this.ws.on('message', (rawData) => {

      try {

        const parsed = JSON.parse(rawData);

        const normalized = this.normalize(parsed);
        this.onMessageCallback(normalized);

      } catch(error) {

        console.error('[EZUGI] parse error', error);
      }
    });

    this.ws.on('close', () => {

      console.log('[EZUGI] disconnected');

      this.reconnect();
    });

    this.ws.on('error', (error) => {

      console.error('[EZUGI] error', error);
    });
  }

  authenticate() {

    const payload = {
      type: 'login',
      username: 'ACP',
      password: 'Welcome2027!'
    };

    this.ws.send(JSON.stringify(payload));
  }

  normalize(message) {

    return {
      provider: this.providerName,
      success: !message.error,
      event: message.type || 'unknown-event',
      data: {
        raw: message
      },
      timestamp: Date.now()
    };
  }

  reconnect() {

    console.log(`[EZUGI] reconnecting in ${this.reconnectDelay}ms`);

    setTimeout(() => {
      this.connect();
    }, this.reconnectDelay);
  }
}

module.exports = EzugiAdapter;