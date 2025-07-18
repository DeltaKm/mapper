import prisma from "@/app/lib/prisma";
import moment from "moment-timezone";

/**
 * Aggiorna i dati degli ordini cliente in CustomerOrders
 * @param sourceData Dati sorgente (movimento Signa o ticket DylogApp)
 * @param sourceType Tipo di fonte ("signa" o "dylogapp")
 * @param idCustomer ID cliente
 * @param restaurant_code Codice ristorante
 */
export async function updateCustomerOrders(
  sourceData: any,
  sourceType: "signa" | "dylogapp",
  idCustomer: string,
  restaurant_code: string
): Promise<void> {
  try {
    if (!idCustomer) {
      console.log("updateCustomerOrders: idCustomer non specificato");
      return;
    }

    // Cerca un record esistente per questo cliente
    const existingOrders = await prisma.customerOrders.findFirst({
      where: { idCustomer: idCustomer }
    });
    
    let sourceId = "";
    let orderId = "";
    let orderDate = new Date();
    let amount = 0;
    let fidelityCard = "";
    let items: any[] = [];
    let rawSourceData: any = {};
    let paymentInfo: any = {};
    let isReso = false;

    // Estrai dati in base al tipo di fonte
    if (sourceType === "signa") {
      // Estrai dati da movimento Signa
      const movimento = sourceData;
      // Per Signa, sourceId = IDReferencePOS e orderId verrà impostato = IDMovimentoPOS
      sourceId = movimento.IDReferencePOS?.toString() || "";
      orderId = movimento.IDMovimentoPOS?.toString() || "";
      
      // Formatta la data dell'ordine
      // Estrai solo la parte della data da PagamentoData (rimuovi la parte dell'ora se presente)
      const dataPart = movimento.PagamentoData ? movimento.PagamentoData.split(' ')[0] : '';
      orderDate = dataPart && movimento.PagamentoOra
        ? new Date(moment(`${dataPart} ${movimento.PagamentoOra}`, "DD/MM/YYYY HH:mm:ss").toISOString())
        : new Date();
      
      // Verifica se è un reso (pagamenti vuoti)
      isReso = !Array.isArray(movimento.pagamenti) || movimento.pagamenti.length === 0;
      
      // Calcola l'importo totale
      amount = Array.isArray(movimento.pagamenti)
        ? movimento.pagamenti.reduce((sum: number, p: any) => sum + (p.Importo || 0), 0)
        : 0;
      
      // Estrai carta fedeltà
      fidelityCard = movimento.customer?.fidelity_card_number || "";
      
      // Recupera i prodotti dalla collezione SignaMovimenti usando IDMovimentoPOS come chiave di ricerca
      let prodottiDettagli: any[] = [];
      let resoValue = 0;
      
      try {
        // Cerca in SignaMovimenti un documento con IDReferencePOS = movimento.IDMovimentoPOS
        const signaMovimento = await prisma.signaMovimenti.findFirst({
          where: {
            IDReferencePOS: movimento.IDMovimentoPOS?.toString() || ""
          }
        });
        
        // Se trovato, estrai l'array dettagli
        if (signaMovimento && signaMovimento.payload) {
          const payload = signaMovimento.payload as any;
          // Ora il payload contiene direttamente l'oggetto movimento con l'array dettagli
          prodottiDettagli = payload.dettagli || [];
          
          // Se è un reso, calcola il valore totale dei prodotti resi
          if (isReso) {
            console.log(`Reso Signa rilevato con IDMovimentoPOS: ${movimento.IDMovimentoPOS}`);
            
            // Calcola il valore totale dei prodotti con CodTipoMovimento = 'RC'
            for (const dettaglio of prodottiDettagli) {
              if (dettaglio.CodTipoMovimento === 'RC') {
                const quantity = parseFloat(dettaglio.Quantita?.toString() || "0") || 0;
                const value = parseFloat(dettaglio.Valore?.toString() || "0") || 0;
                resoValue += quantity * value;
              }
            }
            
            if (resoValue > 0) {
              console.log(`Valore reso calcolato: ${resoValue} per cliente ${idCustomer}`);
              // Imposta l'importo come negativo per i resi
              amount = -resoValue;
            }
          }
        }
      } catch (error) {
        console.error("Errore nel recupero dei prodotti da SignaMovimenti:", error);
        prodottiDettagli = [];
      }
      
      // Mappa i prodotti dai dettagli recuperati
      items = mapSignaProducts(prodottiDettagli);
      
      // Prepara i dati originali
      rawSourceData = {
        IDMovimentoPOS: movimento.IDMovimentoPOS,
        IDReferencePOS: movimento.IDReferencePOS || "",
        date: movimento.PagamentoData || "",
        time: movimento.PagamentoOra || "",
        paymentMethod: isReso ? "RESO" : (movimento.pagamenti?.[0]?.Tipo || "Non specificato"),
        customerRef: idCustomer,
        dettagli: prodottiDettagli,
        isReso: isReso
      };
      
      // Informazioni pagamento
      paymentInfo = {
        paymentMethod: isReso ? "RESO" : (movimento.pagamenti?.[0]?.Tipo || "Non specificato")
      };
    } else if (sourceType === "dylogapp") {
      // Estrai dati da ticket DylogApp
      const ticket = sourceData;
      const orderWebInfo = ticket.orderWebInfo || {};
      sourceId = ticket.IDTickets?.toString() || "";

      // Formatta la data dell'ordine
      orderDate = ticket.DateBill ? new Date(ticket.DateBill) : new Date();
      
      // Estrai e mappa i prodotti
      const productItems: any[] = [];
      if (ticket.DetailList && Array.isArray(ticket.DetailList)) {
        amount = 0;
        for (const item of ticket.DetailList) {
          const price = parseFloat(item.Price) || 0;
          const quantity = parseInt(item.Qta) || 0;
          const itemTotal = price * quantity;
          amount += itemTotal;
          
          productItems.push({
            id: item.Code || "",
            description: item.Name || "",
            quantity: quantity,
            price: price,
            totalPrice: itemTotal,
          });
        }
      } else {
        amount = parseFloat(ticket.Totoal) || 0;
      }
      
      // Mappa i prodotti
      items = mapDylogAppProducts(productItems);
      
      // Prepara i dati originali
      rawSourceData = {
        ticketId: ticket.IDTickets,
        paymentMode: ticket.PaymentMode || "",
        docNumero: ticket.DocNumero,
        docTipo: ticket.DocTipo,
        items: productItems
      };
      
      // Informazioni pagamento
      paymentInfo = {
        paymentMode: ticket.PaymentMode || ""
      };
    }
    
    // Prepara l'oggetto orderItem da aggiungere a orderData
    const orderItem = {
      orderId: orderId,
      sourceType: sourceType,
      sourceId: sourceId,
      orderDate: orderDate.toISOString(), // Converti Date in string per JSON
      amount: amount,
      items: items,
      ...paymentInfo,
      rawSourceData: rawSourceData,
      isReso: isReso // Aggiungi flag per identificare i resi
    };
    
    // Verifica se esiste già un ordine con lo stesso orderId
    if (existingOrders && Array.isArray(existingOrders.orderData)) {
      // Cerca se esiste già un ordine con lo stesso orderId
      const duplicateOrder = existingOrders.orderData.find(
        (order: any) => {
          if (sourceType === "signa") {
            return order.sourceType === "signa" && order.orderId === orderId;
          } else {
            return order.sourceType === "dylogapp" && order.orderId === sourceId;
          }
        }
      );
      
      // Se esiste già un ordine con lo stesso orderId, non salvare il duplicato
      if (duplicateOrder) {
        if (sourceType === "signa") {
          console.log(`Ordine Signa con IDMovimentoPOS ${orderId} già presente, skip.`);
        } else {
          console.log(`Ordine DylogApp con IDTickets ${sourceId} già presente, skip.`);
        }
        return;
      }
    }
    
    if (existingOrders) {
      // Aggiorna il record esistente
      let updatedTotalSpent = (existingOrders.totalSpent || 0) + amount;
      
      // Assicurati che totalSpent non diventi negativo
      if (updatedTotalSpent < 0) {
        console.log(`Attenzione: totalSpent negativo per cliente ${idCustomer}, impostato a 0`);
        updatedTotalSpent = 0;
      }
      
      // Prepara l'array orderDates aggiornato
      let updatedOrderDates = Array.isArray(existingOrders.orderDates) ? [...existingOrders.orderDates] : [];
      const orderDateStr = orderDate.toISOString();
      if (!updatedOrderDates.some((d: any) => {
        // Confronta le date ignorando i millisecondi
        const dateA = new Date(d);
        const dateB = new Date(orderDate);
        return dateA.getFullYear() === dateB.getFullYear() && 
               dateA.getMonth() === dateB.getMonth() && 
               dateA.getDate() === dateB.getDate();
      })) {
        updatedOrderDates.push(orderDateStr);
      }
      
      // Aggiorna il record esistente
      await prisma.customerOrders.update({
        where: { id: existingOrders.id },
        data: {
          totalSpent: updatedTotalSpent,
          totalOrders: (existingOrders.totalOrders || 0) + 1, // Incrementa sempre totalOrders, anche per i resi
          lastOrderDate: orderDate > (existingOrders.lastOrderDate || new Date(0)) ? orderDate : existingOrders.lastOrderDate,
          firstOrderDate: existingOrders.firstOrderDate && orderDate < existingOrders.firstOrderDate ? orderDate : existingOrders.firstOrderDate || orderDate,
          orderData: Array.isArray(existingOrders.orderData) ? [...existingOrders.orderData, orderItem] : [orderItem],
          orderDates: updatedOrderDates,
          updateAt: new Date()
        }
      });
      
      if (isReso) {
        console.log(`CustomerOrders aggiornato con reso per cliente ${idCustomer}, nuovo totalSpent: ${updatedTotalSpent}`);
      } else {
        console.log(`CustomerOrders aggiornato per cliente ${idCustomer}`);
      }
    } else {
      // Crea un nuovo record
      // Se è un reso come primo movimento, imposta totalSpent a 0 invece di un valore negativo
      const initialTotalSpent = amount < 0 ? 0 : amount;
      
      await prisma.customerOrders.create({
        data: {
          idCustomer: idCustomer,
          totalSpent: initialTotalSpent,
          totalOrders: 1,
          firstOrderDate: orderDate,
          lastOrderDate: orderDate,
          orderData: [orderItem],
          orderDates: [orderDate.toISOString()], // Converti Date in string per JSON
          restaurant_code: restaurant_code,
          createdAt: new Date(),
          updateAt: new Date()
        }
      });
      
      if (isReso) {
        console.log(`Nuovo CustomerOrders creato per cliente ${idCustomer} con reso (totalSpent: ${initialTotalSpent})`);
      } else {
        console.log(`Nuovo CustomerOrders creato per cliente ${idCustomer}`);
      }
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
