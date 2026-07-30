import { HardhatUserConfig } from 'hardhat/config';
import '@nomicfoundation/hardhat-toolbox';
import * as dotenv from 'dotenv';

dotenv.config();

// ─── Environment ──────────────────────────────────────────────────────────────
// A zero-value fallback key is used when PRIVATE_KEY is not set (e.g. in CI
// for compile-only jobs). Replace with a real key before deploying.
const PRIVATE_KEY: string =
  process.env['PRIVATE_KEY'] ?? '0x' + '0'.repeat(64);

const SEPOLIA_RPC_URL: string =
  process.env['SEPOLIA_RPC_URL'] ??
  'https://sepolia.infura.io/v3/MISSING_KEY';

const LOCALHOST_RPC_URL: string =
  process.env['LOCALHOST_RPC_URL'] ?? 'http://127.0.0.1:8545';

const ETHERSCAN_API_KEY: string = process.env['ETHERSCAN_API_KEY'] ?? '';

// ─── Hardhat Config ───────────────────────────────────────────────────────────
const config: HardhatUserConfig = {
  solidity: {
    version: '0.8.24',
    settings: {
      optimizer: {
        enabled: true,
        runs: 200,
      },
      viaIR: false,
    },
  },

  networks: {
    // ── Local development ────────────────────────────────────────────────────
    localhost: {
      url: LOCALHOST_RPC_URL,
      chainId: 31337,
    },

    // ── Sepolia testnet ───────────────────────────────────────────────────────
    sepolia: {
      url: SEPOLIA_RPC_URL,
      accounts: [PRIVATE_KEY],
      chainId: 11155111,
      // Gas settings — tune before production deployment
      // gasPrice: 'auto',
    },
  },

  // ── Contract verification (Etherscan) ──────────────────────────────────────
  etherscan: {
    apiKey: ETHERSCAN_API_KEY,
  },

  // ── TypeChain ──────────────────────────────────────────────────────────────
  typechain: {
    outDir: 'typechain-types',
    target: 'ethers-v6',
  },

  // ── Directory layout ───────────────────────────────────────────────────────
  paths: {
    sources: './contracts',
    tests: './test',
    cache: './cache',
    artifacts: './artifacts',
  },

  // ── Gas Reporter ───────────────────────────────────────────────────────────
  gasReporter: {
    enabled: process.env['REPORT_GAS'] === 'true',
    currency: 'USD',
  },
};

export default config;
