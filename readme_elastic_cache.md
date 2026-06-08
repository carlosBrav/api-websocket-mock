# Integración ElastiCache (Redis Pub/Sub)

## Objetivo

Desacoplar el pipeline de datos de los proveedores del pipeline de entrega al frontend.

**Antes:**
```
Proveedor WSS → Connector → Adapter → LobbyStateManager → ws.send() al cliente
```

**Después:**
```
Proveedor WSS → Connector → Adapter → Redis PUBLISH (canal por proveedor)
                                              ↓
                              Redis SUBSCRIBE → FanOutWorker → ws.send() al cliente
```

El `LobbyStateManager` deja de enviar directamente al WebSocket. Su única responsabilidad pasa a ser publicar en Redis. El `FanOutWorker` es quien escucha Redis y despacha a los clientes suscritos. Esto permite:

- Escalar los workers de ingesta independientemente de los de entrega
- Agregar múltiples instancias del BFF detrás de un load balancer (cada una suscribe a Redis)
- Persistir el último estado de cada mesa en Redis para entregarlo al conectarse un nuevo cliente (snapshot on-connect)

---

## Arquitectura

```
┌─────────────────────────────────────────────────────────┐
│                    INGESTA (Producers)                   │
│                                                         │
│  EvolutionConnector ──► EvolutionAdapter                │
│  EzugiConnector     ──► EzugiAdapter      ──► PUBLISH   │
│  PragmaticConnector ──► PragmaticAdapter      lobby:1   │
│  PlaytechConnector  ──► PlaytechAdapter       lobby:2   │
│                                               lobby:3   │
│                                               lobby:4   │
└────────────────────────────────┬────────────────────────┘
                                 │ Redis ElastiCache
                         ┌───────▼────────┐
                         │  Redis Pub/Sub  │
                         │  + Hash store   │
                         │  lobby:state:{  │
                         │    external_id} │
                         └───────┬────────┘
                                 │
┌────────────────────────────────▼────────────────────────┐
│                    ENTREGA (Consumer)                    │
│                                                         │
│  FanOutWorker ──SUBSCRIBE lobby:1,2,3,4──► SessionMgr   │
│                                           ws.send()     │
└─────────────────────────────────────────────────────────┘
```

### Canales Redis por proveedor

| Canal | Proveedor |
|-------|-----------|
| `lobby:1` | Ezugi |
| `lobby:2` | Evolution Gaming |
| `lobby:3` | Pragmatic Play |
| `lobby:4` | Playtech |

### Clave de estado (snapshot)

```
lobby:state:{external_id}  →  JSON serializado de LobbyTablePatch
```

---

## Archivos a crear / modificar

```
src/
├── pubsub/
│   ├── redis.client.ts          ← Singleton de conexión a Redis (ioredis)
│   ├── publisher.service.ts     ← Publica LobbyTablePatch en Redis
│   └── fanout.worker.ts         ← Suscribe a Redis y despacha a clientes WS
├── core/services/
│   └── lobby-state.manager.ts   ← MODIFICAR: delega a PublisherService
└── index.ts                     ← MODIFICAR: inicializar RedisClient y FanOutWorker
```

---

## Implementación

### 1. Instalar dependencia

```bash
npm install ioredis
npm install --save-dev @types/ioredis
```

> `ioredis` tiene soporte nativo para reconexión automática, Cluster mode y TLS — necesario para AWS ElastiCache.

---

### 2. `src/pubsub/redis.client.ts`

Singleton con dos conexiones separadas: una para PUBLISH y otra para SUBSCRIBE (Redis no permite usar la misma conexión para ambas operaciones simultáneamente).

```typescript
import Redis from 'ioredis';

const redisConfig = {
  host:           process.env.REDIS_HOST || '127.0.0.1',
  port:           parseInt(process.env.REDIS_PORT || '6379', 10),
  password:       process.env.REDIS_PASSWORD || undefined,
  tls:            process.env.REDIS_TLS === 'true' ? {} : undefined,
  // ElastiCache en cluster mode — descomentar si aplica:
  // enableReadyCheck: false,
  // maxRetriesPerRequest: null,
  retryStrategy: (times: number) => Math.min(times * 200, 5000),
  lazyConnect: true,
};

// Conexión dedicada para PUBLISH y operaciones de lectura/escritura (GET/SET/HSET)
export const redisPublisher = new Redis(redisConfig);

// Conexión dedicada exclusivamente para SUBSCRIBE
// Una vez suscrita, esta conexión solo puede recibir mensajes
export const redisSubscriber = new Redis(redisConfig);

redisPublisher.on('connect',   () => console.log('[Redis] Publisher conectado'));
redisPublisher.on('error',     (e) => console.error('[Redis] Publisher error:', e.message));
redisSubscriber.on('connect',  () => console.log('[Redis] Subscriber conectado'));
redisSubscriber.on('error',    (e) => console.error('[Redis] Subscriber error:', e.message));

export async function connectRedis(): Promise<void> {
  await Promise.all([
    redisPublisher.connect(),
    redisSubscriber.connect(),
  ]);
}
```

