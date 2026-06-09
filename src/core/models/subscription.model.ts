export enum ProviderId {
  EZUGI     = 1,
  EVOLUTION = 2,
  PRAGMATIC = 3,
  PLAYTECH  = 4,
}

export interface SubscriptionMessage {
  token: string;
  provider_type: number[];
}

/* export function normalizeProviderTypes(value: number | number[]): number[] {
  return Array.isArray(value) ? value : [value];
} */

export const PROVIDER_CATALOG: Record<ProviderId, string> = {
  [ProviderId.EZUGI]:     'Ezugi',
  [ProviderId.EVOLUTION]: 'Evolution Gaming',
  [ProviderId.PRAGMATIC]: 'Pragmatic Play',
  [ProviderId.PLAYTECH]:  'Playtech',
};

export const ALL_PROVIDER_IDS: number[] = [
  ProviderId.EZUGI,
  ProviderId.EVOLUTION,
  ProviderId.PRAGMATIC,
  ProviderId.PLAYTECH,
];

export const VALID_PROVIDER_IDS = [1, 2, 3, 4] as const;
//export type ProviderId = (typeof VALID_PROVIDER_IDS)[number];