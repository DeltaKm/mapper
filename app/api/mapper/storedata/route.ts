import { NextRequest, NextResponse } from "next/server";
import { Buffer } from "buffer";
import prisma from "@/app/lib/prisma";
import moment from "moment-timezone";
import pLimit from "p-limit";
import { updateCustomerOrders } from "@/app/lib/updateCustomerOrders";

const MAX_MB = 32;
const CONCURRENCY = 5;

function getItalianDate(): Date {
  return moment().tz("Europe/Rome").toDate();
}

function getItalianDateString(): string {
  return moment().tz("Europe/Rome").format("YYYY-MM-DD HH:mm:ss");
}

async function parseLargeJSON(request: NextRequest): Promise<any> {
  const reader = request.body?.getReader();
  if (!reader) throw new Error("Stream non disponibile");

  const chunks: Uint8Array[] = [];
  let totalSize = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      chunks.push(value);
      totalSize += value.length;
      if (totalSize > MAX_MB * 1024 * 1024) {
        throw new Error("Payload oltre il limite di 32MB");
      }
    }
  }

  const buffer = Buffer.concat(chunks);
  return JSON.parse(buffer.toString("utf8"));
}

export async function POST(request: NextRequest) {
  const start = Date.now();
  const limit = pLimit(CONCURRENCY);

  try {
    const searchParams = request.nextUrl.searchParams;
    const body = await parseLargeJSON(request);
    const restaurant_code = searchParams.get("restaurant_code") ?? "";
    const subscriber_code = searchParams.get("subscriber_code") ?? "";

    const content = {
      ...body,
      restaurant_code,
      subscriber_code,
    };

    await prisma.data.create({
      data: {
        content,
        createdAt: getItalianDate(),
        createdAtIta: getItalianDateString(),
      },
    });

    // Log del payload completo ricevuto
    console.log(`[${getItalianDateString()}] PAYLOAD RICEVUTO - RICHIESTA DA: ${request.headers.get('x-forwarded-for') || request.headers.get('remote-addr')}`);
    console.log(JSON.stringify({
      timestamp: new Date().toISOString(),
      method: request.method,
      url: request.url,
      headers: Object.fromEntries(request.headers.entries()),
      params: {
        restaurant_code: searchParams.get("restaurant_code"),
        subscriber_code: searchParams.get("subscriber_code")
      },
      body: {
        customerList: body.customerList ? `[${body.customerList.length} elementi]` : 'assente',
        movimentivend: body.movimentivend ? `[${body.movimentivend.length} elementi]` : 'assente',
        ticketList: body.ticketList ? `[${body.ticketList.length} elementi]` : 'assente',
        // Aggiungi qui altri campi rilevanti del payload
      }
    }, null, 2));

    // Salva i dati dei movimenti nella collezione SignaMovimenti
    if (Array.isArray(body.movimenti) && body.movimenti.length > 0) {
      console.log(`[${getItalianDateString()}] Processando ${content.movimenti.length} movimenti Signa per SignaMovimenti...`);
      let salvati = 0, saltati = 0, errori = 0;
      
      // Per ogni movimento nell'array movimenti, salva i dati con i dettagli dei prodotti
      for (const movimento of content.movimenti) {
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
    if (Array.isArray(content.movimentivend) && content.movimentivend.length > 0) {
      console.log(`[${getItalianDateString()}] Processando ${content.movimentivend.length} movimenti vendita Signa...`);
      let salvati = 0, saltati = 0, errori = 0;

      await Promise.allSettled(
        content.movimentivend.map((movimento: any) =>
          limit(async () => {
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
                return; // Salta il resto della funzione
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
                  return;
                }
                await updateCustomerOrders(movimento, "signa", idCustomer, restaurant_code);
              } catch (updateError) {
                console.error(`[${getItalianDateString()}] Errore nell'aggiornamento CustomerOrders per movimento Signa ${movimento.IDMovimentoPOS}: ${updateError}`);
              }
            } catch (error) {
              errori++;
              console.error(`[${getItalianDateString()}] Errore nel processare movimento vendita Signa con IDMovimentoPOS ${movimento.IDMovimentoPOS}: ${error}`);
            }
          })
        )
      );
      console.log(`[${getItalianDateString()}] Completato processamento movimenti vendita Signa: ${salvati} salvati, ${saltati} saltati, ${errori} errori`);
    }

    if (Array.isArray(content.TicketList) && content.TicketList.length > 0) {
      console.log(`[${getItalianDateString()}] Processando ${content.TicketList.length} ticket DylogApp...`);
      let salvati = 0, saltati = 0, errori = 0, erroriUpdate = 0;

      await Promise.allSettled(
        content.TicketList.map((ticket: any) =>
          limit(async () => {
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
                return;
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
          })
        )
      );
      console.log(`[${getItalianDateString()}] Completato processamento ticket DylogApp: ${salvati} salvati, ${saltati} saltati, ${errori} errori, ${erroriUpdate} errori di aggiornamento`);
    }

    if (Array.isArray(content.customerList) && content.customerList.length > 0) {
      console.log(`[${getItalianDateString()}] Processando ${content.customerList.length} clienti...`);
      
      // Log dettagliato della struttura dei clienti per analisi
      console.log(`[${getItalianDateString()}] STRUTTURA CUSTOMER PAYLOAD:`);
      if (content.customerList.length > 0) {
        const sampleCustomer = content.customerList[0];
        // Log dell'intero oggetto customer per vedere tutti i campi
        console.log(`[${getItalianDateString()}] CUSTOMER COMPLETO:`);
        console.log(JSON.stringify(sampleCustomer, null, 2));
      }
      let aggiornati = 0, creati = 0, errori = 0;

      await Promise.allSettled(
        content.customerList.map((customer: any) =>
          limit(async () => {
            try {
              // Se esiste idCustomerExt, lo usiamo al posto di idCustomer
              const effectiveCustomerId = customer.idCustomerExt || customer.idCustomer;
              
              if (!effectiveCustomerId) {
                console.warn(`[${getItalianDateString()}] Cliente senza idCustomer/idCustomerExt, skip.`);
                return;
              }

              // Cerca il cliente per idCustomerExt (se presente) o idCustomer
              const existing = await prisma.customer.findFirst({
                where: {
                  OR: [
                    { idCustomer: effectiveCustomerId },
                    ...(customer.idCustomerExt ? [{ idCustomer: customer.idCustomerExt }] : [])
                  ].filter(Boolean) as any[],
                },
              });
              
              // Log per tracciare quale ID stiamo usando
              console.log(`[${getItalianDateString()}] Processo cliente - ID: ${effectiveCustomerId}${customer.idCustomerExt ? ' (da idCustomerExt)' : ''}${existing ? ' - TROVATO' : ' - NUOVO'}`);

              if (existing) {
                // Aggiorna il cliente esistente invece di eliminarlo e ricrearlo
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
                  updateAt: new Date(), // Assicura che il timestamp di aggiornamento sia corretto
                };
                
                // Log dei dati filtrati usati per l'update
                console.log(`[${getItalianDateString()}] DATI FILTRATI PER UPDATE CUSTOMER ${customer.idCustomer}:`);
                console.log(JSON.stringify(filteredCustomerData, null, 2));
                
                await prisma.customer.update({
                  where: { id: existing.id },
                  data: filteredCustomerData,
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
                  data: filteredCustomerData,
                });
                console.log(`[${getItalianDateString()}] Nuovo cliente con idCustomer ${customer.idCustomer} creato con successo.`);
                creati++;
              }
            } catch (error) {
              // Log dell'errore ma non interrompe il processo per gli altri clienti
              console.error(`[${getItalianDateString()}] Errore nell'aggiornamento/creazione del cliente ${customer?.idCustomer || 'sconosciuto'}: ${error}`);
              errori++;
            }
          })
        )
      );
      console.log(`[${getItalianDateString()}] Completato processamento clienti: ${aggiornati} aggiornati, ${creati} creati, ${errori} errori`);
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
