const fs = require('fs');
const path = require('path');

// Importa Prisma (assicurati che il path sia corretto)
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

// Configurazione semplice
const BATCH_SIZE = 500; // Batch più piccoli
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

// Funzione per processare un singolo cliente (semplificata)
async function processCustomer(customer, restaurant_code, subscriber_code) {
  try {
    const arrivedFrom = customer.arrived_from?.toLowerCase() || "";
    const incomingLastUpdate = customer.dateLastUpdateProduct || "";
    
    let existing = null;
    let effectiveCustomerId = "";
    
    // Logica semplificata per idCustomer
    if (arrivedFrom === "app") {
      effectiveCustomerId = customer.idCustomerExt || customer.idCustomer;
      if (!effectiveCustomerId) {
        return 'skipped';
      }
    } else {
      effectiveCustomerId = customer.idCustomerExt || "";
    }
    
    // Cerca cliente esistente
    const searchCriteria = {
      AND: [
        { restaurant_code },
        {
          OR: [
            ...(effectiveCustomerId ? [{ idCustomer: effectiveCustomerId }] : []),
            ...(customer.email ? [{ email: customer.email }] : [])
          ].filter(Boolean)
        }
      ]
    };
    
    if (searchCriteria.AND[1].OR.length > 0) {
      existing = await prisma.customer.findFirst({
        where: searchCriteria
      });
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
      restaurant_code,
      subscriber_code
    };
    
    if (existing) {
      // Controlla se aggiornare
      const existingLastUpdate = existing.dateLastUpdate || "";
      if (incomingLastUpdate && existingLastUpdate && incomingLastUpdate <= existingLastUpdate) {
        return 'skipped';
      }
      
      // Preserva campi esistenti se nuovi sono vuoti
      Object.keys(customerData).forEach(key => {
        if (!customerData[key] && existing[key]) {
          customerData[key] = existing[key];
        }
      });
      
      customerData.updateAt = new Date();
      
      await prisma.customer.update({
        where: { id: existing.id },
        data: customerData
      });
      
      return 'updated';
    } else {
      customerData.createdAt = new Date();
      
      await prisma.customer.create({
        data: customerData
      });
      
      return 'created';
    }
    
  } catch (error) {
    console.error(`Errore processando cliente ${customer?.name || 'sconosciuto'}: ${error.message}`);
    return 'error';
  }
}

// Funzione principale semplificata
async function loadCustomersSimple() {
  console.log(`[${getItalianDateString()}] Inizio caricamento SEMPLICE clienti...`);
  
  try {
    console.log(`[${getItalianDateString()}] Lettura file ${JSON_FILE_PATH}...`);
    const jsonData = JSON.parse(fs.readFileSync(JSON_FILE_PATH, 'utf8'));
    
    if (!jsonData.customerList || !Array.isArray(jsonData.customerList)) {
      throw new Error('customerList non trovato o non è un array');
    }
    
    const customers = jsonData.customerList;
    const totalCustomers = customers.length;
    
    console.log(`[${getItalianDateString()}] Trovati ${totalCustomers} clienti da processare`);
    console.log(`[${getItalianDateString()}] Processamento sequenziale in batch di ${BATCH_SIZE}...`);
    
    let processed = 0;
    let created = 0;
    let updated = 0;
    let skipped = 0;
    let errors = 0;
    
    // Processa in batch sequenziali
    for (let i = 0; i < totalCustomers; i += BATCH_SIZE) {
      const batch = customers.slice(i, i + BATCH_SIZE);
      const batchNumber = Math.floor(i / BATCH_SIZE) + 1;
      const totalBatches = Math.ceil(totalCustomers / BATCH_SIZE);
      
      console.log(`[${getItalianDateString()}] Processando batch ${batchNumber}/${totalBatches} (${batch.length} clienti)...`);
      
      // Processa ogni cliente nel batch
      for (const customer of batch) {
        const result = await processCustomer(customer, RESTAURANT_CODE, SUBSCRIBER_CODE);
        
        switch (result) {
          case 'created':
            created++;
            break;
          case 'updated':
            updated++;
            break;
          case 'skipped':
            skipped++;
            break;
          case 'error':
            errors++;
            break;
        }
        
        processed++;
        
        // Log progresso ogni 1000 clienti
        if (processed % 1000 === 0) {
          console.log(`[${getItalianDateString()}] Progresso: ${processed}/${totalCustomers} (${Math.round(processed/totalCustomers*100)}%) - C:${created} U:${updated} S:${skipped} E:${errors}`);
        }
      }
      
      // Piccola pausa tra batch
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    
    console.log(`[${getItalianDateString()}] Caricamento SEMPLICE completato!`);
    console.log(`[${getItalianDateString()}] Statistiche finali:`);
    console.log(`  - Processati: ${processed}`);
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
  loadCustomersSimple();
}

module.exports = { loadCustomersSimple };
