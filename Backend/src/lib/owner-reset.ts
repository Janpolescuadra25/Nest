import bcrypt from 'bcryptjs';
import { prisma } from './prisma';
import { logger } from './logger';

const log = logger.child({ module: 'OwnerReset' });

export async function resetOwnerIfRequested(): Promise<void> {
  if (process.env.RESET_OWNER_PASSWORD !== 'true') return;

  const ownerEmail = process.env.OWNER_EMAIL;
  const ownerPassword = process.env.OWNER_PASSWORD;
  const ownerName = process.env.OWNER_NAME;

  if (!ownerEmail || !ownerPassword || !ownerName) {
    log.error('RESET_OWNER_PASSWORD=true but OWNER_EMAIL, OWNER_PASSWORD, or OWNER_NAME is missing.');
    return;
  }

  try {
    const existingOwner = await prisma.user.findFirst({ where: { role: 'OWNER' } });
    if (!existingOwner) {
      log.info('No owner found — nothing to reset.');
      return;
    }

    const hashedPassword = await bcrypt.hash(ownerPassword, 12);
    try {
      await prisma.user.update({
        where: { id: existingOwner.id },
        data: {
          email: ownerEmail,
          password: hashedPassword,
          name: ownerName,
          emailVerified: true,
        },
      });
      log.info({ ownerEmail }, `Updated owner credentials for ${ownerEmail}.`);
    } catch (err: any) {
      if (err.code === 'P2002') {
        log.info({ ownerEmail }, `Email ${ownerEmail} already exists — updating password only.`);
        await prisma.user.update({
          where: { id: existingOwner.id },
          data: { password: hashedPassword, name: ownerName, emailVerified: true },
        });
        log.info({ existingOwnerEmail: existingOwner.email }, `Owner password updated. Email remains: ${existingOwner.email}`);
      } else {
        throw err;
      }
    }
  } catch (err) {
    log.error({ err }, 'Failed');
  }
}
