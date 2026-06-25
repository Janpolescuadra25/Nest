import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main(): Promise<void> {
  console.log('[Seed] Starting seed...');

  // ── 0. Create / update Owner user ──────────────────────────────────────────
  const ownerEmail   = process.env.OWNER_EMAIL    ?? process.env.ADMIN_EMAIL ?? 'paulescuadra25@gmail.com';
  const ownerPassword = process.env.OWNER_PASSWORD ?? process.env.ADMIN_PASSWORD ?? 'ChangeMe123!';
  const ownerName    = process.env.OWNER_NAME     ?? process.env.ADMIN_NAME  ?? 'John Paul O. Escuadra';
  const hashedPassword = await bcrypt.hash(ownerPassword, 12);

  const ownerUser = await prisma.user.upsert({
    where: { email: ownerEmail },
    update: {
      password: hashedPassword,
      role: 'OWNER',
      status: 'ACTIVE',
      name: ownerName,
      subscriptionSource: 'owner',
    },
    create: {
      email: ownerEmail,
      name: ownerName,
      password: hashedPassword,
      role: 'OWNER',
      status: 'ACTIVE',
      subscriptionSource: 'owner',
    },
  });
  console.log(`[Seed] Owner: ${ownerUser.email} / password: ${ownerPassword}`);

  // ── 1. Assign all orphan locations (adminId IS NULL) to the Owner ──────────
  const { count: assigned } = await prisma.location.updateMany({
    where: { adminId: null },
    data: { adminId: ownerUser.id },
  });
  if (assigned > 0) console.log(`[Seed] Assigned ${assigned} orphan location(s) to Owner`);

  // ── 2. Create test user (VIEWER, no permissions) ───────────────────────────
  const user = await prisma.user.upsert({
    where: { email: 'test@nest.app' },
    update: {},
    create: {
      email: 'test@nest.app',
      role: 'VIEWER',
      status: 'ACTIVE',
    },
  });
  console.log('[Seed] Test user:', user.email, '— id:', user.id);

  // ── 3. Create 2 test locations ─────────────────────────────────────────────
  const downtown = await prisma.location.upsert({
    where: { id: 'seed-location-downtown' },
    update: {},
    create: {
      id: 'seed-location-downtown',
      userId: user.id,
      adminId: ownerUser.id,
      name: 'Acme Downtown',
      posUrl: 'https://www.toasttab.com/acme-downtown/v3',
      isActive: true,
    },
  });

  const uptown = await prisma.location.upsert({
    where: { id: 'seed-location-uptown' },
    update: {},
    create: {
      id: 'seed-location-uptown',
      userId: user.id,
      adminId: ownerUser.id,
      name: 'Acme Uptown',
      posUrl: 'https://www.toasttab.com/acme-uptown/v3',
      isActive: true,
    },
  });

  console.log('[Seed] Locations:', downtown.name, '|', uptown.name);

  // ── 4. Create sample mappings for each location ────────────────────────────
  const mappingTemplates = [
    {
      sourceField: 'Food Sales',
      targetAccount: '4000-Food Revenue',
      targetClass: 'Food',
      targetDescription: 'Food sales revenue',
      priority: 1,
    },
    {
      sourceField: 'Beverage Sales',
      targetAccount: '4010-Beverage Revenue',
      targetClass: 'Beverage',
      targetDescription: 'Beverage sales revenue',
      priority: 2,
    },
    {
      sourceField: 'Credit Card Tips',
      targetAccount: '2100-Tips Payable',
      targetDescription: 'Credit card tip liability',
      priority: 3,
    },
    {
      sourceField: 'Cash',
      targetAccount: '1000-Cash',
      targetDescription: 'Cash payments received',
      priority: 4,
    },
    {
      sourceField: 'Tax',
      targetAccount: '2200-Sales Tax Payable',
      targetDescription: 'Sales tax collected',
      priority: 5,
    },
    {
      sourceField: 'Discounts',
      targetAccount: '5900-Discounts Given',
      targetDescription: 'Promotional discounts',
      priority: 6,
    },
  ];

  for (const loc of [downtown, uptown]) {
    for (const tmpl of mappingTemplates) {
      await prisma.mapping.create({
        data: { locationId: loc.id, ...tmpl },
      });
    }
    console.log(`[Seed] Created ${mappingTemplates.length} mappings for ${loc.name}`);
  }

  // ── 5. Create sample rules ─────────────────────────────────────────────────
  for (const loc of [downtown, uptown]) {
    await prisma.rule.create({
      data: {
        locationId: loc.id,
        name: 'Total F&B Revenue',
        ruleType: 'COMBINE',
        config: {
          sourceFields: ['Food Sales', 'Beverage Sales'],
          targetField: 'Total F&B Revenue',
        },
        isActive: true,
      },
    });
    console.log(`[Seed] Created COMBINE rule for ${loc.name}`);
  }

  console.log('[Seed] Done!');
}

main()
  .catch((e) => {
    console.error('[Seed] Error:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
