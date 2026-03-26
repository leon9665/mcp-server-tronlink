/**
 * MCP tool definitions for wallet management.
 *
 * These tools are registered alongside core tools and provide
 * runtime wallet operations: list, switch.
 */

import type { Wallet } from '@bankofai/agent-wallet';
import {
  listWallets,
  setActiveWallet,
  resolveSecureWallet,
} from './wallet.js';

// ── Types ────────────────────────────────────────────────

interface ToolResponse {
  ok: boolean;
  meta: { timestamp: string; durationMs: number };
  result?: unknown;
  error?: { code: string; message: string };
}

export interface WalletToolDef {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  handler: (args: Record<string, unknown>) => Promise<ToolResponse>;
}

/**
 * Callback invoked after the active wallet is switched.
 * Allows the caller (index.ts) to propagate the new wallet
 * into live capability instances.
 */
export type OnWalletSwap = (newWallet: Wallet) => void;

// ── Helper ───────────────────────────────────────────────

function wrapHandler(
  fn: (args: Record<string, unknown>) => Promise<unknown>,
): (args: Record<string, unknown>) => Promise<ToolResponse> {
  return async (args) => {
    const start = Date.now();
    try {
      const result = await fn(args);
      return {
        ok: true,
        meta: { timestamp: new Date().toISOString(), durationMs: Date.now() - start },
        result,
      };
    } catch (err) {
      return {
        ok: false,
        meta: { timestamp: new Date().toISOString(), durationMs: Date.now() - start },
        error: {
          code: 'TL_WALLET_ERROR',
          message: err instanceof Error ? err.message : String(err),
        },
      };
    }
  };
}

// ── Tool definitions ─────────────────────────────────────

export function getWalletToolDefinitions(
  prefix: string,
  network: string,
  onWalletSwap?: OnWalletSwap,
): WalletToolDef[] {
  return [
    {
      name: `${prefix}_wallet_list`,
      description:
        'List all agent-wallet wallets with their IDs, types, active status, and TRON addresses.',
      inputSchema: {
        type: 'object',
        properties: {},
      },
      handler: wrapHandler(async () => {
        const wallets = await listWallets(network);
        if (wallets.length === 0) {
          return {
            wallets,
            message:
              'No wallets configured. Two options:\n' +
              '  Option A (auto): Restart the MCP server — a wallet will be auto-generated\n' +
              '  Option B (manual):\n' +
              '    1. agent-wallet start local_secure --generate --wallet-id main\n' +
              '    2. Add AGENT_WALLET_PASSWORD to your .mcp.json env and restart',
          };
        }
        return { wallets };
      }),
    },
    {
      name: `${prefix}_wallet_set_active`,
      description:
        'Switch the active wallet by wallet ID. The new wallet will be used for all subsequent on-chain, gasfree, and multisig operations.',
      inputSchema: {
        type: 'object',
        properties: {
          wallet_id: {
            type: 'string',
            description: 'The wallet ID to activate',
          },
        },
        required: ['wallet_id'],
      },
      handler: wrapHandler(async (args) => {
        const walletId = args.wallet_id as string;
        const address = await setActiveWallet(network, walletId);

        // Propagate the new wallet into live capabilities
        if (onWalletSwap) {
          const newWallet = await resolveSecureWallet(network, walletId);
          onWalletSwap(newWallet);
        }

        return { wallet_id: walletId, address, message: `Active wallet set to "${walletId}"` };
      }),
    },
  ];
}
