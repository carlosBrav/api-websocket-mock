import Redis from 'ioredis';
import { LobbyTablePatch } from '../../domain/LobbyTablePatch';

const KEY_PREFIX = 'lobby:table:';
const DEFAULT_TTL = parseInt(process.env.REDIS_KEY_TTL || '86400', 10);

export class RedisStateRepository {
  constructor(private readonly redis: Redis) {}

  private buildKey(patch: LobbyTablePatch): string {
    return `${KEY_PREFIX}${patch.idProveedor}:${patch.external_id}`;
  }

  public async savePatch(patch: LobbyTablePatch): Promise<void> {
    try {
      // SET key value EX ttl — un solo round-trip (antes era HSET + EXPIRE = 2)
      await this.redis.set(this.buildKey(patch), JSON.stringify(patch), 'EX', DEFAULT_TTL);
    } catch (err: any) {
      console.error(`[RedisStateRepo] Error guardando ${patch.external_id}:`, err.message);
    }
  }

  public async getPatch(externalId: string, providerId: number): Promise<LobbyTablePatch | null> {
    try {
      const raw = await this.redis.get(`${KEY_PREFIX}${providerId}:${externalId}`);
      return raw ? JSON.parse(raw) as LobbyTablePatch : null;
    } catch (err: any) {
      console.error(`[RedisStateRepo] Error leyendo ${externalId}:`, err.message);
      return null;
    }
  }

  public async getPatchesByProvider(providerId: number): Promise<LobbyTablePatch[]> {
    const patches: LobbyTablePatch[] = [];
    let cursor = '0';
    try {
      do {
        const [nextCursor, keys] = await this.redis.scan(
          cursor, 'MATCH', `${KEY_PREFIX}${providerId}:*`, 'COUNT', 100,
        );
        cursor = nextCursor;
        if (keys.length === 0) continue;

        const pipeline = this.redis.pipeline();
        for (const key of keys) pipeline.get(key); // GET (no HGET)
        const results = await pipeline.exec();
        if (!results) continue;

        for (const [err, raw] of results) {
          if (err || !raw) continue;
          try { patches.push(JSON.parse(raw as string) as LobbyTablePatch); }
          catch { /* entrada corrupta — ignorar */ }
        }
      } while (cursor !== '0');
    } catch (err: any) {
      console.error(`[RedisStateRepo] Error en scan proveedor ${providerId}:`, err.message);
    }
    return patches;
  }

  public async deletePatch(externalId: string, providerId: number): Promise<void> {
    try {
      await this.redis.del(`${KEY_PREFIX}${providerId}:${externalId}`);
    } catch (err: any) {
      console.error(`[RedisStateRepo] Error eliminando ${externalId}:`, err.message);
    }
  }
}