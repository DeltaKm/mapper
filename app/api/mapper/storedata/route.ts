// import { NextRequest, NextResponse } from "next/server";
// import prisma from "@/app/lib/prisma";
// import moment from "moment-timezone";

// enum StatusCodes {
//   Success = 200,
//   Created = 201,
//   BadRequest = 400,
//   InternalServerError = 500,
// }

// function getItalianDate(): Date {
//   return moment().tz("Europe/Rome").toDate();
// }

// function getItalianDateString(): string {
//   return moment().tz("Europe/Rome").format("YYYY-MM-DD HH:mm:ss");
// }

// const italianDate = getItalianDate();
// const italianDateString = getItalianDateString();


// export async function POST(request: NextRequest) {
//   let savedData = null;
//   let statusCode = StatusCodes.Created;
//   let errorMessage: string | null = null;

//   try {
//     const body = await request.json();
//     const searchParams = request.nextUrl.searchParams;
//     const restaurant_code = searchParams.get("restaurant_code");
//     const subscriber_code = searchParams.get("subscriber_code");

//     let content: any;
//     if (typeof body === "object" && body !== null) {
//       content = { ...body };
//     } else {
//       content = { data: body };
//     }

//     if (restaurant_code !== null) {
//       content.restaurant_code = restaurant_code;
//     }
//     if (subscriber_code !== null) {
//       content.subscriber_code = subscriber_code;
//     }


//     // savedData = await prisma.data.create({
//     //   data: { 
//     //     content,
//     //     createdAt: italianDate,
//     //     createdAtIta: italianDateString

//     //   },
//     // });

//     if (content.customerList && Array.isArray(content.customerList)) {
//       const customerPromises = content.customerList.map(async (customer: any) => {
//         const existingCustomer = await prisma.customer.findFirst({
//           where: {
//             idCustomer: customer.idCustomer,
//             arrived_from: customer.arrived_from,
//           },
//         });

//         const customerData = {
//           idReferenceGateway: customer.idReferenceGateway || "",
//           idCustomer: customer.idCustomer || "",
//           gender: customer.gender || "",
//           name: customer.name || "",
//           surname: customer.surname || "",
//           birth_data: customer.birth_data || "",
//           vat_number: customer.vat_number || "",
//           residence_address: customer.residence_address || "",
//           residence_zipcode: customer.residence_zipcode || "",
//           residence_city: customer.residence_city || "",
//           residence_province: customer.residence_province || "",
//           residence_region: customer.residence_region || "",
//           residence_state: customer.residence_state || "",
//           domicile_address: customer.domicile_address || "",
//           domicile_zipcode: customer.domicile_zipcode || "",
//           domicile_city: customer.domicile_city || "",
//           domicile_province: customer.domicile_province || "",
//           domicile_region: customer.domicile_region || "",
//           domicile_state: customer.domicile_state || "",
//           mobile: customer.mobile || "",
//           email: customer.email || "",
//           publicCode: customer.publicCode || "",
//           subscriber: customer.subscriber || "",
//           arrived_from: customer.arrived_from || "",
//           fidelity_card_number: customer.fidelity_card_number || "",
//           consent_marketing: customer.consent_marketing || "",
//           consent_third_parties_marketing: customer.consent_third_parties_marketing || "",
//           dateCreation: customer.dateCreation || "",
//           dateLastUpdate: customer.dateLastUpdate || "",
//           deleted: customer.deleted || "",
//           restaurant_code: content.restaurant_code || "",
//           subscriber_code: content.subscriber_code || "",
//         };

//         if (existingCustomer) {
//           return await prisma.customer.update({
//             where: { id: existingCustomer.id },
//             data: customerData,
//           });
//         } else {
//           return await prisma.customer.create({
//             data: customerData,
//           });
//         }
//       });

//       await Promise.all(customerPromises);
//     }
//   } catch (error) {
//     console.error("Errore durante la creazione dei dati:", error);
//     statusCode = StatusCodes.InternalServerError;
//     errorMessage = error instanceof Error ? error.message : "Errore sconosciuto";
//   }


//   if (statusCode === StatusCodes.Created) {
//     return NextResponse.json(
//       { status: "success", savedData },
//       { status: StatusCodes.Created }
//     );
//   } else {
//     return NextResponse.json(
//       { message: "Errore durante la creazione dei dati", error: errorMessage },
//       { status: statusCode }
//     );
//   }
// }