---

### 3. `src/pubsub/publisher.service.ts`

Se encarga de:
- Publicar el patch en el canal del proveedor correspondiente (Pub/Sub)
- Guardar el último estado de la mesa en un Hash de Redis (para snapshot on-connect)

```typescript
import { LobbyTablePatch } from '../domain/LobbyTablePatch';
import { redisPublisher } from './redis.client';

// Canales por idProveedor — deben coincidir con los que escucha FanOutWorker
const PROVIDER_CHANNELS: Record<number, string> = {
  1: 'lobby:1', // Ezugi
  2: 'lobby:2', // Evolution
  3: 'lobby:3', // Pragmatic
  4: 'lobby:4', // Playtech
};

// TTL del estado de cada mesa en Redis (segundos)
// Si un proveedor deja de emitir, los datos expiran solos
const STATE_TTL_SECONDS = 300; // 5 minutos

export class PublisherService {

  /**
   * Publica el patch normalizado en Redis.
   * Operación fire-and-forget: no bloquea el pipeline de ingesta.
   */
  public publish(patch: LobbyTablePatch): void {
    const channel = PROVIDER_CHANNELS[patch.idProveedor];
    if (!channel) {
      console.warn(`[Publisher] idProveedor desconocido: ${patch.idProveedor}`);
      return;
    }

    const payload = JSON.stringify(patch);

    // Publicar en el canal Pub/Sub (notificación en tiempo real)
    redisPublisher.publish(channel, payload).catch((err) => {
      console.error(`[Publisher] Error publicando en ${channel}:`, err.message);
    });

    // Persistir último estado para snapshot on-connect
    // EX = expiración en segundos
    redisPublisher
      .set(`lobby:state:${patch.external_id}`, payload, 'EX', STATE_TTL_SECONDS)
      .catch((err) => {
        console.error(`[Publisher] Error guardando estado en Redis:`, err.message);
      });
  }
}
```

---

### 4. `src/pubsub/fanout.worker.ts`

Suscribe a todos los canales de proveedores. Cuando llega un mensaje, lo despacha solo a los clientes WebSocket suscritos a ese proveedor. También provee el método `sendSnapshot` para entregar el estado actual al conectarse un nuevo cliente.

