import { ethers } from "hardhat";

/**
 * Deploys RWAToken to the configured Hardhat network.
 *
 * The PRIVATE_KEY and RPC URL are already wired in hardhat.config.ts via env vars:
 *   localhost  → LOCALHOST_RPC_URL  (default: http://127.0.0.1:8545)
 *   sepolia    → SEPOLIA_RPC_URL    (Infura/Alchemy endpoint)
 *
 * No new environment variables are introduced here.
 *
 * Usage (from /contracts):
 *   npm run deploy:local    →  hardhat run scripts/deploy.ts --network localhost
 *   npm run deploy:sepolia  →  hardhat run scripts/deploy.ts --network sepolia
 */
async function main(): Promise<void> {
  // Hardhat injects signers from the configured accounts (PRIVATE_KEY).
  const [deployer] = await ethers.getSigners();

  const network = await ethers.provider.getNetwork();
  const balanceWei = await ethers.provider.getBalance(deployer.address);

  console.log("─".repeat(60));
  console.log("  RWAToken deployment");
  console.log("─".repeat(60));
  console.log(`  Network   : ${network.name} (chainId ${network.chainId})`);
  console.log(`  Deployer  : ${deployer.address}`);
  console.log(`  Balance   : ${ethers.formatEther(balanceWei)} ETH`);
  console.log("─".repeat(60));

  // ── Constructor arguments ──────────────────────────────────────────────────
  // The admin address receives all four roles (DEFAULT_ADMIN_ROLE, MINTER_ROLE,
  // PAUSER_ROLE, COMPLIANCE_ROLE) and is added to the transfer whitelist.
  // Supply cap is in whole-token units; the contract multiplies by 10^18 internally.
  const TOKEN_NAME   = "RWA Token";
  const TOKEN_SYMBOL = "RWA";
  const SUPPLY_CAP   = 1_000_000n; // 1 million tokens
  const ADMIN        = deployer.address;

  console.log("\n  Deploying RWAToken...");
  const RWAToken = await ethers.getContractFactory("RWAToken");
  const token = await RWAToken.deploy(TOKEN_NAME, TOKEN_SYMBOL, SUPPLY_CAP, ADMIN);
  await token.waitForDeployment();

  const deployedAddress  = await token.getAddress();
  const deploymentTx     = token.deploymentTransaction();
  const receipt          = deploymentTx ? await deploymentTx.wait(1) : null;

  console.log("\n─".repeat(60));
  console.log(`  ✅ RWAToken deployed to : ${deployedAddress}`);
  if (deploymentTx) {
    console.log(`  Tx hash               : ${deploymentTx.hash}`);
  }
  if (receipt) {
    console.log(`  Gas used              : ${receipt.gasUsed.toLocaleString()}`);
    console.log(`  Block                 : ${receipt.blockNumber}`);
  }
  console.log(`  Admin / initial roles : ${ADMIN}`);
  console.log(`  Supply cap            : ${SUPPLY_CAP.toLocaleString()} tokens`);
  console.log("─".repeat(60) + "\n");
}

main()
  .then(() => process.exit(0))
  .catch((error: Error) => {
    console.error("\n❌ Deployment failed:", error.message);
    process.exit(1);
  });
