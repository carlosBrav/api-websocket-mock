# Rollback y ajustes — WebSocket + Control de errores en proveedores

## Contexto y requerimientos actuales

Este documento reemplaza la versión anterior del rollback. Los requerimientos confirmados son:

1. **El WebSocket se consume desde la URL raíz** del servidor, sin ruta específica (`/api/v1/lobby/realtime` se elimina como filtro de conexión).
2. **La validación del mensaje inicial SE MANTIENE**: el cliente debe enviar un mensaje con `external_id` y `game_type` para activar su suscripción y comenzar a recibir datos. Si la estructura es errónea, no recibe nada y se cierra la conexión.
3. **Corte ante errores estructurales en proveedores (401 / 404)**: si cualquier conector recibe un error `401` o `404` en su llamado inicial (HTTP snapshot o handshake WebSocket), debe detenerse por completo sin reintentar y sin continuar al siguiente paso del flujo (no lanzar `connectStreaming()` si `fetchInitialState()` falla con estos códigos, no reconectar si el WS cierra con `401`).

---

## Resumen de archivos afectados

| Archivo | Tipo de cambio |
|---|---|
| `src/index.ts` | Rollback parcial: quitar filtro de ruta. La validación del mensaje inicial se mantiene. |
| `src/infrastructure/inbound/websocket/lobby.gateway.ts` | Sin cambios — la lógica de validación ya es la correcta. |
| `src/infrastructure/inbound/websocket/session.manager.ts` | Sin cambios — `isSubscribed: false` al inicio es correcto. |
| `src/api/routes/lobbyRealTime.ts` | Comentar contenido — la ruta HTTP 426 ya no tiene sentido sin filtro por ruta. |
| `src/providers/connectors/evolution.connector.ts` | Nuevo: corte ante 401/404 en HTTP y WS, sin reconexión. |
| `src/providers/connectors/ezugi.connector.ts` | Hereda de Evolution — el fix aplica automáticamente. |
| `src/providers/connectors/pragmatic.connector.ts` | Nuevo: corte ante errores de autenticación/estructura en el handshake. |
| `src/providers/connectors/playtech.connector.ts` | Nuevo: corte ante 401/404 en la REST API inicial. |

---

## Cambios detallados

---

### 1. `src/index.ts` — Rollback del filtro de ruta

**Qué se revierte:** La constante `WS_PATH`, el import del router y el bloque `if/else` en el handler `upgrade` que rechazaba conexiones a otras rutas.

**Qué NO se revierte:** La validación del mensaje inicial en el gateway sigue activa (es un requerimiento confirmado).

**Estado actual (ya aplicado en el archivo):**
```typescript
const PORT = parseInt(process.env.WS_PORT || '3000', 10);
//const WS_PATH = '/api/v1/lobby/realtime';  ← ya comentado

httpServer.on('upgrade', (request, socket, head) => {
  gateway.handleUpgrade(request, socket as any, head);
  /* filtro de ruta ya comentado */
});
```

El estado actual del `index.ts` **ya refleja el rollback de ruta correctamente**. No requiere cambios adicionales en este archivo respecto al punto 1.

---

### 2. `src/api/routes/lobbyRealTime.ts` — Comentar contenido

Sin el filtro de ruta en el upgrade handler, este archivo ya no cumple ninguna función útil.

**Estado actual:**
```typescript
import { Router } from 'express';

export const lobbyRealtimeRouter = Router();

lobbyRealtimeRouter.get('/lobby/realtime', (_req, res) => {
  res.status(426).json({ error: 'Esta ruta solo acepta conexiones WebSocket.' });
});
```

**Cómo debe quedar:**
```typescript
/* ROLLBACK — ruta HTTP 426 desactivada (ya no se filtra el WS por ruta específica)
import { Router } from 'express';

export const lobbyRealtimeRouter = Router();

lobbyRealtimeRouter.get('/lobby/realtime', (_req, res) => {
  res.status(426).json({ error: 'Esta ruta solo acepta conexiones WebSocket.' });
});
*/
```

---

### 3. `src/infrastructure/inbound/websocket/lobby.gateway.ts` — Sin cambios

