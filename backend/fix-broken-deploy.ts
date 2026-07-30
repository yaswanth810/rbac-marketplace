/**
 * fix-broken-deploy.ts
 *
 * Resets assets that were "deployed" with chain_id=11155111 (Sepolia) but
 * whose BLOCKCHAIN_RPC_URL is localhost:8545 (Hardhat).
 *
 * These assets have contract_address set but on the WRONG chain, making
 * them unusable. This script:
 *   1. Finds tokens with chain_id=11155111 that have a contract_address
 *   2. Clears the contract_address from the tokens row
 *   3. Resets the parent asset status back to 'approved'
 *      so the correct deploy (to Hardhat) can be re-done
 *
 * Idempotent — safe to re-run.
 *
 * Run:  npx tsx fix-broken-deploy.ts
 */

import { Client } from 'pg';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = dirname(__filename);
dotenv.config({ path: resolve(__dirname, '.env') });

const DATABASE_URL = process.env['DATABASE_URL'];
if (!DATABASE_URL) { console.error('DATABASE_URL missing'); process.exit(1); }

async function main() {
  const client = new Client({ connectionString: DATABASE_URL });
  await client.connect();
  console.log('✓  Connected\n');

  try {
    // Find affected tokens
    const { rows: affected } = await client.query<{
      token_id: string; asset_id: string; token_symbol: string;
      contract_address: string; chain_id: number; asset_name: string; asset_status: string;
    }>(`
      SELECT t.id AS token_id, t.asset_id, t.token_symbol,
             t.contract_address, t.chain_id,
             a.name AS asset_name, a.status AS asset_status
      FROM   tokens t
      JOIN   assets a ON a.id = t.asset_id
      WHERE  t.chain_id = 11155111
        AND  t.contract_address IS NOT NULL
    `);

    if (!affected.length) {
      console.log('✓  No broken Sepolia deployments found. Nothing to do.');
      return;
    }

    console.log(`Found ${affected.length} broken deployment(s):\n`);
    for (const r of affected) {
      console.log(`  Asset: ${r.asset_name} (${r.asset_id})`);
      console.log(`  Token: ${r.token_symbol}  chain_id=${r.chain_id}`);
      console.log(`  Bad contract: ${r.contract_address}`);
      console.log(`  Current status: ${r.asset_status}\n`);
    }

    await client.query('BEGIN');

    for (const r of affected) {
      // Clear the bad contract_address
      await client.query(
        `UPDATE tokens SET contract_address = NULL WHERE id = $1`,
        [r.token_id]
      );
      console.log(`  ✓  Cleared contract_address on token ${r.token_symbol}`);

      // Reset asset back to 'approved' so the re-deploy button appears
      if (r.asset_status === 'tokenized') {
        await client.query(
          `UPDATE assets SET status = 'approved' WHERE id = $1`,
          [r.asset_id]
        );
        console.log(`  ✓  Reset asset "${r.asset_name}" from 'tokenized' → 'approved'\n`);
      }
    }

    await client.query('COMMIT');
    console.log('✅  Done. Re-open the asset detail page and deploy again using Localhost Hardhat (31337).');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    await client.end();
  }
}

main().catch(err => { console.error('✗  Fatal:', err); process.exit(1); });
