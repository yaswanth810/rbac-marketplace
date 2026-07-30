import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const HARDHAT_DEPLOYER = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266';
  
  // Find whoever already owns this wallet
  const existing = await prisma.$queryRaw<any[]>`
    SELECT id, email, name, wallet_address 
    FROM users 
    WHERE wallet_address = ${HARDHAT_DEPLOYER} 
    LIMIT 1
  `;
  
  if (existing.length > 0) {
    const user = existing[0];
    console.log('✅ Found existing user with the Hardhat Deployer wallet!');
    console.log('-----------------------------------');
    console.log(`User:  ${user.name} (${user.email})`);
    console.log(`Wallet: ${user.wallet_address} (Whitelisted)`);
    console.log(`UUID (Copy this!):`);
    console.log(user.id);
    console.log('-----------------------------------');
    console.log('Paste this UUID into the "Recipient User ID" field to mint tokens.');
    return;
  }
  
  console.log('Wallet not found on any user.');
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
