/**
 * token.service.ts
 *
 * Business logic for the token lifecycle:
 *   configure → deploy (on-chain via ethers v6) → mint (on-chain)
 *
 * Exported low-level on-chain helpers
 * ────────────────────────────────────
 * addToWhitelistOnChain  — idempotent; used by investment approval flow
 * mintOnChain            — raw on-chain mint; used by mintTokens AND investment approval
 *
 * These helpers ensure there is exactly ONE implementation of the
 * ethers contract interaction code. Both mintTokens (token route) and
 * approveInvestment (investment route) call the same functions rather
 * than each maintaining their own wallet/contract setup.
 *
 * Blockchain notes
 * ────────────────
 * • The compiled RWAToken artifact (ABI + bytecode) is read from the sibling
 *   contracts workspace:  <repo-root>/contracts/artifacts/…/RWAToken.json
 *   Resolved via import.meta.url so it works with both tsx and compiled JS.
 *
 * • DEPLOYER_PRIVATE_KEY and BLOCKCHAIN_RPC_URL must be set in the environment
 *   before calling any on-chain function.  Missing vars throw AppError 503.
 *
 * • total_supply is stored in whole-token units (e.g. 1 000 000).
 *   The RWAToken constructor multiplies by 10**decimals internally —
 *   pass total_supply directly, do NOT divide by 1e18.
 *
 * • Mint amount is accepted as a string (wei) from the route to prevent
 *   JavaScript double-precision loss on large uint256 values.
 */

import { type PrismaClient, Prisma } from '@prisma/client';
import { existsSync, readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { ethers } from 'ethers';
import { AppError } from '../assets/asset.service.js';

// ── Exported error class for on-chain failures ─────────────────────────────────

/**
 * Thrown when an on-chain transaction fails.
 * Route handlers catch this and return 502 Bad Gateway (not 500) to
 * distinguish blockchain failures from application bugs.
 */
export class BlockchainError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BlockchainError';
  }
}

// ── Artifact path ─────────────────────────────────────────────────────────────

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// From backend/src/modules/tokens/ → root → contracts/artifacts/…
const ARTIFACT_PATH = join(
  __dirname,
  '../../../../contracts/artifacts/contracts/RWAToken.sol/RWAToken.json'
);

function loadArtifact(): { abi: ethers.InterfaceAbi; bytecode: string } {
  if (!existsSync(ARTIFACT_PATH)) {
    throw new AppError(
      503,
      'RWAToken artifact not found. Run "npm run compile" in the contracts workspace first.',
      'Service Unavailable'
    );
  }
  const raw = JSON.parse(readFileSync(ARTIFACT_PATH, 'utf-8')) as {
    abi: ethers.InterfaceAbi;
    bytecode: string;
  };
  return { abi: raw.abi, bytecode: raw.bytecode };
}

// ── Provider / signer helpers (per-chain) ────────────────────────────────────
//
// Each chain uses its own RPC URL and deployer key.
// chain_id 31337 → BLOCKCHAIN_RPC_URL + DEPLOYER_PRIVATE_KEY  (Hardhat localhost)
// chain_id 11155111 → SEPOLIA_RPC_URL + SEPOLIA_DEPLOYER_PRIVATE_KEY

const SUPPORTED_CHAINS: Record<number, { rpcEnvKey: string; keyEnvKey: string; name: string }> = {
  31337: {
    rpcEnvKey: 'BLOCKCHAIN_RPC_URL',
    keyEnvKey: 'DEPLOYER_PRIVATE_KEY',
    name:       'Localhost Hardhat',
  },
  11155111: {
    rpcEnvKey: 'SEPOLIA_RPC_URL',
    keyEnvKey: 'SEPOLIA_DEPLOYER_PRIVATE_KEY',
    name:       'Sepolia',
  },
};

function getProviderForChain(chainId: number): ethers.JsonRpcProvider {
  const cfg = SUPPORTED_CHAINS[chainId];
  if (!cfg) {
    throw new AppError(400, `Unsupported chain_id: ${chainId}. Supported: ${Object.keys(SUPPORTED_CHAINS).join(', ')}`, 'Bad Request');
  }
  const rpcUrl = process.env[cfg.rpcEnvKey];
  if (!rpcUrl) {
    throw new AppError(
      503,
      `${cfg.rpcEnvKey} is not configured. Set it in backend/.env to deploy to ${cfg.name}.`,
      'Service Unavailable'
    );
  }
  return new ethers.JsonRpcProvider(rpcUrl);
}

