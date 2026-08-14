from pathlib import Path

path = Path('src/popup/components/SyncView.tsx')
text = path.read_text(encoding='utf-8')
old = '''        if (txnType === 'BILL' || txnType === 'VENDOR_CREDIT') {
          const template = templates.find((t) => t.transactionType === txnType && t.isActive);
          if (!template?.defaults || !template.defaults.vendorRef || !template.defaults.apAccountRef) {
            const reason = 'missing header defaults (set up in Mapping tab)';
            const existing = skippedReasons.find((s) => s.type === txnType && s.reason === reason);
            if (existing) { existing.count++; } else { skippedReasons.push({ type: txnType, reason, count: 1 }); }
            continue;
          }

          const payload = buildBillLikePayload({
            scanRecordId: scan.id,
            transactionType: txnType as 'BILL' | 'VENDOR_CREDIT',
            scanData: scan.rawData,
            mappings,
            accounts,
            vendors,
            terms,
            taxCodes,

            txnDate: scan.scanDate.slice(0, 10),
            defaults: template.defaults as Record<string, { value: string; name?: string } | null>,
            scanEntry: sharedScanEntry,
            valueMappings: valueMappingsByTemplate.get(template.id) ?? [],
          });
'''
new = '''        if (txnType === 'BILL' || txnType === 'VENDOR_CREDIT') {
          const template = templates.find((t) => t.transactionType === txnType && t.isActive);
          if (!template?.defaults || !template.defaults.vendorRef || !template.defaults.apAccountRef) {
            const reason = 'missing header defaults (set up in Mapping tab)';
            const existing = skippedReasons.find((s) => s.type === txnType && s.reason === reason);
            if (existing) { existing.count++; } else { skippedReasons.push({ type: txnType, reason, count: 1 }); }
            continue;
          }

          const payload = buildBillLikePayload({
            scanRecordId: scan.id,
            transactionType: txnType as 'BILL' | 'VENDOR_CREDIT',
            scanData: scan.rawData,
            mappings,
            accounts,
            vendors,
            terms,
            taxCodes,
            txnDate: scan.scanDate.slice(0, 10),
            defaults: template.defaults as Record<string, { value: string; name?: string } | null>,
            scanEntry: sharedScanEntry,
            valueMappings: valueMappingsByTemplate.get(template.id) ?? [],
          });
'''
count = text.count(old)
if count == 0:
    raise SystemExit('No occurrences found to replace')
text = text.replace(old, new, 2)
path.write_text(text, encoding='utf-8')
print(f'Replaced {min(2, count)} occurrence(s), found {count}')
