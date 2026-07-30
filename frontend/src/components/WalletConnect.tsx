'use client';

/**
 * WalletConnect.tsx
 *
 * MetaMask wallet connection button for Investor users.
 *
 * Flow:
 *  1. On mount: call GET /api/users/me to check if a wallet is already stored.
 *  2. User clicks "Connect Wallet":
 *     a. Request MetaMask accounts via window.ethereum.request
 *     b. Optionally prompt to switch to Sepolia (chain 0xaa36a7)
 *     c. Send PATCH /api/users/me/wallet with the address
 *     d. Update UI to show truncated address
 *  3. "Disconnect": clears only the UI state (wallet_address stays in DB
 *     so token minting still works — investor can re-connect to update it).
 *
 * Props:
 *  compact — if true, renders a small inline badge instead of a full button
 *            (used in the Sidebar footer)
 */

import { useEffect, useState, useCallback } from 'react';
import { useApi } from '@/lib/api';

// Ethereum window type extension
declare global {
  interface Window {
    ethereum?: {
      isMetaMask?: boolean;
      request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
      on: (event: string, handler: (...args: unknown[]) => void) => void;
      removeListener: (event: string, handler: (...args: unknown[]) => void) => void;
    };
  }
}

const SEPOLIA_CHAIN_ID = '0xaa36a7'; // 11155111 in hex

