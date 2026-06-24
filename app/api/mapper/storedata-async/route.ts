import { NextRequest, NextResponse } from "next/server";
import { Buffer } from "buffer";
import prisma from "@/app/lib/prisma";
import moment from "moment-timezone";
import pLimit from "p-limit";
import { updateCustomerOrders } from "@/app/lib/updateCustomerOrders";
import { cleanString } from "@/app/utils/clean-string";

const MAX_MB = 32; // da ridurre da 32MB a 16MB
const CONCURRENCY = 3; // Ridotto da 5 a 3 per limitare uso memoria

function getItalianDate(): Date {
  return moment().tz("Europe/Rome").toDate();
}

function getItalianDateString(): string {
  return moment().tz("Europe/Rome").format("YYYY-MM-DD HH:mm:ss");
}

async function parseLargeJSON(request: NextRequest): Promise<any> {
  try {
 
    const body = await request.json();
    

    const bodyString = JSON.stringify(body);
    const sizeInMB = Buffer.byteLength(bodyString, 'utf8') / (1024 * 1024);
    
    if (sizeInMB > MAX_MB) {
      throw new Error(`Payload troppo grande: ${sizeInMB.toFixed(2)}MB (limite: ${MAX_MB}MB)`);
    }
    
    return body;
  } catch (error) {
    if (error instanceof Error && error.message.includes('too large')) {
      throw new Error(`Payload oltre il limite di ${MAX_MB}MB`);
    }
    throw error;
  }
}

