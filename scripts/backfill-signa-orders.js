/*
 * Script di backfill per creare righe CustomerOrdersFlat mancanti
 * a partire dai documenti SignaMovimenti privi di idCustomerExt.
 *
 * Uso:
 *   node scripts/backfill-signa-orders.js [--restaurant CENE)0000308] [--dry-run]
 *
 * Richiede DATABASE_URL configurata (es. in .env).
 */

require("dotenv").config();
const { MongoClient } = require("mongodb");

const mongoUri = process.env.DATABASE_URL;
if (!mongoUri) {
  console.error("DATABASE_URL non definita nelle variabili di ambiente");
  process.exit(1);
}

const args = process.argv.slice(2);
let restaurantFilter = null;
let dryRun = false;

for (let i = 0; i < args.length; i++) {
  const arg = args[i];
  if (arg === "--restaurant" && args[i + 1]) {
    restaurantFilter = args[i + 1];
    i++;
  } else if (arg === "--dry-run") {
    dryRun = true;
  }
}

const INSERT_BATCH_SIZE = 500;
const CURSOR_BATCH_SIZE = 100;

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

function parseSignaDate(movimentoData, movimentoOra) {
  if (!movimentoData || typeof movimentoData !== "string") {
    return new Date();
  }

  const [datePart] = movimentoData.split(" ");
  const [dayStr, monthStr, yearStr] = (datePart || "").split("/");
  const day = Number(dayStr) || 1;
  const month = (Number(monthStr) || 1) - 1;
  const year = Number(yearStr) || new Date().getFullYear();

  const time = typeof movimentoOra === "string" ? movimentoOra : "00:00:00";
  const [hourStr, minuteStr, secondStr] = time.split(":");
  const hour = Number(hourStr) || 0;
  const minute = Number(minuteStr) || 0;
  const second = Number(secondStr) || 0;

  return new Date(Date.UTC(year, month, day, hour, minute, second));
}

function extractCustomerContactData(customer = {}) {
  const rawEmail = trimEmail(customer.email || customer.Email);
  const phoneCandidates = [
    customer.mobile,
    customer.phone,
    customer.telephone,
    customer.cellphone,
    customer.Telefono,
    customer.Cellulare,
  ];
  const rawPhone = pickRawPhone(phoneCandidates);
  const contactKey = computeContactKey(rawEmail, rawPhone, customer.mobile, customer.phone, customer.telephone, customer.cellphone, customer.Telefono, customer.Cellulare);

  return {
    rawEmail,
    rawPhone,
    contactKey,
  };
}

function buildDetailId(restaurantCode, orderId, rowIndex) {
  return `${restaurantCode || ""}_${orderId || ""}_${rowIndex ?? ""}`;
}

function toNumber(value) {
  const parsed = parseFloat(value?.toString() || "0");
  return Number.isFinite(parsed) ? parsed : 0;
}

