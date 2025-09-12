const fs = require('fs');
const path = require('path');

// Importa Prisma (assicurati che il path sia corretto)
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

// Configurazione
const BATCH_SIZE = 1000; // Processa 1000 utenti alla volta
const JSON_FILE_PATH = path.join(__dirname, '../TempSignaWowRestGateWay.json');
const RESTAURANT_CODE = "CENE)0000308"; // Dal tuo esempio
const SUBSCRIBER_CODE = "SIGNA"; // Dal tuo esempio

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

// Funzione per processare un singolo customer (stessa logica della route)
async function processCustomer(customer, restaurant_code, subscriber_code) {
  try {
    // Determina il tipo di utente basato su arrived_from
    const arrivedFrom = customer.arrived_from?.toLowerCase() || "";
    
    // Data in arrivo (specifica: dateLastUpdateProduct)
    const incomingLastUpdate = customer.dateLastUpdateProduct || "";
    
    let existing = null;
    let effectiveCustomerId = "";
    
    if (arrivedFrom === "app") {
      // LOGICA APP: usa idCustomerExt o idCustomer
      effectiveCustomerId = customer.idCustomerExt || customer.idCustomer;
      
      if (!effectiveCustomerId) {
        console.warn(`Cliente App senza idCustomer/idCustomerExt, skip: ${customer.name} ${customer.surname}`);
        return { status: 'skipped', reason: 'no_id' };
      }
      
      // Cerca per idCustomer OPPURE per email NEL STESSO RESTAURANT
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
      // LOGICA NON-APP
      if (customer.idCustomerExt) {
        // Ha idCustomerExt → salvalo in idCustomer
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
        // NON ha idCustomerExt → idCustomer = "" e cerca per email
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
      // Controlla se dateLastUpdateProduct (in arrivo) è più recente di dateLastUpdate (salvato)
      const existingLastUpdate = existing.dateLastUpdate || "";
      
      if (incomingLastUpdate && existingLastUpdate && incomingLastUpdate <= existingLastUpdate) {
        console.log(`Cliente ${effectiveCustomerId || 'email:' + customer.email} saltato - dateLastUpdateProduct non più recente`);
        return { status: 'skipped', reason: 'date_not_recent' };
      }
      
      // Aggiorna il cliente esistente preservando i valori esistenti se non vengono passati nuovi valori
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
        dateLastUpdate: incomingLastUpdate, // Aggiorna con la nuova data se più recente
        deleted: customer.deleted || existing.deleted || "",
        restaurant_code,
        subscriber_code,
        updateAt: new Date(), // Assicura che il timestamp di aggiornamento sia corretto
      };
      
      await prisma.customer.update({
        where: { id: existing.id },
        data: {
          ...filteredCustomerData,
          idCustomer: effectiveCustomerId // Assicura che idCustomer sia impostato correttamente
        },
      });
      
      return { status: 'updated', id: existing.id };
    } else {
      // Crea un nuovo cliente se non esiste
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
      };
      
      const newCustomer = await prisma.customer.create({
        data: {
          ...filteredCustomerData,
          idCustomer: effectiveCustomerId, // Assicura che idCustomer sia impostato correttamente
          createdAt: new Date()
        },
      });
      
      return { status: 'created', id: newCustomer.id };
    }
  } catch (error) {
    console.error(`Errore processando cliente ${customer?.idCustomer || customer?.name || 'sconosciuto'}: ${error}`);
    return { status: 'error', error: error.message };
  }
}

// Funzione principale
async function loadCustomers() {
  console.log(`[${getItalianDateString()}] Inizio caricamento clienti...`);
  
  try {
    // Leggi il file JSON
    console.log(`[${getItalianDateString()}] Lettura file ${JSON_FILE_PATH}...`);
    const jsonData = JSON.parse(fs.readFileSync(JSON_FILE_PATH, 'utf8'));
    
    if (!jsonData.customerList || !Array.isArray(jsonData.customerList)) {
      throw new Error('customerList non trovato o non è un array');
    }
    
    const customers = jsonData.customerList;
    const totalCustomers = customers.length;
    
    console.log(`[${getItalianDateString()}] Trovati ${totalCustomers} clienti da processare`);
    console.log(`[${getItalianDateString()}] Processamento in batch di ${BATCH_SIZE} clienti...`);
    
    let processed = 0;
    let created = 0;
    let updated = 0;
    let skipped = 0;
    let errors = 0;
    
    // Processa in batch
    for (let i = 0; i < totalCustomers; i += BATCH_SIZE) {
      const batch = customers.slice(i, i + BATCH_SIZE);
      const batchNumber = Math.floor(i / BATCH_SIZE) + 1;
      const totalBatches = Math.ceil(totalCustomers / BATCH_SIZE);
      
      console.log(`[${getItalianDateString()}] Processando batch ${batchNumber}/${totalBatches} (${batch.length} clienti)...`);
      
      // Processa ogni cliente nel batch
      for (const customer of batch) {
        const result = await processCustomer(customer, RESTAURANT_CODE, SUBSCRIBER_CODE);
        
        switch (result.status) {
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
          console.log(`[${getItalianDateString()}] Progresso: ${processed}/${totalCustomers} (${Math.round(processed/totalCustomers*100)}%)`);
        }
      }
      
      // Pausa rimossa per massima velocità - MongoDB Atlas può gestire il carico
      // await new Promise(resolve => setTimeout(resolve, 50));
    }
    
    console.log(`[${getItalianDateString()}] Caricamento completato!`);
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
  loadCustomers();
}

module.exports = { loadCustomers, processCustomer };
