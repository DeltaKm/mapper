const fs = require('fs');
const path = require('path');

// Importa Prisma (assicurati che il path sia corretto)
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

// Configurazione ultra-veloce
const BATCH_SIZE = 2000; // Batch grandi per operazioni bulk
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

// Funzione principale ultra-veloce
async function loadCustomersUltra() {
  console.log(`[${getItalianDateString()}] Inizio caricamento ULTRA-VELOCE clienti...`);
  
  try {
    console.log(`[${getItalianDateString()}] Lettura file ${JSON_FILE_PATH}...`);
    const jsonData = JSON.parse(fs.readFileSync(JSON_FILE_PATH, 'utf8'));
    
    if (!jsonData.customerList || !Array.isArray(jsonData.customerList)) {
      throw new Error('customerList non trovato o non è un array');
    }
    
    const customers = jsonData.customerList;
    const totalCustomers = customers.length;
    
    console.log(`[${getItalianDateString()}] Trovati ${totalCustomers} clienti da processare`);
    
    // STEP 1: Carica TUTTI i clienti esistenti in memoria una volta sola
    console.log(`[${getItalianDateString()}] Caricamento clienti esistenti in memoria...`);
    const existingCustomers = await prisma.customer.findMany({
      where: { restaurant_code: RESTAURANT_CODE },
      select: {
        id: true,
        idCustomer: true,
        email: true,
        dateLastUpdate: true,
        // Tutti i campi per preservare dati esistenti
        idReferenceGateway: true,
        gender: true,
        name: true,
        surname: true,
        birth_data: true,
        vat_number: true,
        residence_address: true,
        residence_zipcode: true,
        residence_city: true,
        residence_province: true,
        residence_region: true,
        residence_state: true,
        domicile_address: true,
        domicile_zipcode: true,
        domicile_city: true,
        domicile_province: true,
        domicile_region: true,
        domicile_state: true,
        mobile: true,
        publicCode: true,
        subscriber: true,
        arrived_from: true,
        fidelity_card_number: true,
        consent_marketing: true,
        consent_third_parties_marketing: true,
        dateCreation: true,
        deleted: true
      }
    });
    
    console.log(`[${getItalianDateString()}] Caricati ${existingCustomers.length} clienti esistenti in memoria`);
    
    // Crea mappe per lookup veloce
    const customerByIdMap = new Map();
    const customerByEmailMap = new Map();
    
    existingCustomers.forEach(customer => {
      if (customer.idCustomer) {
        customerByIdMap.set(customer.idCustomer, customer);
      }
      if (customer.email) {
        customerByEmailMap.set(customer.email, customer);
      }
    });
    
    console.log(`[${getItalianDateString()}] Mappe di lookup create - ID: ${customerByIdMap.size}, Email: ${customerByEmailMap.size}`);
    
    // STEP 2: Processa tutti i clienti in memoria
    console.log(`[${getItalianDateString()}] Processamento clienti in memoria...`);
    
    const toCreate = [];
    const toUpdate = [];
    let skipped = 0;
    let errors = 0;
    
    for (let i = 0; i < totalCustomers; i++) {
      const customer = customers[i];
      
      // Log progresso ogni 5000 clienti
      if (i % 5000 === 0) {
        console.log(`[${getItalianDateString()}] Analisi progresso: ${i}/${totalCustomers} (${Math.round(i/totalCustomers*100)}%)`);
      }
      
      try {
        const arrivedFrom = customer.arrived_from?.toLowerCase() || "";
        const incomingLastUpdate = customer.dateLastUpdateProduct || "";
        
        let effectiveCustomerId = "";
        
        // Determina ID cliente
        if (arrivedFrom === "app") {
          effectiveCustomerId = customer.idCustomerExt || customer.idCustomer;
          if (!effectiveCustomerId) {
            skipped++;
            continue;
          }
        } else {
          effectiveCustomerId = customer.idCustomerExt || "";
        }
        
        // Lookup veloce in memoria
        let existing = null;
        if (effectiveCustomerId) {
          existing = customerByIdMap.get(effectiveCustomerId);
        }
        if (!existing && customer.email) {
          existing = customerByEmailMap.get(customer.email);
        }
        
        // Prepara dati cliente
        const customerData = {
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
          dateLastUpdate: incomingLastUpdate,
          deleted: customer.deleted || "",
          restaurant_code: RESTAURANT_CODE,
          subscriber_code: SUBSCRIBER_CODE
        };
        
        if (existing) {
          // Controlla se aggiornare
          const existingLastUpdate = existing.dateLastUpdate || "";
          if (incomingLastUpdate && existingLastUpdate && incomingLastUpdate <= existingLastUpdate) {
            skipped++;
            continue;
          }
          
          // Preserva campi esistenti se nuovi sono vuoti
          Object.keys(customerData).forEach(key => {
            if (!customerData[key] && existing[key]) {
              customerData[key] = existing[key];
            }
          });
          
          customerData.updateAt = new Date();
          
          toUpdate.push({
            where: { id: existing.id },
            data: customerData
          });
        } else {
          customerData.createdAt = new Date();
          toCreate.push(customerData);
        }
        
      } catch (error) {
        console.error(`Errore processando cliente ${i}: ${error.message}`);
        errors++;
      }
    }
    
    console.log(`[${getItalianDateString()}] Analisi completata:`);
    console.log(`  - Da creare: ${toCreate.length}`);
    console.log(`  - Da aggiornare: ${toUpdate.length}`);
    console.log(`  - Saltati: ${skipped}`);
    console.log(`  - Errori: ${errors}`);
    
    // STEP 3: Operazioni bulk sul database
    let created = 0;
    let updated = 0;
    
    // Bulk create
    if (toCreate.length > 0) {
      console.log(`[${getItalianDateString()}] Creazione bulk di ${toCreate.length} clienti...`);
      
      for (let i = 0; i < toCreate.length; i += BATCH_SIZE) {
        const batch = toCreate.slice(i, i + BATCH_SIZE);
        const batchNum = Math.floor(i / BATCH_SIZE) + 1;
        const totalBatches = Math.ceil(toCreate.length / BATCH_SIZE);
        
        console.log(`[${getItalianDateString()}] Creando batch ${batchNum}/${totalBatches} (${batch.length} clienti)...`);
        
        try {
          const result = await prisma.customer.createMany({
            data: batch
          });
          created += result.count;
        } catch (error) {
          console.error(`Errore batch create ${batchNum}: ${error.message}`);
          errors += batch.length;
        }
      }
    }
    
    // Bulk update (in batch per evitare timeout)
    if (toUpdate.length > 0) {
      console.log(`[${getItalianDateString()}] Aggiornamento di ${toUpdate.length} clienti...`);
      
      for (let i = 0; i < toUpdate.length; i += 100) { // Batch più piccoli per update
        const batch = toUpdate.slice(i, i + 100);
        const batchNum = Math.floor(i / 100) + 1;
        const totalBatches = Math.ceil(toUpdate.length / 100);
        
        if (batchNum % 10 === 1) { // Log ogni 10 batch
          console.log(`[${getItalianDateString()}] Aggiornando batch ${batchNum}/${totalBatches}...`);
        }
        
        try {
          const updatePromises = batch.map(async ({ where, data }) => {
            try {
              await prisma.customer.update({ where, data });
              return 'success';
            } catch (err) {
              console.error(`Errore update singolo: ${err.message}`);
              return 'error';
            }
          });
          
          const results = await Promise.all(updatePromises);
          const successCount = results.filter(r => r === 'success').length;
          const errorCount = results.filter(r => r === 'error').length;
          
          updated += successCount;
          errors += errorCount;
        } catch (error) {
          console.error(`Errore batch update ${batchNum}: ${error.message}`);
          errors += batch.length;
        }
      }
    }
    
    console.log(`[${getItalianDateString()}] Caricamento ULTRA-VELOCE completato!`);
    console.log(`[${getItalianDateString()}] Statistiche finali:`);
    console.log(`  - Processati: ${totalCustomers}`);
    console.log(`  - Creati: ${created}`);
    console.log(`  - Aggiornati: ${updated}`);
    console.log(`  - Saltati: ${skipped}`);
    console.log(`  - Errori: ${errors}`);
    
  } catch (error) {
    console.error(`[${getItalianDateString()}] Errore durante il caricamento:`, error);
  } finally {
    await prisma.$disconnect();
  }
}

// Esegui lo script
if (require.main === module) {
  loadCustomersUltra();
}

module.exports = { loadCustomersUltra };
