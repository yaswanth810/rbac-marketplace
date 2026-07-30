import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  const passwordHash = await bcrypt.hash('Demo1234!', 10);

  // 1. Create a demo organization
  const org = await prisma.$queryRaw<any[]>`
    INSERT INTO organizations (name)
    VALUES ('Demo Capital Partners')
    RETURNING id
  `;
  const orgId = org[0].id;

  // 2. Insert users
  const adminEmail = 'admin@demo.com';
  const issuerEmail = 'issuer@demo.com';
  const investorEmail = 'investor@demo.com';

  const users = await prisma.$queryRaw<any[]>`
    INSERT INTO users (organization_id, name, email, password_hash, kyc_status, status)
    VALUES
      (${orgId}::uuid, 'Alice Admin', ${adminEmail}, ${passwordHash}, 'approved', 'active'),
      (${orgId}::uuid, 'Bob Issuer', ${issuerEmail}, ${passwordHash}, 'approved', 'active'),
      (${orgId}::uuid, 'Charlie Investor', ${investorEmail}, ${passwordHash}, 'approved', 'active')
    RETURNING id, email
  `;

  const getUserId = (email: string) => users.find(u => u.email === email).id;

  // 3. Find roles
  const roles = await prisma.$queryRaw<any[]>`SELECT id, name FROM roles WHERE organization_id IS NULL`;
  const getRoleId = (name: string) => roles.find(r => r.name === name)?.id;

  // 4. Assign roles
  await prisma.$queryRaw`
    INSERT INTO user_roles (user_id, role_id)
    VALUES
      (${getUserId(adminEmail)}::uuid, ${getRoleId('Enterprise Admin')}::uuid),
      (${getUserId(adminEmail)}::uuid, ${getRoleId('Compliance Officer')}::uuid),
      (${getUserId(adminEmail)}::uuid, ${getRoleId('Legal Officer')}::uuid),
      (${getUserId(issuerEmail)}::uuid, ${getRoleId('Asset Issuer')}::uuid),
      (${getUserId(investorEmail)}::uuid, ${getRoleId('Investor')}::uuid)
  `;

  console.log('✅ Demo users created successfully!');
  console.log('-----------------------------------');
  console.log('Admin (Full access):');
  console.log('  Email:    admin@demo.com');
  console.log('  Password: Demo1234!');
  console.log('-----------------------------------');
  console.log('Issuer (Can create assets):');
  console.log('  Email:    issuer@demo.com');
  console.log('  Password: Demo1234!');
  console.log('-----------------------------------');
  console.log('Investor (Can browse marketplace):');
  console.log('  Email:    investor@demo.com');
  console.log('  Password: Demo1234!');
  console.log('-----------------------------------');
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