// c'è un problema sul campo fidelity nuumber, dobbiamo capire da dove proviene il problema, dal mapper, gateway o easyappear

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/app/lib/prisma";
import moment from "moment-timezone";
import { updateCustomerOrders } from "@/app/lib/updateCustomerOrders";

enum StatusCodes {
  Success = 200,
  Created = 201,
  BadRequest = 400,
  InternalServerError = 500,
}

function getItalianDate(): Date {
  return moment().tz("Europe/Rome").toDate();
}

function getItalianDateString(): string {
  return moment().tz("Europe/Rome").format("YYYY-MM-DD HH:mm:ss");
}

const italianDate = getItalianDate();
const italianDateString = getItalianDateString();

export async function POST(request: NextRequest) {
  let savedData = null;
  let statusCode = StatusCodes.Created;
  let errorMessage: string | null = null;

  try {
    const body = await request.json();
    const searchParams = request.nextUrl.searchParams;
    const restaurant_code = searchParams.get("restaurant_code");
    const subscriber_code = searchParams.get("subscriber_code");

    let content: any;
    if (typeof body === "object" && body !== null) {
      content = { ...body };
    } else {
      content = { data: body };
    }

    if (restaurant_code !== null) {
      content.restaurant_code = restaurant_code;
    }
    if (subscriber_code !== null) {
      content.subscriber_code = subscriber_code;
    }

    // --- Salvataggio globale dei dati ricevuti ---
    savedData = await prisma.data.create({
      data: { 
        content,
        createdAt: italianDate,
        createdAtIta: italianDateString

      },
    });
    // Funzione per verificare se un numero è un cellulare valido
    function isValidMobileNumber(phone: string | null | undefined): boolean {
      if (!phone) return false;
      
      // Rimuovi spazi e caratteri non numerici tranne il + iniziale
      const cleanPhone = phone.replace(/^\+|[^0-9]/g, '');
      
      // Verifica che sia un numero di cellulare (inizia con 3 in Italia)
      // Questa logica può essere ampliata per altri paesi se necessario
      return cleanPhone.length >= 9 && cleanPhone.startsWith('3');
    }
    
    // Funzione per processare un cliente da Signa
    async function processSignaCustomer(customerData: any, restaurant_code: string) {
      // Verifica se ha la fidelity card
      if (customerData.fidelity_card_number && customerData.fidelity_card_number.trim() !== '') {
        // Cliente con fidelity card (presente sia in Signa che app Dylog)
        const existingCustomer = await prisma.customer.findFirst({
          where: {
            idCustomer: customerData.idCustomerExt,
            restaurant_code: restaurant_code
          }
        });
        
        if (existingCustomer) {
          console.log(`Cliente con fidelity trovato (idCustomerExt: ${customerData.idCustomerExt})`);
          return existingCustomer;
        } else {
          // Determina il numero di cellulare valido
          let mobileNumber = "";
          if (isValidMobileNumber(customerData.mobile)) {
            mobileNumber = customerData.mobile;
          } else if (isValidMobileNumber(customerData.phone)) {
            mobileNumber = customerData.phone;
          }
          
          // Crea un nuovo cliente con fidelity
          console.log(`Nuovo cliente con fidelity (idCustomerExt: ${customerData.idCustomerExt})`);
          const newCustomer = await prisma.customer.create({
            data: {
              idReferenceGateway: customerData.idReferenceGateway?.toString() || "",
              idCustomer: customerData.idCustomerExt || "", // Importante per targeting notifiche
              name: customerData.name?.trim() || "",
              surname: customerData.surname?.trim() || "",
              email: customerData.email?.trim() || "",
              mobile: mobileNumber,
              birth_data: customerData.birth_data || "",
              gender: customerData.gender || "",
              fidelity_card_number: customerData.fidelity_card_number || "",
              arrived_from: "SIGNA_WITH_FIDELITY",
              restaurant_code: restaurant_code,
              publicCode: restaurant_code, // Memorizziamo in entrambi i campi
              subscriber_code: "SIGNA",
            }
          });
          return newCustomer;
        }
      } else {
        // Cliente senza fidelity card (solo su Signa)
        const existingCustomerByEmail = customerData.email ? await prisma.customer.findFirst({
          where: {
            email: customerData.email,
            restaurant_code: restaurant_code
          }
        }) : null;
        
        if (existingCustomerByEmail) {
          return existingCustomerByEmail;
        }
        
        // Determina il numero di cellulare valido
        let mobileNumber = "";
        if (isValidMobileNumber(customerData.mobile)) {
          mobileNumber = customerData.mobile;
        } else if (isValidMobileNumber(customerData.phone)) {
          mobileNumber = customerData.phone;
        }
        
        // Crea un nuovo cliente senza fidelity
        console.log(`Nuovo cliente senza fidelity (idCustomerExt: ${customerData.idCustomerExt})`);
        const newCustomer = await prisma.customer.create({
          data: {
            idReferenceGateway: customerData.idReferenceGateway?.toString() || "",
            idCustomer: `SIG_${customerData.idCustomerExt}` || "", // Prefisso per evitare conflitti
            name: customerData.name?.trim() || "",
            surname: customerData.surname?.trim() || "",
            email: customerData.email?.trim() || "",
            mobile: mobileNumber,
            birth_data: customerData.birth_data || "",
            gender: customerData.gender || "",
            fidelity_card_number: "",
            arrived_from: "SIGNA_NO_FIDELITY",
            restaurant_code: restaurant_code,
            publicCode: restaurant_code, // Memorizziamo in entrambi i campi
            subscriber_code: "SIGNA",
          }
        });
        return newCustomer;
      }
    }

    // Funzione per trasformare un movimento Signa in formato standard
    function transformSignaMovimentoToSalesData(movimento: any, metadata: any, customer: any) {
      try {
        // Estrai la data e ora di vendita
        let saleDateTime = new Date();
        if (movimento.PagamentoData) {
          const dateParts = movimento.PagamentoData.split(' ')[0].split('/');
          const formattedDate = `${dateParts[2]}-${dateParts[1]}-${dateParts[0]}`;
          const timeStr = movimento.PagamentoOra || '00:00:00';
          saleDateTime = new Date(`${formattedDate}T${timeStr}`);
          
          // Se la data non è valida, usa la data corrente
          if (isNaN(saleDateTime.getTime())) {
            console.log(`Data non valida per movimento ${movimento.idReferenceGateway}, uso data corrente`);
            saleDateTime = new Date();
          }
        }
        
        // Calcola l'importo totale
        const totalAmount = movimento.pagamenti ? movimento.pagamenti.reduce((sum: number, payment: any) => {
          return sum + (payment.Importo || 0);
        }, 0) : 0;
        
        // Crea il record standardizzato
        return {
          sourceType: "signa",
          sourceId: movimento.idReferenceGateway?.toString() || "",
          
          saleDate: saleDateTime,
          
          totalAmount: totalAmount,
          
          customerId: customer?.id || null,
          fidelityCard: movimento.customer?.fidelity_card_number || "",
          
          restaurant_code: metadata.restaurant_code || "",
          subscriber_code: metadata.subscriber_code || "",
          
          // Versione ridotta dei dati originali
          sourceData: {
            idRefGateway: movimento.idReferenceGateway,
            idRefPOS: movimento.IDReferencePOS,
            date: movimento.PagamentoData,
            time: movimento.PagamentoOra,
            paymentMethod: movimento.pagamenti && movimento.pagamenti.length > 0 ? 
              movimento.pagamenti[0].CodTipoPagamento : null,
            customerRef: movimento.customer?.idCustomerExt || null,
            // Aggiungo i dettagli dei prodotti per permettere il mapping corretto in CustomerOrders
            prodotti: movimento.prodotti || []
          }
        };
      } catch (error) {
        console.error('Errore nella trasformazione del movimento:', error);
        return null;
      }
    }

    // Funzione per aggiornare le metriche aggregate per cliente
    async function updateCustomerSalesSummary(salesData: any) {
      if (!salesData.customerId) return;
      
      try {
        // Cerca se il cliente esiste già nelle metriche
        const existingSummary = await prisma.$runCommandRaw({
          find: "CustomerSalesSummary",
          filter: { customerId: salesData.customerId },
          limit: 1
        }).then((result: any) => {
          return result.cursor?.firstBatch?.[0] || null;
        });
        
        if (existingSummary) {
          // Aggiorna le metriche esistenti
          const orderDates = existingSummary.orderDates || [];
          orderDates.push(salesData.saleDate);
          
          // Aggiorna i conteggi per tipo di fonte
          const signaOrders = salesData.sourceType === "signa" ? 
            (existingSummary.signaOrders || 0) + 1 : (existingSummary.signaOrders || 0);
          const signaSpent = salesData.sourceType === "signa" ? 
            (existingSummary.signaSpent || 0) + salesData.totalAmount : (existingSummary.signaSpent || 0);
          
          const dylogappOrders = salesData.sourceType === "dylogapp" ? 
            (existingSummary.dylogappOrders || 0) + 1 : (existingSummary.dylogappOrders || 0);
          const dylogappSpent = salesData.sourceType === "dylogapp" ? 
            (existingSummary.dylogappSpent || 0) + salesData.totalAmount : (existingSummary.dylogappSpent || 0);
          
          await prisma.$runCommandRaw({
            update: "CustomerSalesSummary",
            updates: [{
              q: { _id: { $oid: existingSummary._id } },
              u: {
                $set: {
                  totalOrders: (existingSummary.totalOrders || 0) + 1,
                  totalSpent: (existingSummary.totalSpent || 0) + salesData.totalAmount,
                  lastOrderDate: salesData.saleDate > existingSummary.lastOrderDate ? 
                    salesData.saleDate : existingSummary.lastOrderDate,
                  orderDates: orderDates,
                  signaOrders,
                  signaSpent,
                  dylogappOrders,
                  dylogappSpent,
                  updateAt: new Date()
                }
              }
            }]
          });
        } else {
          // Crea nuove metriche
          const orderDates = [salesData.saleDate];
          const signaOrders = salesData.sourceType === "signa" ? 1 : 0;
          const signaSpent = salesData.sourceType === "signa" ? salesData.totalAmount : 0;
          const dylogappOrders = salesData.sourceType === "dylogapp" ? 1 : 0;
          const dylogappSpent = salesData.sourceType === "dylogapp" ? salesData.totalAmount : 0;
          
          await prisma.$runCommandRaw({
            insert: "CustomerSalesSummary",
            documents: [{
              customerId: salesData.customerId,
              totalOrders: 1,
              totalSpent: salesData.totalAmount,
              firstOrderDate: salesData.saleDate,
              lastOrderDate: salesData.saleDate,
              orderDates: orderDates,
              signaOrders,
              signaSpent,
              dylogappOrders,
              dylogappSpent,
              restaurant_code: salesData.restaurant_code || "",
              createdAt: new Date(),
              updateAt: new Date()
            }]
          });
        }
      } catch (error) {
        console.error('Errore nell\'aggiornamento delle metriche cliente:', error);
      }
    }

    // --- Verifica TicketList (DylogApp) ---
    if (content.TicketList && Array.isArray(content.TicketList) && content.TicketList.length > 0) {
      console.log("TicketList trovato, procedendo con salvataggio separato...");
      
      let dylogAppTicketsCount = 0;
      const salesDataRecords = [];
      
      // Salva TicketList in una collezione separata usando l'API prisma.$runCommandRaw
      for (const ticket of content.TicketList) {
        // Salva in TicketData (per tutti i ticket)
        await prisma.$runCommandRaw({
          insert: "TicketData", // Nome della collezione
          documents: [{
            ticketData: ticket,
            restaurant_code: content.restaurant_code || "",
            subscriber_code: content.subscriber_code || "",
            createdAt: new Date(),
            updateAt: new Date()
          }]
        });
        
        // Verifica se è un ticket di DylogApp con OrderWebInfo
        const isDylogApp = content.subscriber_code === "DylogApp";
        let hasOrderWebInfo = false;
        let orderWebInfo = null;
        
        // Verifica se DetailList contiene OrderWebInfo
        if (ticket.DetailList && Array.isArray(ticket.DetailList)) {
          for (const detail of ticket.DetailList) {
            if (detail.OrderWebInfo) {
              hasOrderWebInfo = true;
              orderWebInfo = detail.OrderWebInfo;
              break;
            }
          }
        }
        
        // Se è di DylogApp e ha OrderWebInfo, salva nella collezione specializzata
        if (isDylogApp && hasOrderWebInfo) {
          await prisma.$runCommandRaw({
            insert: "ticketListBaccoDylogAPP", // Nome della collezione
            documents: [{
              ticketData: ticket,
              restaurant_code: content.restaurant_code || "",
              subscriber_code: "DylogApp",
              orderWebInfo: orderWebInfo,
              createdAt: new Date(),
              updateAt: new Date()
            }]
          });
          dylogAppTicketsCount++;
          
          // Crea anche il record standardizzato per SalesData
          try {
            // Estrai il cliente se presente
            let customerId = null;
            if (orderWebInfo && orderWebInfo.customerId) {
              customerId = orderWebInfo.customerId;
            }
            
            // Calcola l'importo totale
            let totalAmount = 0;
            if (ticket.Totoal) {
              totalAmount = parseFloat(ticket.Totoal.toString());
            }
            
            // Crea il record per SalesData
            const salesDataRecord = {
              sourceType: "dylogapp",
              sourceId: ticket.IDTickets?.toString() || "",
              saleDate: ticket.DateBill ? new Date(ticket.DateBill) : new Date(),
              totalAmount: totalAmount,
              customerId: customerId,
              fidelityCard: "", // Da compilare se disponibile
              restaurant_code: content.restaurant_code || "",
              subscriber_code: "DylogApp",
              sourceData: {
                ticketId: ticket.IDTickets,
                orderWebInfo: orderWebInfo ? true : false,
                paymentMode: ticket.PaymentMode || "",
                // Aggiungo i dettagli dei prodotti per permettere il mapping corretto in CustomerOrders
                items: ticket.items || []
              }
            };
            
            salesDataRecords.push(salesDataRecord);
            
            // Aggiorna le metriche cliente
            if (customerId) {
              await updateCustomerSalesSummary(salesDataRecord);
              
              // Aggiorna CustomerOrders con il nuovo ordine
              const idCustomer = orderWebInfo?.IDCustomer || null;
              await updateCustomerOrders(salesDataRecord, idCustomer);
            }
          } catch (error) {
            console.error('Errore nella creazione del record SalesData per DylogApp:', error);
          }
        }
      }
      
      // Salva i record in SalesData
      if (salesDataRecords.length > 0) {
        try {
          await prisma.$runCommandRaw({
            insert: "SalesData",
            documents: salesDataRecords.map(record => ({
              ...record,
              createdAt: new Date(),
              updateAt: new Date()
            }))
          });
          console.log(`Salvati ${salesDataRecords.length} record nella collezione SalesData (DylogApp)`);
        } catch (error) {
          console.error('Errore nel salvataggio in SalesData:', error);
        }
      }
      
      let successMessage = `Salvati ${content.TicketList.length} record nella collezione TicketData`;
      if (dylogAppTicketsCount > 0) {
        successMessage += `, di cui ${dylogAppTicketsCount} record salvati anche nella collezione ticketListBaccoDylogAPP`;
      }
      if (salesDataRecords.length > 0) {
        successMessage += ` e ${salesDataRecords.length} record salvati in SalesData`;
      }
      console.log(successMessage);
      
      // Non salvare l'intero contenuto in Data
      return NextResponse.json(
        { status: "success", message: successMessage },
        { status: StatusCodes.Created }
      );
    }
    // --- Fine verifica TicketList (DylogApp) ---
    
    // --- Verifica movimenti Signa ---
    if (content.movimentivend && Array.isArray(content.movimentivend) && content.movimentivend.length > 0) {
      console.log("Movimenti Signa trovati, procedendo con salvataggio...");
      
      // Salva i movimenti grezzi nella collezione SignaMovimenti
      try {
        await prisma.$runCommandRaw({
          insert: "SignaMovimenti",
          documents: content.movimentivend.map((movimento: any) => ({
            movimentoData: movimento,
            restaurant_code: content.restaurant_code || "",
            subscriber_code: "SIGNA",
            createdAt: new Date(),
            updateAt: new Date()
          }))
        });
        console.log(`Salvati ${content.movimentivend.length} movimenti grezzi nella collezione SignaMovimenti`);
      } catch (error) {
        console.error('Errore nel salvataggio dei movimenti grezzi in SignaMovimenti:', error);
      }
      
      const processedCustomers = new Set(); // Per evitare elaborazioni duplicate
      const salesDataRecords = [];
      
      for (const movimento of content.movimentivend) {
        try {
          // Elabora il cliente se presente
          let customer = null;
          if (movimento.customer && movimento.customer.idCustomerExt) {
            const customerId = movimento.customer.idCustomerExt;
            
            // Elabora il cliente solo se non l'abbiamo già fatto in questo batch
            if (!processedCustomers.has(customerId)) {
              customer = await processSignaCustomer(movimento.customer, content.restaurant_code || "");
              processedCustomers.add(customerId);
            }
          }
          
          // Trasforma il movimento in formato standardizzato
          const salesData = transformSignaMovimentoToSalesData(movimento, content, customer);
          
          if (salesData) {
            // Assicuriamoci che customerId sia impostato se abbiamo un cliente
            if (customer) {
              salesData.customerId = customer.id;
            }
            
            salesDataRecords.push(salesData);
            
            // Aggiorna le metriche cliente
            if (customer) {
              await updateCustomerSalesSummary(salesData);
              
              // Aggiorna CustomerOrders con il nuovo ordine
              const idCustomer = movimento.customer?.idCustomerExt || movimento.customer?.idCustomer || null;
              await updateCustomerOrders(salesData, idCustomer);
            }
          }
        } catch (error) {
          console.error('Errore nella elaborazione del movimento Signa:', error);
        }
      }
      
      // Salva i record in SalesData
      if (salesDataRecords.length > 0) {
        try {
          // Assicuriamoci che tutti i record abbiano il customerId corretto
          // aggiornando quello che abbiamo eventualmente impostato durante updateCustomerSalesSummary
          for (let i = 0; i < salesDataRecords.length; i++) {
            const record = salesDataRecords[i];
            // Se record ha fidelityCard ma non customerId, cerca di trovare il cliente
            if (!record.customerId && (record.fidelityCard || (record.sourceData && record.sourceData.customerRef))) {
              let customer = null;
              
              // Cerca per fidelity card
              if (record.fidelityCard) {
                customer = await prisma.customer.findFirst({
                  where: { fidelity_card_number: record.fidelityCard }
                });
              }
              
              // Se non trovato per fidelity, cerca per customerRef
              if (!customer && record.sourceData && record.sourceData.customerRef) {
                customer = await prisma.customer.findFirst({
                  where: { idCustomer: record.sourceData.customerRef }
                });
              }
              
              // Se troviamo il cliente, aggiorna il customerId
              if (customer) {
                salesDataRecords[i].customerId = customer.id;
                console.log(`Cliente trovato per record di vendita: ${customer.id}`);
              }
            }
          }
          
          await prisma.$runCommandRaw({
            insert: "SalesData",
            documents: salesDataRecords.map(record => ({
              ...record,
              createdAt: new Date(),
              updateAt: new Date()
            }))
          });
          console.log(`Salvati ${salesDataRecords.length} record nella collezione SalesData (Signa)`);
        } catch (error) {
          console.error('Errore nel salvataggio in SalesData:', error);
        }
      }
      
      const successMessage = `Elaborati ${content.movimentivend.length} movimenti Signa, salvati ${processedCustomers.size} clienti e ${salesDataRecords.length} record di vendita`;
      console.log(successMessage);
      
      // Non salvare l'intero contenuto in Data
      return NextResponse.json(
        { status: "success", message: successMessage },
        { status: StatusCodes.Created }
      );
    }
    // --- Fine verifica movimenti Signa ---

    if (content.customerList && Array.isArray(content.customerList)) {
      const customerPromises = content.customerList.map(async (customer: any) => {
        const existingCustomer = await prisma.customer.findFirst({
          where: {
            idCustomer: customer.idCustomer,
            publicCode: customer.publicCode,
          },
        });

        const customerData = {
          idReferenceGateway: customer.idReferenceGateway || "",
          idCustomer: customer.idCustomer || "",
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
          dateCreation: customer.dateCreation || "",
          dateLastUpdate: customer.dateLastUpdate || "",
          deleted: customer.deleted || "",
          restaurant_code: content.restaurant_code || "",
          subscriber_code: content.subscriber_code || "",
        };

        if (existingCustomer) {
          await prisma.customer.delete({
            where: { id: existingCustomer.id },
          });
        }

        return await prisma.customer.create({
          data: customerData,
        });
      });

      await Promise.all(customerPromises);
    }
  } catch (error) {
    console.error("Errore durante la creazione dei dati:", error);
    statusCode = StatusCodes.InternalServerError;
    errorMessage = error instanceof Error ? error.message : "Errore sconosciuto";
  }

  if (statusCode === StatusCodes.Created) {
    return NextResponse.json(
      { status: "success", savedData },
      { status: StatusCodes.Created }
    );
  } else {
    return NextResponse.json(
      { message: "Errore durante la creazione dei dati", error: errorMessage },
      { status: statusCode }
    );
  }
}