function truncate(addr: string) {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

interface WalletConnectProps {
  compact?: boolean;
}

export function WalletConnect({ compact = false }: WalletConnectProps) {
  const api = useApi();
  const [wallet, setWallet]     = useState<string | null>(null);
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState<string | null>(null);
  const [noMM, setNoMM]         = useState(false); // MetaMask not detected

  // ── Fetch current wallet from backend ────────────────────────────────────────
  useEffect(() => {
    api.get<{ wallet_address: string | null }>('/api/users/me')
      .then(u => { if (u.wallet_address) setWallet(u.wallet_address); })
      .catch(() => { /* non-fatal: silently skip */ });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Listen for MetaMask account changes ──────────────────────────────────────
  useEffect(() => {
    if (!window.ethereum) return;
    const handler = (accounts: unknown) => {
      const list = accounts as string[];
      if (list.length === 0) setWallet(null); // user disconnected in MetaMask
    };
    window.ethereum.on('accountsChanged', handler);
    return () => window.ethereum?.removeListener('accountsChanged', handler);
  }, []);

  // ── Connect ──────────────────────────────────────────────────────────────────
  const handleConnect = useCallback(async () => {
    setError(null);

    if (!window.ethereum?.isMetaMask) {
      setNoMM(true);
      return;
    }

    setLoading(true);
    try {
      // 1. Request accounts
      const accounts = (await window.ethereum.request({
        method: 'eth_requestAccounts',
      })) as string[];

      const address = accounts[0];
      if (!address) throw new Error('No account returned from MetaMask.');

      // 2. Switch to Sepolia (non-blocking — if user rejects, we still save the address)
      try {
        await window.ethereum.request({
          method: 'wallet_switchEthereumChain',
          params: [{ chainId: SEPOLIA_CHAIN_ID }],
        });
      } catch (switchErr) {
        // 4902 = chain not added to MetaMask; prompt to add it
        if ((switchErr as { code?: number }).code === 4902) {
          try {
            await window.ethereum.request({
              method: 'wallet_addEthereumChain',
              params: [{
                chainId: SEPOLIA_CHAIN_ID,
                chainName: 'Sepolia Testnet',
                nativeCurrency: { name: 'Sepolia ETH', symbol: 'ETH', decimals: 18 },
                rpcUrls: ['https://sepolia.infura.io/v3/'],
                blockExplorerUrls: ['https://sepolia.etherscan.io'],
              }],
            });
          } catch {
            /* user rejected add-chain — proceed anyway */
          }
        }
        /* user rejected switch — that's fine, address is still valid */
      }

      // 3. Save to backend
      const result = await api.patch<{ walletAddress: string }>(
        '/api/users/me/wallet',
        { walletAddress: address }
      );

      setWallet(result.walletAddress);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to connect wallet.';
      if (msg.toLowerCase().includes('user rejected')) {
        setError('Connection rejected in MetaMask.');
      } else {
        setError(msg);
      }
    } finally {
      setLoading(false);
    }
  }, [api]);

  // ── Disconnect (UI only) ──────────────────────────────────────────────────────
  const handleDisconnect = useCallback(() => {
    setWallet(null);
    setError(null);
  }, []);

  // ── MetaMask not installed ─────────────────────────────────────────────────
  if (noMM) {
    return (
      <a
        href="https://metamask.io/download/"
        target="_blank"
        rel="noreferrer"
        className="block w-full text-center rounded-md bg-orange-900/40 border border-orange-700/40 px-3 py-2 text-xs text-orange-300 hover:bg-orange-900/60 transition-colors"
      >
        🦊 Install MetaMask
      </a>
    );
  }

  // ── Compact badge (Sidebar) ───────────────────────────────────────────────
  if (compact) {
    if (wallet) {
      return (
        <div className="flex items-center justify-between px-2 py-1.5 rounded-md bg-green-900/30 border border-green-700/30">
          <span className="flex items-center gap-1.5 text-xs text-green-300">
            <span className="h-1.5 w-1.5 rounded-full bg-green-400 flex-shrink-0" />
            <span className="font-mono">{truncate(wallet)}</span>
          </span>
          <button
            onClick={handleDisconnect}
            className="text-xs text-gray-500 hover:text-gray-300 transition-colors ml-1"
            title="Disconnect wallet (UI only)"
          >
            ×
          </button>
        </div>
      );
    }
    return (
      <button
        onClick={handleConnect}
        disabled={loading}
        className="w-full flex items-center gap-2 rounded-md px-3 py-1.5 text-xs text-gray-400 hover:bg-gray-800 hover:text-orange-300 transition-colors disabled:opacity-50"
      >
        <span>🦊</span>
        {loading ? 'Connecting…' : 'Connect Wallet'}
      </button>
    );
  }

  // ── Full button (standalone) ──────────────────────────────────────────────
  return (
    <div className="space-y-2">
      {wallet ? (
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 rounded-lg bg-green-900/30 border border-green-700/30 px-3 py-2 flex-1">
            <span className="h-2 w-2 rounded-full bg-green-400 flex-shrink-0" />
            <span className="font-mono text-sm text-green-300">{truncate(wallet)}</span>
            <a
              href={`https://sepolia.etherscan.io/address/${wallet}`}
              target="_blank"
              rel="noreferrer"
              className="ml-auto text-xs text-gray-500 hover:text-indigo-400 transition-colors"
            >
              ↗
            </a>
          </div>
          <button
            onClick={handleDisconnect}
            className="text-xs text-gray-500 hover:text-red-400 transition-colors px-2 py-1 rounded border border-gray-700 hover:border-red-700/50"
          >
            Disconnect
          </button>
        </div>
      ) : (
        <button
          onClick={handleConnect}
          disabled={loading}
          className="flex w-full items-center justify-center gap-2 rounded-lg border border-orange-700/50 bg-orange-900/20 px-4 py-2.5 text-sm font-medium text-orange-300 hover:bg-orange-900/40 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <span>🦊</span>
          {loading ? 'Connecting…' : 'Connect MetaMask Wallet'}
        </button>
      )}

      {error && (
        <p className="text-xs text-red-400 rounded bg-red-900/20 border border-red-700/30 px-3 py-2">
          {error}
        </p>
      )}

      {!wallet && (
        <p className="text-xs text-gray-500">
          Your wallet address is used to receive tokens when your investment is approved.
          You must connect before your investment can be settled on-chain.
        </p>
      )}
    </div>
  );
}
