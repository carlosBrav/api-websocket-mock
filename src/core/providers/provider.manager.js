class ProviderManager {

  constructor(registry) {

    this.registry = registry;
  }

  initialize() {

    this.registry.getAll().forEach((provider) => {

      provider.connect();
    });
  }
}

module.exports = ProviderManager;