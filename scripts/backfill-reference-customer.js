const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const BATCH_SIZE = 300;

const args = process.argv.slice(2);
let restaurantFilter = null;
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--restaurant' && args[i + 1]) {
    restaurantFilter = args[i + 1];
    i++;
  }
}

async function resolveCustomer(record, customerCache) {
  const cacheKey = (key) => `${record.public_code}::${key}`;

  // 1. Per idCustomer numerico
  if (record.idCustomer) {
    const k = cacheKey(`id:${record.idCustomer}`);
    if (customerCache.has(k)) return customerCache.get(k);
    const c = await prisma.customer.findFirst({
      where: { idCustomer: record.idCustomer, restaurant_code: record.public_code },
      select: { id: true }
    });
    customerCache.set(k, c);
    if (c) return c;
  }

  // 2. idCustomer lungo 24 = vecchio MongoDB _id salvato come idCustomer
  if (record.idCustomer && record.idCustomer.length === 24) {
    const k = cacheKey(`oid:${record.idCustomer}`);
    if (customerCache.has(k)) return customerCache.get(k);
    const c = await prisma.customer.findFirst({
      where: { id: record.idCustomer, restaurant_code: record.public_code },
      select: { id: true }
    });
    customerCache.set(k, c);
    if (c) return c;
  }

  // 3. Fallback contact_key email
  if (record.contact_key && record.contact_key.startsWith('email:')) {
    const email = record.contact_key.replace('email:', '');
    const k = cacheKey(`email:${email}`);
    if (customerCache.has(k)) return customerCache.get(k);
    const c = await prisma.customer.findFirst({
      where: { email, restaurant_code: record.public_code },
      select: { id: true }
    });
    customerCache.set(k, c);
    if (c) return c;
  }

  // 4. Fallback contact_key phone
  if (record.contact_key && record.contact_key.startsWith('phone:')) {
    const phone = record.contact_key.replace('phone:', '');
    const k = cacheKey(`phone:${phone}`);
    if (customerCache.has(k)) return customerCache.get(k);
    const c = await prisma.customer.findFirst({
      where: { mobile: phone, restaurant_code: record.public_code },
      select: { id: true }
    });
    customerCache.set(k, c);
    if (c) return c;
  }

  return null;
}

async function main() {
  const where = { reference_customer: '' };
  if (restaurantFilter) {
    where.public_code = restaurantFilter;
    console.log(`Filtro restaurant_code: ${restaurantFilter}`);
  }

  const total = await prisma.customerOrdersFlat.count({ where });
  console.log(`Record da backfillare: ${total}`);
  if (total === 0) return;

  let aggiornati = 0, saltati = 0, skip = 0;
  const customerCache = new Map();

  while (skip < total) {
    const records = await prisma.customerOrdersFlat.findMany({
      where,
      select: { id: true, detail_id: true, idCustomer: true, contact_key: true, public_code: true },
      skip,
      take: BATCH_SIZE,
      orderBy: { id: 'asc' }
    });

    if (records.length === 0) break;

    const updates = [];
    for (const record of records) {
      const customer = await resolveCustomer(record, customerCache);
      if (customer) {
        updates.push(prisma.customerOrdersFlat.update({
          where: { id: record.id },
          data: { reference_customer: customer.id }
        }));
        aggiornati++;
      } else {
        saltati++;
      }
    }

    if (updates.length > 0) await Promise.all(updates);

    skip += records.length;
    console.log(`Progresso: ${Math.min(skip, total)}/${total} (aggiornati=${aggiornati} saltati=${saltati})`);
  }

  console.log(`\nBackfill completato: aggiornati=${aggiornati} saltati=${saltati}`);
}

main().catch(console.error).finally(() => prisma.$disconnect());
