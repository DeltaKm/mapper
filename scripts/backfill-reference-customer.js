const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  // Trova tutti i CustomerOrdersFlat con reference_customer vuoto
  const records = await prisma.customerOrdersFlat.findMany({
    where: { reference_customer: '' },
    select: { id: true, detail_id: true, idCustomer: true, contact_key: true, public_code: true, source: true, order_id: true }
  });
  console.log('Record da backfillare:', records.length);

  let aggiornati = 0, saltati = 0;

  for (const record of records) {
    let customer = null;

    // 1. Prova per idCustomer diretto (es. "49930" in source=restaurant)
    if (record.idCustomer) {
      customer = await prisma.customer.findFirst({
        where: { idCustomer: record.idCustomer, restaurant_code: record.public_code },
        select: { id: true }
      });
    }

    // 2. Se source=retail e non trovato: il vecchio codice salvava il MongoDB _id come idCustomer
    //    → cerca per customer.id direttamente
    if (!customer && record.idCustomer && record.idCustomer.length === 24) {
      customer = await prisma.customer.findFirst({
        where: { id: record.idCustomer, restaurant_code: record.public_code },
        select: { id: true }
      });
    }

    // 3. Fallback: cerca tramite contact_key email
    if (!customer && record.contact_key && record.contact_key.startsWith('email:')) {
      const email = record.contact_key.replace('email:', '');
      customer = await prisma.customer.findFirst({
        where: { email: email, restaurant_code: record.public_code },
        select: { id: true }
      });
    }

    // 4. Fallback: cerca tramite contact_key phone
    if (!customer && record.contact_key && record.contact_key.startsWith('phone:')) {
      const phone = record.contact_key.replace('phone:', '');
      customer = await prisma.customer.findFirst({
        where: { mobile: phone, restaurant_code: record.public_code },
        select: { id: true }
      });
    }

    if (customer) {
      await prisma.customerOrdersFlat.update({
        where: { id: record.id },
        data: { reference_customer: customer.id }
      });
      aggiornati++;
      console.log('OK:', record.detail_id, '→ reference_customer =', customer.id);
    } else {
      saltati++;
      console.log('SKIP (no match):', record.detail_id, '| idCustomer:', record.idCustomer, '| contact_key:', record.contact_key);
    }
  }

  console.log('\nBackfill completato: aggiornati=' + aggiornati + ' saltati=' + saltati);
}

main().catch(console.error).finally(() => prisma.$disconnect());
