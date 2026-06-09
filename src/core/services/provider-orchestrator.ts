import { RedisPubSubService } from '../../infrastructure/redis/redis-pubsub.service';
import { IProviderConnector } from '../../providers/connectors/base.connector';

const IDLE_TIMEOUT_MS = parseInt(process.env.PROVIDER_IDLE_TIMEOUT_MS || '60000', 10); // 1 min

export class ProviderOrchestrator {
  private activeClientCount = 0;
  private idleTimer: NodeJS.Timeout | null = null;
  private isRunning = false;

  constructor(
    private readonly connectors: IProviderConnector[],
    private readonly redisPubSub?: RedisPubSubService,
  ) {}

  public onClientConnected(): void {
    this.activeClientCount++;
    this.cancelIdleTimer();
    if (!this.isRunning) {
      console.log('[Orchestrator] Primer cliente. Iniciando proveedores...');
      this.startAll();
    }
  }

  public onClientDisconnected(): void {
    this.activeClientCount = Math.max(0, this.activeClientCount - 1);
    if (this.activeClientCount === 0) {
      console.log(`[Orchestrator] Sin clientes. Pausando en ${IDLE_TIMEOUT_MS / 1000}s...`);
      this.scheduleIdleShutdown();
    }
  }

  public isProvidersRunning(): boolean { return this.isRunning; }
  public getActiveClientCount(): number { return this.activeClientCount; }

  private async startAll(): Promise<void> {
    this.isRunning = true;
    await this.redisPubSub?.resume();
    for (const c of this.connectors) {
      await c.start().catch(err =>
        console.error(`[Orchestrator] Error iniciando "${c.name}":`, err.message)
      );
    }
  }

  private async disposeAll(): Promise<void> {
    this.isRunning = false;
    await this.redisPubSub?.pause();
    for (const c of this.connectors) {
      await c.dispose().catch(err =>
        console.error(`[Orchestrator] Error desconectando "${c.name}":`, err.message)
      );
    }
  }

  private scheduleIdleShutdown(): void {
    this.idleTimer = setTimeout(async () => {
      if (this.activeClientCount === 0) {
        console.warn('[Orchestrator] Timeout de inactividad. Desconectando proveedores...');
        await this.disposeAll();
      }
    }, IDLE_TIMEOUT_MS);
  }

  private cancelIdleTimer(): void {
    if (this.idleTimer) { clearTimeout(this.idleTimer); this.idleTimer = null; }
  }
}