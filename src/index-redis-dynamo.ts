import dotenv from 'dotenv';
dotenv.config();

import express from 'express';
import { createServer } from 'http';
import { Server as HttpServer } from 'http';

import { SessionManager } from './infrastructure/inbound/websocket/session.manager';
import { LobbyStateManager } from './core/services/lobby-state.manager';
import { LobbyGateway } from './infrastructure/inbound/websocket/lobby.gateway';
import { EvolutionConnector } from './providers/connectors/evolution.connector';
import { PragmaticConnector } from './providers/connectors/pragmatic.connector';
import { EvolutionAdapter } from './providers/adapters/evolution.adapter';
import { PragmaticAdapter } from './providers/adapters/pragmatic.adapter';
import { DefaultSubscriptionValidator } from './core/strategies/default-subscription.validator';
import { ProviderOrchestrator } from './core/services/provider-orchestrator';
import { VALID_PROVIDER_IDS } from './core/models/subscription.model';

// Redis
import { createRedisClient } from './infrastructure/redis/redis.client';
import { RedisStateRepository } from './infrastructure/redis/redis-state.repository';
import { RedisPubSubService } from './infrastructure/redis/redis-pubsub.service';

// DynamoDB
/*import { createDynamoClient } from './infrastructure/dynamo/dynamo.client';
import { DynamoCatalogRepository } from './infrastructure/dynamo/dynamo-catalog.repository';
import { CatalogFilterService } from './core/services/catalog-filter.service';*/

const PORT           = parseInt(process.env.WS_PORT       || '3000', 10);
const REDIS_ENABLED  = process.env.REDIS_ENABLED  === 'true';
const DYNAMO_ENABLED = process.env.DYNAMO_ENABLED === 'true';

// Referencias globales necesarias para el graceful shutdown
let httpServer: HttpServer;
let sessionManager: SessionManager;

// ── Graceful Shutdown ──────────────────────────────────────────────────────

function notifyClientsAndShutdown(reason: string, exitCode: number): void {
  console.warn(`[BFF] Iniciando shutdown. Motivo: ${reason}`);

  if (sessionManager) {
    const clients = sessionManager.getSubscribedClients();
    const message = JSON.stringify({
      event: 'SERVER_SHUTDOWN',
      reason,
      message: 'El servidor se está reiniciando. Reconecta en unos momentos.',
    });

    console.log(`[BFF] Notificando a ${clients.length} cliente(s) conectados...`);
    for (const client of clients) {
      try {
        if (client.ws.readyState === client.ws.OPEN) {
          client.ws.send(message);
          client.ws.close(1001, 'Going Away');
        }
      } catch {
        // Ignorar errores al cerrar — el proceso va a terminar de todas formas
      }
    }
  }

  if (httpServer) {
    httpServer.close(() => {
      console.log('[BFF] Servidor HTTP cerrado limpiamente.');
      process.exit(exitCode);
    });
    setTimeout(() => {
      console.error('[BFF] Forzando cierre por timeout.');
      process.exit(exitCode);
    }, 5000).unref();
  } else {
    process.exit(exitCode);
  }
}

// SIGTERM: apagado controlado del sistema (ECS, Kubernetes)
process.on('SIGTERM', () => {
  notifyClientsAndShutdown('SIGTERM recibido (apagado controlado del sistema)', 0);
});

// SIGINT: Ctrl+C en desarrollo
process.on('SIGINT', () => {
  notifyClientsAndShutdown('SIGINT recibido (Ctrl+C)', 0);
});

// Promise rechazada sin capturar
process.on('unhandledRejection', (reason, promise) => {
  console.error('[BFF] UnhandledRejection en:', promise);
  console.error('[BFF] Motivo:', reason);
  notifyClientsAndShutdown('Error interno no controlado (unhandledRejection)', 1);
});

// Error síncrono no capturado en el hilo principal
process.on('uncaughtException', (err) => {
  console.error('[BFF] UncaughtException:', err.message);
  console.error(err.stack);
  notifyClientsAndShutdown('Excepción no controlada (uncaughtException)', 1);
});

// ── Bootstrap ──────────────────────────────────────────────────────────────

