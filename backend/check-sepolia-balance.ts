/**
 * check-sepolia-balance.ts
 *
 * Checks the Sepolia deployer wallet balance and tells you whether it has
 * enough ETH to deploy an RWAToken contract (~0.01 ETH minimum).
 *
 * Run:  npx tsx check-sepolia-balance.ts
 */

import { ethers } from 'ethers';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = dirname(__filename);
dotenv.config({ path: resolve(__dirname, '.env') });

const SEPOLIA_RPC_URL             = process.env['SEPOLIA_RPC_URL'];
const SEPOLIA_DEPLOYER_PRIVATE_KEY = process.env['SEPOLIA_DEPLOYER_PRIVATE_KEY'];
const MIN_ETH = 0.01;

async function main() {
  if (!SEPOLIA_RPC_URL) {
    console.error('✗  SEPOLIA_RPC_URL not set in backend/.env');
    process.exit(1);
  }
  if (!SEPOLIA_DEPLOYER_PRIVATE_KEY) {
    console.error('✗  SEPOLIA_DEPLOYER_PRIVATE_KEY not set in backend/.env');
    process.exit(1);
  }

  const provider = new ethers.JsonRpcProvider(SEPOLIA_RPC_URL);
  const wallet   = new ethers.Wallet(SEPOLIA_DEPLOYER_PRIVATE_KEY, provider);

  console.log(`\nSepolia Deployer Wallet\n${'─'.repeat(50)}`);
  console.log(`Address:  ${wallet.address}`);
  console.log(`Etherscan: https://sepolia.etherscan.io/address/${wallet.address}\n`);

  let balance: bigint;
  try {
    balance = await provider.getBalance(wallet.address);
  } catch (err) {
    console.error('✗  Failed to connect to Sepolia RPC:', err instanceof Error ? err.message : err);
    process.exit(1);
  }

  const balanceEth = parseFloat(ethers.formatEther(balance));
  const funded     = balanceEth >= MIN_ETH;

  console.log(`Balance:  ${balanceEth.toFixed(6)} ETH`);
  console.log(`Required: ${MIN_ETH} ETH (minimum for a deploy)`);
  console.log(`Status:   ${funded ? '✅  Funded — ready to deploy to Sepolia' : '❌  Insufficient — fund this wallet before deploying'}\n`);

  if (!funded) {
    console.log('Faucets:');
    console.log('  https://sepoliafaucet.com');
    console.log('  https://faucet.quicknode.com/ethereum/sepolia');
    console.log('  https://www.infura.io/faucet/sepolia\n');
    process.exit(1);
  }
}

main().catch(err => { console.error('✗  Fatal:', err); process.exit(1); });
