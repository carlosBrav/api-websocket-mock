import { LobbyTablePatch } from "../../domain/LobbyTablePatch";
import { ProviderAdapter } from "./base.adapter";

export class PragmaticAdapter extends ProviderAdapter {

  private readonly ID_PROVEEDOR = 3; 
  private readonly NAME_PROVEEDOR = 'PRAGMATIC_PROVIDER';

  normalize(payload: any): LobbyTablePatch | null {
    // 1. Validación de seguridad: Pragmatic siempre envía un tableId en sus actualizaciones
    if (!payload || !payload.tableId) {
      return null;
    }

    const tableId = String(payload.tableId);
    const tableType = payload.tableType; // Ejemplo: "BLACKJACK", "ROULETTE", "BACCARAT"
    const isAvailable = payload.tableOpen; // Booleano real del documento (true/false)

    // 2. Determinar el tipo de evento para el BFF de forma dinámica
    let eventType = "TABLE_UPDATED";
    if (isAvailable === true) eventType = "TABLE_OPENED";
    if (isAvailable === false) eventType = "TABLE_CLOSED";

    // 3. Extraer el último resultado si el juego tiene historial (gameResult o last20Results)
    let lastResultData: any = undefined;
    
    if (payload.gameResult && Array.isArray(payload.gameResult) && payload.gameResult.length > 0) {
      // Tomamos el primer elemento (el más reciente) del array de resultados
      const latest = payload.gameResult[0];
      lastResultData = {
        winningNumber: latest.result !== undefined ? String(latest.result) : undefined,
        winner: latest.winner || undefined,
        roundId: latest.gameId || undefined,
      };
    } else if (payload.last20Results && Array.isArray(payload.last20Results) && payload.last20Results.length > 0) {
      // Para Ruleta o Mega Wheel que usan 'last20Results'
      const latest = payload.last20Results[0];
      lastResultData = {
        winningNumber: latest.result !== undefined ? String(latest.result) : undefined,
        winner: latest.color || undefined, // En ruleta se usa el color (red/black)
        roundId: latest.gameId || undefined,
      };
    }

    // 4. Lógica condicional exclusiva para Blackjack clásico (Asientos físicos)
    // El subtipo 'OneBJ' maneja jugadores infinitos, por lo que se excluye de los asientos físicos
    const isClassicBlackjack = tableType === "BLACKJACK" && payload.tableSubtype !== "OneBJ";
    const availableSeats = isClassicBlackjack && typeof payload.availableSeats === 'number' 
      ? payload.availableSeats 
      : undefined;

    // 5. Retornar el contrato canónico unificado mapeando los campos del PDF
    return {
      external_id: `pragmatic_${tableId}`,
      idProveedor: this.ID_PROVEEDOR,
      nameProveedor: this.NAME_PROVEEDOR,
      providerTableId: tableId,
      gameType: tableType || 'UNKNOWN',
      eventType: eventType,
      realtime: {
        isAvailable: isAvailable,
        minBet: payload.tableLimits?.minBet !== undefined ? payload.tableLimits.minBet : undefined,
        currency: payload.currency || 'EUR', // 'EUR' por defecto según el PDF
        availableSeats: availableSeats, // Solo Blackjack clásico
        updatedAt: this.now(), // Heredado de tu base.adapter
      },
      // Si logramos capturar un resultado del stream, lo añadimos; si no, queda limpio
      ...(lastResultData && { lastResult: lastResultData })
    };
  }
}
