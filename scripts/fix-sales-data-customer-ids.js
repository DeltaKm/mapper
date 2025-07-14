// Script semplificato per correggere i dati SalesData esistenti che hanno customerId null
// Questo script si concentra SOLO sull'aggiornamento del campo customerId in SalesData
const { MongoClient, ObjectId } = require('mongodb');
require('dotenv').config(); // Carica le variabili d'ambiente dal file .env

// Recupera la connessione MongoDB dalla variabile d'ambiente
const mongoUri = process.env.DATABASE_URL;
if (!mongoUri) {
  console.error('DATABASE_URL non definita nelle variabili di ambiente!');
  process.exit(1);
}

// Estrai il nome del database dalla stringa di connessione
let dbName = 'mapper';
const dbNameMatch = mongoUri.match(/\/([^\/\?]+)(\?|$)/);
if (dbNameMatch) {
  dbName = dbNameMatch[1];
}
console.log(`Usando il database: ${dbName}`);

async function fixSalesDataCustomerIds() {
  console.log("Avvio correzione dati SalesData...");
  
  // Inizializza il client MongoDB
  const client = new MongoClient(mongoUri);
  
  try {
    // Connessione al database
    await client.connect();
    console.log(`Connesso al database MongoDB: ${mongoUri.replace(/:[^:]*@/, ':****@')}`); // Nascondi la password
    
    const db = client.db(dbName);
    const salesDataCollection = db.collection('SalesData');
    const customerCollection = db.collection('Customer');
    
    // 1. Ottieni tutti i record SalesData con customerId null
    const salesDataWithNullCustomerId = await salesDataCollection
      .find({ customerId: null })
      .limit(1000)
      .toArray();
      
    console.log(`Trovati ${salesDataWithNullCustomerId.length} record SalesData con customerId null`);
    
    let updatedCount = 0;
    
    // 2. Per ogni record, prova a trovare il cliente tramite fidelityCard o customerRef
    for (const record of salesDataWithNullCustomerId) {
      let customer = null;
      
      // Cerca per fidelity card
      if (record.fidelityCard && typeof record.fidelityCard === 'string' && record.fidelityCard.trim() !== '') {
        try {
          customer = await customerCollection.findOne({
            fidelity_card_number: record.fidelityCard
          });
          
          if (customer) {
            console.log(`Cliente trovato tramite fidelityCard: ${record.fidelityCard}`);
          }
        } catch (e) {
          console.log(`Errore nella ricerca cliente per fidelityCard: ${e.message}`);
        }
      }
      
      // Se non trovato per fidelity, cerca per customerRef
      if (!customer && record.sourceData && record.sourceData.customerRef) {
        try {
          customer = await customerCollection.findOne({
            idCustomer: record.sourceData.customerRef
          });
          
          if (customer) {
            console.log(`Cliente trovato tramite customerRef: ${record.sourceData.customerRef}`);
          }
        } catch (e) {
          console.log(`Errore nella ricerca cliente per customerRef: ${e.message}`);
        }
      }
      
      // Se troviamo il cliente, aggiorna il record
      if (customer) {
        try {
          // Estrai l'ID del cliente
          const customerId = customer._id.toString(); // MongoDB memorizza gli ID come ObjectId, li convertiamo in string
          
          // Aggiorna solo il campo customerId
          const result = await salesDataCollection.updateOne(
            { _id: record._id },
            { $set: { customerId: customerId } }
          );
          
          if (result.modifiedCount > 0) {
            updatedCount++;
            console.log(`Record aggiornato con successo: ${record._id}`);
          }
        } catch (updateError) {
          console.error(`Errore nell'aggiornamento del record ${record._id}:`, updateError);
        }
      }
    }
    
    console.log(`Aggiornati ${updatedCount} record su ${salesDataWithNullCustomerId.length}`);
    console.log(`${salesDataWithNullCustomerId.length - updatedCount} record non sono stati associati a clienti`);
    
  } catch (error) {
    console.error('Errore durante la correzione dei dati:', error);
  } finally {
    await client.close();
    console.log('Connessione al database chiusa');
  }
}

// Esegui la funzione
fixSalesDataCustomerIds()
  .then(() => console.log('Correzione completata'))
  .catch(e => console.error('Errore:', e));
