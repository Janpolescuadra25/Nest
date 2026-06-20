import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

/**
 * POS field key patterns commonly found in columnMappings of POS templates.
 * POS systems (Toast, Oracle/Simphony, SALIDO) use category-prefixed keys
 * like "Revenue.DineIn", "Payments.CreditCard", "Taxes.SalesTax", etc.
 */
const POS_FIELD_PATTERNS = /^(Revenue|Payments|Taxes|Tips|Discounts|Deductions|Refunds|ServiceCharges|GiftCards|HouseAccounts|OtherIncome|OtherExpense|CashIn|CashOut|PaidOuts|ReceivedOnAccount)\./i;

/**
 * POS system name keywords used in template names.
 */
const POS_NAME_KEYWORDS = /\b(pos|toast|oracle|simphony|salido|micros|alu|brink|square)\b/i;

/** DRY_RUN flag — pass --dry-run to preview changes without writing to the database. */
const DRY_RUN = process.argv.includes('--dry-run');

/**
 * Backfills scanMode on existing templates that have no scanMode set.
 *
 * Detection priority:
 * 1. If columnMappings contains POS-style field keys (e.g., "Revenue.DineIn") -> POS
 * 2. If template name contains POS system keywords -> POS
 * 3. If columnMappings is non-empty (has field mappings) -> EXCEL
 * 4. Otherwise -> IMAGE (default)
 */
async function backfillScanMode() {
  const templates = await prisma.template.findMany({
    where: { scanMode: 'IMAGE' },
  });

  console.log(`Found ${templates.length} templates currently set to IMAGE.`);

  if (templates.length === 0) {
    console.log('Nothing to backfill. Exiting.');
    return;
  }

  for (const t of templates) {
    let mode: 'POS' | 'EXCEL' | 'IMAGE';
    let posSystem: string | null = null;

    // Method 1: Check columnMappings for POS field patterns
    if (t.columnMappings) {
      try {
        const mappings = typeof t.columnMappings === 'string'
          ? JSON.parse(t.columnMappings)
          : t.columnMappings;

        const keys = Object.keys(mappings);
        const hasPosFieldKeys = keys.some((k) => POS_FIELD_PATTERNS.test(k));

        if (hasPosFieldKeys) {
          mode = 'POS';
          const nameLower = t.name.toLowerCase();
          if (nameLower.includes('toast')) posSystem = 'toast';
          else if (nameLower.includes('oracle') || nameLower.includes('simphony')) posSystem = 'oracle';
          else if (nameLower.includes('salido')) posSystem = 'salido';
        }
      } catch (e) {
        console.warn(`  Failed to parse columnMappings for "${t.name}":`, e);
      }
    }

    // Method 2: Check template name for POS keywords (only if Method 1 didn't match)
    if (mode !== 'POS' && POS_NAME_KEYWORDS.test(t.name)) {
      mode = 'POS';
      const nameLower = t.name.toLowerCase();
      if (nameLower.includes('toast')) posSystem = 'toast';
      else if (nameLower.includes('oracle') || nameLower.includes('simphony')) posSystem = 'oracle';
      else if (nameLower.includes('salido')) posSystem = 'salido';
    }

    // Method 3: If columnMappings exists and is non-empty -> EXCEL
    if (!mode || mode === 'IMAGE') {
      if (t.columnMappings) {
        try {
          const mappings = typeof t.columnMappings === 'string'
            ? JSON.parse(t.columnMappings)
            : t.columnMappings;
          if (Object.keys(mappings).length > 0) {
            mode = 'EXCEL';
          }
        } catch {
          // Parse failed, fall through to default
        }
      }
    }

    // Default
    if (!mode) mode = 'IMAGE';

    if (DRY_RUN) {
      console.log(`  [DRY RUN] Would update: "${t.name}" -> scanMode=${mode}${posSystem ? `, posSystem=${posSystem}` : ''}`);
    } else {
      await prisma.template.update({
        where: { id: t.id },
        data: { scanMode: mode, posSystem },
      });
      console.log(`  ${mode}: "${t.name}"${posSystem ? ` (${posSystem})` : ''}`);
    }
  }

  console.log(`\nDone. ${DRY_RUN ? 'DRY RUN — no changes made.' : 'All templates updated.'}`);
}

if (DRY_RUN) {
  console.log('=== DRY RUN MODE — no database changes will be made ===\n');
}

backfillScanMode()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