function getDeployerForChain(chainId: number, provider: ethers.JsonRpcProvider): ethers.Wallet {
  const cfg = SUPPORTED_CHAINS[chainId];
  if (!cfg) throw new AppError(400, `Unsupported chain_id: ${chainId}`, 'Bad Request');
  const privateKey = process.env[cfg.keyEnvKey];
  if (!privateKey) {
    throw new AppError(
      503,
      `${cfg.keyEnvKey} is not configured. Set it in backend/.env to deploy to ${cfg.name}.`,
      'Service Unavailable'
    );
  }
  return new ethers.Wallet(privateKey, provider);
}

/**
 * Checks the deployer wallet balance for a given chain.
 * Throws AppError 503 if below MIN_ETH_WEI threshold.
 * Only called before Sepolia deploys — localhost Hardhat always has test ETH.
 */
const MIN_ETH_WEI = ethers.parseEther('0.01'); // ~minimum gas for a deploy

async function assertDeployerFunded(chainId: number): Promise<string> {
  if (chainId === 31337) return 'localhost'; // Hardhat always funded
  const provider = getProviderForChain(chainId);
  const deployer = getDeployerForChain(chainId, provider);
  const balance = await provider.getBalance(deployer.address);
  if (balance < MIN_ETH_WEI) {
    throw new AppError(
      503,
      `Deployer wallet ${deployer.address} has insufficient ${SUPPORTED_CHAINS[chainId]?.name ?? ''} ETH ` +
      `(balance: ${ethers.formatEther(balance)} ETH, need ≥ 0.01 ETH). ` +
      `Fund it at https://sepoliafaucet.com then retry.`,
      'Service Unavailable'
    );
  }
  return deployer.address;
}

// ── Row shapes ────────────────────────────────────────────────────────────────

export interface TokenRow {
  id: string;
  asset_id: string;
  contract_address: string | null;
  token_symbol: string;
  /** NUMERIC returned as string by $queryRaw */
  total_supply: string | null;
  decimals: number;
  price: string | null;
  chain_id: number;
}

// ── Low-level on-chain helpers (exported for reuse across services) ────────────

/**
 * Adds a wallet to the RWAToken whitelist using the deployer/admin signer
 * (which holds COMPLIANCE_ROLE).
 *
 * Idempotent: reads the current whitelist state on-chain first.
 * Returns txHash=null if the wallet was already whitelisted (no tx submitted).
 *
 * Used by: approveInvestment in investment.service.ts
 */
export async function addToWhitelistOnChain(
  contractAddress: string,
  walletAddress: string,
  chainId = 31337
): Promise<{ txHash: string | null }> {
  const { abi } = loadArtifact();
  const provider = getProviderForChain(chainId);
  const deployer = getDeployerForChain(chainId, provider);
  const contract = new ethers.Contract(contractAddress, abi, deployer);

  try {
    const isWhitelisted = (await contract['whitelist'](walletAddress)) as boolean;
    if (isWhitelisted) return { txHash: null };

    const tx = (await contract['addToWhitelist'](walletAddress)) as ethers.TransactionResponse;
    const receipt = await tx.wait(1);
    return { txHash: receipt?.hash ?? tx.hash };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new BlockchainError(`addToWhitelist failed: ${msg}`);
  }
}

/**
 * Calls mint(recipient, amount) on the deployed RWAToken contract.
 * Does NOT check whitelist status — caller is responsible for ensuring
 * the recipient is whitelisted before calling this.
 *
 * Used by: mintTokens (token route) AND approveInvestment (investment route)
 * to ensure there is exactly one mint implementation in the codebase.
 */
export async function mintOnChain(
  contractAddress: string,
  recipientWallet: string,
  amount: bigint,
  chainId = 31337
): Promise<{ txHash: string }> {
  const { abi } = loadArtifact();
  const provider = getProviderForChain(chainId);
  const deployer = getDeployerForChain(chainId, provider);
  const contract = new ethers.Contract(contractAddress, abi, deployer);

  try {
    const tx = (await contract['mint'](recipientWallet, amount)) as ethers.TransactionResponse;
    const receipt = await tx.wait(1);
    return { txHash: receipt?.hash ?? tx.hash };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new BlockchainError(`mint failed: ${msg}`);
  }
}

// ── Configure ─────────────────────────────────────────────────────────────────

interface ConfigureInput {
  assetId: string;
  organizationId: string;
  userId: string;
  tokenSymbol: string;
  totalSupply: number;
  decimals: number;
  price?: number | null;
  chainId: number;
}

