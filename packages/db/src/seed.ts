import { ensureDefaults, prisma } from './index';

await ensureDefaults();
console.log('Seeded default board, stages, categories and brand profile.');
await prisma.$disconnect();