```typescript
import { redisSubscriber, redisPublisher } from './redis.client';
import { SessionManager } from '../infrastructure/inbound/websocket/session.manager';
import { LobbyTablePatch } from '../domain/LobbyTablePatch';

// Mapa inverso: canal Redis → idProveedor
const CHANNEL_TO_PROVIDER: Record<string, number> = {
  'lobby:1': 1,
  'lobby:2': 2,
  'lobby:3': 3,
  'lobby:4': 4,
};

const ALL_CHANNELS = Object.keys(CHANNEL_TO_PROVIDER);

export class FanOutWorker {

  constructor(private sessionManager: SessionManager) {}

  /**
   * Inicia la suscripción a todos los canales de proveedores.
   * Debe llamarse una vez al arrancar el servidor.
   */
  public start(): void {
    redisSubscriber.subscribe(...ALL_CHANNELS, (err, count) => {
      if (err) {
        console.error('[FanOut] Error al suscribirse a canales Redis:', err.message);
        return;
      }
      console.log(`[FanOut] Suscrito a ${count} canales Redis: ${ALL_CHANNELS.join(', ')}`);
    });

    redisSubscriber.on('message', (channel: string, payload: string) => {
      this.dispatch(channel, payload);
    });
  }

  /**
   * Despacha el mensaje a los clientes WebSocket suscritos al proveedor.
   * Ejecuta el fan-out en un microtask para no bloquear el event loop de Redis.
   */
  private dispatch(channel: string, payload: string): void {
    const providerId = CHANNEL_TO_PROVIDER[channel];
    if (!providerId) return;

    const targets = this.sessionManager.getSubscribedClientsByProvider(providerId);
    if (targets.length === 0) return;

    // Construir el frame una sola vez y reutilizarlo para todos los clientes
    let patch: LobbyTablePatch;
    try {
      patch = JSON.parse(payload);
    } catch {
      console.error('[FanOut] Payload inválido recibido desde Redis:', payload.slice(0, 100));
      return;
    }

    const frame = JSON.stringify({ event: 'TABLE_UPDATE', data: patch });

    // setImmediate cede el control al event loop entre cada cliente
    // evitando que un fan-out grande bloquee las nuevas conexiones entrantes
    setImmediate(() => {
      for (const client of targets) {
        if (client.ws.readyState === client.ws.OPEN) {
          client.ws.send(frame);
        }
      }
    });
  }

  /**
   * Envía el snapshot del estado actual de todas las mesas al nuevo cliente.
   * Se llama al activar la suscripción de un cliente para que reciba datos
   * inmediatamente sin esperar el siguiente evento del proveedor.
   */
  public async sendSnapshot(clientId: string, providerIds: number[]): Promise<void> {
    const providerPrefixes = providerIds.map((id) => {
      const channelMap: Record<number, string> = {
        1: 'ezugi',
        2: 'evolution',
        3: 'pragmatic',
        4: 'playtech',
      };
      return channelMap[id];
    }).filter(Boolean);

    // Buscar todas las claves de estado para los proveedores solicitados
    // En producción con muchas mesas, usar SCAN en lugar de KEYS para no bloquear Redis
    const keyPromises = providerPrefixes.map((prefix) =>
      redisPublisher.keys(`lobby:state:${prefix}_*`)
    );

    const keyGroups = await Promise.all(keyPromises);
    const allKeys = keyGroups.flat();

    if (allKeys.length === 0) return;

    const values = await redisPublisher.mget(...allKeys);
    const session = this.sessionManager['sessions'].get(clientId);
    if (!session || session.ws.readyState !== session.ws.OPEN) return;

    for (const value of values) {
      if (value) {
        session.ws.send(JSON.stringify({ event: 'TABLE_UPDATE', data: JSON.parse(value) }));
      }
    }

    console.log(`[FanOut] Snapshot enviado a cliente ${clientId}: ${allKeys.length} mesas`);
  }
}
```

---

### 5. Modificar `src/core/services/lobby-state.manager.ts`

Reemplazar el envío directo por WebSocket con una publicación en Redis. El `LobbyStateManager` ya no conoce al `SessionManager`.

```typescript
import { LobbyTablePatch } from '../../domain/LobbyTablePatch';
import { PublisherService } from '../../pubsub/publisher.service';

export class LobbyStateManager {

  constructor(private publisher: PublisherService) {}

  public updateTableState(patch: LobbyTablePatch): void {
    // Delega al canal Pub/Sub — desacoplado del WebSocket
    this.publisher.publish(patch);
  }
}
```

---

### 6. Modificar `src/index.ts`

Conectar Redis al arrancar, pasar el `PublisherService` al `LobbyStateManager`, iniciar el `FanOutWorker` e inyectarlo en el `LobbyGateway` para el snapshot on-connect.

