import 'dotenv/config';
import { prisma } from '../src/lib/prisma';

async function main() {
  console.log('[Migration] Starting template migration');

  const locations = await prisma.location.findMany({
    include: { mappings: true, templates: true },
  });

  for (const location of locations) {
    if (location.templates.length > 0) {
      console.log(`- Skipping location ${location.id} (${location.name}) because templates already exist`);
      continue;
    }

    const template = await prisma.template.create({
      data: {
        locationId: location.id,
        name: 'Default mapping template',
        description: 'Auto-created template for existing mappings',
      },
    });

    if (location.mappings.length > 0) {
      await prisma.mapping.updateMany({
        where: {
          locationId: location.id,
          templateId: null,
        },
        data: {
          templateId: template.id,
        },
      });
      console.log(`- Attached ${location.mappings.length} existing mappings to template ${template.id}`);
    } else {
      console.log(`- Created template ${template.id} for location ${location.id} with no mappings`);
    }
  }

  console.log('[Migration] Completed template migration');
}

main()
  .catch((error) => {
    console.error('[Migration] Failed', error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