async function bootstrap(): Promise<void> {
  console.log(
    `[BFF] Iniciando (Redis: ${REDIS_ENABLED ? 'ON' : 'OFF'} | DynamoDB: ${DYNAMO_ENABLED ? 'ON' : 'OFF'})...\n`
  );

  const app = express();
  httpServer = createServer(app);

  // ── 1. DynamoDB — PRECARGA BLOQUEANTE ─────────────────────────────────────
  // Los proveedores no arrancan hasta que este paso esté completo.
  /*const catalogFilter = new CatalogFilterService();

  if (DYNAMO_ENABLED) {
    console.log('[BFF] Cargando catálogo desde DynamoDB...');
    try {
      const dynamoClient = createDynamoClient();
      const catalogRepo  = new DynamoCatalogRepository(dynamoClient);
      const entries      = await catalogRepo.loadAll();
      catalogFilter.load(entries);
      console.log(`[BFF] DynamoDB listo. ${catalogFilter.getTotalActive()} mesas activas en catálogo.`);
    } catch (err: any) {
      console.error('[BFF] FATAL: No se pudo cargar el catálogo desde DynamoDB:', err.message);
      process.exit(1);
    }
  } else {
    console.log('[BFF] DynamoDB deshabilitado — modo permisivo (todas las mesas aceptadas).');
  }*/

  // ── 2. Redis — opcional, degrada sin él ───────────────────────────────────
  let redisRepo:   RedisStateRepository | undefined;
  let redisPubSub: RedisPubSubService   | undefined;

  if (REDIS_ENABLED) {
    console.log('[BFF] Conectando a Redis...');
    try {
      const publisher  = createRedisClient();
      const subscriber = publisher.duplicate();
      await publisher.connect();
      await subscriber.connect();
      redisRepo   = new RedisStateRepository(publisher);
      redisPubSub = new RedisPubSubService(publisher, subscriber);
      console.log('[BFF] Redis listo.');
    } catch (err: any) {
      console.error('[BFF] Redis no disponible, continuando sin él:', err.message);
    }
  }

  // ── 3. Core ────────────────────────────────────────────────────────────────
  sessionManager          = new SessionManager();
  const lobbyStateManager = new LobbyStateManager(sessionManager, redisRepo, redisPubSub);
  const validator         = new DefaultSubscriptionValidator();

  // ── 4. Proveedores — arrancan DESPUÉS de DynamoDB ─────────────────────────
  // catalogFilter inyectado en cada adapter filtra las mesas no permitidas
  //const evolutionConnector = startEvolution(lobbyStateManager, new EvolutionAdapter(catalogFilter));
  //const pragmaticConnector = startPragmatic(lobbyStateManager, new PragmaticAdapter(catalogFilter));

  //const activeConnectors = [evolutionConnector, pragmaticConnector].filter(Boolean) as any[];

  //const orchestrator = new ProviderOrchestrator(activeConnectors, redisPubSub);
  //const gateway      = new LobbyGateway(sessionManager, validator, lobbyStateManager, orchestrator);

  // ── 5. Redis Pub/Sub ───────────────────────────────────────────────────────
  if (redisPubSub) {
    await redisPubSub.subscribeToProviders(
      [...VALID_PROVIDER_IDS],
      (providerId: number, rawMessage: string) => {
        const targets = sessionManager.getSubscribedClientsByProvider(providerId);
        if (targets.length === 0) return;
        for (const client of targets) {
          if (client.ws.readyState === client.ws.OPEN) {
            client.ws.send(rawMessage);
          }
        }
      }
    );
  }

  // ── 6. HTTP upgrade → WebSocket ───────────────────────────────────────────
  httpServer.on('upgrade', (request, socket, head) => {
    //gateway.handleUpgrade(request, socket as any, head);
  });

  // ── 7. Health endpoint ─────────────────────────────────────────────────────
  app.get('/health', (_req, res) => {
    const mem = process.memoryUsage();
    res.json({
      status: 'ok',
      uptime:  `${process.uptime().toFixed(0)}s`,
      redis:   REDIS_ENABLED  ? 'enabled' : 'disabled',
      //dynamo:  DYNAMO_ENABLED ? `enabled — ${catalogFilter.getTotalActive()} mesas` : 'disabled',
      clients: sessionManager.getTotalSessionCount(),
      memory: {
        heapUsed:  `${(mem.heapUsed  / 1024 / 1024).toFixed(1)} MB`,
        heapTotal: `${(mem.heapTotal / 1024 / 1024).toFixed(1)} MB`,
        rss:       `${(mem.rss       / 1024 / 1024).toFixed(1)} MB`,
      },
      
    });
  });

  // ── 8. Servidor listo ──────────────────────────────────────────────────────
  httpServer.listen(PORT, () => {
    console.log(`[BFF] Servidor listo en ws://localhost:${PORT}`);
  });
}

// ── Funciones de arranque de proveedores ──────────────────────────────────

function startEvolution(
  lobbyStateManager: LobbyStateManager,
  adapter: EvolutionAdapter,
): EvolutionConnector | null {
  try {
    const connector = new EvolutionConnector((rawPayload: unknown) => {
      const patch = adapter.normalize(rawPayload);
      if (patch) lobbyStateManager.updateTableState(patch);
    });
    connector.connectStreaming();
    return connector;
  } catch (err: any) {
    console.error('[Evolution] No se pudo iniciar:', err.message);
    return null;
  }
}

function startPragmatic(
  lobbyStateManager: LobbyStateManager,
  adapter: PragmaticAdapter,
): PragmaticConnector | null {
  try {
    const connector = new PragmaticConnector((rawPayload: unknown) => {
      const patch = adapter.normalize(rawPayload);
      if (patch) lobbyStateManager.updateTableState(patch);
    });
    connector.connect();
    return connector;
  } catch (err: any) {
    console.error('[Pragmatic] No se pudo iniciar:', err.message);
    return null;
  }
}

bootstrap();