```typescript
import dotenv from 'dotenv';
dotenv.config();

import express from 'express';
import { createServer } from 'http';
import { connectRedis } from './pubsub/redis.client';
import { PublisherService } from './pubsub/publisher.service';
import { FanOutWorker } from './pubsub/fanout.worker';
import { SessionManager } from './infrastructure/inbound/websocket/session.manager';
import { LobbyStateManager } from './core/services/lobby-state.manager';
import { LobbyGateway } from './infrastructure/inbound/websocket/lobby.gateway';
import { EvolutionConnector } from './providers/connectors/evolution.connector';
import { PragmaticConnector } from './providers/connectors/pragmatic.connector';
import { PlaytechConnector } from './providers/connectors/playtech.connector';
import { EzugiConnector } from './providers/connectors/ezugi.connector';
import { EvolutionAdapter } from './providers/adapters/evolution.adapter';
import { PragmaticAdapter } from './providers/adapters/pragmatic.adapter';
import { PlaytechAdapter } from './providers/adapters/playtech.adapter';
import { EzugiAdapter } from './providers/adapters/ezugi.adapter';
import { DefaultSubscriptionValidator } from './core/strategies/default-subscription.validator';

const PORT = parseInt(process.env.WS_PORT || '3000', 10);

async function bootstrap() {
  console.log('Iniciando api-mesas-vivos-bff...\n');

  // 1. Conectar a Redis antes de arrancar cualquier otra cosa
  await connectRedis();

  const app = express();
  const httpServer = createServer(app);

  // 2. Construir el pipeline pub/sub
  const publisher        = new PublisherService();
  const sessionManager   = new SessionManager();
  const fanOutWorker     = new FanOutWorker(sessionManager);
  const lobbyStateManager = new LobbyStateManager(publisher);  // ya no recibe SessionManager
  const validator        = new DefaultSubscriptionValidator();
  const gateway          = new LobbyGateway(sessionManager, validator, fanOutWorker);

  // 3. Iniciar el worker que escucha Redis y despacha a clientes WS
  fanOutWorker.start();

  httpServer.on('upgrade', (request, socket, head) => {
    gateway.handleUpgrade(request, socket as any, head);
  });

  // 4. Arrancar proveedores
  startEvolution(lobbyStateManager, new EvolutionAdapter());
  startEzugi(lobbyStateManager, new EzugiAdapter());
  startPragmatic(lobbyStateManager, new PragmaticAdapter());
  startPlaytech(lobbyStateManager, new PlaytechAdapter());

  httpServer.listen(PORT, () => {
    console.log(`[BFF] WebSocket disponible en ws://localhost:${PORT}`);
  });
}

function startEvolution(manager: LobbyStateManager, adapter: EvolutionAdapter): void {
  try {
    const connector = new EvolutionConnector((raw) => {
      const patch = adapter.normalize(raw);
      if (patch) manager.updateTableState(patch);
    });
    connector.connectStreaming();
  } catch (err: any) {
    console.error('[Evolution] No se pudo iniciar:', err.message);
  }
}

function startEzugi(manager: LobbyStateManager, adapter: EzugiAdapter): void {
  try {
    const connector = new EzugiConnector((raw) => {
      const patch = adapter.normalize(raw);
      if (patch) manager.updateTableState(patch);
    });
    connector.connectStreaming();
  } catch (err: any) {
    console.error('[Ezugi] No se pudo iniciar:', err.message);
  }
}

function startPragmatic(manager: LobbyStateManager, adapter: PragmaticAdapter): void {
  try {
    const connector = new PragmaticConnector((raw) => {
      const patch = adapter.normalize(raw);
      if (patch) manager.updateTableState(patch);
    });
    connector.connect();
  } catch (err: any) {
    console.error('[Pragmatic] No se pudo iniciar:', err.message);
  }
}

function startPlaytech(manager: LobbyStateManager, adapter: PlaytechAdapter): void {
  try {
    const connector = new PlaytechConnector((raw) => {
      const patch = adapter.normalize(raw);
      if (patch) manager.updateTableState(patch);
    });
    connector.fetchInitialState().then(({ fatalError }) => {
      if (fatalError) return;
      connector.connectKafkaStreaming();
    });
  } catch (err: any) {
    console.error('[Playtech] No se pudo iniciar:', err.message);
  }
}

bootstrap();
```

---

### 7. Modificar `src/infrastructure/inbound/websocket/lobby.gateway.ts`

Inyectar el `FanOutWorker` para enviar el snapshot al cliente al activar su suscripción.

```typescript
import { WebSocketServer, WebSocket as WSClient } from 'ws';
import { SessionManager } from './session.manager';
import { FanOutWorker } from '../../../pubsub/fanout.worker';
import crypto from 'crypto';
import { IncomingMessage } from 'http';
import { Socket } from 'net';
import { ISubscriptionValidationStrategy } from '../../../core/strategies/subscription-validation.strategy';
import { normalizeProviderTypes } from '../../../core/models/subscription.model';

export class LobbyGateway {
  private wss: WebSocketServer;

  constructor(
    private sessionManager: SessionManager,
    private validator: ISubscriptionValidationStrategy,
    private fanOutWorker: FanOutWorker,   // ← nuevo
  ) {
    this.wss = new WebSocketServer({ noServer: true });
    this.init();
  }

