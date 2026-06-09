
import { LobbyTablePatch } from '../../domain/LobbyTablePatch';
import { SessionManager } from '../../infrastructure/inbound/websocket/session.manager';
import { RedisPubSubService } from '../../infrastructure/redis/redis-pubsub.service';
import { RedisStateRepository } from '../../infrastructure/redis/redis-state.repository';

export class LobbyStateManager {
  private currentLobbyState = new Map<string, LobbyTablePatch>();
  private readonly stateTimestamps = new Map<string, number>();
  private readonly STATE_TTL_MS = parseInt(process.env.STATE_TTL_MS || '3600000', 10);

  constructor(
    private sessionManager: SessionManager,
    private readonly redisRepo?: RedisStateRepository,
    private readonly redisPubSub?: RedisPubSubService,
  ) {
    this.startStaleCleanup();
  }

  public updateTableState(patch: LobbyTablePatch): void {
    if (patch.eventType === 'TABLE_CLOSED') {
      this.currentLobbyState.delete(patch.external_id);
      this.stateTimestamps.delete(patch.external_id);
      this.redisRepo?.deletePatch(patch.external_id, patch.idProveedor).catch(err =>
        console.error('[LobbyStateManager] Error eliminando de Redis:', err.message)
      );
    } else {
      this.currentLobbyState.set(patch.external_id, patch);
      this.stateTimestamps.set(patch.external_id, Date.now());
      this.redisRepo?.savePatch(patch).catch(err =>
        console.error('[LobbyStateManager] Error guardando en Redis:', err.message)
      );
    }

    if (this.redisPubSub) {
      this.redisPubSub.publish(patch);
    } else {
      this.fanOutDirect(patch);
    }
  }

  private fanOutDirect(patch: LobbyTablePatch): void {
    const targets = this.sessionManager.getSubscribedClientsByProvider(patch.idProveedor);
    if (targets.length === 0) return;
    const payloadString = JSON.stringify({ event: 'TABLE_UPDATE', data: patch });
    for (const client of targets) {
      if (client.ws.readyState === client.ws.OPEN) {
        client.ws.send(payloadString);
      }
    }
  }

  public async getSnapshotForProvider(providerId: number): Promise<LobbyTablePatch[]> {
    if (this.redisRepo) return this.redisRepo.getPatchesByProvider(providerId);
    return Array.from(this.currentLobbyState.values()).filter(p => p.idProveedor === providerId);
  }

  private startStaleCleanup(): void {
    setInterval(() => {
      const now = Date.now();
      let cleaned = 0;
      for (const [id, ts] of this.stateTimestamps) {
        if (now - ts > this.STATE_TTL_MS) {
          this.currentLobbyState.delete(id);
          this.stateTimestamps.delete(id);
          cleaned++;
        }
      }
      if (cleaned > 0) {
        console.log(`[LobbyStateManager] Limpieza: ${cleaned} entradas expiradas eliminadas.`);
      }
    }, 60_000);
  }
}