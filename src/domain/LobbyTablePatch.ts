export interface LobbyTablePatch {
  external_id: string;
  idProveedor: number;
  nameProveedor: string;
  providerTableId: string;
  gameType:
    | 'roulette'
    | 'blackjack'
    | 'baccarat'
    | 'dragon-tiger'
    | 'sicbo'
    | 'poker'
    | 'other';
  eventType?:
    | 'TABLE_OPENED'
    | 'TABLE_CLOSED'
    | 'TABLE_UPDATED'
    | 'BETTING_OPENED'
    | 'BETTING_CLOSED'
    | 'PLAYERS_UPDATED'
    | 'SEATS_UPDATED'
    | 'RESULT_UPDATED';
  realtime: {
    isAvailable?: boolean;
    bettingOpen?: boolean;
    minBet: number;
    maxBet?: number;
    currency?: string;
    playersOnline?: number;
    availableSeats?: number;
    dealerName?: string;
    updatedAt: string;
  };
  lastResult?: {
    winningNumber?: number;
    winner?: string;
    playerHandValue?: number;
    bankerHandValue?: number;
    roundId?: number;
  };
}