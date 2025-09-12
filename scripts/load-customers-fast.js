const fs = require('fs');
const path = require('path');

// Importa Prisma (assicurati che il path sia corretto)
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

// Configurazione ottimizzata
const BATCH_SIZE = 1000; // Batch più conservativi
const PARALLEL_BATCHES = 2; // Processa 2 batch in parallelo
const JSON_FILE_PATH = path.join(__dirname, '../TempSignaWowRestGateWay.json');
const RESTAURANT_CODE = "CENE)0000308";
const SUBSCRIBER_CODE = "SIGNA";

// Funzione per ottenere data italiana
function getItalianDateString() {
  return new Date().toLocaleString('it-IT', {
    timeZone: 'Europe/Rome',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });
}

// Funzione per processare un batch di clienti in parallelo
async function processBatchParallel(customers, restaurant_code, subscriber_code) {
  const results = {
    created: 0,
    updated: 0,
    skipped: 0,
    errors: 0
  };

  // Raggruppa operazioni per tipo
  const toCreate = [];
  const toUpdate = [];
  const toSkip = [];

  // Prima fase: identifica cosa fare per ogni cliente (con logging)
  console.log(`[${getItalianDateString()}] Analizzando ${customers.length} clienti...`);
  
  for (let i = 0; i < customers.length; i++) {
    const customer = customers[i];
    
    // Log progresso ogni 100 clienti
    if (i % 100 === 0) {
      console.log(`[${getItalianDateString()}] Analisi progresso: ${i}/${customers.length}`);
    }
    
    try {
      const arrivedFrom = customer.arrived_from?.toLowerCase() || "";
      const incomingLastUpdate = customer.dateLastUpdateProduct || "";
      
      let existing = null;
      let effectiveCustomerId = "";
      
      if (arrivedFrom === "app") {
        effectiveCustomerId = customer.idCustomerExt || customer.idCustomer;
        if (!effectiveCustomerId) {
          toSkip.push({ customer, reason: 'no_id' });
          continue;
        }
        
        existing = await prisma.customer.findFirst({
          where: {
            AND: [
              { restaurant_code },
              {
                OR: [
                  { idCustomer: effectiveCustomerId },
                  ...(customer.email ? [{ email: customer.email }] : [])
                ].filter(Boolean)
              }
            ]
          }
        });
      } else {
        if (customer.idCustomerExt) {
          effectiveCustomerId = customer.idCustomerExt;
          existing = await prisma.customer.findFirst({
            where: {
              AND: [
                { restaurant_code },
                {
                  OR: [
                    { idCustomer: effectiveCustomerId },
                    ...(customer.email ? [{ email: customer.email }] : [])
                  ].filter(Boolean)
                }
              ]
            }
          });
        } else {
          effectiveCustomerId = "";
          if (customer.email) {
            existing = await prisma.customer.findFirst({
              where: {
                AND: [
                  { restaurant_code },
                  { email: customer.email }
                ]
              }
            });
          }
        }
      }
      
      if (existing) {
        const existingLastUpdate = existing.dateLastUpdate || "";
        if (incomingLastUpdate && existingLastUpdate && incomingLastUpdate <= existingLastUpdate) {
          toSkip.push({ customer, reason: 'date_not_recent' });
          continue;
        }
        
        // Prepara per update
        const filteredCustomerData = {
          idReferenceGateway: customer.idReferenceGateway || existing.idReferenceGateway || "",
          idCustomer: effectiveCustomerId,
          gender: customer.gender || existing.gender || "",
          name: customer.name || existing.name || "",
          surname: customer.surname || existing.surname || "",
          birth_data: customer.birth_data || existing.birth_data || "",
          vat_number: customer.vat_number || existing.vat_number || "",
          residence_address: customer.residence_address || existing.residence_address || "",
          residence_zipcode: customer.residence_zipcode || existing.residence_zipcode || "",
          residence_city: customer.residence_city || existing.residence_city || "",
          residence_province: customer.residence_province || existing.residence_province || "",
          residence_region: customer.residence_region || existing.residence_region || "",
          residence_state: customer.residence_state || existing.residence_state || "",
          domicile_address: customer.domicile_address || existing.domicile_address || "",
          domicile_zipcode: customer.domicile_zipcode || existing.domicile_zipcode || "",
          domicile_city: customer.domicile_city || existing.domicile_city || "",
          domicile_province: customer.domicile_province || existing.domicile_province || "",
          domicile_region: customer.domicile_region || existing.domicile_region || "",
          domicile_state: customer.domicile_state || existing.domicile_state || "",
          mobile: customer.mobile || existing.mobile || "",
          email: customer.email || existing.email || "",
          publicCode: customer.publicCode || existing.publicCode || "",
          subscriber: customer.subscriber || existing.subscriber || "",
          arrived_from: customer.arrived_from || existing.arrived_from || "",
          fidelity_card_number: customer.fidelity_card_number || existing.fidelity_card_number || "",
          consent_marketing: customer.consent_marketing || existing.consent_marketing || "",
          consent_third_parties_marketing: customer.consent_third_parties_marketing || existing.consent_third_parties_marketing || "",
          dateCreation: customer.dateCreationProduct || customer.dateCreation || existing.dateCreation || "",
          dateLastUpdate: incomingLastUpdate,
          deleted: customer.deleted || existing.deleted || "",
          restaurant_code,
          subscriber_code,
          updateAt: new Date(),
        };
        
        toUpdate.push({ id: existing.id, data: filteredCustomerData });
      } else {
        // Prepara per create
        const filteredCustomerData = {
          idReferenceGateway: customer.idReferenceGateway || "",
          idCustomer: effectiveCustomerId,
          gender: customer.gender || "",
          name: customer.name || "",
          surname: customer.surname || "",
          birth_data: customer.birth_data || "",
          vat_number: customer.vat_number || "",
          residence_address: customer.residence_address || "",
          residence_zipcode: customer.residence_zipcode || "",
          residence_city: customer.residence_city || "",
          residence_province: customer.residence_province || "",
          residence_region: customer.residence_region || "",
          residence_state: customer.residence_state || "",
          domicile_address: customer.domicile_address || "",
          domicile_zipcode: customer.domicile_zipcode || "",
          domicile_city: customer.domicile_city || "",
          domicile_province: customer.domicile_province || "",
          domicile_region: customer.domicile_region || "",
          domicile_state: customer.domicile_state || "",
          mobile: customer.mobile || "",
          email: customer.email || "",
          publicCode: customer.publicCode || "",
          subscriber: customer.subscriber || "",
          arrived_from: customer.arrived_from || "",
          fidelity_card_number: customer.fidelity_card_number || "",
          consent_marketing: customer.consent_marketing || "",
          consent_third_parties_marketing: customer.consent_third_parties_marketing || "",
          dateCreation: customer.dateCreationProduct || customer.dateCreation || "",
          dateLastUpdate: customer.dateLastUpdateProduct || customer.dateLastUpdate || "",
          deleted: customer.deleted || "",
          restaurant_code,
          subscriber_code,
          createdAt: new Date()
        };
        
        toCreate.push(filteredCustomerData);
      }
    } catch (error) {
      console.error(`Errore processando cliente ${customer?.name || 'sconosciuto'}: ${error}`);
      results.errors++;
    }
  }

  // Seconda fase: esegui operazioni batch in parallelo
  const operations = [];
  
  // Batch create
  if (toCreate.length > 0) {
    operations.push(
      prisma.customer.createMany({
        data: toCreate,
        skipDuplicates: true
      }).then(() => {
        results.created += toCreate.length;
      })
    );
  }
  
  // Batch updates (in parallelo)
  if (toUpdate.length > 0) {
    const updatePromises = toUpdate.map(({ id, data }) =>
      prisma.customer.update({
        where: { id },
        data
      }).then(() => {
        results.updated++;
      }).catch(error => {
        console.error(`Errore update cliente ${id}: ${error}`);
        results.errors++;
      })
    );
    operations.push(...updatePromises);
  }
  
  // Esegui tutte le operazioni in parallelo
  await Promise.all(operations);
  
  results.skipped = toSkip.length;
  
  return results;
}