async function run() {
  const client = new MongoClient(mongoUri);

  try {
    await client.connect();
    const dbNameMatch = mongoUri.match(/\/?([^/?]+)(\?|$)/);
    const dbName = dbNameMatch ? dbNameMatch[1] : undefined;
    console.log(`Connesso a ${dbName || "database"}`);

    const db = client.db(dbName);
    const signaMovimentiCollection = db.collection("SignaMovimenti");
    const ordersCollection = db.collection("CustomerOrdersFlat");

    const movementFilter = {
      "payload.dettagli": { $exists: true, $type: "array", $ne: [] },
      $or: [
        { "payload.customer.idCustomerExt": { $exists: false } },
        { "payload.customer.idCustomerExt": null },
        { "payload.customer.idCustomerExt": "" }
      ]
    };

    if (restaurantFilter) {
      movementFilter.restaurant_code = restaurantFilter;
      console.log(`Filtrando per restaurant_code = ${restaurantFilter}`);
    }

    if (dryRun) {
      console.log("Modalità DRY-RUN attiva: nessuna scrittura verrà eseguita");
    }

    const cursor = signaMovimentiCollection.find(movementFilter, {
      batchSize: CURSOR_BATCH_SIZE,
    });

    let processedMovements = 0;
    let processedDetails = 0;
    let createdDetails = 0;
    let skippedExisting = 0;
    let skippedMissingIdentifiers = 0;

    let bulkOps = [];

    for await (const movimento of cursor) {
      processedMovements++;

      const payload = movimento.payload || {};
      const dettagli = Array.isArray(payload.dettagli) ? payload.dettagli : [];
      if (!dettagli.length) {
        continue;
      }

      const restaurantCode = movimento.restaurant_code || payload.restaurant_code || payload.publicCode || "";
      const orderId = movimento.IDReferencePOS?.toString() || payload.IDReferencePOS?.toString() || "";
      const customerData = payload.customer || {};
      const idCustomer = customerData.idCustomerExt ? customerData.idCustomerExt.toString() : "";
      const { contactKey } = extractCustomerContactData(customerData);

      if (!idCustomer && !contactKey) {
        skippedMissingIdentifiers += dettagli.length;
        continue;
      }

      const detailIds = dettagli.map((dettaglio) => buildDetailId(restaurantCode, orderId, dettaglio.Riga));
      const existingDetails = await ordersCollection.find({ detail_id: { $in: detailIds } }, { projection: { detail_id: 1 } }).toArray();
      const existingDetailSet = new Set(existingDetails.map((doc) => doc.detail_id));

      const orderDate = parseSignaDate(payload.MovimentoData || movimento.MovimentoData, payload.MovimentoOra || movimento.MovimentoOra);
      const orderTime = payload.MovimentoOra || movimento.MovimentoOra || "";
      const orderYear = Number(payload.MovimentoAnno || movimento.MovimentoAnno) || orderDate.getUTCFullYear();

      for (const dettaglio of dettagli) {
        processedDetails++;

        const detailId = buildDetailId(restaurantCode, orderId, dettaglio.Riga);
        if (existingDetailSet.has(detailId)) {
          skippedExisting++;
          continue;
        }

        if (!idCustomer && !contactKey) {
          skippedMissingIdentifiers++;
          continue;
        }

        const quantity = toNumber(dettaglio.Quantita);
        const unitPrice = toNumber(dettaglio.Valore);
        const totalAmount = quantity * unitPrice;

        const record = {
          detail_id: detailId,
          idCustomer: idCustomer,
          contact_key: contactKey,
          order_id: orderId,
          public_code: restaurantCode,
          source: "retail",
          order_date: orderDate,
          order_time: orderTime,
          order_year: orderYear,
          movement_type: dettaglio.CodTipoMovimento || "",
          is_return: (dettaglio.CodTipoMovimento || "") === "RC",
          product_code: dettaglio.CodArticolo || "",
          product_name: dettaglio.Article_Description_Short || "",
          category: dettaglio.Famiglia || "",
          subcategory: dettaglio.SottoFamiglia || "",
          brand: dettaglio.Marchio || "",
          season: dettaglio.CodStagione || "",
          color: dettaglio.Colore || "",
          size: dettaglio.Taglia || "",
          quantity,
          unit_price: unitPrice,
          total_amount: totalAmount,
          created_at: new Date(),
          updated_at: new Date(),
        };

        createdDetails++;

        if (!dryRun) {
          bulkOps.push({ insertOne: { document: record } });
        }

        if (!dryRun && bulkOps.length >= INSERT_BATCH_SIZE) {
          const result = await ordersCollection.bulkWrite(bulkOps, { ordered: false });
          console.log(`Bulk insert eseguito: inserted ${result.insertedCount || 0} (batch da ${bulkOps.length})`);
          bulkOps = [];
        }
      }

      if (processedMovements % 100 === 0) {
        console.log(`Movimenti elaborati: ${processedMovements}, righe create: ${createdDetails}, righe già presenti: ${skippedExisting}, righe senza identificativi: ${skippedMissingIdentifiers}`);
      }
    }

    if (!dryRun && bulkOps.length > 0) {
      const result = await ordersCollection.bulkWrite(bulkOps, { ordered: false });
      console.log(`Bulk finale eseguito: inserted ${result.insertedCount || 0} (batch da ${bulkOps.length})`);
    }

    console.log("--- Riepilogo backfill Signa ---");
    console.log(`Movimenti processati: ${processedMovements}`);
    console.log(`Dettagli valutati: ${processedDetails}`);
    console.log(`Dettagli creati: ${createdDetails}`);
    console.log(`Dettagli già presenti: ${skippedExisting}`);
    console.log(`Dettagli saltati (senza identificativo): ${skippedMissingIdentifiers}`);
  } catch (error) {
    console.error("Errore durante il backfill delle righe Signa:", error);
    process.exitCode = 1;
  } finally {
    await client.close();
    console.log("Connessione chiusa");
  }
}

run();
