import Redis from 'ioredis';
import { LobbyTablePatch } from '../../domain/LobbyTablePatch';

const CHANNEL_PREFIX = process.env.REDIS_CHANNEL_PREFIX || 'lobby:realtime';

export function buildProviderChannel(providerId: number): string {
  return `${CHANNEL_PREFIX}:${providerId}`;
}

export class RedisPubSubService {
  private subscribedChannels: string[] = [];
  private isPaused = false;

  constructor(
    private readonly publisher: Redis,
    private readonly subscriber: Redis,
  ) {}

  // Fire-and-forget: no await, no bloquea el Event Loop
  public publish(patch: LobbyTablePatch): void {
    const channel = buildProviderChannel(patch.idProveedor);
    const message = JSON.stringify({ event: 'TABLE_UPDATE', data: patch });
    this.publisher.publish(channel, message).catch(err =>
      console.error(`[RedisPubSub] Error publicando en ${channel}:`, err.message)
    );
  }

  public async subscribeToProviders(
    providerIds: number[],
    onMessage: (providerId: number, raw: string) => void,
  ): Promise<void> {
    this.subscribedChannels = providerIds.map(buildProviderChannel);
    await this.subscriber.subscribe(...this.subscribedChannels);
    console.log(`[RedisPubSub] Suscrito a: ${this.subscribedChannels.join(', ')}`);

    this.subscriber.on('message', (channel: string, message: string) => {
      const parts = channel.split(':');
      const providerId = parseInt(parts[parts.length - 1], 10);
      if (!isNaN(providerId)) onMessage(providerId, message);
    });
  }

  public async pause(): Promise<void> {
    if (this.isPaused || this.subscribedChannels.length === 0) return;
    await this.subscriber.unsubscribe(...this.subscribedChannels);
    this.isPaused = true;
    console.log('[RedisPubSub] Suscripción pausada — sin clientes activos.');
  }

  public async resume(): Promise<void> {
    if (!this.isPaused || this.subscribedChannels.length === 0) return;
    await this.subscriber.subscribe(...this.subscribedChannels);
    this.isPaused = false;
    console.log('[RedisPubSub] Suscripción reanudada — clientes conectados.');
  }
}