// Funzione principale ottimizzata
async function loadCustomersFast() {
  console.log(`[${getItalianDateString()}] Inizio caricamento VELOCE clienti...`);
  
  try {
    console.log(`[${getItalianDateString()}] Lettura file ${JSON_FILE_PATH}...`);
    const jsonData = JSON.parse(fs.readFileSync(JSON_FILE_PATH, 'utf8'));
    
    if (!jsonData.customerList || !Array.isArray(jsonData.customerList)) {
      throw new Error('customerList non trovato o non è un array');
    }
    
    const customers = jsonData.customerList;
    const totalCustomers = customers.length;
    
    console.log(`[${getItalianDateString()}] Trovati ${totalCustomers} clienti da processare`);
    console.log(`[${getItalianDateString()}] Processamento PARALLELO: ${PARALLEL_BATCHES} batch di ${BATCH_SIZE} clienti...`);
    
    let processed = 0;
    let totalCreated = 0;
    let totalUpdated = 0;
    let totalSkipped = 0;
    let totalErrors = 0;
    
    // Crea chunks per processamento parallelo
    const chunks = [];
    for (let i = 0; i < totalCustomers; i += BATCH_SIZE) {
      chunks.push(customers.slice(i, i + BATCH_SIZE));
    }
    
    // Processa chunks in parallelo
    for (let i = 0; i < chunks.length; i += PARALLEL_BATCHES) {
      const parallelChunks = chunks.slice(i, i + PARALLEL_BATCHES);
      const batchNumber = Math.floor(i / PARALLEL_BATCHES) + 1;
      const totalBatches = Math.ceil(chunks.length / PARALLEL_BATCHES);
      
      console.log(`[${getItalianDateString()}] Processando gruppo ${batchNumber}/${totalBatches} (${parallelChunks.length} batch paralleli)...`);
      
      // Esegui batch in parallelo
      const promises = parallelChunks.map(chunk => 
        processBatchParallel(chunk, RESTAURANT_CODE, SUBSCRIBER_CODE)
      );
      
      const results = await Promise.all(promises);
      
      // Aggrega risultati
      results.forEach(result => {
        totalCreated += result.created;
        totalUpdated += result.updated;
        totalSkipped += result.skipped;
        totalErrors += result.errors;
        processed += BATCH_SIZE;
      });
      
      console.log(`[${getItalianDateString()}] Progresso: ${Math.min(processed, totalCustomers)}/${totalCustomers} (${Math.round(Math.min(processed, totalCustomers)/totalCustomers*100)}%)`);
    }
    
    console.log(`[${getItalianDateString()}] Caricamento VELOCE completato!`);
    console.log(`[${getItalianDateString()}] Statistiche finali:`);
    console.log(`  - Processati: ${totalCustomers}`);
    console.log(`  - Creati: ${totalCreated}`);
    console.log(`  - Aggiornati: ${totalUpdated}`);
    console.log(`  - Saltati: ${totalSkipped}`);
    console.log(`  - Errori: ${totalErrors}`);
    
  } catch (error) {
    console.error(`[${getItalianDateString()}] Errore durante il caricamento:`, error);
  } finally {
    await prisma.$disconnect();
  }
}

// Esegui lo script
if (require.main === module) {
  loadCustomersFast();
}

module.exports = { loadCustomersFast };
