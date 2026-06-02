class ProviderRegistry {

  constructor() {

    this.providers = new Map();
  }

  register(name, provider) {

    this.providers.set(name, provider);
  }

  get(name) {

    return this.providers.get(name);
  }

  getAll() {

    return [...this.providers.values()];
  }
}

module.exports = ProviderRegistry;