export async function POST(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const body = await parseLargeJSON(request);
    const restaurant_code = searchParams.get("restaurant_code") ?? "";
    const subscriber_code = searchParams.get("subscriber_code") ?? "";

    if (!restaurant_code || !subscriber_code) {
      return NextResponse.json(
        { error: "restaurant_code e subscriber_code sono obbligatori" },
        { status: 400 }
      );
    }

    const jobId = `job_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    const asyncJob = await prisma.asyncJob.create({
      data: {
        id: jobId,
        status: 'queued',
        restaurant_code,
        subscriber_code,
        payload: body,
        createdAt: new Date()
      }
    });

    processDataInBackground(jobId, body, restaurant_code, subscriber_code).catch(error => {
      console.error(`[${getItalianDateString()}] Errore background job ${jobId}:`, error);
    });

    return NextResponse.json({
      status: "accepted",
      message: "Dati ricevuti e messi in coda per processamento",
      jobId: jobId,
      statusUrl: `/api/mapper/job-status/${jobId}`
    }, { status: 202 });

  } catch (error) {
    console.error(`[${getItalianDateString()}] Errore endpoint asincrono:`, error);
    return NextResponse.json(
      { 
        error: "Errore interno del server",
        details: error instanceof Error ? error.message : String(error)
      },
      { status: 500 }
    );
  }
}

async function processDataInBackground(
  jobId: string,
  body: any,
  restaurant_code: string,
  subscriber_code: string
) {
  const start = Date.now();

  try {
    console.log(`[${getItalianDateString()}] Avvio processamento job ${jobId}`);
    
    await prisma.asyncJob.update({
      where: { id: jobId },
      data: {
        status: 'processing',
        startedAt: new Date()
      }
    });

    let stats = {
      customersProcessed: 0,
      customersCreated: 0,
      customersUpdated: 0,
      customersSkipped: 0,
      customersErrors: 0,
      movimentiProcessed: 0,
      movimentiCreated: 0,
      movimentiSkipped: 0,
      movimentiErrors: 0,
      movimentivendProcessed: 0,
      movimentivendCreated: 0,
      movimentivendSkipped: 0,
      movimentivendErrors: 0,
      ticketsProcessed: 0,
      ticketsCreated: 0,
      ticketsSkipped: 0,
      ticketsErrors: 0
    };

    const clientIP = 'async-job';
    console.log(`[${getItalianDateString()}] Job ${jobId} - Payload: customers=${body.customerList?.length || 0}, movements=${body.movimenti?.length || 0}, sales=${body.movimentivend?.length || 0}, tickets=${body.TicketList?.length || 0}`);

    if (Array.isArray(body.movimenti) && body.movimenti.length > 0) {
      console.log(`[${getItalianDateString()}] Processando ${body.movimenti.length} movimenti Signa per SignaMovimenti...`);
      let salvati = 0, saltati = 0, errori = 0;
      
      for (const movimento of body.movimenti) {
        try {
          const existingMovimento = await prisma.signaMovimenti.findFirst({
            where: {
              IDReferencePOS: movimento.IDReferencePOS?.toString() || ""
            }
          });
          
          if (existingMovimento) {
            console.log(`[${getItalianDateString()}] Movimento Signa con IDReferencePOS ${movimento.IDReferencePOS} già presente, skip.`);
            saltati++;
            continue;
          }
          
          await prisma.signaMovimenti.create({
            data: {
              payload: movimento,
              idReferenceGateway: movimento.idReferenceGateway?.toString() || "",
              IDReferencePOS: movimento.IDReferencePOS?.toString() || "",
              CodAzienda: movimento.CodAzienda || "",
              CodNegozio: movimento.CodNegozio || "",
              CodCommesso: movimento.CodCommesso || "",
              CodSconto: movimento.CodSconto || "",
              MovimentoData: movimento.MovimentoData || "",
              MovimentoOra: movimento.MovimentoOra || "",
              MovimentoAnno: movimento.MovimentoAnno || 0,
              VenditaWeb: movimento.VenditaWeb || false,
              TaxFree: movimento.TaxFree || false,
              Noleggiato: movimento.Noleggiato || false,
              Fatturato: movimento.Fatturato || false,
              restaurant_code,
              subscriber_code: "SIGNA",
              createdAt: new Date(),
              updateAt: new Date(),
            },
          });
          salvati++;
        } catch (error) {
          console.error(`[${getItalianDateString()}] Errore nel salvare movimento Signa con IDReferencePOS ${movimento.IDReferencePOS}: ${error}`);
          errori++;
        }
      }
      console.log(`[${getItalianDateString()}] Job ${jobId}: Completato processamento movimenti Signa: ${salvati} salvati, ${saltati} saltati, ${errori} errori`);
      
      stats.movimentiProcessed = salvati + saltati;
      stats.movimentiCreated = salvati;
      stats.movimentiSkipped = saltati;
      stats.movimentiErrors = errori;
    }
    
    if (Array.isArray(body.movimentivend) && body.movimentivend.length > 0) {
      console.log(`[${getItalianDateString()}] Job ${jobId}: Processando ${body.movimentivend.length} movimenti vendita Signa...`);
      let salvati = 0, saltati = 0, errori = 0;

      for (const movimento of body.movimentivend) {
            try {
              console.log(`[${getItalianDateString()}] Job ${jobId}: Processando movimento ${movimento.IDMovimentoPOS}`);
              
              const existingMovimentoVend = await prisma.signaMovimentiVend.findFirst({
                where: {
                  IDMovimentoPOS: movimento.IDMovimentoPOS?.toString() || ""
                }
              });
              
              if (existingMovimentoVend) {
                console.log(`[${getItalianDateString()}] Job ${jobId}: Movimento ${movimento.IDMovimentoPOS} già presente, skip.`);
                saltati++;
                continue;
              }
              
              await prisma.$runCommandRaw({
                insert: "SignaMovimentiVend",
                documents: [
                  {
                    movimentoData: movimento,
                    IDMovimentoPOS: movimento.IDMovimentoPOS?.toString() || "", 
                    restaurant_code,
                    subscriber_code: "SIGNA",
                    createdAt: new Date(),
                    updateAt: new Date(),
                  },
                ],
              });
              salvati++;

              const saleDateTime = movimento.PagamentoData && movimento.PagamentoOra
                ? new Date(
                    moment(`${movimento.PagamentoData} ${movimento.PagamentoOra}`, "DD/MM/YYYY HH:mm:ss").toISOString()
                  )
                : new Date();

              const totalAmount = Array.isArray(movimento.pagamenti)
                ? movimento.pagamenti.reduce((sum: number, p: any) => sum + (p.Importo || 0), 0)
                : 0;

              const prodotti = movimento.prodotti || [];

              try {
                const idCustomer = movimento.customer?.idCustomerExt || movimento.customer?.idCustomer;
                if (!idCustomer) {
                  console.warn(`[${getItalianDateString()}] Movimento Signa con IDMovimentoPOS ${movimento.IDMovimentoPOS} senza idCustomer, skip updateCustomerOrders.`);
                  continue;
                }
                await updateCustomerOrders(movimento, "signa", idCustomer, restaurant_code);
              } catch (updateError) {
                console.error(`[${getItalianDateString()}] Errore nell'aggiornamento CustomerOrders per movimento Signa ${movimento.IDMovimentoPOS}: ${updateError}`);
              }
            } catch (error) {
              errori++;
              console.error(`[${getItalianDateString()}] Errore nel processare movimento vendita Signa con IDMovimentoPOS ${movimento.IDMovimentoPOS}: ${error}`);
            }
      }
      console.log(`[${getItalianDateString()}] Job ${jobId}: Completato processamento movimenti vendita Signa: ${salvati} salvati, ${saltati} saltati, ${errori} errori`);
      
      
      stats.movimentivendProcessed = salvati + saltati;
      stats.movimentivendCreated = salvati;
      stats.movimentivendSkipped = saltati;
      stats.movimentivendErrors = errori;
    }

    if (Array.isArray(body.TicketList) && body.TicketList.length > 0) {
      console.log(`[${getItalianDateString()}] Processando ${body.TicketList.length} ticket DylogApp...`);
      let salvati = 0, saltati = 0, errori = 0, erroriUpdate = 0;

      for (const ticket of body.TicketList) {
            try {
              let orderWebInfo = null;
              if (Array.isArray(ticket.DetailList)) {
                for (const detail of ticket.DetailList) {
                  if (detail.OrderWebInfo) {
                    orderWebInfo = detail.OrderWebInfo;
                    break;
                  }
                }
              }

              if (!orderWebInfo || !orderWebInfo.IDCustomer) {
                console.warn(`[${getItalianDateString()}] Ticket DylogApp senza orderWebInfo o IDCustomer, skip.`);
                saltati++;
                continue;
              }

              const productItems = [];
              let totalAmount = 0;

              for (const detail of ticket.DetailList || []) {
                if ((detail.Name || detail.Code) && detail.Price !== undefined && detail.Qta !== undefined) {
                  const quantity = parseFloat(detail.Qta.toString()) || 0;
                  const price = parseFloat(detail.Price.toString()) || 0;
                  const itemTotal = quantity * price;
                  totalAmount += itemTotal;
                  productItems.push({
                    id: detail.Code || '',
                    description: detail.Name || '',
                    quantity,
                    price,
                    totalPrice: itemTotal,
                  });
                }
              }

              try {
                await prisma.ticketListBaccoDylogAPP.create({
                  data: {
                    ticketData: ticket,
                    restaurant_code,
                    subscriber_code: "DylogApp",
                    orderWebInfo,
                    createdAt: new Date(),
                    updateAt: new Date()
                  }
                });
                console.log(`[${getItalianDateString()}] Ticket DylogApp con IDTickets ${orderWebInfo.IDTickets} salvato con successo.`);
                salvati++;
              } catch (error) {
               
                console.error(`[${getItalianDateString()}] Errore nel salvare il ticket DylogApp con IDTickets ${orderWebInfo.IDTickets}: ${error}`);
                errori++;
              }

              try {
                await updateCustomerOrders(ticket, "dylogapp", orderWebInfo.IDCustomer, restaurant_code);
              } catch (updateError) {
                console.error(`[${getItalianDateString()}] Errore nell'aggiornamento CustomerOrders per ticket DylogApp ${orderWebInfo.IDTickets}: ${updateError}`);
                erroriUpdate++;
              }
            } catch (error) {
              console.error(`[${getItalianDateString()}] Errore generale nel processare ticket DylogApp: ${error}`);
              errori++;
            }
      }
      console.log(`[${getItalianDateString()}] Job ${jobId}: Completato processamento ticket DylogApp: ${salvati} salvati, ${saltati} saltati, ${errori} errori, ${erroriUpdate} errori di aggiornamento`);
      
     
      stats.ticketsProcessed = salvati + saltati;
      stats.ticketsCreated = salvati;
      stats.ticketsSkipped = saltati;
      stats.ticketsErrors = errori;
    }

    if (Array.isArray(body.customerList) && body.customerList.length > 0) {
      console.log(`[${getItalianDateString()}] Processando ${body.customerList.length} clienti...`);
      let aggiornati = 0, creati = 0, saltati = 0, errori = 0;

    
      for (const customer of body.customerList) {
            try {
            
              const arrivedFrom = customer.arrived_from?.toLowerCase() || "";
              
             
              const incomingLastUpdate = customer.dateLastUpdateProduct || "";
              
              let existing = null;
              let effectiveCustomerId = "";
              
              if (arrivedFrom === "app") {
              
                effectiveCustomerId = customer.idCustomerExt || customer.idCustomer;
                
                if (!effectiveCustomerId) {
                  console.warn(`[${getItalianDateString()}] Cliente App senza idCustomer/idCustomerExt, skip.`);
                  continue;
                }
                
             
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
               
                if (customer.idCustomerExt) {
                
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
              
            
              console.log(`[${getItalianDateString()}] Processo cliente - arrived_from: ${arrivedFrom}, ID: ${effectiveCustomerId}${customer.idCustomerExt ? ' (da idCustomerExt)' : ''}${existing ? ' - TROVATO' : ' - NUOVO'}`);

              if (existing) {
               
                const existingLastUpdate = existing.dateLastUpdate || "";
                
                if (incomingLastUpdate && existingLastUpdate && incomingLastUpdate <= existingLastUpdate) {
                  console.log(`[${getItalianDateString()}] Cliente ${effectiveCustomerId || 'email:' + customer.email} saltato - dateLastUpdateProduct non più recente (${incomingLastUpdate} <= ${existingLastUpdate})`);
                  saltati++;
                  continue;
                }
              
                const filteredCustomerData = {
                  idReferenceGateway: customer.idReferenceGateway || existing.idReferenceGateway || "",
                  idCustomer: effectiveCustomerId,
                  gender: customer.gender || existing.gender || "",
                  name: cleanString(customer.name) || cleanString(existing.name) || "",
                  surname: cleanString(customer.surname) || cleanString(existing.surname)|| "",
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
                  mobile: cleanString(customer.mobile) || cleanString(existing.mobile) || "",
                  email: customer.email || existing.email || "",
                  publicCode: cleanString(customer.publicCode) || cleanString(existing.publicCode) || "",
                  subscriber: cleanString(customer.subscriber) || cleanString(existing.subscriber) || "",
                  arrived_from: customer.arrived_from || existing.arrived_from || "",
                  fidelity_card_number: customer.fidelity_card_number || existing.fidelity_card_number || "",
                  consent_marketing: customer.consent_marketing || existing.consent_marketing || "",
                  consent_third_parties_marketing: customer.consent_third_parties_marketing || existing.consent_third_parties_marketing || "",
                  dateCreation: existing.dateCreation || "",
                  dateLastUpdate: incomingLastUpdate, 
                  deleted: customer.deleted || existing.deleted || "",
                  restaurant_code,
                  subscriber_code,
                  updateAt: new Date(), 
                };
                
               
                console.log(`[${getItalianDateString()}] DATI FILTRATI PER UPDATE CUSTOMER ${customer.idCustomer}:`);
                console.log(JSON.stringify(filteredCustomerData, null, 2));
                
                await prisma.customer.update({
                  where: { id: existing.id },
                  data: {
                    ...filteredCustomerData,
                    idCustomer: effectiveCustomerId 
                  },
                });
                console.log(`[${getItalianDateString()}] Cliente con idCustomer ${customer.idCustomer} aggiornato con successo.`);
                aggiornati++;
              } else {
             
                const filteredCustomerData = {
                  idReferenceGateway: customer.idReferenceGateway || "",
                  idCustomer: effectiveCustomerId,
                  gender: customer.gender || "",
                  name: cleanString(customer.name) || "",
                  surname: cleanString(customer.surname) || "",
                  birth_data: customer.birth_data || "",
                  vat_number: cleanString(customer.vat_number) || "",
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
                  mobile: cleanString(customer.mobile) || "",
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
                
               
                console.log(`[${getItalianDateString()}] DATI FILTRATI PER CREATE CUSTOMER ${customer.idCustomer}:`);
                console.log(JSON.stringify(filteredCustomerData, null, 2));
                
                await prisma.customer.create({
                  data: {
                    ...filteredCustomerData,
                    idCustomer: effectiveCustomerId,
                    createdAt: new Date()
                  },
                });
                console.log(`[${getItalianDateString()}] Nuovo cliente con idCustomer ${customer.idCustomer} creato con successo.`);
                creati++;
              }
            } catch (error) {
            
              console.error(`[${getItalianDateString()}] Errore nell'aggiornamento/creazione del cliente ${customer?.idCustomer || 'sconosciuto'}: ${error}`);
              errori++;
            }
      }
      console.log(`[${getItalianDateString()}] Job ${jobId}: Completato processamento clienti: ${aggiornati} aggiornati, ${creati} creati, ${saltati} saltati (data non recente), ${errori} errori`);
      
    
      stats.customersProcessed = aggiornati + creati + saltati;
      stats.customersCreated = creati;
      stats.customersUpdated = aggiornati;
      stats.customersSkipped = saltati;
      stats.customersErrors = errori;
    }

   
    const duration = ((Date.now() - start) / 1000).toFixed(2);
    
    await prisma.asyncJob.update({
      where: { id: jobId },
      data: {
        status: 'completed',
        progress: 100,
        completedAt: new Date(),
        result: {
          status: "success",
          duration: `${duration}s`,
          stats: stats
        }
      }
    });

    console.log(`[${getItalianDateString()}] Job ${jobId} completato in ${duration}s:`, stats);

  } catch (error) {
    console.error(`[${getItalianDateString()}] Errore job ${jobId}:`, error);
    
    await prisma.asyncJob.update({
      where: { id: jobId },
      data: {
        status: 'failed',
        completedAt: new Date(),
        error: error instanceof Error ? error.message : String(error)
      }
    });
  }
}
