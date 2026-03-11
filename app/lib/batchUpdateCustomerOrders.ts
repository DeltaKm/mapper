import prisma from "@/app/lib/prisma";
import moment from "moment-timezone";

interface MovementData {
  movimento: any;
  sourceType: "signa" | "dylogapp";
  idCustomer: string;
  restaurant_code: string;
}


export async function batchUpdateCustomerOrders(
  movements: MovementData[]
): Promise<void> {
  try {
    console.log(`[BATCH] Inizio batch update per ${movements.length} movimenti...`);
    
    const customerGroups = new Map<string, MovementData[]>();
    
    for (const movement of movements) {
      if (!movement.idCustomer) continue;
      
      if (!customerGroups.has(movement.idCustomer)) {
        customerGroups.set(movement.idCustomer, []);
      }
      customerGroups.get(movement.idCustomer)!.push(movement);
    }
    
    console.log(`[BATCH] Processando ${customerGroups.size} clienti unici...`);
    
    const customerIds = Array.from(customerGroups.keys());
    const existingOrders = await prisma.customerOrders.findMany({
      where: {
        idCustomer: { in: customerIds }
      }
    });
    
    const existingOrdersMap = new Map<string, any>();
    for (const order of existingOrders) {
      if (order.idCustomer) {
        existingOrdersMap.set(order.idCustomer, order);
      }
    }
    
    const movimentoPOSIds = movements
      .filter(m => m.sourceType === "signa")
      .map(m => m.movimento.IDMovimentoPOS?.toString())
      .filter((id): id is string => Boolean(id));
    
    const signaMovimenti = await prisma.signaMovimenti.findMany({
      where: {
        IDReferencePOS: { in: movimentoPOSIds }
      }
    });
    
    const signaMovimentiMap = new Map<string, any>();
    for (const mov of signaMovimenti) {
      if (mov.IDReferencePOS) {
        signaMovimentiMap.set(mov.IDReferencePOS, mov);
      }
    }
    
    const updatePromises: Promise<any>[] = [];
    const createData: any[] = [];
    
    for (const [customerId, customerMovements] of customerGroups) {
      const existingOrder = existingOrdersMap.get(customerId);
      const restaurant_code = customerMovements[0].restaurant_code;
      
      let totalAmount = 0;
      let totalOrders = 0;
      let firstOrderDate: Date | null = null;
      let lastOrderDate: Date | null = null;
      const orderDates: string[] = [];
      const orderData: any[] = [];
      
      for (const { movimento, sourceType } of customerMovements) {
        const orderItem = await processMovement(movimento, sourceType, signaMovimentiMap);
        
        if (orderItem) {
          totalAmount += orderItem.amount;
          totalOrders += 1;
          
          const orderDate = orderItem.orderDate;
          if (!firstOrderDate || orderDate < firstOrderDate) {
            firstOrderDate = orderDate;
          }
          if (!lastOrderDate || orderDate > lastOrderDate) {
            lastOrderDate = orderDate;
          }
          
          const orderDateStr = orderDate.toISOString();
          if (!orderDates.includes(orderDateStr)) {
            orderDates.push(orderDateStr);
          }
          
          orderData.push(orderItem);
        }
      }
      
      if (existingOrder) {
        const updatedTotalSpent = Math.max(0, (existingOrder.totalSpent || 0) + totalAmount);
        const updatedOrderDates = Array.from(new Set([
          ...(existingOrder.orderDates || []),
          ...orderDates
        ]));
        
        updatePromises.push(
          prisma.customerOrders.update({
            where: { id: existingOrder.id },
            data: {
              totalSpent: updatedTotalSpent,
              totalOrders: (existingOrder.totalOrders || 0) + totalOrders,
              lastOrderDate: lastOrderDate && lastOrderDate > (existingOrder.lastOrderDate || new Date(0)) 
                ? lastOrderDate : existingOrder.lastOrderDate,
              firstOrderDate: existingOrder.firstOrderDate && firstOrderDate && firstOrderDate < existingOrder.firstOrderDate 
                ? firstOrderDate : existingOrder.firstOrderDate || firstOrderDate,
              orderData: [...(existingOrder.orderData || []), ...orderData],
              orderDates: updatedOrderDates,
              updateAt: new Date()
            }
          })
        );
      } else {
        const initialTotalSpent = Math.max(0, totalAmount);
        
        createData.push({
          idCustomer: customerId,
          totalSpent: initialTotalSpent,
          totalOrders: totalOrders,
          firstOrderDate: firstOrderDate,
          lastOrderDate: lastOrderDate,
          orderData: orderData,
          orderDates: orderDates,
          restaurant_code: restaurant_code,
          createdAt: new Date(),
          updateAt: new Date()
        });
      }
    }
    
    if (updatePromises.length > 0) {
      await Promise.all(updatePromises);
      console.log(`[BATCH] Aggiornati ${updatePromises.length} CustomerOrders esistenti`);
    }
    
    if (createData.length > 0) {
      await prisma.customerOrders.createMany({
        data: createData
      });
      console.log(`[BATCH] Creati ${createData.length} nuovi CustomerOrders`);
    }
    
    console.log(`[BATCH] Completato batch update per ${movements.length} movimenti`);
    
  } catch (error) {
    console.error('[BATCH] Errore nel batch update CustomerOrders:', error);
    throw error;
  }
}


