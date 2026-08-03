/**
 * fix-owner-role.ts
 * Run against production to restore OWNER role and permissions.
 *
 * Usage:
 *   DATABASE_URL="postgresql://..." npx tsx scripts/fix-owner-role.ts
 *
 * Get DATABASE_URL from Render dashboard → nest-backend → Environment.
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  // Step 1: Show all top-level users (no adminId) to find the OWNER
  const topLevel = await prisma.user.findMany({
    where: { adminId: null },
    select: { id: true, email: true, role: true, status: true, createdAt: true },
    orderBy: { createdAt: 'asc' },
    take: 5,
  });

  console.log('\n--- Top-level users (adminId IS NULL) ---');
  console.table(topLevel);

  if (topLevel.length === 0) {
    console.error('No top-level users found. Something is wrong.');
    process.exit(1);
  }

  // Step 2: Target specific email if provided, otherwise use first-created
  const targetEmail = process.env.OWNER_EMAIL ?? topLevel[0].email;
  const ownerEmail = targetEmail;
  console.log(`\nRestoring OWNER role for: ${ownerEmail}`);

  const updated = await prisma.user.update({
    where: { email: ownerEmail },
    data: {
      role: 'OWNER',
      status: 'ACTIVE',
    },
    select: { id: true, email: true, role: true, status: true },
  });

  console.log('\n--- Updated user ---');
  console.table([updated]);
  console.log('\n✅ Done. OWNER role restored.');
}

main()
  .catch(e => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
