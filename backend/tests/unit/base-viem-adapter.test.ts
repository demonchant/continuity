import { describe, expect, it, vi } from 'vitest';
import { encodeFunctionData, parseEther } from 'viem';
import { baseSepolia } from 'viem/chains';
import {
  BaseViemAdapter,
  type BaseViemClients,
} from '../../src/integrations/base/base-viem-adapter.js';

const hash = `0x${'a'.repeat(64)}` as const;
const accountAddress = '0x1111111111111111111111111111111111111111';
const recipient = '0x2222222222222222222222222222222222222222';

function clients(): BaseViemClients {
  return {
    accountAddress,
    wallet: {
      sendTransaction: vi.fn().mockResolvedValue(hash),
    },
    public: {
      getChainId: vi.fn().mockResolvedValue(84532),
      waitForTransactionReceipt: vi
        .fn()
        .mockResolvedValue({ transactionHash: hash, status: 'success', blockNumber: 123n }),
      getTransactionReceipt: vi
        .fn()
        .mockResolvedValue({ transactionHash: hash, status: 'success', blockNumber: 123n }),
    },
  };
}

describe('BaseViemAdapter', () => {
  it('constructs the documented Base Sepolia native transfer', async () => {
    const sdk = clients();
    const adapter = new BaseViemAdapter('base-sepolia', sdk);
    await expect(
      adapter.sendNativeTransfer({ recipient, amountWei: parseEther('0.0001') }),
    ).resolves.toBe(hash);
    expect(sdk.wallet.sendTransaction).toHaveBeenCalledWith({
      account: accountAddress,
      chain: baseSepolia,
      to: recipient,
      value: parseEther('0.0001'),
    });
    expect(adapter.chainId).toBe(84532);
  });

  it('waits for and normalizes an onchain confirmation', async () => {
    const sdk = clients();
    const adapter = new BaseViemAdapter('base-sepolia', sdk);
    await expect(adapter.waitForConfirmation(hash, 2)).resolves.toEqual({
      transactionHash: hash,
      status: 'success',
      blockNumber: 123n,
    });
    expect(sdk.public.waitForTransactionReceipt).toHaveBeenCalledWith({ hash, confirmations: 2 });
  });

  it('constructs an ERC-20 transfer for Base USDC', async () => {
    const sdk = clients();
    const adapter = new BaseViemAdapter('base-sepolia', sdk);
    const tokenAddress = '0x036CbD53842c5426634e7929541eC2318f3dCF7e';
    await adapter.sendTokenTransfer({ recipient, tokenAddress, amountBaseUnits: 800000n });
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
      args: [recipient, 800000n],
    });
    expect(sdk.wallet.sendTransaction).toHaveBeenCalledWith({
      account: accountAddress,
      chain: baseSepolia,
      to: tokenAddress,
      data,
      value: 0n,
    });
  });

  it('classifies submission failures without exposing provider payloads', async () => {
    const sdk = clients();
    sdk.wallet.sendTransaction = vi.fn().mockRejectedValue(new Error('secret RPC response'));
    const adapter = new BaseViemAdapter('base-sepolia', sdk);
    await expect(adapter.sendNativeTransfer({ recipient, amountWei: 1n })).rejects.toMatchObject({
      code: 'BASE_TRANSACTION_FAILED',
      retriable: true,
      message: 'Base transaction submission failed',
    });
  });
});
