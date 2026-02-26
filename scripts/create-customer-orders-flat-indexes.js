/*
 * Script per creare gli indici composti su CustomerOrdersFlat.
 *
 * Uso:
 *   node scripts/create-customer-orders-flat-indexes.js
 */

require("dotenv").config();
const { MongoClient } = require("mongodb");

const mongoUri = process.env.DATABASE_URL;

if (!mongoUri) {
  console.error("DATABASE_URL non definita nelle variabili di ambiente");
  process.exit(1);
}

async function createIndexes() {
  const client = new MongoClient(mongoUri, {
    maxPoolSize: 5,
  });

  try {
    await client.connect();
    console.log("Connesso al cluster MongoDB");

    const db = client.db();
    const collection = db.collection("CustomerOrdersFlat");

    console.log("Creazione indice: public_code + category + order_date + subcategory + product_code ...");
    const categoryIndex = await collection.createIndex(
      { public_code: 1, category: 1, order_date: -1, subcategory: 1, product_code: 1 },
      { name: "CustomerOrdersFlat_public_code_category_date_sub_product_idx" }
    );

    console.log(`Indice creato: ${categoryIndex}`);

    console.log("Creazione indice: public_code + subcategory + order_date ...");
    const subcategoryIndex = await collection.createIndex(
      { public_code: 1, subcategory: 1, order_date: -1 },
      { name: "CustomerOrdersFlat_public_code_subcategory_date_idx" }
    );

    console.log(`Indice creato: ${subcategoryIndex}`);

    console.log("Creazione indice: public_code + brand + order_date ...");
    const brandIndex = await collection.createIndex(
      { public_code: 1, brand: 1, order_date: -1 },
      { name: "CustomerOrdersFlat_public_code_brand_date_idx" }
    );

    console.log(`Indice creato: ${brandIndex}`);
  } catch (error) {
    console.error("Errore durante la creazione degli indici:", error);
    process.exitCode = 1;
  } finally {
    await client.close();
    console.log("Connessione MongoDB chiusa");
  }
}

createIndexes();
