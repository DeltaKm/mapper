import { NextRequest, NextResponse } from "next/server";
import { Buffer } from "buffer";
import prisma from "@/app/lib/prisma";
import moment from "moment-timezone";
import pLimit from "p-limit";
import { updateCustomerOrders } from "@/app/lib/updateCustomerOrders";

const MAX_MB = 16; // Ridotto da 32MB a 16MB
const CONCURRENCY = 3; // Ridotto da 5 a 3 per limitare uso memoria

function getItalianDate(): Date {
  return moment().tz("Europe/Rome").toDate();
}

function getItalianDateString(): string {
  return moment().tz("Europe/Rome").format("YYYY-MM-DD HH:mm:ss");
}

async function parseLargeJSON(request: NextRequest): Promise<any> {
  try {
    // Usa il metodo nativo di Next.js che è più efficiente
    const body = await request.json();
    
    // Stima approssimativa della dimensione per sicurezza
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
  const start = Date.now();
  const limit = pLimit(CONCURRENCY);

  try {
    const searchParams = request.nextUrl.searchParams;
    const body = await parseLargeJSON(request);
    const restaurant_code = searchParams.get("restaurant_code") ?? "";
    const subscriber_code = searchParams.get("subscriber_code") ?? "";

    // Rimuoviamo la creazione di content per evitare duplicazione in memoria

    // COMMENTATO: Salvataggio payload completo per risparmiare spazio DB
    // await prisma.data.create({
    //   data: {
    //     content,
    //     createdAt: getItalianDate(),
    //     createdAtIta: getItalianDateString(),
    //   },
    // });

    // Log minimale per ridurre uso memoria
    const clientIP = request.headers.get('x-forwarded-for')?.split(',')[0] || 'unknown';
    console.log(`[${getItalianDateString()}] Request from ${clientIP} - Payload: customers=${body.customerList?.length || 0}, movements=${body.movimenti?.length || 0}, sales=${body.movimentivend?.length || 0}, tickets=${body.ticketList?.length || 0}`);

    // Salva i dati dei movimenti nella collezione SignaMovimenti
    if (Array.isArray(body.movimenti) && body.movimenti.length > 0) {
      console.log(`[${getItalianDateString()}] Processando ${body.movimenti.length} movimenti Signa per SignaMovimenti...`);
      let salvati = 0, saltati = 0, errori = 0;
      
      // Processamento sequenziale per ridurre uso memoria
      for (const movimento of body.movimenti) {
        try {
          // Verifica se esiste già un documento con lo stesso IDReferencePOS
          const existingMovimento = await prisma.signaMovimenti.findFirst({
            where: {
              IDReferencePOS: movimento.IDReferencePOS?.toString() || ""
            }
          });
          
          // Se esiste già, salta questo movimento
          if (existingMovimento) {
            console.log(`[${getItalianDateString()}] Movimento Signa con IDReferencePOS ${movimento.IDReferencePOS} già presente, skip.`);
            saltati++;
            continue;
          }
          
          // Se non esiste, procedi con il salvataggio
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
      console.log(`[${getItalianDateString()}] Completato processamento movimenti Signa: ${salvati} salvati, ${saltati} saltati, ${errori} errori`);
    }
    
    // Salva i dati delle vendite nella collezione SignaMovimentiVend
    if (Array.isArray(body.movimentivend) && body.movimentivend.length > 0) {
      console.log(`[${getItalianDateString()}] Processando ${body.movimentivend.length} movimenti vendita Signa...`);
      let salvati = 0, saltati = 0, errori = 0;

      // Processamento sequenziale per ridurre uso memoria
      for (const movimento of body.movimentivend) {
            try {
              // Verifica se esiste già un documento con lo stesso IDMovimentoPOS
              const existingMovimentoVend = await prisma.signaMovimentiVend.findFirst({
                where: {
                  IDMovimentoPOS: movimento.IDMovimentoPOS?.toString() || ""
                }
              });
              
              // Se esiste già, salta questo movimento
              if (existingMovimentoVend) {
                console.log(`[${getItalianDateString()}] Movimento Signa con IDMovimentoPOS ${movimento.IDMovimentoPOS} già presente in SignaMovimentiVend, skip.`);
                saltati++;
                continue; // Salta solo l'iterazione corrente
              }
              
              // Se non esiste, procedi con il salvataggio
              await prisma.$runCommandRaw({
                insert: "SignaMovimentiVend",
                documents: [
                  {
                    movimentoData: movimento,
                    IDMovimentoPOS: movimento.IDMovimentoPOS?.toString() || "", // Salva IDMovimentoPOS come campo separato
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

              // Utilizzo updateCustomerOrders per aggiornare i campi aggregati
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
      console.log(`[${getItalianDateString()}] Completato processamento movimenti vendita Signa: ${salvati} salvati, ${saltati} saltati, ${errori} errori`);
    }

    if (Array.isArray(body.TicketList) && body.TicketList.length > 0) {
      console.log(`[${getItalianDateString()}] Processando ${body.TicketList.length} ticket DylogApp...`);
      let salvati = 0, saltati = 0, errori = 0, erroriUpdate = 0;

      // Processamento sequenziale per ridurre uso memoria
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

              // Salva il ticket nella collezione ticketListBaccoDylogAPP
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
                // Gestione errori: potrebbe essere un duplicato o altro problema
                console.error(`[${getItalianDateString()}] Errore nel salvare il ticket DylogApp con IDTickets ${orderWebInfo.IDTickets}: ${error}`);
                errori++;
              }

              // Utilizzo updateCustomerOrders per aggiornare i campi aggregati
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
      console.log(`[${getItalianDateString()}] Completato processamento ticket DylogApp: ${salvati} salvati, ${saltati} saltati, ${errori} errori, ${erroriUpdate} errori di aggiornamento`);
    }

    if (Array.isArray(body.customerList) && body.customerList.length > 0) {
      console.log(`[${getItalianDateString()}] Processando ${body.customerList.length} clienti...`);
      let aggiornati = 0, creati = 0, saltati = 0, errori = 0;

      // Processamento sequenziale per ridurre uso memoria
      for (const customer of body.customerList) {
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
                  console.warn(`[${getItalianDateString()}] Cliente App senza idCustomer/idCustomerExt, skip.`);
                  continue;
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
              
              // Log per tracciare quale ID stiamo usando
              console.log(`[${getItalianDateString()}] Processo cliente - arrived_from: ${arrivedFrom}, ID: ${effectiveCustomerId}${customer.idCustomerExt ? ' (da idCustomerExt)' : ''}${existing ? ' - TROVATO' : ' - NUOVO'}`);

              if (existing) {
                // Controlla se dateLastUpdateProduct (in arrivo) è più recente di dateLastUpdate (salvato)
                const existingLastUpdate = existing.dateLastUpdate || "";
                
                if (incomingLastUpdate && existingLastUpdate && incomingLastUpdate <= existingLastUpdate) {
                  console.log(`[${getItalianDateString()}] Cliente ${effectiveCustomerId || 'email:' + customer.email} saltato - dateLastUpdateProduct non più recente (${incomingLastUpdate} <= ${existingLastUpdate})`);
                  saltati++;
                  continue;
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
                
                // Log dei dati filtrati usati per l'update
                console.log(`[${getItalianDateString()}] DATI FILTRATI PER UPDATE CUSTOMER ${customer.idCustomer}:`);
                console.log(JSON.stringify(filteredCustomerData, null, 2));
                
                await prisma.customer.update({
                  where: { id: existing.id },
                  data: {
                    ...filteredCustomerData,
                    idCustomer: effectiveCustomerId // Assicura che idCustomer sia impostato correttamente
                  },
                });
                console.log(`[${getItalianDateString()}] Cliente con idCustomer ${customer.idCustomer} aggiornato con successo.`);
                aggiornati++;
              } else {
                // Crea un nuovo cliente se non esiste
                // Filtra i campi del cliente per includere solo quelli definiti nel modello Prisma
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
                
                // Log dei dati filtrati usati per la creazione
                console.log(`[${getItalianDateString()}] DATI FILTRATI PER CREATE CUSTOMER ${customer.idCustomer}:`);
                console.log(JSON.stringify(filteredCustomerData, null, 2));
                
                await prisma.customer.create({
                  data: {
                    ...filteredCustomerData,
                    idCustomer: effectiveCustomerId, // Assicura che idCustomer sia impostato correttamente
                    createdAt: new Date()
                  },
                });
                console.log(`[${getItalianDateString()}] Nuovo cliente con idCustomer ${customer.idCustomer} creato con successo.`);
                creati++;
              }
            } catch (error) {
              // Log dell'errore ma non interrompe il processo per gli altri clienti
              console.error(`[${getItalianDateString()}] Errore nell'aggiornamento/creazione del cliente ${customer?.idCustomer || 'sconosciuto'}: ${error}`);
              errori++;
            }
      }
      console.log(`[${getItalianDateString()}] Completato processamento clienti: ${aggiornati} aggiornati, ${creati} creati, ${saltati} saltati (data non recente), ${errori} errori`);
    }

    const duration = ((Date.now() - start) / 1000).toFixed(2);
    return NextResponse.json({ status: "success", duration: `${duration}s` }, { status: 201 });
  } catch (error) {
    console.error("Errore POST:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Errore generico" },
      { status: 500 }
    );
  }
}
