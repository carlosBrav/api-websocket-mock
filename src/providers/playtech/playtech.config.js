const env = require('../../config/env');

module.exports = {
  providerName: 'playtech',
  websocketUrl: env.playtech.websocketUrl,
  token:        env.playtech.token,
};