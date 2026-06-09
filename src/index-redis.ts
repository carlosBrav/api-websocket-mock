import dotenv from 'dotenv';
dotenv.config();

import express from 'express';
import { createServer } from 'http';
import { SessionManager } from './infrastructure/inbound/websocket/session.manager';
import { LobbyStateManager } from './core/services/lobby-state.manager';
import { LobbyGateway } from './infrastructure/inbound/websocket/lobby.gateway';
import { EvolutionConnector } from './providers/connectors/evolution.connector';
import { PragmaticConnector } from './providers/connectors/pragmatic.connector';
import { PlaytechConnector } from './providers/connectors/playtech.connector';
import { EvolutionAdapter } from './providers/adapters/evolution.adapter';
import { PragmaticAdapter } from './providers/adapters/pragmatic.adapter';
import { PlaytechAdapter } from './providers/adapters/playtech.adapter';
import { EzugiAdapter } from './providers/adapters/ezugi.adapter';
import { EzugiConnector } from './providers/connectors/ezugi.connector';
import { DefaultSubscriptionValidator } from './core/strategies/default-subscription.validator';
import { createRedisClient } from './infrastructure/redis/redis.client';
import { RedisStateRepository } from './infrastructure/redis/redis-state.repository';
import { RedisPubSubService } from './infrastructure/redis/redis-pubsub.service';
import { ProviderOrchestrator } from './core/services/provider-orchestrator';
import { VALID_PROVIDER_IDS } from './core/models/subscription.model';

const PORT = parseInt(process.env.WS_PORT || '3000', 10);
const REDIS_ENABLED = process.env.REDIS_ENABLED === 'true';

async function bootstrap() {
  console.log(`[BFF] Iniciando api-mesas-vivos-bff (Redis: ${REDIS_ENABLED ? 'ON' : 'OFF'})...\n`);

  const app = express();
  const httpServer = createServer(app);

  // ── Redis ──────────────────────────────────────────────────────────────────
  let redisRepo: RedisStateRepository | undefined;
  let redisPubSub: RedisPubSubService | undefined;

  if (REDIS_ENABLED) {
    const publisher = createRedisClient();
    const subscriber = publisher.duplicate();

    await publisher.connect();
    await subscriber.connect();

    redisRepo = new RedisStateRepository(publisher);
    redisPubSub = new RedisPubSubService(publisher, subscriber);

    console.log('[BFF] Servicios Redis inicializados.');
  }
  const sessionManager = new SessionManager();
  const lobbyStateManager = new LobbyStateManager(sessionManager, redisRepo, redisPubSub);

    // ── Proveedores ────────────────────────────────────────────────────────────
  const evolutionConnector = startEvolution(lobbyStateManager, new EvolutionAdapter());
  // startEzugi(lobbyStateManager, new EzugiAdapter());
  const pragmaticConnector = startPragmatic(lobbyStateManager, new PragmaticAdapter());
  // startPlaytech(lobbyStateManager, new PlaytechAdapter());


  const validator = new DefaultSubscriptionValidator();
  const orchestrator = new ProviderOrchestrator(
    [evolutionConnector as EvolutionConnector, 
    pragmaticConnector as PragmaticConnector
    ], redisPubSub);
  const gateway = new LobbyGateway(sessionManager, validator, lobbyStateManager, orchestrator);


  if (redisPubSub) {
    await redisPubSub.subscribeToProviders(
      [...VALID_PROVIDER_IDS],
      (providerId: number, rawMessage: string) => {
        // providerId viene del canal — rawMessage se reenvía sin tocar
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


  httpServer.on('upgrade', (request, socket, head) => {
    gateway.handleUpgrade(request, socket as any, head);
  });

  httpServer.listen(PORT, () => {
    console.log(`[BFF] WebSocket disponible en ws://localhost:${PORT}`);
  });
}

function startEvolution(lobbyStateManager: LobbyStateManager, adapter: EvolutionAdapter): EvolutionConnector | null {
  try {
    const connector = new EvolutionConnector((rawPayload: unknown) => {
      const patch = adapter.normalize(rawPayload);
      if (patch) lobbyStateManager.updateTableState(patch);
    });
    connector.connectStreaming();
    return  connector
  } catch (err: any) {
    console.error('[Evolution] No se pudo iniciar:', err.message);
    return null
  }
}

function startPragmatic(lobbyStateManager: LobbyStateManager, adapter: PragmaticAdapter): PragmaticConnector | null {
  try {
    const connector = new PragmaticConnector((rawPayload: unknown) => {
      const patch = adapter.normalize(rawPayload);
      if (patch) lobbyStateManager.updateTableState(patch);
    });
    connector.connect();
    return connector
  } catch (err: any) {
    console.error('[Pragmatic] No se pudo iniciar:', err.message);
    return null
  }
}

function startPlaytech(lobbyStateManager: LobbyStateManager, adapter: PlaytechAdapter): void {
  try {
    const connector = new PlaytechConnector((rawPayload: unknown) => {
      const patch = adapter.normalize(rawPayload);
      if (patch) lobbyStateManager.updateTableState(patch);
    });
    connector.fetchInitialState().then(({ tables, fatalError }) => {
      if (fatalError) {
        console.error('[Playtech] Arranque abortado por error fatal.');
        return;
      }
      console.log(`[Playtech] Snapshot inicial: ${tables.length} mesas`);
      connector.connectKafkaStreaming();
    });
  } catch (err: any) {
    console.error('[Playtech] No se pudo iniciar:', err.message);
  }
}

function startEzugi(lobbyStateManager: LobbyStateManager, adapter: EzugiAdapter): void {
  try {
    const connector = new EzugiConnector((rawPayload: unknown) => {
      const patch = adapter.normalize(rawPayload);
      if (patch) lobbyStateManager.updateTableState(patch);
    });
    connector.fetchInitialState().then(({ tables, fatalError }) => {
      if (fatalError) {
        console.error('[Ezugi] Arranque abortado por error fatal.');
        return;
      }
      tables.forEach((table) => {
        const patch = adapter.normalize({ type: 'table_assigned', id: 'initial', table });
        if (patch) lobbyStateManager.updateTableState(patch);
      });
      connector.connectStreaming();
    });
  } catch (err: any) {
    console.error('[Ezugi] No se pudo iniciar:', err.message);
  }
}

bootstrap();