import { LobbyTablePatch } from "../../domain/LobbyTablePatch";
import { ProviderAdapter } from "./base.adapter";

export class PragmaticAdapter extends ProviderAdapter {

  private readonly ID_PROVEEDOR = 3; 
  private readonly NAME_PROVEEDOR = 'PRAGMATIC_PROVIDER';

  normalize(payload: any): LobbyTablePatch | null {
    if (!payload || !payload.tableId) {
      return null;
    }

    const tableId = String(payload.tableId);
    const rawTableType = payload.tableType;
    const isAvailable = payload.tableOpen;

    let gameType: LobbyTablePatch['gameType'] = 'other';
    if (rawTableType) {
      const lowerType = rawTableType.toLowerCase();
      if (['roulette', 'blackjack', 'baccarat', 'sicbo', 'poker'].includes(lowerType)) {
        gameType = lowerType as LobbyTablePatch['gameType'];
      } else if (lowerType === 'dragontiger') {
        gameType = 'dragon-tiger';
      }
    }

    let eventType = "TABLE_UPDATED";
    if (isAvailable === true) eventType = "TABLE_OPENED";
    if (isAvailable === false) eventType = "TABLE_CLOSED";

    let lastResultData: any = undefined;
    if (payload.gameResult && Array.isArray(payload.gameResult) && payload.gameResult.length > 0) {
      const latest = payload.gameResult[0];
      lastResultData = {
        winningNumber: latest.result !== undefined ? Number(latest.result) : undefined, // Convertido a número por el contrato
        winner: latest.winner || undefined,
        roundId: latest.gameId ? String(latest.gameId) : undefined,
      };
    } else if (payload.last20Results && Array.isArray(payload.last20Results) && payload.last20Results.length > 0) {
      const latest = payload.last20Results[0];
      lastResultData = {
        winningNumber: latest.result !== undefined ? Number(latest.result) : undefined,
        winner: latest.color || undefined,
        roundId: latest.gameId ? String(latest.gameId) : undefined,
      };
    }

    const isClassicBlackjack = gameType === "blackjack" && payload.tableSubtype !== "OneBJ";
    const availableSeats = isClassicBlackjack && typeof payload.availableSeats === 'number' 
      ? payload.availableSeats 
      : undefined;

    let gameData: LobbyTablePatch['gameData'] = undefined;

    if (isClassicBlackjack && payload.boxes && Array.isArray(payload.boxes)) {
      eventType = "SEATS_UPDATED";
      gameData = {
        seats: payload.boxes.map((box: any, index: number) => ({
          seatIndex: box.cardsPosition !== undefined ? box.cardsPosition : index,
          occupied: box.status === 'Occupied',
          status: box.status ? box.status.toUpperCase() : undefined,
          seatCards: box.cards || undefined,
          seatScore: box.score || undefined
        }))
      };
    }

    if (gameType === 'baccarat' && payload.shoeStats) {
      gameData = {
        statistics: {
          shoeRoadmap: payload.roadmap || undefined,
          baccaratStats: {
            playerWinsCount: payload.shoeStats.playerWins || 0,
            bankerWinsCount: payload.shoeStats.bankerWins || 0,
            tieWinsCount: payload.shoeStats.ties || 0,
            playerPairsCount: payload.shoeStats.playerPairs || 0,
            bankerPairsCount: payload.shoeStats.bankerPairs || 0,
          }
        }
      };
    }

    return {
      external_id: `pragmatic_${tableId}`,
      idProveedor: this.ID_PROVEEDOR,
      nameProveedor: this.NAME_PROVEEDOR,
      providerTableId: tableId,
      gameType: gameType,
      eventType: eventType as LobbyTablePatch['eventType'],
      realtime: {
        isAvailable: isAvailable,
        minBet: payload.tableLimits?.minBet !== undefined ? payload.tableLimits.minBet : 0,
        maxBet: payload.tableLimits?.maxBet !== undefined ? payload.tableLimits.maxBet : undefined,
        currency: payload.currency || 'EUR',
        availableSeats: availableSeats, 
        updatedAt: this.now(), 
      },
      ...(lastResultData && { lastResult: lastResultData }),
      ...(gameData && { gameData: gameData })
    };
  }
}