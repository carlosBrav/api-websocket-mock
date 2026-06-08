import { LobbyTablePatch } from '../../domain/LobbyTablePatch';

export function mapGameRoundToLobbyPatch(gameData: any, providerId: number): LobbyTablePatch {
  const isEzugi = gameData.gameProvider === 'ezugi';
  const prefix = isEzugi ? 'ezugi_' : 'evolution_';
  
  // 1. Calcular asientos disponibles en Blackjack de forma reactiva
  let availableSeats: number | undefined;
  if (gameData.gameType === 'blackjack' && gameData.result?.seats) {
    const totalSeats = 7;
    const occupiedSeatsCount = Object.keys(gameData.result.seats).length;
    availableSeats = Math.max(0, totalSeats - occupiedSeatsCount);
  }

  return {
    external_id: `${prefix}${gameData.table.id}`,
    idProveedor: providerId,
    nameProveedor: 'EVOLUTION_STREAM',
    providerTableId: '',
    gameType: gameData.gameType,

    realtime: {
      // Si la mesa está resolviendo rondas, garantizamos que está disponible
      isAvailable: gameData.status === 'Resolved' ? true : undefined,
      availableSeats,
      updatedAt: gameData.settledAt || new Date().toISOString(),
      minBet: gameData.minBet
    }
  };
}