La lógica actual **es la correcta y definitiva**. Se mantiene exactamente como está:

- Al conectarse, `isSubscribed = false`.
- El cliente debe enviar `{ external_id: string, game_type: string }`.
- Si el mensaje es inválido o el JSON está malformado → `close(1008, 'BAD_REQUEST')`.
- Si el mensaje es válido → `activateSubscription(clientId)` + `SUBSCRIPTION_ACK`.
- Mensajes posteriores al primero son ignorados.

```
✅ No requiere ningún cambio.
```

---

### 4. `src/infrastructure/inbound/websocket/session.manager.ts` — Sin cambios

El estado inicial `isSubscribed: false` es correcto y debe mantenerse. El método `activateSubscription()` y el filtro en `getSubscribedClients()` son necesarios para el requerimiento de validación de mensaje.

```
✅ No requiere ningún cambio.
```

---

### 5. `src/providers/connectors/evolution.connector.ts` — Corte ante 401/404

**Requerimiento:** Si `fetchInitialState()` recibe un `401` o `404`, no debe ejecutarse `connectStreaming()`. Si el WebSocket cierra con `401` (code `4001` o reason `'401'`), no debe reconectar.

**Estado actual de `fetchInitialState()`:**
```typescript
} catch (error: any) {
  if (error.response?.status === 401) {
    console.error('[HTTP][Evolution] ALERTA CRÍTICA: 401. Abortando reconexión automática.');
    return []; // Devuelve vacío pero no indica al caller que hubo un error fatal
  }
  console.error('[HTTP][Evolution] Error obteniendo estado inicial:', error.message);
  return [];
}
```

**Problema:** devuelve `[]` en todos los casos, por lo que `index.ts` no puede distinguir entre "no hay mesas" y "error fatal de autenticación". El `connectStreaming()` se lanza igual en `startEvolution()`.

**Cómo debe quedar `fetchInitialState()`:**
```typescript
// Cambiar la firma para señalizar errores fatales
public async fetchInitialState(): Promise<{ tables: EvTable[]; fatalError: boolean }> {
  const { httpUrl } = this.getEndpoints();
  try {
    console.log(`[HTTP][Evolution] Solicitando estado base: ${httpUrl}`);
    const response = await axios.get<{ tables: EvTable[] }>(httpUrl, {
      timeout: 10000,
      headers: { Authorization: this.getAuthHeader() },
    });
    return { tables: response.data.tables || [], fatalError: false };
  } catch (error: any) {
    const status = error.response?.status;

    // 401 o 404 → error estructural/de permisos → corte total, sin reintentar
    if (status === 401 || status === 404) {
      console.error(`[HTTP][Evolution] CORTE FATAL: Error ${status}. Verificar credenciales y endpoints. Sin reconexión.`);
      return { tables: [], fatalError: true };
    }

    console.error('[HTTP][Evolution] Error obteniendo estado inicial:', error.message);
    return { tables: [], fatalError: false };
  }
}
```

**Cómo debe quedar el bloque `close` en `connectStreaming()`:**

El manejo de `401` en el evento `close` del WebSocket ya está implementado correctamente:
```typescript
} else if (code === 4001 || reasonStr.includes('401')) {
  // Credenciales inválidas — no reintentar ✅ ya correcto
  console.error('[WSS][Evolution] Autenticación rechazada (401). Revisar CASINO_KEY y API_TOKEN.');
}
```

Agregar el caso `404` por completitud:
```typescript
} else if (code === 4001 || reasonStr.includes('401') || reasonStr.includes('404')) {
  console.error(`[WSS][Evolution] Error estructural (401/404). Sin reconexión automática.`);
}
```

---

### 6. `src/index.ts` — `startEvolution()` con control de error fatal

Con el cambio de firma de `fetchInitialState()`, `startEvolution()` debe respetar el `fatalError`:

**Estado actual:**
```typescript
function startEvolution(lobbyStateManager, adapter) {
  try {
    const connector = new EvolutionConnector((rawPayload) => { ... });

    connector.fetchInitialState().then((tables) => {
      console.log(`[Evolution] Snapshot inicial: ${tables.length} mesas`);
      tables.forEach((table) => { ... });
    });

    connector.connectStreaming(); // ← se lanza siempre, incluso si fetchInitialState falló con 401
  } catch (err) { ... }
}
```

