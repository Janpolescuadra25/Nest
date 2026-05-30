import { PrismaClient } from '@prisma/client';
import { encrypt, isEncrypted } from '../src/lib/encryption';

const prisma = new PrismaClient();

async function main() {
  console.log('Starting token encryption migration...');

  const tokens = await prisma.qBToken.findMany();
  console.log(`Found ${tokens.length} QB token records`);

  let encrypted = 0;
  let skipped = 0;

  for (const token of tokens) {
    if (isEncrypted(token.accessToken)) {
      console.log(`Skipping ${token.userId} — already encrypted`);
      skipped++;
      continue;
    }

    await prisma.qBToken.update({
      where: { userId: token.userId },
      data: {
        accessToken: encrypt(token.accessToken),
        refreshToken: encrypt(token.refreshToken),
      },
    });
    console.log(`Encrypted tokens for ${token.userId}`);
    encrypted++;
  }

  console.log(`Migration complete! Encrypted: ${encrypted}, Skipped: ${skipped}`);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
