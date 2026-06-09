import Redis from 'ioredis';

let instance: Redis | null = null;

export function createRedisClient(): Redis {
  if (instance) return instance;

  instance = new Redis({
    host:     process.env.REDIS_HOST     || '127.0.0.1',
    port:     parseInt(process.env.REDIS_PORT || '6379', 10),
    password: process.env.REDIS_PASSWORD || undefined,
    db:       parseInt(process.env.REDIS_DB   || '0', 10),
    lazyConnect: true,
    retryStrategy(times) {
      if (times > 10) {
        console.error('[Redis] Máximo de reintentos. Abandonando.');
        return null;
      }
      const delay = Math.min(500 * Math.pow(2, times), 30_000);
      console.warn(`[Redis] Reintentando en ${delay}ms (intento ${times})...`);
      return delay;
    },

    enableOfflineQueue: false,
    maxRetriesPerRequest: 1,
    connectTimeout: 5000,
  });

  instance.on('connect',      () => console.log('[Redis] Conexión establecida.'));
  instance.on('ready',        () => console.log('[Redis] Lista para comandos.'));
  instance.on('error',        (err) => console.error('[Redis] Error:', err.message));
  instance.on('close',        () => console.warn('[Redis] Conexión cerrada.'));
  instance.on('reconnecting', (ms: number) => console.log(`[Redis] Reconectando en ${ms}ms...`));
  instance.on('end',          () => console.error('[Redis] Conexión terminada definitivamente.'));

  return instance;
}

export function getRedisClient(): Redis | null {
  return instance;
}