**Cómo debe quedar:**
```typescript
function startEvolution(
  lobbyStateManager: LobbyStateManager,
  adapter: EvolutionAdapter,
): void {
  try {
    const connector = new EvolutionConnector((rawPayload: unknown) => {
      const patch = adapter.normalize(rawPayload);
      if (patch) lobbyStateManager.updateTableState(patch);
    });

    connector.fetchInitialState().then(({ tables, fatalError }) => {
      // Si hubo un error estructural (401/404), cortar aquí sin continuar
      if (fatalError) {
        console.error('[Evolution] Arranque abortado por error fatal en el snapshot HTTP. connectStreaming() no será llamado.');
        return;
      }

      console.log(`[Evolution] Snapshot inicial: ${tables.length} mesas`);
      tables.forEach((table) => {
        const patch = adapter.normalize({ type: 'table_assigned', id: 'initial', table });
        if (patch) lobbyStateManager.updateTableState(patch);
      });

      // Solo conectar el WebSocket si el snapshot HTTP fue exitoso
      connector.connectStreaming();
    });

  } catch (err: any) {
    console.error('[Evolution] No se pudo iniciar:', err.message);
  }
}
```

> **Nota:** `connector.connectStreaming()` se mueve **dentro del `.then()`** para que solo se ejecute si el snapshot fue exitoso. Actualmente está fuera del `.then()` y se ejecuta incondicionalmente.

---

### 7. `src/providers/connectors/pragmatic.connector.ts` — Corte ante error en handshake

Pragmatic no tiene un HTTP inicial, pero sí puede recibir un mensaje de error del servidor en el `open` o en los primeros mensajes. El cierre controlado ante rechazo de credenciales debe evitar el `scheduleReconnect()`.

**Agregar en `handleClose()`:**
```typescript
private handleClose(code: number, reason: string): void {
  console.warn(`[WSS][Pragmatic] Conexión cerrada. Código: ${code}, Razón: ${reason.toString()}`);
  this.isConnecting = false;
  this.ws = null;

  if (this.pingTimeout) clearTimeout(this.pingTimeout);

  // 401/403/4001 → error de autenticación o estructura → corte total
  const reasonStr = reason.toString();
  if (code === 4001 || code === 401 || reasonStr.includes('401') || reasonStr.includes('403') || reasonStr.includes('Unauthorized')) {
    console.error('[WSS][Pragmatic] CORTE FATAL: Autenticación rechazada. Verificar PRAGMATIC_CASINO_ID y TABLE_IDS. Sin reconexión.');
    return; // ← No llamar scheduleReconnect()
  }

  this.scheduleReconnect();
}
```

---

### 8. `src/providers/connectors/playtech.connector.ts` — Corte ante 401/404 en REST

**Agregar en `fetchInitialState()`:**
```typescript
public async fetchInitialState(): Promise<{ tables: PlaytechRestTable[]; fatalError: boolean }> {
  try {
    const endpoint = `${this.config.restUrl}/lobby/tables`;
    console.log(`[HTTP REST][Playtech] Conectando para estado inicial a: ${endpoint}`);

    const response = await axios.get<PlaytechRestTable[]>(endpoint, {
      headers: {
        Authorization: `Bearer ${this.config.restToken}`,
        Accept: 'application/json',
      },
      timeout: 8000,
    });

    return { tables: response.data || [], fatalError: false };
  } catch (error: any) {
    const status = error.response?.status;

    if (status === 401 || status === 404) {
      console.error(`[HTTP REST][Playtech] CORTE FATAL: Error ${status}. Verificar PLAYTECH_REST_TOKEN y REST_URL. Sin reconexión.`);
      return { tables: [], fatalError: true };
    }

    console.error('[HTTP REST][Playtech] Error consultando la API:', error.message);
    return { tables: [], fatalError: false };
  }
}
```