async function processMovement(
  movimento: any, 
  sourceType: "signa" | "dylogapp",
  signaMovimentiMap: Map<string, any>
): Promise<any | null> {
  try {
    if (sourceType === "signa") {
      const sourceId = movimento.IDReferencePOS?.toString() || "";
      const orderId = movimento.IDMovimentoPOS?.toString() || "";
      
      const dataPart = movimento.PagamentoData ? movimento.PagamentoData.split(' ')[0] : '';
      const orderDate = dataPart && movimento.PagamentoOra
        ? new Date(moment(`${dataPart} ${movimento.PagamentoOra}`, "DD/MM/YYYY HH:mm:ss").toISOString())
        : new Date();
      
      const isReso = !Array.isArray(movimento.pagamenti) || movimento.pagamenti.length === 0;
      
      let amount = Array.isArray(movimento.pagamenti)
        ? movimento.pagamenti.reduce((sum: number, p: any) => sum + (p.Importo || 0), 0)
        : 0;
      
      let prodottiDettagli: any[] = [];
      const signaMovimento = signaMovimentiMap.get(orderId);
      
      if (signaMovimento && signaMovimento.payload) {
        const payload = signaMovimento.payload as any;
        prodottiDettagli = payload.dettagli || [];
        
        if (isReso) {
          let resoValue = 0;
          for (const dettaglio of prodottiDettagli) {
            if (dettaglio.CodTipoMovimento === 'RC') {
              const quantity = parseFloat(dettaglio.Quantita?.toString() || "0") || 0;
              const value = parseFloat(dettaglio.Valore?.toString() || "0") || 0;
              resoValue += quantity * value;
            }
          }
          if (resoValue > 0) {
            amount = -resoValue;
          }
        }
      }
      
      return {
        sourceId: sourceId,
        orderId: orderId,
        orderDate: orderDate,
        amount: amount,
        fidelityCard: movimento.customer?.fidelity_card_number || "",
        items: mapSignaProducts(prodottiDettagli),
        rawSourceData: {
          IDMovimentoPOS: movimento.IDMovimentoPOS,
          IDReferencePOS: movimento.IDReferencePOS || "",
          date: movimento.PagamentoData || "",
          time: movimento.PagamentoOra || "",
          paymentMethod: isReso ? "RESO" : (movimento.pagamenti?.[0]?.Tipo || "Non specificato"),
          dettagli: prodottiDettagli,
          isReso: isReso
        },
        paymentInfo: {
          paymentMethod: isReso ? "RESO" : (movimento.pagamenti?.[0]?.Tipo || "Non specificato")
        }
      };
      
    } else if (sourceType === "dylogapp") {
      const ticket = movimento;
      const orderWebInfo = ticket.orderWebInfo || {};
      
      const orderDate = ticket.DateBill ? new Date(ticket.DateBill) : new Date();
      
      let amount = 0;
      const productItems: any[] = [];
      
      if (ticket.DetailList && Array.isArray(ticket.DetailList)) {
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
            category: item.GroupDescription || "Non specificato"
          });
        }
      }
      
      return {
        sourceId: ticket.IDTickets?.toString() || "",
        orderId: orderWebInfo.IDTickets?.toString() || "",
        orderDate: orderDate,
        amount: amount,
        fidelityCard: orderWebInfo.fidelity_card_number || "",
        items: productItems,
        rawSourceData: {
          IDTickets: ticket.IDTickets,
          DateBill: ticket.DateBill,
          DetailList: ticket.DetailList,
          orderWebInfo: orderWebInfo
        },
        paymentInfo: {
          paymentMethod: orderWebInfo.paymentMethod || "Non specificato"
        }
      };
    }
    
    return null;
  } catch (error) {
    console.error('Errore nel processamento movimento:', error);
    return null;
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
