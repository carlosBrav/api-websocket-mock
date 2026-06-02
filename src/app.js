require('dotenv').config(); 
const express = require('express');
const cors = require('cors');
const { createServer } = require('http');
const WebSocketServerManager = require('./core/websocket/websocket.server');
const WebSocketBroadcast = require('./core/websocket/websocket.broadcast');
const ProviderRegistry = require('./core/providers/provider.registry');
const ProviderManager = require('./core/providers/provider.manager');
//const EzugiAdapter = require('./providers/ezugi/ezugi.adapter');
const EvolutionAdapter = require('./providers/evolution/evolution.adapter')
const EvolutionNormalizer = require('./providers/evolution/evolution.normalizer')
const PragmaticAdapter = require('./providers/pragmatic/pragmatic.adapter')
const PlayTechAdapter = require('./providers/playtech/playtech.adapter')
const PragmaticNormalizer = require('./providers/pragmatic/pragmatic.normalizer')
const PlayTechNormalizer = require('./providers/playtech/playtech.normalizer')

const app = express();

app.use(cors({
  origin: '*',
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
  credentials: true
}));

app.use(express.json());

app.get('/api/hello', (req, res) => {
  res.json({
    mensaje: "probando servidor"
  });
});

const server = createServer(app);


const wsServer =
  new WebSocketServerManager(server);

wsServer.initialize();


const broadcaster =
  new WebSocketBroadcast(wsServer);


const registry =
  new ProviderRegistry();

registry.register(
  'evolution',
  new EvolutionAdapter(broadcaster,new EvolutionNormalizer())
);

registry.register(
  'pragmatic',
  new PragmaticAdapter(broadcaster, new PragmaticNormalizer())
);
registry.register(
  'playtech',
  new PlayTechAdapter(broadcaster, new PlayTechNormalizer())
)

const providerManager =
  new ProviderManager(registry);

providerManager.initialize();


server.listen(3000, () => {

  console.log('🚀 server ready');
});