export async function configureToken(
  prisma: PrismaClient,
  input: ConfigureInput
): Promise<TokenRow> {
  const assetRows = await prisma.$queryRaw<
    Array<{ id: string; organization_id: string; name: string; status: string }>
  >(
    Prisma.sql`SELECT id, organization_id, name, status FROM assets WHERE id = ${input.assetId}::uuid`
  );

  const asset = assetRows[0];
  if (!asset || asset.organization_id !== input.organizationId) {
    throw new AppError(403, 'Cross-organization access denied', 'Forbidden');
  }
  if (asset.status !== 'approved') {
    throw new AppError(
      409,
      `Token can only be configured once the asset is 'approved' (current status: '${asset.status}')`,
      'Conflict'
    );
  }

  const rows = await prisma.$queryRaw<TokenRow[]>(
    Prisma.sql`
      INSERT INTO tokens
        (asset_id, token_symbol, total_supply, decimals, price, chain_id)
      VALUES
        (${input.assetId}::uuid, ${input.tokenSymbol}, ${input.totalSupply},
         ${input.decimals}, ${input.price ?? null}, ${input.chainId})
      ON CONFLICT (asset_id) DO NOTHING
      RETURNING id, asset_id, contract_address, token_symbol,
                total_supply::text, decimals, price::text, chain_id
    `
  );

  if (rows.length === 0) {
    throw new AppError(409, 'Token configuration already exists for this asset.', 'Conflict');
  }

  await prisma.$queryRaw(
    Prisma.sql`
      INSERT INTO audit_logs
        (user_id, action, resource_type, resource_id, organization_id, new_state)
      VALUES
        (${input.userId}::uuid, 'token.configure', 'asset', ${input.assetId}::uuid,
         ${input.organizationId}::uuid,
         ${JSON.stringify({ tokenSymbol: input.tokenSymbol, totalSupply: input.totalSupply })}::jsonb)
    `
  );

  return rows[0]!;
}

// ── Deploy ────────────────────────────────────────────────────────────────────

interface DeployInput {
  assetId: string;
  organizationId: string;
  userId: string;
}

export async function deployToken(
  prisma: PrismaClient,
  input: DeployInput
): Promise<TokenRow> {
  const assetRows = await prisma.$queryRaw<
    Array<{ id: string; organization_id: string; name: string; status: string }>
  >(
    Prisma.sql`SELECT id, organization_id, name, status FROM assets WHERE id = ${input.assetId}::uuid`
  );
  const asset = assetRows[0];
  if (!asset || asset.organization_id !== input.organizationId) {
    throw new AppError(403, 'Cross-organization access denied', 'Forbidden');
  }
  if (asset.status !== 'approved') {
    throw new AppError(
      409,
      `Token can only be deployed once the asset is 'approved' (current status: '${asset.status}')`,
      'Conflict'
    );
  }

  const tokenRows = await prisma.$queryRaw<TokenRow[]>(
    Prisma.sql`
      SELECT id, asset_id, contract_address, token_symbol,
             total_supply::text, decimals, price::text, chain_id
      FROM   tokens
      WHERE  asset_id = ${input.assetId}::uuid
    `
  );
  const token = tokenRows[0];
  if (!token) {
    throw new AppError(
      409,
      'Token has not been configured yet. Call POST /api/tokens/configure first.',
      'Conflict'
    );
  }
  if (token.contract_address) {
    throw new AppError(409, `Token is already deployed at ${token.contract_address}`, 'Conflict');
  }

  // Balance check before Sepolia deploy — gives a clear error vs timeout
  await assertDeployerFunded(token.chain_id);

  // Load artifact + deploy via ethers v6 using the correct chain's provider
  const { abi, bytecode } = loadArtifact();
  const provider = getProviderForChain(token.chain_id);
  const deployer = getDeployerForChain(token.chain_id, provider);

  // total_supply is whole-token units — pass directly as supplyCap_.
  // The RWAToken constructor multiplies by 10**decimals internally.
  // Do NOT divide by 1e18 here.
  const supplyCap = BigInt(String(token.total_supply ?? 0));

  const factory = new ethers.ContractFactory(abi, bytecode, deployer);
  const contract = await factory.deploy(
    asset.name,         // name_
    token.token_symbol, // symbol_
    supplyCap,          // supplyCap_  (whole-token units)
    deployer.address    // admin_      (gets all 4 roles on-chain)
  );
  await contract.waitForDeployment();

  const contractAddress = await contract.getAddress();

  const previousState = JSON.stringify({ status: 'approved' });
  const newState = JSON.stringify({ status: 'tokenized', contractAddress });

  const [updatedToken] = await prisma.$transaction([
    prisma.$queryRaw<TokenRow[]>(
      Prisma.sql`
        UPDATE tokens SET contract_address = ${contractAddress}
        WHERE  asset_id = ${input.assetId}::uuid
        RETURNING id, asset_id, contract_address, token_symbol,
                  total_supply::text, decimals, price::text, chain_id
      `
    ),
    prisma.$queryRaw(
      Prisma.sql`UPDATE assets SET status = 'tokenized' WHERE id = ${input.assetId}::uuid`
    ),
    prisma.$queryRaw(
      Prisma.sql`
        INSERT INTO audit_logs
          (user_id, action, resource_type, resource_id, organization_id,
           previous_state, new_state)
        VALUES
          (${input.userId}::uuid, 'token.deploy', 'asset', ${input.assetId}::uuid,
           ${input.organizationId}::uuid,
           ${previousState}::jsonb, ${newState}::jsonb)
      `
    ),
  ]);

  return ((updatedToken as TokenRow[])[0])!;
}

