import prisma from "@/app/lib/prisma";

/**
 * Aggiorna o crea un record CustomerOrders per un cliente
 * @param salesData Dati di vendita standardizzati
 * @param idCustomer ID del cliente nel sistema originale
 */
export async function updateCustomerOrders(salesData: any, idCustomer: string | null | undefined) {
  if (!idCustomer) {
    console.log('Nessun idCustomer fornito, impossibile aggiornare CustomerOrders');
    return;
  }
  
  // Debug: stampa la struttura dei dati ricevuti
  console.log('updateCustomerOrders - sourceType:', salesData.sourceType);
  console.log('updateCustomerOrders - sourceData:', JSON.stringify(salesData.sourceData, null, 2));
  
  try {
    // Cerca un record esistente per questo cliente
    const existingOrders = await prisma.customerOrders.findFirst({
      where: { idCustomer: idCustomer }
    });
    
    // Estrai la data dell'ordine
    const orderDate = salesData.saleDate || new Date();
    
    // Crea l'oggetto ordine standardizzato
    const orderItem = {
      orderId: salesData.sourceId,
      sourceType: salesData.sourceType,
      sourceId: salesData.sourceId,
      orderDate: orderDate,
      amount: salesData.totalAmount || 0,
      restaurant_code: salesData.restaurant_code || "",
      subscriber_code: salesData.sourceType === "signa" ? "SIGNA" : "DylogApp",
      
      // Campi specifici per fonte
      ...(salesData.sourceType === "signa" && salesData.sourceData?.paymentMethod && {
        paymentMethod: salesData.sourceData.paymentMethod
      }),
      ...(salesData.sourceType === "dylogapp" && salesData.sourceData?.paymentMode && {
        paymentMode: salesData.sourceData.paymentMode
      }),
      
      fidelityCard: salesData.fidelityCard || "",
      
      // Dettagli prodotti se disponibili
      items: salesData.sourceType === "signa" ? 
        mapSignaProducts(salesData.sourceData?.prodotti) : 
        salesData.sourceType === "dylogapp" ? 
        mapDylogAppProducts(salesData.sourceData?.items) : 
        [],
      
      // Dati originali
      sourceData: salesData.sourceData || {}
    };
    
    if (existingOrders) {
      // Aggiorna il record esistente
      await prisma.customerOrders.update({
        where: { id: existingOrders.id },
        data: {
          totalSpent: (existingOrders.totalSpent || 0) + (salesData.totalAmount || 0),
          totalOrders: (existingOrders.totalOrders || 0) + 1,
          lastOrderDate: orderDate,
          firstOrderDate: existingOrders.firstOrderDate || orderDate,
          orderData: Array.isArray(existingOrders.orderData) ? [...existingOrders.orderData, orderItem] : [orderItem],
          orderDates: Array.isArray(existingOrders.orderDates) ? [...existingOrders.orderDates, orderDate] : [orderDate]
        }
      });
      console.log(`CustomerOrders aggiornato per cliente ${idCustomer}`);
    } else {
      // Crea un nuovo record
      await prisma.customerOrders.create({
        data: {
          idCustomer: idCustomer,
          totalSpent: salesData.totalAmount || 0,
          totalOrders: 1,
          firstOrderDate: orderDate,
          lastOrderDate: orderDate,
          orderData: [orderItem],
          orderDates: [orderDate],
          restaurant_code: salesData.restaurant_code || ""
        }
      });
      console.log(`Nuovo CustomerOrders creato per cliente ${idCustomer}`);
    }
  } catch (error) {
    console.error('Errore nell\'aggiornamento di CustomerOrders:', error);
  }
}

/**
 * Mappa i prodotti da Signa al formato standard
 */
function mapSignaProducts(prodotti: any[] | undefined): any[] {
  if (!prodotti || !Array.isArray(prodotti)) {
    return [];
  }
  
  return prodotti.map(prod => ({
    productId: prod.codice || "",
    name: prod.descrizione || "",
    quantity: parseInt(prod.quantita) || 0,
    unitPrice: parseFloat(prod.prezzo_unitario) || 0,
    totalPrice: parseFloat(prod.prezzo_totale) || 0,
    category: prod.categoria || "Non specificato"
  }));
}

/**
 * Mappa i prodotti da DylogApp al formato standard
 */
function mapDylogAppProducts(items: any[] | undefined): any[] {
  if (!items || !Array.isArray(items)) {
    return [];
  }
  
  return items.map(item => {
    // Gestisci sia il formato originale che quello estratto da DetailList
    return {
      productId: item.id || item.itemId || item.Code || "",
      name: item.description || item.name || item.Name || "",
      quantity: item.quantity || item.qty || item.Qta || 0,
      unitPrice: item.price || item.Price || 0,
      totalPrice: item.totalPrice || (item.price && item.quantity ? item.price * item.quantity : 0) || (item.Price && item.Qta ? item.Price * item.Qta : 0) || 0,
      category: item.category || item.GroupDescription || "Non specificato"
    };
  });
}