Y en `startPlaytech()` en `index.ts`:
```typescript
function startPlaytech(lobbyStateManager: LobbyStateManager, adapter: PlaytechAdapter): void {
  try {
    const connector = new PlaytechConnector((rawPayload: unknown) => {
      const patch = adapter.normalize(rawPayload);
      if (patch) lobbyStateManager.updateTableState(patch);
    });

    connector.fetchInitialState().then(({ tables, fatalError }) => {
      if (fatalError) {
        console.error('[Playtech] Arranque abortado por error fatal. connectKafkaStreaming() no será llamado.');
        return;
      }
      console.log(`[Playtech] Snapshot inicial: ${tables.length} mesas`);
      connector.connectKafkaStreaming();
    });

  } catch (err: any) {
    console.error('[Playtech] No se pudo iniciar:', err.message);
  }
}
```

---

### 9. `src/providers/connectors/ezugi.connector.ts` — Impacto por herencia

`EzugiConnector` extiende directamente `EvolutionConnector` y solo sobreescribe `getGameProvider()` para retornar `'ezugi'` en lugar de `'evolution'`. No tiene ninguna lógica propia de conexión, autenticación o manejo de errores.

```typescript
// ezugi.connector.ts — código completo actual
import { EvolutionConnector } from './evolution.connector';

export class EzugiConnector extends EvolutionConnector {
  protected override getGameProvider(): string {
    return 'ezugi';
  }
}
```

**Impacto de los cambios en `EvolutionConnector`:**

Todos los cambios aplicados a `EvolutionConnector` se propagan automáticamente a `EzugiConnector` por herencia. No se requiere ninguna modificación en el archivo `ezugi.connector.ts`.

| Cambio en `EvolutionConnector` | Efecto en `EzugiConnector` |
|---|---|
| `fetchInitialState()` retorna `{ tables, fatalError }` | `EzugiConnector.fetchInitialState()` hereda el mismo comportamiento. Si el endpoint de Ezugi responde `401` o `404`, también retorna `fatalError: true`. |
| Corte sin reconexión ante `401`/`404` en el snapshot HTTP | Aplica igual para Ezugi. El snapshot usa las mismas credenciales (`EVOLUTION_CASINO_KEY`, `EVOLUTION_API_TOKEN`) y el mismo hostname, pero con `gameProvider=ezugi` en los query params. |
| WS `close` con código `4001` o reason `'401'`/`'404'` no reconecta | Aplica igual para Ezugi. |
| Backoff exponencial para otros códigos de cierre | Aplica igual para Ezugi. |

**Diferencia clave respecto a Evolution:** el parámetro `gameProvider=ezugi` en la URL hace que el stream de Evolution filtre y entregue solo mesas del sub-proveedor Ezugi. Las credenciales, el hostname y todos los mecanismos de resiliencia son compartidos. Por eso un error `401` en Ezugi implica que las mismas credenciales están fallando para Evolution también, y ambos servicios deben detenerse.

**Lo que sí se necesita ajustar** es `startEzugi()` en `index.ts`, aplicando el mismo patrón que `startEvolution()` — mover `connectStreaming()` dentro del `.then()` y validar `fatalError`:

**Estado actual de `startEzugi()` en `index.ts`:**
```typescript
function startEzugi(
  lobbyStateManager: LobbyStateManager,
  adapter: EzugiAdapter,
): void {
  try {
    const connector = new EzugiConnector((rawPayload: unknown) => {
      const patch = adapter.normalize(rawPayload);
      if (patch) lobbyStateManager.updateTableState(patch);
    });

    connector.fetchInitialState().then((tables) => {
      // ← recibe tables directamente (firma antigua)
      console.log(`[Ezugi] Snapshot inicial: ${tables.length} mesas`);
    });

    connector.connectStreaming(); // ← fuera del .then(), se lanza siempre
  } catch (err: any) {
    console.error('[Ezugi] No se pudo iniciar:', err.message);
  }
}
```

