export interface IProviderConnector {
  start(): Promise<void>;
  dispose(): Promise<void>;
  readonly name: string;
}