// ── Mint (token route entry point) ────────────────────────────────────────────

interface MintInput {
  assetId: string;
  organizationId: string;
  userId: string;
  recipientUserId: string;
  /** Amount in wei as a string to avoid JS double-precision loss */
  amount: string;
}

export async function mintTokens(
  prisma: PrismaClient,
  input: MintInput
): Promise<{ txHash: string }> {
  const { assetId, organizationId, userId, recipientUserId, amount } = input;

  const assetRows = await prisma.$queryRaw<
    Array<{ organization_id: string; status: string }>
  >(
    Prisma.sql`SELECT organization_id, status FROM assets WHERE id = ${assetId}::uuid`
  );
  const asset = assetRows[0];
  if (!asset || asset.organization_id !== organizationId) {
    throw new AppError(403, 'Cross-organization access denied', 'Forbidden');
  }
  if (asset.status !== 'tokenized') {
    throw new AppError(
      409,
      `Minting is only available once the asset is 'tokenized' (current status: '${asset.status}')`,
      'Conflict'
    );
  }

  const tokenRows = await prisma.$queryRaw<Array<{
    contract_address: string | null;
    chain_id: number;
  }>>(
    Prisma.sql`SELECT contract_address, chain_id FROM tokens WHERE asset_id = ${assetId}::uuid`
  );
  const token = tokenRows[0];
  if (!token?.contract_address) {
    throw new AppError(409, 'Token has not been deployed yet.', 'Conflict');
  }

  const userRows = await prisma.$queryRaw<Array<{ wallet_address: string | null }>>(
    Prisma.sql`SELECT wallet_address FROM users WHERE id = ${recipientUserId}::uuid`
  );
  const recipient = userRows[0];
  if (!recipient) throw new AppError(404, 'Recipient user not found.', 'Not Found');
  if (!recipient.wallet_address) {
    throw new AppError(400, 'Recipient user has no wallet address registered.', 'Bad Request');
  }

  // Token route requires wallet to already be whitelisted (no auto-whitelist here).
  // Whitelist is managed by investment approval flow.
  const { abi } = loadArtifact();
  const provider = getProviderForChain(token.chain_id);
  const deployer  = getDeployerForChain(token.chain_id, provider);
  const contract  = new ethers.Contract(token.contract_address, abi, deployer);

  const isWhitelisted = (await contract['whitelist'](recipient.wallet_address)) as boolean;
  if (!isWhitelisted) {
    throw new AppError(
      409,
      `Recipient wallet ${recipient.wallet_address} is not whitelisted. ` +
        'Whitelist the address via the investment approval flow first.',
      'Conflict'
    );
  }

  // Use the shared mintOnChain helper — single implementation for all callers.
  const { txHash } = await mintOnChain(
    token.contract_address,
    recipient.wallet_address,
    BigInt(amount),
    token.chain_id
  );


  await prisma.$queryRaw(
    Prisma.sql`
      INSERT INTO audit_logs
        (user_id, action, resource_type, resource_id, organization_id, new_state)
      VALUES
        (${userId}::uuid, 'token.mint', 'asset', ${assetId}::uuid,
         ${organizationId}::uuid,
         ${JSON.stringify({ recipient: recipient.wallet_address, amount, txHash })}::jsonb)
    `
  );

  return { txHash };
}
