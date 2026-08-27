export type BaseNetwork = 'base' | 'base-sepolia';
export type TransactionHash = `0x${string}`;

export interface BaseTransferRequest {
  readonly recipient: `0x${string}`;
  readonly amountWei: bigint;
}

export interface BaseTokenTransferRequest {
  readonly recipient: `0x${string}`;
  readonly tokenAddress: `0x${string}`;
  readonly amountBaseUnits: bigint;
}

export interface BaseConfirmation {
  readonly transactionHash: TransactionHash;
  readonly status: 'success' | 'reverted';
  readonly blockNumber: bigint;
}

/** Application boundary implemented with Base's documented viem transaction flow. */
export interface BaseTransactionGateway {
  readonly network: BaseNetwork;
  readonly chainId: number;
  readonly explorerBaseUrl: string;
  sendNativeTransfer(request: BaseTransferRequest): Promise<TransactionHash>;
  sendTokenTransfer(request: BaseTokenTransferRequest): Promise<TransactionHash>;
  waitForConfirmation(hash: TransactionHash, confirmations: number): Promise<BaseConfirmation>;
  getConfirmation(hash: TransactionHash): Promise<BaseConfirmation | null>;
}
