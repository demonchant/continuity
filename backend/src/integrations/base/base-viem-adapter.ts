import {
  createPublicClient,
  createWalletClient,
  encodeFunctionData,
  http,
  type Address,
  type Hash,
  type PublicClient,
  type WalletClient,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { base, baseSepolia } from 'viem/chains';
import type {
  BaseConfirmation,
  BaseNetwork,
  BaseTransactionGateway,
  BaseTokenTransferRequest,
  BaseTransferRequest,
  TransactionHash,
} from './base-gateway.js';
import { BaseIntegrationError } from './base-errors.js';

export interface BaseViemConfiguration {
  readonly network: BaseNetwork;
  readonly rpcUrl: string;
  readonly privateKey: `0x${string}`;
  readonly timeoutMs?: number;
  readonly retryCount?: number;
}

export interface BaseViemClients {
  readonly accountAddress: Address;
  readonly wallet: Pick<WalletClient, 'sendTransaction'>;
  readonly public: Pick<
    PublicClient,
    'getChainId' | 'waitForTransactionReceipt' | 'getTransactionReceipt'
  >;
}

function chainFor(network: BaseNetwork) {
  return network === 'base' ? base : baseSepolia;
}

function confirmation(receipt: {
  readonly transactionHash: Hash;
  readonly status: 'success' | 'reverted';
  readonly blockNumber: bigint;
}): BaseConfirmation {
  return {
    transactionHash: receipt.transactionHash,
    status: receipt.status,
    blockNumber: receipt.blockNumber,
  };
}

export class BaseViemAdapter implements BaseTransactionGateway {
  readonly chainId: number;
  readonly explorerBaseUrl: string;
  private readonly chain: typeof base | typeof baseSepolia;

  constructor(
    readonly network: BaseNetwork,
    private readonly clients: BaseViemClients,
  ) {
    this.chain = chainFor(network);
    this.chainId = this.chain.id;
    this.explorerBaseUrl = this.chain.blockExplorers.default.url;
  }

  static async create(configuration: BaseViemConfiguration): Promise<BaseViemAdapter> {
    const chain = chainFor(configuration.network);
    const account = privateKeyToAccount(configuration.privateKey);
    const transport = http(configuration.rpcUrl, {
      timeout: configuration.timeoutMs ?? 10_000,
      retryCount: configuration.retryCount ?? 2,
      retryDelay: 250,
    });
    const clients: BaseViemClients = {
      accountAddress: account.address,
      wallet: createWalletClient({ account, chain, transport }),
      public: createPublicClient({ chain, transport }),
    };
    const adapter = new BaseViemAdapter(configuration.network, clients);
    const actualChainId = await clients.public.getChainId();
    if (actualChainId !== chain.id) {
      throw new BaseIntegrationError(
        'BASE_NETWORK_MISMATCH',
        `Configured Base RPC returned chain ${actualChainId}; expected ${chain.id}`,
        false,
      );
    }
    return adapter;
  }

  async sendNativeTransfer(request: BaseTransferRequest): Promise<TransactionHash> {
    try {
      return await this.clients.wallet.sendTransaction({
        account: this.clients.accountAddress,
        chain: this.chain,
        to: request.recipient,
        value: request.amountWei,
      });
    } catch (error) {
      throw new BaseIntegrationError(
        'BASE_TRANSACTION_FAILED',
        'Base transaction submission failed',
        true,
        { cause: error },
      );
    }
  }

  async sendTokenTransfer(request: BaseTokenTransferRequest): Promise<TransactionHash> {
    try {
      const data = encodeFunctionData({
        abi: [
          {
            type: 'function',
            name: 'transfer',
            stateMutability: 'nonpayable',
            inputs: [
              { name: 'to', type: 'address' },
              { name: 'amount', type: 'uint256' },
            ],
            outputs: [{ name: '', type: 'bool' }],
          },
        ] as const,
        functionName: 'transfer',
        args: [request.recipient, request.amountBaseUnits],
      });
      return await this.clients.wallet.sendTransaction({
        account: this.clients.accountAddress,
        chain: this.chain,
        to: request.tokenAddress,
        data,
        value: 0n,
      });
    } catch (error) {
      throw new BaseIntegrationError(
        'BASE_TRANSACTION_FAILED',
        'Base token transaction submission failed',
        true,
        { cause: error },
      );
    }
  }

  async waitForConfirmation(
    hash: TransactionHash,
    confirmations: number,
  ): Promise<BaseConfirmation> {
    try {
      return confirmation(
        await this.clients.public.waitForTransactionReceipt({ hash, confirmations }),
      );
    } catch (error) {
      throw new BaseIntegrationError(
        'BASE_CONFIRMATION_FAILED',
        'Base transaction confirmation failed',
        true,
        { cause: error },
      );
    }
  }

  async getConfirmation(hash: TransactionHash): Promise<BaseConfirmation | null> {
    try {
      return confirmation(await this.clients.public.getTransactionReceipt({ hash }));
    } catch {
      return null;
    }
  }
}
