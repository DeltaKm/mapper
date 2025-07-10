// Script per correggere i dati SalesData esistenti che hanno customerId null
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function fixSalesDataCustomerIds() {
  console.log("Avvio correzione dati SalesData...");
  
  try {
    // 1. Ottieni tutti i record SalesData con customerId null
    const salesDataWithNullCustomerId = await prisma.salesData.findMany({
      where: {
        customerId: null
      }
    });
    
    console.log(`Trovati ${salesDataWithNullCustomerId.length} record SalesData con customerId null`);
    
    let updatedCount = 0;
    
    // 2. Per ogni record, prova a trovare il cliente tramite fidelityCard o customerRef
    for (const record of salesDataWithNullCustomerId) {
      let customer = null;
      
      // Cerca per fidelity card
      if (record.fidelityCard) {
        customer = await prisma.customer.findFirst({
          where: { fidelity_card_number: record.fidelityCard }
        });
        
        if (customer) {
          console.log(`Cliente trovato tramite fidelityCard: ${record.fidelityCard}`);
        }
      }
      
      // Se non trovato per fidelity, cerca per customerRef
      if (!customer && record.sourceData && record.sourceData.customerRef) {
        customer = await prisma.customer.findFirst({
          where: { idCustomer: record.sourceData.customerRef }
        });
        
        if (customer) {
          console.log(`Cliente trovato tramite customerRef: ${record.sourceData.customerRef}`);
        }
      }
      
      // Se troviamo il cliente, aggiorna il record
      if (customer) {
        await prisma.salesData.update({
          where: { id: record.id },
          data: { customerId: customer.id }
        });
        
        // Aggiorniamo anche CustomerSalesSummary
        const existingSummary = await prisma.customerSalesSummary.findFirst({
          where: { customerId: customer.id }
        });
        
        if (existingSummary) {
          // Aggiorna le metriche esistenti
          const orderDates = existingSummary.orderDates || [];
          orderDates.push(record.saleDate);
          
          // Aggiorna i conteggi per tipo di fonte
          const signaOrders = record.sourceType === "signa" ? 
            (existingSummary.signaOrders || 0) + 1 : (existingSummary.signaOrders || 0);
          const signaSpent = record.sourceType === "signa" ? 
            (existingSummary.signaSpent || 0) + record.totalAmount : (existingSummary.signaSpent || 0);
          
          const dylogappOrders = record.sourceType === "dylogapp" ? 
            (existingSummary.dylogappOrders || 0) + 1 : (existingSummary.dylogappOrders || 0);
          const dylogappSpent = record.sourceType === "dylogapp" ? 
            (existingSummary.dylogappSpent || 0) + record.totalAmount : (existingSummary.dylogappSpent || 0);
          
          await prisma.customerSalesSummary.update({
            where: { id: existingSummary.id },
            data: {
              totalOrders: (existingSummary.totalOrders || 0) + 1,
              totalSpent: (existingSummary.totalSpent || 0) + record.totalAmount,
              lastOrderDate: record.saleDate > existingSummary.lastOrderDate ? 
                record.saleDate : existingSummary.lastOrderDate,
              orderDates: orderDates,
              signaOrders,
              signaSpent,
              dylogappOrders,
              dylogappSpent,
              updateAt: new Date()
            }
          });
        } else {
          // Crea nuove metriche
          const orderDates = [record.saleDate];
          const signaOrders = record.sourceType === "signa" ? 1 : 0;
          const signaSpent = record.sourceType === "signa" ? record.totalAmount : 0;
          const dylogappOrders = record.sourceType === "dylogapp" ? 1 : 0;
          const dylogappSpent = record.sourceType === "dylogapp" ? record.totalAmount : 0;
          
          await prisma.customerSalesSummary.create({
            data: {
              customerId: customer.id,
              totalOrders: 1,
              totalSpent: record.totalAmount,
              firstOrderDate: record.saleDate,
              lastOrderDate: record.saleDate,
              orderDates: orderDates,
              signaOrders,
              signaSpent,
              dylogappOrders,
              dylogappSpent,
              restaurant_code: record.restaurant_code || "",
              createdAt: new Date(),
              updateAt: new Date()
            }
          });
        }
        
        updatedCount++;
      }
    }
    
    console.log(`Aggiornati ${updatedCount} record su ${salesDataWithNullCustomerId.length}`);
    console.log(`${salesDataWithNullCustomerId.length - updatedCount} record non sono stati associati a clienti`);
    
  } catch (error) {
    console.error('Errore durante la correzione dei dati:', error);
  } finally {
    await prisma.$disconnect();
  }
}

// Esegui la funzione
fixSalesDataCustomerIds()
  .then(() => console.log('Correzione completata'))
  .catch(e => console.error('Errore:', e));
