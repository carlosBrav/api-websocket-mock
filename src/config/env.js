
module.exports = {
  port: process.env.PORT || 3000,

  evolution: {
    websocketUrl: process.env.EVOLUTION_WS_URL,
  },

  ezugi: {
    websocketUrl: process.env.EZUGI_WS_URL,
    credentials: {
      username: process.env.EZUGI_USERNAME,
      password: process.env.EZUGI_PASSWORD,
    },
  },

  playtech: {
    websocketUrl: process.env.PLAYTECH_WS_URL,
    token:        process.env.PLAYTECH_TOKEN,
  },

  pragmatic: {
    websocketUrl: process.env.PRAGMATIC_WS_URL,
    casinoId:     process.env.PRAGMATIC_CASINO_ID,
    currency:     process.env.PRAGMATIC_CURRENCY,
  },
};