  public handleUpgrade(request: IncomingMessage, socket: Socket, head: Buffer): void {
    this.wss.handleUpgrade(request, socket, head, (ws) => {
      this.wss.emit('connection', ws, request);
    });
  }

  private init(): void {
    console.log('[Gateway] WebSocket listo');

    this.wss.on('connection', (ws: WSClient) => {
      const clientId = crypto.randomUUID();
      this.sessionManager.addSession(clientId, ws);
      console.log(`[Gateway] Nuevo cliente: ${clientId}`);

      let subscribed = false;

      ws.on('message', (raw: Buffer | string) => {
        if (subscribed) return;

        try {
          const parsed = JSON.parse(raw.toString());
          const result = this.validator.validate(parsed);

          if (!result.valid || !result.parsed) {
            ws.send(JSON.stringify({ event: 'BAD_REQUEST', message: result.reason }));
            ws.close(1008, 'BAD_REQUEST');
            return;
          }

          const providerIds = normalizeProviderTypes(result.parsed.provider_type);
          subscribed = true;
          this.sessionManager.activateSubscription(clientId, providerIds);

          ws.send(JSON.stringify({
            event: 'SUBSCRIPTION_ACK',
            status: 'SUCCESS',
            providers: providerIds,
          }));

          // Enviar snapshot del estado actual desde Redis al nuevo cliente
          this.fanOutWorker.sendSnapshot(clientId, providerIds).catch((err) => {
            console.error('[Gateway] Error enviando snapshot:', err.message);
          });

        } catch {
          ws.send(JSON.stringify({
            event: 'BAD_REQUEST',
            message: 'El mensaje debe ser JSON válido con token y provider_type.',
          }));
          ws.close(1008, 'BAD_REQUEST');
        }
      });

      ws.on('close', () => {
        this.sessionManager.removeSession(clientId);
        console.log(`[Gateway] Cliente ${clientId} desconectado.`);
      });
    });
  }
}
```

---

## Variables de entorno a agregar en `.env`

```env
# Redis / AWS ElastiCache
REDIS_HOST=127.0.0.1         # En AWS: el endpoint del cluster ElastiCache
REDIS_PORT=6379
REDIS_PASSWORD=              # Dejar vacío si no tiene auth (entorno local)
REDIS_TLS=false              # true en producción con ElastiCache
```

Para AWS ElastiCache con TLS:
```env
REDIS_HOST=mi-cluster.abc123.ng.0001.use1.cache.amazonaws.com
REDIS_PORT=6379
REDIS_TLS=true
```

---

## Consideraciones de performance

**Por qué `setImmediate` en el fan-out**
El fan-out de un mensaje a muchos clientes puede ser un loop costoso. `setImmediate` cede el control al event loop de Node entre cada despacho, permitiendo que nuevas conexiones y mensajes de Redis no queden bloqueados esperando que termine el loop.

**Por qué dos conexiones Redis**
Redis no permite mezclar comandos normales (`GET`, `SET`, `PUBLISH`) con una conexión en modo suscriptor. Una vez que se llama `SUBSCRIBE`, la conexión solo puede recibir mensajes. Por eso se mantienen dos instancias separadas.

**Por qué `KEYS` en el snapshot solo en desarrollo**
`KEYS lobby:state:*` bloquea Redis mientras escanea. En producción con muchas mesas, reemplazar por `SCAN` con cursor o mantener un `SET` auxiliar con los `external_id` activos para hacer `SMEMBERS` + `MGET`.

**TTL en los estados**
Cada clave `lobby:state:{external_id}` tiene un TTL de 5 minutos. Si un proveedor cae, los datos expiran solos y el snapshot del siguiente cliente conectado no incluirá mesas obsoletas.

---

## Diagrama de secuencia completo

```
Proveedor     Connector     Adapter     LobbyStateManager   PublisherService   Redis         FanOutWorker    Cliente WS
    │              │            │               │                   │             │                 │              │
    │──mensaje──►  │            │               │                   │             │                 │              │
    │              │──normalize►│               │                   │             │                 │              │
    │              │            │──patch──────► │                   │             │                 │              │
    │              │            │               │──publish(patch)──►│             │                 │              │
    │              │            │               │                   │──PUBLISH──► │                 │              │
    │              │            │               │                   │──SET EX───► │                 │              │
    │              │            │               │                   │             │──message──────► │              │
    │              │            │               │                   │             │                 │──ws.send()──►│
```
