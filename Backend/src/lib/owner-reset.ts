import bcrypt from 'bcryptjs';
import { prisma } from './prisma';

export async function resetOwnerIfRequested(): Promise<void> {
  if (process.env.RESET_OWNER_PASSWORD !== 'true') return;

  const ownerEmail = process.env.OWNER_EMAIL;
  const ownerPassword = process.env.OWNER_PASSWORD;
  const ownerName = process.env.OWNER_NAME;

  if (!ownerEmail || !ownerPassword || !ownerName) {
    console.error('[Owner Reset] RESET_OWNER_PASSWORD=true but OWNER_EMAIL, OWNER_PASSWORD, or OWNER_NAME is missing.');
    return;
  }

  try {
    const existingOwner = await prisma.user.findFirst({ where: { role: 'OWNER' } });
    if (!existingOwner) {
      console.log('[Owner Reset] No owner found — nothing to reset.');
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
        },
      });
      console.log(`[Owner Reset] Updated owner credentials for ${ownerEmail}.`);
    } catch (err: any) {
      if (err.code === 'P2002') {
        console.log(`[Owner Reset] Email ${ownerEmail} already exists — updating password only.`);
        await prisma.user.update({
          where: { id: existingOwner.id },
          data: { password: hashedPassword, name: ownerName },
        });
        console.log(`[Owner Reset] Owner password updated. Email remains: ${existingOwner.email}`);
      } else {
        throw err;
      }
    }
  } catch (err) {
    console.error('[Owner Reset] Failed:', err);
  }
}
