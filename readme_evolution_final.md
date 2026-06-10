# Guía de Integración — Evolution Gaming & Ezugi (Lobby & Game Streaming APIs)

Documentación unificada de la arquitectura de integración, protocolos de seguridad, endpoints, ciclo de vida de conexiones, estructuras de datos por tipo de juego y adaptadores de referencia en TypeScript para el proyecto **Lobby Real-Time BFF**.

---

## Contenido

1. [Arquitectura de Integración Híbrida](#1-arquitectura-de-integración-híbrida)
2. [Seguridad y Autenticación](#2-seguridad-y-autenticación)
3. [Endpoints y Parámetros de Consulta](#3-endpoints-y-parámetros-de-consulta)
4. [Manejo de Exclusiones](#4-manejo-de-exclusiones)
5. [Ciclo de Vida de la Conexión WebSocket](#5-ciclo-de-vida-de-la-conexión-websocket)
6. [Secuenciación y Detección de Gaps](#6-secuenciación-y-detección-de-gaps)
7. [Tipos de Eventos y Flujo de Mensajes](#7-tipos-de-eventos-y-flujo-de-mensajes)
8. [Estructuras JSON de Ejemplo — Lobby Streaming](#8-estructuras-json-de-ejemplo--lobby-streaming)
9. [Estructuras JSON por Tipo de Juego — Game Streaming](#9-estructuras-json-por-tipo-de-juego--game-streaming)
10. [Versionamiento y Deprecaciones](#10-versionamiento-y-deprecaciones)
11. [Políticas de Desconexión del Servidor](#11-políticas-de-desconexión-del-servidor)
12. [Integración de Ezugi](#12-integración-de-ezugi)
13. [Adaptadores de Referencia en TypeScript](#13-adaptadores-de-referencia-en-typescript)
14. [Mapeo al Contrato Canónico LobbyTablePatch](#14-mapeo-al-contrato-canónico-lobbytablepatch)
15. [Recomendaciones de Monitoreo y QA](#15-recomendaciones-de-monitoreo-y-qa)

---

## 1. Arquitectura de Integración Híbrida

La integración con Evolution se divide en **dos planos operativos independientes pero complementarios**: el plano de visualización del lobby (Lobby Streaming) y el plano de auditoría y resultados de rondas (Game Streaming).

```mermaid
flowchart TD
    subgraph Evolution_Upstream["Infraestructura Evolution Gaming"]
        STATE_API["State API (HTTPS REST)\nGET /api/lobby/v1/{casinoId}/live"]
        LOBBY_STREAM_API["Lobby Streaming API (WebSocket)\nwss://{licensee_hostname}/api/lobby/v1/..."]
        GAME_STREAM_API["Game Streaming API (HTTP Streaming)\nhttps://{licensee_hostname}/api/streaming/game/v1/"]
        RENDER_API["Game Result Render API (v2 HTML)\nhttps://{licensee_hostname}/api/render/v2/html/..."]
    end

    subgraph BFF_ECS["Lobby Real-Time BFF (ECS Fargate)"]
        EV_LOBBY_ADAPTER["EvolutionLobbyAdapter"]
        EV_GAME_ADAPTER["EvolutionGameAdapter"]

        EV_LOBBY_ADAPTER -->|1. GET Estado Completo| STATE_API
        EV_LOBBY_ADAPTER -->|2. Conexión Persistente Deltas| LOBBY_STREAM_API
        EV_GAME_ADAPTER -->|3. HTTP Chunked Stream| GAME_STREAM_API

        CACHE_STORE["Caché de Mesas (Redis)"]
        EV_LOBBY_ADAPTER -->|4. Actualizar Estado| CACHE_STORE
        EV_GAME_ADAPTER -->|5. Auditoría / Validación| CACHE_STORE

        REDIS_PUB["Redis Pub/Sub (lobby-realtime)"]
        EV_LOBBY_ADAPTER -->|6. Publicar Parche Canónico| REDIS_PUB
    end

    subgraph Cliente["Browser (Next.js)"]
        WSS_CLIENT["Cliente WebSocket"]
        IFRAME_GAME["Iframe de Juego"]
    end

    REDIS_PUB -->|7. WebSocket Fan-Out| WSS_CLIENT
    IFRAME_GAME -->|8. Renderizar Historial de Ronda| RENDER_API
```

### Planos de Operación

**Lobby Streaming API (Sincronización de Mesas)**
- Propósito: mantener el lobby actualizado con mesas disponibles, límites de apuesta, asientos libres y estado de apertura/cierre.
- Tecnología: conexión híbrida — HTTP REST para la carga inicial del estado completo y WebSocket para recibir deltas incrementales.
- Latencia: < 1 segundo.

**Game Streaming API (Resultados de Rondas)**
- Propósito: capturar resultados completos de cada ronda (cartas, giros, apuestas, multiplicadores) para auditoría y estadísticas.
- Tecnología: HTTP Streaming (Chunked Transfer Encoding) sobre HTTPS. Conexión persistente donde el servidor escribe mensajes delimitados por `\r\n`.
- Latencia: < 10 segundos desde la resolución física de la ronda.

---

## 2. Seguridad y Autenticación

Toda comunicación debe realizarse sobre **TLS** (`HTTPS` / `WSS`). Las conexiones en texto plano están rechazadas por los firewalls de Evolution.

### Autenticación HTTP Basic (RFC 2617)

Las solicitudes HTTP y el handshake inicial de WebSocket se protegen mediante **HTTP Basic Auth** sobre HTTPS.

- **Username:** `casino.key` (clave de cuenta de la integración `UserAuthentication 2.0`)
- **Password:** `apiToken` (token de acceso de la `Data API` / `Game Streaming API`)

```http
Authorization: Basic <Base64(casino.key:apiToken)>
```

**Ejemplo:**
```
casino.key:  test-casino-key-12345
apiToken:    test-api-token-67890
Base64:      dGVzdC1jYXNpbm8ta2V5LTEyMzQ1OnRlc3QtYXBpLXRva2VuLTY3ODkw
```

```http
Authorization: Basic dGVzdC1jYXNpbm8ta2V5LTEyMzQ1OnRlc3QtYXBpLXRva2VuLTY3ODkw==
```

### Verificación con curl

```bash
curl -v -u "test-casino-key-12345:test-api-token-67890" \
  https://cit1-prototype.evolutiongaming.com/api/streaming/game/v1/
```

### Códigos de error de autenticación

| Código | Significado | Acción |
|--------|-------------|--------|
| `401 Unauthorized` | Credenciales incorrectas o ausentes | Suspender reintentos, emitir alerta crítica |

---

## 3. Endpoints y Parámetros de Consulta

### A. Lobby Streaming API

```http
# Estado inicial (HTTP REST)
GET https://{licensee_hostname}/api/lobby/v1/{casinoId}/live

# Stream de deltas en tiempo real (WebSocket)
WSS wss://{licensee_hostname}/api/lobby/v1/{casinoId}/live
```

**Variables de ruta:**
- `{licensee_hostname}`: dominio asignado por Evolution al operador (ej. `atlanticcity-stage.evolutiongaming.com`)
- `{casinoId}`: identificador del casino provisto por Evolution (ej. `atlanticcitylive`)

**Query parameters:**

| Parámetro | Tipo | Requerido | Descripción |
|-----------|------|-----------|-------------|
| `currency` | String | Sí | Código ISO-4217 de 3 caracteres (ej. `COP`, `USD`). Define la divisa de los límites de apuesta. |
| `gameVertical` | String | No | Filtra por vertical: `roulette`, `blackjack`, `baccarat`, `moneywheel`, `poker`, `topcard`, `dice`, `craps`. |
| `gameProvider` | String | No | Filtra por sub-proveedor: `evolution`, `ezugi`, `netent`. |
| `playerUpdates` | Boolean | No | Si `true`, envía actualizaciones de alta frecuencia sobre conteo de jugadores y asientos. Esencial para Blackjack. |
| `exclude` | String | No | Lista separada por comas de secciones a omitir: `statistics`, `dealer`, `seats`, `limits`. Reduce el ancho de banda hasta un **60%**. |

**URL optimizada para producción:**
```
wss://{licensee_hostname}/api/lobby/v1/{casinoId}/live?currency=COP&exclude=statistics,dealer&playerUpdates=true
```

---

### B. Game Streaming API

```http
GET https://{licensee_hostname}/api/streaming/game/v1/
```

**Query parameters (mutuamente excluyentes):**

| Parámetro | Tipo | Descripción |
|-----------|------|-------------|
| `transmissionId` | String | Reanuda el stream desde un ID de transmisión específico. |
| `startTime` | String | Punto de inicio en UTC (`YYYY-MM-DDTHH:mm:ss.SSSZ`). Máximo 24 horas en el pasado. |

> Si se envían ambos parámetros juntos, el servidor responde con `400 Bad Request`.

**Códigos de error `400` de esta API:**

```json
// transmissionId inválido
[{ "field": "transmissionId", "error": "Invalid query parameter value provided for transmissionId..." }]

// transmissionId expirado (> 24h)
[{ "field": "transmissionId", "error": "Expired query parameter value provided for transmissionId..." }]

// parámetros mutuamente excluyentes usados juntos
[{ "field": "queryParameter", "error": "transmissionId and startTime query parameters are mutually exclusive..." }]

// startTime fuera de rango (> 24h en el pasado)
[{ "field": "startTime", "error": "Expired query parameter value provided for startTime..." }]
```

---

### C. Game Result Render API (v2)

```http
GET https://{licensee_hostname}/api/render/v2/html/{renderToken}
```

- **Rate limit:** máximo 10 RPS por licencia.
- **Datos históricos disponibles:** hasta 6 meses.
- **SLA:** 99.5% de disponibilidad garantizada.

---

## 4. Manejo de Exclusiones

El parámetro `exclude` suprime información pesada del stream, reduciendo el tamaño promedio de los frames JSON hasta en un **60%**.

| Exclusión | Efecto |
|-----------|--------|
| `dealer` | Excluye el objeto del crupier (nombre, foto). Recomendado si el lobby no muestra la foto del dealer. |
| `statistics` | Silencia los eventos `TableStatisticsUpdated` y datos históricos de ruleta/baccarat. Crítico para mesas de alta velocidad. |
| `seats` | Omite el array detallado de asientos ocupados/libres en Blackjack. Útil si solo se muestra el número total de asientos libres. |
| `limits` | Excluye los límites de apuesta min/max. Solo si los límites son fijos y no cambian dinámicamente. |

> Al excluir `statistics`, los eventos `TableStatisticsUpdated` se silencian por completo.
> Al excluir `seats`, los arrays en eventos `SeatsUpdated` llegan vacíos o se omiten.

---

## 5. Ciclo de Vida de la Conexión WebSocket

```mermaid
stateDiagram-v2
    [*] --> DISCONNECTED
    DISCONNECTED --> CONNECTING : Instanciar WS (Backoff)
    CONNECTING --> CONNECTED : Handshake 101 OK
    CONNECTED --> STATE_RECEIVED : Recibe 1er Frame (State)
    STATE_RECEIVED --> STREAMING : Procesando Deltas
    STREAMING --> STREAMING : Heartbeat / Ping-Pong
    STREAMING --> DISCONNECTED : Cierre (1011, 4000) o Timeout
    STATE_RECEIVED --> DISCONNECTED : Error de Conexión
    CONNECTING --> DISCONNECTED : Conexión Fallida
```

### Códigos de Cierre

| Código | Nombre | Significado | Acción en el BFF |
|--------|--------|-------------|-----------------|
| `1000` | Normal Closure | Desconexión controlada voluntaria. | Agendar reconexión controlada con backoff. |
| `1011` | Internal Server Error | Error inesperado en el servidor de Evolution. | Loguear como error, reconectar con backoff exponencial. |
| `4000` | Force Reconnect | Inactividad, vencimiento de token o mantenimiento del nodo de Evolution. | **Reconectar inmediatamente** solicitando nuevo estado inicial vía HTTP para no perder actualizaciones durante el switch de nodo. |
| `4001` / `401` | Auth Rejected | Credenciales inválidas. | **No reintentar.** Emitir alerta crítica y esperar intervención manual. |

---

## 6. Secuenciación y Detección de Gaps

Cada mensaje WebSocket contiene un identificador único en su raíz:

```
{casinoId}-{podId}-{eventNr}-{additionalEventNr}
```

**Ejemplo:** `atlanticcitylive-pod3-10485-0`

- `casinoId`: identificador de la licencia
- `podId`: nodo interno de Evolution que procesa las mesas
- `eventNr`: número de secuencia incremental monolítico de 64 bits
- `additionalEventNr`: sub-secuencia para eventos de múltiples fases

### Detección de Gap

El adaptador debe guardar el último `eventNr` procesado. Si el `eventNr` de un nuevo mensaje es mayor que `ultimoEventNr + 1`, se detectó un gap.

**Acción correctiva:**
1. Cerrar el WebSocket de forma segura.
2. Limpiar el caché local del proveedor.
3. Llamar a la **State API HTTP** para resincronizar el estado completo.
4. Reconectar el WebSocket.

---

## 7. Tipos de Eventos y Flujo de Mensajes

### Secuencia cronológica de una sesión

1. **Primer frame (`state`):** inmediatamente tras el handshake, el servidor transmite el estado completo del lobby (lista de todas las mesas abiertas). Idéntico en estructura a la respuesta HTTP de la State API.
2. **Frames siguientes (deltas):** solo los cambios incrementales.

### Eventos delta del Lobby Streaming

| Evento | Descripción | Acción en el BFF |
|--------|-------------|-----------------|
| `table_assigned` | Mesa nueva asignada al lobby. | Agregar al caché. |
| `table_unassigned` | Mesa eliminada del lobby. | Eliminar del caché. |
| `table_opened` | Mesa abre al público. | `isAvailable = true`. |
| `table_closed` | Mesa cerrada (mantenimiento, fin de jornada). | `isAvailable = false`. |
| `table_updated` | Cambio en límites, tipo de juego o configuración. | Actualizar campos correspondientes. |
| `dealer_changed` | Nuevo crupier en la mesa. | Actualizar `dealerName`. |
| `dealer_left` | Crupier se retira temporalmente. | Marcar dealer como ausente. |
| `seats_updated` | Cambio en ocupación de asientos (Blackjack). | Recalcular `availableSeats`. |
| `players_updated` | Cambio en conteo de jugadores activos. | Actualizar `playersOnline`. |

---

## 8. Estructuras JSON de Ejemplo — Lobby Streaming

### A. Evento `state` (primer frame — estado completo)

```json
{
  "id": "atlanticcitylive-pod3-10484-0",
  "type": "state",
  "tables": [
    {
      "id": "ev-bj-classic1",
      "name": "Blackjack Classic 1",
      "isOpen": true,
      "limits": { "min": 10.0, "max": 2000.0, "currency": "COP" },
      "seats": [
        {"id": 0, "occupied": true}, {"id": 1, "occupied": false},
        {"id": 2, "occupied": true}, {"id": 3, "occupied": false},
        {"id": 4, "occupied": false}, {"id": 5, "occupied": true},
        {"id": 6, "occupied": false}
      ],
      "playersCount": 3
    }
  ]
}
```

### B. Evento `table_assigned`

```json
{
  "id": "atlanticcitylive-pod3-10485-0",
  "type": "table_assigned",
  "table": {
    "id": "ev-bj-classic1",
    "name": "Blackjack Classic 1",
    "isOpen": true,
    "limits": { "min": 10.0, "max": 2000.0, "currency": "COP" },
    "seats": [
      {"id": 0, "occupied": true}, {"id": 1, "occupied": false},
      {"id": 2, "occupied": true}, {"id": 3, "occupied": false},
      {"id": 4, "occupied": false}, {"id": 5, "occupied": true},
      {"id": 6, "occupied": false}
    ],
    "playersCount": 3
  }
}
```

### C. Evento `table_updated` (cambio de límites)

```json
{
  "id": "atlanticcitylive-pod3-10486-0",
  "type": "table_updated",
  "table": {
    "id": "ev-bj-classic1",
    "limits": { "min": 25.0, "max": 5000.0, "currency": "COP" }
  }
}
```

### D. Evento `seats_updated`

```json
{
  "id": "atlanticcitylive-pod3-10487-0",
  "type": "seats_updated",
  "tableId": "ev-bj-classic1",
  "seats": [
    {"id": 0, "occupied": true}, {"id": 1, "occupied": true},
    {"id": 2, "occupied": true}, {"id": 3, "occupied": true},
    {"id": 4, "occupied": false}, {"id": 5, "occupied": true},
    {"id": 6, "occupied": true}
  ]
}
```

### E. Evento `players_updated`

```json
{
  "id": "atlanticcitylive-pod3-10488-0",
  "type": "players_updated",
  "tableId": "ev-bj-classic1",
  "playersCount": 6
}
```

### F. Evento `table_closed`

```json
{
  "id": "atlanticcitylive-pod3-10489-0",
  "type": "table_closed",
  "tableId": "ev-bj-classic1"
}
```

---

## 9. Estructuras JSON por Tipo de Juego — Game Streaming

### A. Roulette (Ruleta en Vivo)

- `gameType`: `"roulette"` o `"americanroulette"`
- `result.outcomes`: array con el número ganador, color y tipo (par/impar)
- `result.luckyNumbers`: números con multiplicadores especiales (Lightning Roulette, Gold Vault Roulette)

```json
{
  "id": "17885fc1bc92d36c3f971315",
  "gameProvider": "evolution",
  "gameType": "roulette",
  "gameSubType": "goldvault",
  "table": { "id": "GoldVaultRo00001", "name": "Gold Vault Roulette" },
  "result": {
    "outcomes": [
      { "number": "8", "type": "Even", "color": "Black" }
    ],
    "luckyNumbers": {
      "24": 49, "2": 149, "18": 149, "7": 49, "29": 49, "28": 49
    }
  }
}
```

---

### B. Blackjack (Mesa de 7 Asientos)

- `gameType`: `"blackjack"`
- `participants[].seats`: decisiones por asiento (`insurance`, `doubleDown`, `splitHand`, `betBehind`)
- `result.dealer`: cartas y puntuación del dealer, flag de blackjack natural
- `result.seats`: resultado individual por asiento (`cards`, `score`, `outcome`: `Win`/`Lost`/`Push`)

```json
{
  "id": "188b2f2c7a00f052118eb69d",
  "gameType": "blackjack",
  "table": { "id": "ev-bj-classic1", "name": "Blackjack Classic 1" },
  "participants": [
    {
      "playerId": "test_player",
      "bets": [
        { "code": "BJ_PlaySeat4", "stake": 5.0, "payout": 0 },
        { "code": "BJ_InsuranceSeat4", "stake": 2.5, "payout": 7.5 }
      ],
      "seats": {
        "Seat4": { "insurance": true, "doubleDown": false, "splitHand": false }
      }
    }
  ],
  "result": {
    "dealer": { "score": 21, "cards": ["AS", "QS"], "isBlackjack": true },
    "seats": {
      "Seat4": {
        "score": 18, "cards": ["8H", "JS"],
        "outcome": "Lost", "insuranceOutcome": "Win"
      }
    }
  }
}
```

> **Nota:** El campo `bet.description` fue eliminado en la versión `1.1.x` de la API (deprecación aplicada el 2024-12-09). Usar el campo `code` como identificador.

---

### C. Baccarat (Punto y Banca)

- `gameType`: `"baccarat"`
- `gameSubType`: `"nocommission"`, `"speed"`, `"nocommissionredenvelope"`
- `result.player` / `result.banker`: cartas y puntuación
- `result.outcome`: `Player`, `Banker`, `Tie`
- `result.sideBet*`: resultados de apuestas laterales (`PlayerPair`, `BankerPair`, `PerfectPair`)

```json
{
  "id": "158afoofa0b148486c20fbar",
  "gameType": "baccarat",
  "gameSubType": "nocommissionredenvelope",
  "table": { "id": "ev-bac-speed1", "name": "Speed Baccarat A" },
  "result": {
    "player": { "score": 0, "cards": ["QD", "QC", "KH"] },
    "banker": { "score": 2, "cards": ["2D", "QH", "KS"] },
    "outcome": "Banker",
    "sideBetPlayerPair": "Win",
    "sideBetBankerPair": "Lose",
    "sideBetEitherPair": "Win"
  }
}
```

---

### D. Game Shows (Ruedas y Dados)

- `gameType`: `"moneywheel"` (Dream Catcher, Crazy Time, Monopoly Live), `"craps"`, `"dice"`
- `result.outcomes`: array con resultados y multiplicadores intermedios

```json
{
  "id": "123456abc",
  "gameType": "moneywheel",
  "table": { "id": "DreamCatcher01", "name": "Dream Catcher" },
  "result": {
    "outcomes": ["X2", "05"]
  }
}
```

---

## 10. Versionamiento y Deprecaciones

La API de streaming de Evolution va por la versión `1.1.28`. Cambios relevantes:

| Fecha | Cambio |
|-------|--------|
| 2026-02-02 | Eliminados: `Deal or no Deal`, `Gonzo's Treasure Map`, `Cash or Crash`, `Lightning Bac Bo`, `Video Poker Live`. Remover mappers específicos. |
| 2024-12-09 | Eliminado `bet.description` del objeto de apuestas. Migrar a `bet.code` como identificador. |
| 2025/2026 | Soporte extendido para `Sneaky Slots`, `Spinning Whale`, `ezarcade`, `Super Stack Blackjack`, `Lucky Baccarat`, `Disco Balls`. |

### Buenas prácticas de versionamiento

1. **Tolerancia a campos desconocidos:** el parser JSON del BFF **nunca** debe fallar si llegan campos nuevos no documentados. Evolution los agrega regularmente.
2. **Usar `gameType` + `gameSubType`:** nunca basar la lógica solo en `gameType`. La combinación con `gameSubType` (ej. `roulette` + `goldvault`) identifica correctamente multiplicadores y reglas especiales.
3. **Monitorear deprecaciones:** Evolution da un período de gracia de 3 a 6 meses antes de eliminar un campo. Revisar los release notes periódicamente.

---

## 11. Políticas de Desconexión del Servidor

El servidor de Evolution cierra activamente la conexión bajo estos escenarios:

| Escenario | Comportamiento | Acción en el BFF |
|-----------|---------------|-----------------|
| **Múltiples conexiones concurrentes** | Solo se permite 1 conexión activa por credenciales. La nueva conexión desconecta a la antigua. | Evitar múltiples pods con las mismas credenciales sin control de líder. Si se detecta el patrón, suspender el pod secundario. |
| **Lectura lenta (Slow Reader)** | Si el cliente consume datos lentamente y la cola del servidor supera el límite de buffer, la conexión se corta. | Medir el tiempo de procesamiento por mensaje. Si supera 50ms, delegar a Worker Threads o BullMQ. |
| **Parada abrupta de lectura** | Si el cliente deja de consumir el socket de forma abrupta (hilo congelado), la conexión se corta. | Monitorear el event loop de Node.js para detectar bloqueos. |
| **Mantenimiento del servidor** | Cierre controlado durante actualizaciones de Evolution. | Reconectar con backoff exponencial. |

---

## 12. Integración de Ezugi

Ezugi fue adquirida por Evolution y opera bajo la misma infraestructura. Comparte exactamente las mismas APIs, protocolos de seguridad, formatos de mensaje y mecanismos de transporte.

### Filtrado en Lobby Streaming API

Usar el parámetro `gameProvider=ezugi` en la URL:

```http
wss://{licensee_hostname}/api/lobby/v1/{casinoId}/live?gameProvider=ezugi&currency=COP
```

El stream filtrará en origen y solo transmitirá eventos de mesas de Ezugi, reduciendo el procesamiento innecesario en el BFF.

### Filtrado en Game Streaming API

La Game Streaming API entrega resultados de todas las marcas bajo la licencia. El filtrado se hace en memoria sobre el campo `gameProvider`:

```typescript
client.on('game_round', (gameData) => {
  if (gameData.gameProvider === 'ezugi') {
    const patch = mapGameRoundToLobbyPatch(gameData, EZUGI_PROVIDER_ID);
    publishToRedis(patch);
  }
});
```

### Particularidades de Ezugi

- **Compatibilidad 100%:** las estructuras de datos son idénticas en formato JSON a las de Evolution.
- **Códigos de apuesta:** los prefijos de `bets[].code` cambian para reflejar los juegos de Ezugi (ej. `EZ_EZ_Roulette` en lugar de `ROU_...`).
- **Multi-asiento:** los juegos de cartas de Ezugi reportan ocupación de asientos en el mismo formato que Blackjack de Evolution.

---

## 13. Adaptadores de Referencia en TypeScript

### A. Lobby Streaming Adapter (HTTP + WebSocket)

```typescript
import WebSocket from 'ws';
import axios from 'axios';
import { LobbyTablePatch } from '../../domain/LobbyTablePatch';

interface EvLimits { min: number; max: number; currency: string; }
interface EvSeat { id: number; occupied: boolean; }
interface EvTable {
  id: string; name?: string; isOpen?: boolean;
  limits?: EvLimits; seats?: EvSeat[]; playersCount?: number;
}
interface EvBaseMessage { id: string; type: string; }
interface EvStateMessage extends EvBaseMessage { type: 'state'; tables: EvTable[]; }
interface EvTableAssignedMessage extends EvBaseMessage { type: 'table_assigned'; table: EvTable; }
interface EvTableUpdatedMessage extends EvBaseMessage { type: 'table_updated'; table: EvTable; }
interface EvTableClosedMessage extends EvBaseMessage { type: 'table_closed'; tableId: string; }
interface EvSeatsUpdatedMessage extends EvBaseMessage { type: 'seats_updated'; tableId: string; seats: EvSeat[]; }
interface EvPlayersUpdatedMessage extends EvBaseMessage { type: 'players_updated'; tableId: string; playersCount: number; }

type EvMessage =
  | EvStateMessage | EvTableAssignedMessage | EvTableUpdatedMessage
  | EvTableClosedMessage | EvSeatsUpdatedMessage | EvPlayersUpdatedMessage;

export class EvolutionLobbyAdapter {
  private ws: WebSocket | null = null;
  private isConnecting = false;
  private lastEventNr = 0;

  private readonly config = {
    licenseeHostname: process.env.EVOLUTION_LICENSEE_HOSTNAME || '',
    casinoId:         process.env.EVOLUTION_CASINO_ID || '',
    casinoKey:        process.env.EVOLUTION_CASINO_KEY || '',
    apiToken:         process.env.EVOLUTION_API_TOKEN || '',
    currency:         process.env.EVOLUTION_CURRENCY || 'COP',
    exclusions:       process.env.EVOLUTION_EXCLUSIONS || 'statistics,dealer',
    playerUpdates:    process.env.EVOLUTION_PLAYER_UPDATES || 'true',
  };

  constructor() {
    if (!this.config.licenseeHostname || !this.config.casinoId ||
        !this.config.casinoKey || !this.config.apiToken) {
      throw new Error('[EvolutionLobby] Faltan variables críticas en el .env');
    }
  }

  private getAuthHeader(): string {
    const creds = `${this.config.casinoKey}:${this.config.apiToken}`;
    return `Basic ${Buffer.from(creds, 'utf-8').toString('base64')}`;
  }

  private getEndpoints() {
    const params = new URLSearchParams({
      currency:      this.config.currency,
      exclude:       this.config.exclusions,
      playerUpdates: this.config.playerUpdates,
    });
    const base = `https://${this.config.licenseeHostname}/api/lobby/v1/${this.config.casinoId}/live`;
    return {
      httpUrl: `${base}?${params}`,
      wsUrl:   `wss://${this.config.licenseeHostname}/api/lobby/v1/${this.config.casinoId}/live?${params}`,
    };
  }

  /**
   * Plano 1 — Sincrónico: carga inicial del estado completo (State API HTTP)
   */
  public async fetchInitialState(): Promise<{ tables: EvTable[]; fatalError: boolean }> {
    const { httpUrl } = this.getEndpoints();
    try {
      console.log(`[EvLobby] Solicitando estado inicial: ${httpUrl}`);
      const res = await axios.get<{ tables: EvTable[] }>(httpUrl, {
        timeout: 10000,
        headers: { Authorization: this.getAuthHeader() },
      });
      return { tables: res.data.tables || [], fatalError: false };
    } catch (err: any) {
      if (err.response?.status === 401) {
        console.error('[EvLobby] ALERTA CRÍTICA: Autenticación rechazada (401). Sin reconexión.');
        return { tables: [], fatalError: true };
      }
      console.error('[EvLobby] Error obteniendo estado inicial:', err.message);
      return { tables: [], fatalError: false };
    }
  }

  /**
   * Plano 2 — Asincrónico: stream de deltas en tiempo real (WebSocket)
   */
  public connectStreaming(onPatch: (patch: LobbyTablePatch) => void): void {
    if (this.isConnecting) return;
    this.isConnecting = true;

    const { wsUrl } = this.getEndpoints();
    console.log(`[EvLobby] Conectando WebSocket: ${wsUrl}`);

    try {
      this.ws = new WebSocket(wsUrl, {
        headers: { Authorization: this.getAuthHeader() },
      });

      this.ws.on('open', () => {
        console.log('[EvLobby] WebSocket conectado.');
        this.isConnecting = false;
      });

      this.ws.on('message', (data: WebSocket.Data) => {
        try {
          const message = JSON.parse(data.toString()) as EvMessage;
          if (message.id) this.handleSequencing(message.id, onPatch);
          this.processEvent(message, onPatch);
        } catch (err: any) {
          console.error('[EvLobby] Error procesando frame:', err.message);
        }
      });

      this.ws.on('close', (code: number, reason: Buffer) => {
        this.isConnecting = false;
        const reasonStr = reason.toString();
        console.warn(`[EvLobby] Conexión cerrada. Código: ${code}, Razón: ${reasonStr}`);

        if (code === 4001 || reasonStr.includes('401')) {
          console.error('[EvLobby] Autenticación rechazada. Revisar credenciales. Sin reconexión.');
          return;
        }
        if (code === 4000) {
          this.resyncAndReconnect(onPatch);
        } else {
          this.reconnectWithBackoff(onPatch);
        }
      });

      this.ws.on('error', (err: Error) => {
        console.error('[EvLobby] Error en el socket:', err.message);
        this.ws?.close();
      });

    } catch (err: any) {
      console.error('[EvLobby] Fallo crítico abriendo WebSocket:', err.message);
      this.isConnecting = false;
      this.reconnectWithBackoff(onPatch);
    }
  }

  private processEvent(message: EvMessage, onPatch: (patch: LobbyTablePatch) => void): void {
    switch (message.type) {
      case 'state':
        console.log(`[EvLobby] Estado inicial: ${message.tables.length} mesas.`);
        message.tables.forEach(t => onPatch(this.mapTableToPatch(t)));
        break;

      case 'table_assigned':
      case 'table_updated':
        onPatch(this.mapTableToPatch(message.table));
        break;

      case 'table_closed':
        onPatch({
          external_id: `evolution_${message.tableId}`,
          idProveedor: 2, nameProveedor: 'EVOLUTION_PROVIDER',
          providerTableId: message.tableId, gameType: 'other',
          eventType: 'TABLE_CLOSED',
          realtime: { isAvailable: false, minBet: 0, updatedAt: new Date().toISOString() },
        });
        break;

      case 'seats_updated': {
        const freeSeats = message.seats.filter(s => !s.occupied).length;
        onPatch({
          external_id: `evolution_${message.tableId}`,
          idProveedor: 2, nameProveedor: 'EVOLUTION_PROVIDER',
          providerTableId: message.tableId, gameType: 'blackjack',
          eventType: 'SEATS_UPDATED',
          realtime: { availableSeats: freeSeats, minBet: 0, updatedAt: new Date().toISOString() },
        });
        break;
      }

      case 'players_updated':
        onPatch({
          external_id: `evolution_${message.tableId}`,
          idProveedor: 2, nameProveedor: 'EVOLUTION_PROVIDER',
          providerTableId: message.tableId, gameType: 'other',
          eventType: 'PLAYERS_UPDATED',
          realtime: { playersOnline: message.playersCount, minBet: 0, updatedAt: new Date().toISOString() },
        });
        break;
    }
  }

  private handleSequencing(messageId: string, onPatch: (patch: LobbyTablePatch) => void): void {
    const parts = messageId.split('-');
    if (parts.length >= 3) {
      const eventNr = parseInt(parts[2], 10);
      if (!isNaN(eventNr)) {
        if (this.lastEventNr > 0 && eventNr > this.lastEventNr + 1) {
          console.error(`[EvLobby] GAP detectado. Esperado: ${this.lastEventNr + 1}, Recibido: ${eventNr}. Resincronizando...`);
          this.ws?.close();
        } else {
          this.lastEventNr = eventNr;
        }
      }
    }
  }

  private async resyncAndReconnect(onPatch: (patch: LobbyTablePatch) => void): Promise<void> {
    console.log('[EvLobby] Resincronizando estado base vía HTTP...');
    this.lastEventNr = 0;
    const { tables } = await this.fetchInitialState();
    tables.forEach(t => onPatch(this.mapTableToPatch(t)));
    this.connectStreaming(onPatch);
  }

  private reconnectWithBackoff(onPatch: (patch: LobbyTablePatch) => void, attempt = 1): void {
    const delay = Math.min(1000 * Math.pow(2, attempt), 30000);
    console.log(`[EvLobby] Reconectando en ${delay / 1000}s... (Intento: ${attempt})`);
    setTimeout(() => this.connectStreaming(onPatch), delay);
  }

  private mapTableToPatch(table: EvTable): LobbyTablePatch {
    const freeSeats = table.seats?.filter(s => !s.occupied).length;
    const gameTypeMap: Record<string, LobbyTablePatch['gameType']> = {
      roulette: 'roulette', americanroulette: 'roulette',
      blackjack: 'blackjack', baccarat: 'baccarat',
      'dragon-tiger': 'dragon-tiger', sicbo: 'sicbo', poker: 'poker',
    };
    return {
      external_id:     `evolution_${table.id}`,
      idProveedor:     2,
      nameProveedor:   'EVOLUTION_PROVIDER',
      providerTableId: table.id,
      gameType:        gameTypeMap[String(table.id).toLowerCase()] ?? 'other',
      eventType:       table.isOpen ? 'TABLE_OPENED' : 'TABLE_CLOSED',
      realtime: {
        isAvailable:    table.isOpen ?? true,
        minBet:         table.limits?.min ?? 0,
        maxBet:         table.limits?.max,
        currency:       table.limits?.currency,
        availableSeats: freeSeats,
        playersOnline:  table.playersCount,
        updatedAt:      new Date().toISOString(),
      },
    };
  }
}
```

---

### B. Game Streaming Client (HTTP Chunked)

```typescript
import axios, { AxiosResponse } from 'axios';
import { Readable } from 'stream';
import { EventEmitter } from 'events';

interface GameStreamConfig {
  licenseeHostname: string;
  casinoKey: string;
  apiToken: string;
}

export class EvolutionGameStreamClient extends EventEmitter {
  private activeStream: Readable | null = null;
  private isRunning = false;
  private lastTransmissionId: string | null = null;
  private reconnectTimeout: NodeJS.Timeout | null = null;

  constructor(private config: GameStreamConfig) {
    super();
    if (!config.licenseeHostname || !config.casinoKey || !config.apiToken) {
      throw new Error('[EvGameStream] Configuración de credenciales incompleta.');
    }
  }

  public async start(startTime?: string): Promise<void> {
    if (this.isRunning) return;
    this.isRunning = true;

    const authHeader = Buffer.from(`${this.config.casinoKey}:${this.config.apiToken}`).toString('base64');

    // Parámetros mutuamente excluyentes — no enviar ambos juntos
    let url = `https://${this.config.licenseeHostname}/api/streaming/game/v1/`;
    if (this.lastTransmissionId) {
      url += `?transmissionId=${encodeURIComponent(this.lastTransmissionId)}`;
    } else if (startTime) {
      url += `?startTime=${encodeURIComponent(startTime)}`;
    }

    console.log(`[EvGameStream] Conectando a: ${url}`);

    try {
      const response: AxiosResponse<Readable> = await axios({
        method: 'GET', url,
        headers: { Authorization: `Basic ${authHeader}`, Accept: 'application/json' },
        responseType: 'stream',
        timeout: 0, // Sin timeout — conexión persistente
      });

      this.activeStream = response.data;
      let buffer = '';

      this.activeStream.on('data', (chunk: Buffer) => {
        buffer += chunk.toString('utf8');

        // Dividir estrictamente por \r\n — no usar solo \n
        let boundaryIndex: number;
        while ((boundaryIndex = buffer.indexOf('\r\n')) !== -1) {
          const rawMessage = buffer.substring(0, boundaryIndex).trim();
          buffer = buffer.substring(boundaryIndex + 2);

          if (rawMessage.length > 0) {
            this.handleRawMessage(rawMessage);
          } else {
            // Línea vacía = keep-alive del servidor — ignorar silenciosamente
            this.emit('heartbeat');
          }
        }
      });

      this.activeStream.on('end',   () => { console.warn('[EvGameStream] Stream cerrado por el servidor.'); this.handleDisconnect(); });
      this.activeStream.on('error', (err: Error) => { console.error('[EvGameStream] Error en stream:', err.message); this.handleDisconnect(); });

    } catch (err: any) {
      console.error('[EvGameStream] Error al conectar:', err.message);
      this.handleDisconnect();
    }
  }

  private handleRawMessage(rawMessage: string): void {
    try {
      const parsed = JSON.parse(rawMessage);

      // Guardar el último transmissionId para reanudación resiliente
      if (parsed.transmissionID) {
        this.lastTransmissionId = parsed.transmissionID;
      }

      // Emitir eventos según el tipo de mensaje
      if (parsed.messageType === 'game' && parsed.data)   this.emit('game_round', parsed.data);
      else if (parsed.messageType === 'tip')              this.emit('player_tip', parsed.data);
      else if (parsed.messageType === 'system')           this.emit('system_notification', parsed.data);
    } catch (err: any) {
      console.error('[EvGameStream] Error parseando JSON:', err.message);
    }
  }

  private handleDisconnect(attempt = 1): void {
    this.cleanup();
    if (!this.isRunning) return;
    const delay = Math.min(1000 * Math.pow(2, attempt), 30000);
    console.log(`[EvGameStream] Reconectando en ${delay / 1000}s... (Intento: ${attempt})`);
    this.reconnectTimeout = setTimeout(async () => {
      try { await this.start(); }
      catch { this.handleDisconnect(attempt + 1); }
    }, delay);
  }

  private cleanup(): void {
    this.activeStream?.removeAllListeners();
    this.activeStream = null;
    if (this.reconnectTimeout) { clearTimeout(this.reconnectTimeout); this.reconnectTimeout = null; }
  }

  public stop(): void {
    console.log('[EvGameStream] Deteniendo cliente de streaming...');
    this.isRunning = false;
    this.cleanup();
  }
}
```

---

## 14. Mapeo al Contrato Canónico LobbyTablePatch

La **Game Streaming API** entrega resultados de rondas completadas (no estado del lobby). Este mapper infiere el estado de la mesa a partir del resultado de una ronda:

```typescript
import { LobbyTablePatch } from '../../domain/LobbyTablePatch';

export function mapGameRoundToLobbyPatch(gameData: any, providerId: number): LobbyTablePatch {
  const isEzugi = gameData.gameProvider === 'ezugi';
  const prefix  = isEzugi ? 'ezugi_' : 'evolution_';

  // Calcular asientos disponibles reactivamente para Blackjack
  let availableSeats: number | undefined;
  if (gameData.gameType === 'blackjack' && gameData.result?.seats) {
    const totalSeats = 7;
    const occupied   = Object.keys(gameData.result.seats).length;
    availableSeats   = Math.max(0, totalSeats - occupied);
  }

  return {
    external_id:     `${prefix}${gameData.table.id}`,
    idProveedor:     providerId,
    nameProveedor:   isEzugi ? 'EZUGI_PROVIDER' : 'EVOLUTION_PROVIDER',
    providerTableId: gameData.table.id,
    gameType:        gameData.gameType,
    realtime: {
      // Si la mesa está resolviendo rondas, está disponible
      isAvailable:    gameData.status === 'Resolved' ? true : undefined,
      availableSeats,
      minBet:         gameData.minBet ?? 0,
      updatedAt:      gameData.settledAt || new Date().toISOString(),
    },
  };
}
```

---

## 15. Recomendaciones de Monitoreo y QA

### 1. Alerta de doble conexión (conflicto de credenciales)
- **Detectar:** cierres WebSocket con código `4000` o desconexiones HTTP repetitivas en menos de 10 segundos.
- **Acción:** suspender el pod secundario de inmediato y emitir alerta crítica: `"Conflicto de credenciales de streaming de Evolution — Posible ejecución de múltiples instancias"`.

### 2. Detección de gaps de secuencia
- **Detectar:** `eventNr` recibido > `lastEventNr + 1`.
- **Acción:** cerrar WebSocket → limpiar caché → llamar State API HTTP → reconectar.

### 3. Mitigación de lectura lenta (Slow Reader)
- **Detectar:** tiempo de procesamiento de un mensaje > 50ms.
- **Acción:** delegar el parseo y la lógica de negocio a Worker Threads o a BullMQ para no bloquear el event loop de Node.js. Un hilo bloqueado hace que Evolution corte la conexión.

### 4. Deduplicación de mensajes (Game Streaming)
- Evolution garantiza entrega **At-Least-Once**. Pueden llegar duplicados tras reconexiones.
- **Acción:** mantener un Set de Redis con TTL de 5 minutos almacenando los `data.id` procesados. Descartar si ya existe.

### 5. Validación en QA con Render API
- Usar la **HTML Render API v2** para contrastar visualmente que los resultados procesados por el BFF coincidan con la representación oficial de Evolution de la ronda.

### 6. Variables de entorno requeridas

| Variable | Descripción |
|----------|-------------|
| `EVOLUTION_LICENSEE_HOSTNAME` | Hostname del licenciatario |
| `EVOLUTION_CASINO_ID` | ID del casino |
| `EVOLUTION_CASINO_KEY` | Clave de autenticación (username en Basic Auth) |
| `EVOLUTION_API_TOKEN` | Token API (password en Basic Auth) |
| `EVOLUTION_CURRENCY` | Moneda ISO-4217 (default: `COP`) |
| `EVOLUTION_EXCLUSIONS` | Exclusiones del stream (default: `statistics,dealer`) |
| `EVOLUTION_PLAYER_UPDATES` | Actualizaciones de jugadores (default: `true`) |