**Cómo debe quedar:**
```typescript
function startEzugi(
  lobbyStateManager: LobbyStateManager,
  adapter: EzugiAdapter,
): void {
  try {
    const connector = new EzugiConnector((rawPayload: unknown) => {
      const patch = adapter.normalize(rawPayload);
      if (patch) lobbyStateManager.updateTableState(patch);
    });

    connector.fetchInitialState().then(({ tables, fatalError }) => {
      // Si hubo un error estructural (401/404), cortar aquí sin continuar
      if (fatalError) {
        console.error('[Ezugi] Arranque abortado por error fatal en el snapshot HTTP. connectStreaming() no será llamado.');
        return;
      }

      console.log(`[Ezugi] Snapshot inicial: ${tables.length} mesas`);
      tables.forEach((table) => {
        const patch = adapter.normalize({ type: 'table_assigned', id: 'initial', table });
        if (patch) lobbyStateManager.updateTableState(patch);
      });

      // Solo conectar el WebSocket si el snapshot HTTP fue exitoso
      connector.connectStreaming();
    });

  } catch (err: any) {
    console.error('[Ezugi] No se pudo iniciar:', err.message);
  }
}
```

---

## Comportamiento final esperado

### Flujo del cliente WebSocket
```
Cliente conecta a ws://host:3000
  ↓
isSubscribed = false → no recibe datos todavía
  ↓
Cliente envía: { "external_id": "evolution_ev-bj-1", "game_type": "blackjack" }
  ↓
  ├─ JSON inválido o campos faltantes → close(1008, BAD_REQUEST) ← corte
  └─ Válido → SUBSCRIPTION_ACK + isSubscribed = true → empieza a recibir parches
```

### Flujo de arranque de proveedores
```
startEvolution()
  ↓
fetchInitialState()
  ├─ 401 / 404 → fatalError = true → log crítico → STOP (connectStreaming NO se llama)
  ├─ Otro error → fatalError = false → connectStreaming() con backoff
  └─ OK → poblar caché → connectStreaming()
       ↓
       WS close con 401/4001 → STOP (no reconnectWithBackoff)
       WS close con 4000     → resyncAndReconnect()
       WS close otros        → reconnectWithBackoff()
```

### Tabla comparativa de comportamientos

| Escenario | Antes | Después |
|---|---|---|
| URL de conexión WS clientes | `ws://host:3000/api/v1/lobby/realtime` | `ws://host:3000` (cualquier ruta) |
| Mensaje inicial requerido | Sí | Sí (se mantiene) |
| Estructura inválida en mensaje | `close(1008)` | `close(1008)` (sin cambio) |
| Cliente sin mensaje inicial | No recibe datos | No recibe datos (sin cambio) |
| `fetchInitialState()` con 401/404 (Evolution) | Devuelve `[]`, igual lanza `connectStreaming()` | Devuelve `fatalError: true`, **no lanza** `connectStreaming()` |
| `fetchInitialState()` con 401/404 (Ezugi) | Devuelve `[]`, igual lanza `connectStreaming()` ❌ | Hereda fix de Evolution, `fatalError: true`, **no lanza** `connectStreaming()` ✅ |
| `startEzugi()` en `index.ts` | `connectStreaming()` fuera del `.then()`, se lanza siempre ❌ | `connectStreaming()` dentro del `.then()`, condicionado a `fatalError` ✅ |
| WS Evolution/Ezugi cierra con 401 | No reconecta ✅ (ya estaba) | No reconecta ✅ |
| Pragmatic cierra con 401 | Reconecta con backoff ❌ | No reconecta ✅ |
| Playtech REST 401/404 | Devuelve `[]`, igual lanza Kafka ❌ | Devuelve `fatalError: true`, **no lanza** Kafka ✅ |

---

## Orden de aplicación

1. `src/api/routes/lobbyRealTime.ts` — comentar contenido completo
2. `src/providers/connectors/evolution.connector.ts` — cambiar firma de `fetchInitialState()`, agregar `404` en el `close`
3. `src/providers/connectors/pragmatic.connector.ts` — agregar corte en `handleClose()`
4. `src/providers/connectors/playtech.connector.ts` — cambiar firma de `fetchInitialState()`
5. `src/index.ts` — mover `connectStreaming()` dentro del `.then()` en `startEvolution()` y `startEzugi()`, aplicar mismo patrón en `startPlaytech()`

> `ezugi.connector.ts` no requiere cambios. Los fixes se heredan automáticamente desde `EvolutionConnector`.
