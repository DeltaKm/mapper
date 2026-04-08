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

    if (sourceType === "signa") {
      const movimento = sourceData;
      sourceId = movimento.IDReferencePOS?.toString() || "";
      orderId = movimento.IDMovimentoPOS?.toString() || "";
      
      const dataPart = movimento.PagamentoData ? movimento.PagamentoData.split(' ')[0] : '';
      orderDate = dataPart && movimento.PagamentoOra
        ? new Date(moment(`${dataPart} ${movimento.PagamentoOra}`, "DD/MM/YYYY HH:mm:ss").toISOString())
        : new Date();
      
      isReso = !Array.isArray(movimento.pagamenti) || movimento.pagamenti.length === 0;
      
      amount = Array.isArray(movimento.pagamenti)
        ? movimento.pagamenti.reduce((sum: number, p: any) => sum + (p.Importo || 0), 0)
        : 0;
      
      fidelityCard = movimento.customer?.fidelity_card_number || "";
      
      let prodottiDettagli: any[] = [];
      let resoValue = 0;
      
      try {
        const signaMovimento = await prisma.signaMovimenti.findFirst({
          where: {
            IDReferencePOS: movimento.IDMovimentoPOS?.toString() || ""
          }
        });
        
        if (signaMovimento && signaMovimento.payload) {
          const payload = signaMovimento.payload as any;
          prodottiDettagli = payload.dettagli || [];
          
          if (isReso) {
            console.log(`Reso Signa rilevato con IDMovimentoPOS: ${movimento.IDMovimentoPOS}`);
            
            for (const dettaglio of prodottiDettagli) {
              if (dettaglio.CodTipoMovimento === 'RC') {
                const quantity = parseFloat(dettaglio.Quantita?.toString() || "0") || 0;
                const value = parseFloat(dettaglio.Valore?.toString() || "0") || 0;
                resoValue += quantity * value;
              }
            }
            
            if (resoValue > 0) {
              console.log(`Valore reso calcolato: ${resoValue} per cliente ${idCustomer}`);
              amount = -resoValue;
            }
          }
        }
      } catch (error) {
        console.error("Errore nel recupero dei prodotti da SignaMovimenti:", error);
        prodottiDettagli = [];
      }
      
      items = mapSignaProducts(prodottiDettagli);
      
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
      
      paymentInfo = {
        paymentMethod: isReso ? "RESO" : (movimento.pagamenti?.[0]?.Tipo || "Non specificato")
      };
    } else if (sourceType === "dylogapp") {
      const ticket = sourceData;
      const orderWebInfo = ticket.orderWebInfo || {};
      sourceId = ticket.IDTickets?.toString() || "";

      orderDate = ticket.DateBill ? new Date(ticket.DateBill) : new Date();
      
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
      
      items = mapDylogAppProducts(productItems);
      
      rawSourceData = {
        ticketId: ticket.IDTickets,
        paymentMode: ticket.PaymentMode || "",
        docNumero: ticket.DocNumero,
        docTipo: ticket.DocTipo,
        items: productItems
      };
      
      paymentInfo = {
        paymentMode: ticket.PaymentMode || ""
      };
    }
    
    const orderItem = {
      orderId: orderId,
      sourceType: sourceType,
      sourceId: sourceId,
      orderDate: orderDate.toISOString(),
      amount: amount,
      items: items,
      ...paymentInfo,
      rawSourceData: rawSourceData,
      isReso: isReso
    };
    
    if (existingOrders && Array.isArray(existingOrders.orderData)) {
      const duplicateOrder = existingOrders.orderData.find(
        (order: any) => {
          if (sourceType === "signa") {
            return order.sourceType === "signa" && order.orderId === orderId;
          } else {
            return order.sourceType === "dylogapp" && order.orderId === sourceId;
          }
        }
      );
      
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
      let updatedTotalSpent = (existingOrders.totalSpent || 0) + amount;
      
      if (updatedTotalSpent < 0) {
        console.log(`Attenzione: totalSpent negativo per cliente ${idCustomer}, impostato a 0`);
        updatedTotalSpent = 0;
      }
      
      let updatedOrderDates = Array.isArray(existingOrders.orderDates) ? [...existingOrders.orderDates] : [];
      const orderDateStr = orderDate.toISOString();
      if (!updatedOrderDates.some((d: any) => {
        const dateA = new Date(d);
        const dateB = new Date(orderDate);
        return dateA.getFullYear() === dateB.getFullYear() && 
               dateA.getMonth() === dateB.getMonth() && 
               dateA.getDate() === dateB.getDate();
      })) {
        updatedOrderDates.push(orderDateStr);
      }
      
      await prisma.customerOrders.update({
        where: { id: existingOrders.id },
        data: {
          totalSpent: updatedTotalSpent,
          totalOrders: (existingOrders.totalOrders || 0) + 1, 
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
      const initialTotalSpent = amount < 0 ? 0 : amount;
      
      await prisma.customerOrders.create({
        data: {
          idCustomer: idCustomer,
          totalSpent: initialTotalSpent,
          totalOrders: 1,
          firstOrderDate: orderDate,
          lastOrderDate: orderDate,
          orderData: [orderItem],
          orderDates: [orderDate.toISOString()],
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


function mapSignaProducts(prodotti: any[] | undefined): any[] {
  if (!prodotti || !Array.isArray(prodotti)) {
    return [];
  }
  
  return prodotti.map(prod => ({
    productId: prod.CodArticolo || "",
    name: prod.Article_Description_Short || "",
    quantity: parseFloat(prod.Quantita?.toString() || "0") || 0,
    unitPrice: parseFloat(prod.Valore?.toString() || "0") || 0,
    totalPrice: (parseFloat(prod.Quantita?.toString() || "0") || 0) * (parseFloat(prod.Valore?.toString() || "0") || 0),
    category: prod.Famiglia || prod.CodFamiglia || "Non specificato"
  }));
}


function mapDylogAppProducts(items: any[] | undefined): any[] {
  if (!items || !Array.isArray(items)) {
    return [];
  }
  
  return items.map(item => {
  
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
