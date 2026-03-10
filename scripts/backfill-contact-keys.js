
require("dotenv").config();
const { MongoClient } = require("mongodb");

const mongoUri = process.env.DATABASE_URL;

if (!mongoUri) {
  console.error("DATABASE_URL non definita nelle variabili di ambiente");
  process.exit(1);
}

const BATCH_SIZE = 500;

function normalizeEmail(email) {
  if (!email || typeof email !== "string") return "";
  return email.trim().toLowerCase();
}

function trimEmail(email) {
  if (!email || typeof email !== "string") return "";
  return email.trim();
}

function normalizePhone(phone) {
  if (!phone || typeof phone !== "string") return "";
  return phone.replace(/\D+/g, "");
}

function pickRawPhone(phoneCandidates = []) {
  for (const candidate of phoneCandidates) {
    if (typeof candidate === "string" && candidate.trim().length > 0) {
      return candidate.trim();
    }
  }
  return "";
}

function computeContactKey(email, ...phones) {
  const normalizedEmail = normalizeEmail(email);
  if (normalizedEmail) {
    return `email:${normalizedEmail}`;
  }

  for (const phone of phones) {
    const normalizedPhone = normalizePhone(phone);
    if (normalizedPhone) {
      return `phone:${normalizedPhone}`;
    }
  }

  return "";
}

function extractCustomerContactData(customer) {
  const rawEmail = trimEmail(customer?.email);
  const phoneCandidates = [
    customer?.mobile,
    customer?.phone,
    customer?.telephone,
    customer?.cellphone,
  ];
  const rawPhone = pickRawPhone(phoneCandidates);
  const contactKey = computeContactKey(rawEmail, rawPhone, customer?.mobile, customer?.phone, customer?.telephone, customer?.cellphone);

  return { rawEmail, rawPhone, contactKey };
}

async function backfillCustomerContactKeys(db) {
  const customerCollection = db.collection("Customer");

  const filter = {
    $or: [
      { contact_key: { $exists: false } },
      { contact_key: null },
      { contact_key: "" }
    ]
  };

  let processed = 0;
  let updated = 0;

  const cursor = customerCollection.find(filter, { batchSize: BATCH_SIZE });
  let bulkOps = [];

  for await (const customer of cursor) {
    processed++;

    const { rawEmail, rawPhone, contactKey } = extractCustomerContactData(customer);

    if (!contactKey || contactKey === customer.contact_key) {
      continue;
    }

    bulkOps.push({
      updateOne: {
        filter: { _id: customer._id },
        update: {
          $set: {
            contact_key: contactKey,
            email: rawEmail || customer.email || "",
            mobile: rawPhone || customer.mobile || "",
            updateAt: new Date(),
          }
        }
      }
    });

    if (bulkOps.length >= BATCH_SIZE) {
      const result = await customerCollection.bulkWrite(bulkOps, { ordered: false });
      updated += result.modifiedCount || 0;
      console.log(`Customer – batch aggiornato: ${result.modifiedCount}/${bulkOps.length}`);
      bulkOps = [];
    }
  }

  if (bulkOps.length > 0) {
    const result = await customerCollection.bulkWrite(bulkOps, { ordered: false });
    updated += result.modifiedCount || 0;
    console.log(`Customer – batch aggiornato: ${result.modifiedCount}/${bulkOps.length}`);
  }

  console.log(`Customer – processati ${processed}, aggiornati ${updated}`);
  return { processed, updated };
}

async function backfillOrderContactKeys(db) {
  const ordersCollection = db.collection("CustomerOrdersFlat");
  const customerCollection = db.collection("Customer");
  const customerCache = new Map();

  const filter = {
    $or: [
      { contact_key: { $exists: false } },
      { contact_key: null },
      { contact_key: "" }
    ]
  };

  let processed = 0;
  let updated = 0;

  const cursor = ordersCollection.find(filter, { batchSize: BATCH_SIZE });
  let bulkOps = [];

  for await (const order of cursor) {
    processed++;

    if (order.contact_key && order.contact_key !== "") {
      continue;
    }

    let contactKey = "";

    if (order.idCustomer) {
      const cacheKey = `${order.public_code || ""}__${order.idCustomer}`;
      if (customerCache.has(cacheKey)) {
        contactKey = customerCache.get(cacheKey);
      } else {
        const matchingCustomer = await customerCollection.findOne({
          restaurant_code: order.public_code || "",
          idCustomer: order.idCustomer
        });

        if (matchingCustomer) {
          const { rawEmail, rawPhone, contactKey: computed } = extractCustomerContactData(matchingCustomer);
          contactKey = matchingCustomer.contact_key || computed;

          customerCache.set(cacheKey, contactKey);

          if (!matchingCustomer.contact_key && contactKey) {
            await customerCollection.updateOne(
              { _id: matchingCustomer._id },
              {
                $set: {
                  contact_key: contactKey,
                  email: rawEmail || matchingCustomer.email || "",
                  mobile: rawPhone || matchingCustomer.mobile || "",
                  updateAt: new Date(),
                }
              }
            );
          }
        } else {
          customerCache.set(cacheKey, "");
        }
      }
    }

    if (!contactKey) {
      continue;
    }

    bulkOps.push({
      updateOne: {
        filter: { _id: order._id },
        update: {
          $set: {
            contact_key: contactKey,
            updated_at: new Date()
          }
        }
      }
    });

    if (bulkOps.length >= BATCH_SIZE) {
      const result = await ordersCollection.bulkWrite(bulkOps, { ordered: false });
      updated += result.modifiedCount || 0;
      console.log(`CustomerOrdersFlat – batch aggiornato: ${result.modifiedCount}/${bulkOps.length}`);
      bulkOps = [];
    }
  }

  if (bulkOps.length > 0) {
    const result = await ordersCollection.bulkWrite(bulkOps, { ordered: false });
    updated += result.modifiedCount || 0;
    console.log(`CustomerOrdersFlat – batch aggiornato: ${result.modifiedCount}/${bulkOps.length}`);
  }

  console.log(`CustomerOrdersFlat – processati ${processed}, aggiornati ${updated}`);
  return { processed, updated };
}

async function run() {
  const client = new MongoClient(mongoUri);

  try {
    await client.connect();
    const dbNameMatch = mongoUri.match(/\/?([^/?]+)(\?|$)/);
    const dbName = dbNameMatch ? dbNameMatch[1] : undefined;
    console.log(`Connesso a ${dbName || "database"}`);

    const db = client.db(dbName);

    const customerResult = await backfillCustomerContactKeys(db);
    const orderResult = await backfillOrderContactKeys(db);

    console.log("--- Riepilogo ---");
    console.log(`Customer – processati: ${customerResult.processed}, aggiornati: ${customerResult.updated}`);
    console.log(`CustomerOrdersFlat – processati: ${orderResult.processed}, aggiornati: ${orderResult.updated}`);
  } catch (error) {
    console.error("Errore durante la migrazione delle contact key:", error);
    process.exitCode = 1;
  } finally {
    await client.close();
    console.log("Connessione chiusa");
  }
}

run();
