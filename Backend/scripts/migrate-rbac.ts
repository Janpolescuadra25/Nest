/**
 * migrate-rbac.ts
 * Backfills RBAC fields for existing users after the extend_rbac_foundation migration.
 *
 * What it does:
 *   - Finds the oldest top-level user (adminId IS NULL) and ensures they have role OWNER
 *   - For all other adminId-null users, ensures they have role ADMIN
 *   - Backfills approvedAt + approvedById (= owner.id) for any user lacking approvedAt
 *
 * Idempotent — safe to run multiple times.
 *
 * Usage:
 *   DATABASE_URL="postgresql://..." npx tsx scripts/migrate-rbac.ts
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  // Step 1: Find all top-level users
  const topLevel = await prisma.user.findMany({
    where: { adminId: null },
    select: { id: true, email: true, role: true, approvedAt: true, createdAt: true },
    orderBy: { createdAt: 'asc' },
  });

  console.log('\n--- Top-level users ---');
  console.table(topLevel.map(u => ({ id: u.id, email: u.email, role: u.role, approvedAt: u.approvedAt })));

  if (topLevel.length === 0) {
    console.error('No top-level users found. Aborting.');
    process.exit(1);
  }

  const owner = topLevel[0];

  // Step 2: Ensure first user has OWNER role
  if (owner.role !== 'OWNER') {
    await prisma.user.update({
      where: { id: owner.id },
      data: { role: 'OWNER' },
    });
    console.log(`\n✅ Set OWNER role for ${owner.email} (${owner.id})`);
  } else {
    console.log(`\n✅ ${owner.email} already has OWNER role`);
  }

  // Step 3: Ensure other top-level users have ADMIN role
  const nonOwnerTopLevel = topLevel.slice(1);
  if (nonOwnerTopLevel.length > 0) {
    const nonAdminIds = nonOwnerTopLevel
      .filter(u => u.role !== 'ADMIN')
      .map(u => u.id);

    if (nonAdminIds.length > 0) {
      const updated = await prisma.user.updateMany({
        where: { id: { in: nonAdminIds } },
        data: { role: 'ADMIN' },
      });
      console.log(`✅ Set ADMIN role for ${updated.count} top-level user(s)`);
    } else {
      console.log('✅ All other top-level users already have ADMIN role');
    }
  }

  // Step 4: Backfill approvedAt for all users missing it
  const usersNeedingApproval = await prisma.user.findMany({
    where: { approvedAt: null },
    select: { id: true, email: true, createdAt: true },
  });

  if (usersNeedingApproval.length > 0) {
    // Update each user with their own createdAt as the approvedAt backfill
    await Promise.all(
      usersNeedingApproval.map(u =>
        prisma.user.update({
          where: { id: u.id },
          data: {
            approvedAt: u.createdAt,
            approvedById: owner.id,
          },
        })
      )
    );
    console.log(`✅ Backfilled approvedAt for ${usersNeedingApproval.length} user(s)`);
  } else {
    console.log('✅ All users already have approvedAt set');
  }

  console.log('\n✅ migrate-rbac complete.');
}

main()
  .catch(e => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
