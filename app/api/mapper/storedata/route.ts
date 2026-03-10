import { NextRequest, NextResponse } from "next/server";
import { Buffer } from "buffer";
import prisma from "@/app/lib/prisma";
import moment from "moment-timezone";
import pLimit from "p-limit";

const MAX_MB = 32; // da ridurre da 32MB a 16MB
const CONCURRENCY = 5; 

function getItalianDate(): Date {
  return moment().tz("Europe/Rome").toDate();
}

function getItalianDateString(): string {
  return moment().tz("Europe/Rome").format("YYYY-MM-DD HH:mm:ss");
}

function parseSignaDate(data: string, ora: string): Date {
  try {
    const dataPart = data.split(' ')[0];
    return new Date(moment(`${dataPart} ${ora}`, "DD/MM/YYYY HH:mm:ss").toISOString());
  } catch {
    return new Date();
  }
}

function normalizeEmail(email?: string | null): string {
  if (!email) return "";
  return email.trim().toLowerCase();
}

function normalizePhone(phone?: string | null): string {
  if (!phone) return "";
  return phone.replace(/\D+/g, "");
}

function computeContactKey(email?: string | null, phone?: string | null): {
  contactKey: string;
  normalizedEmail: string;
  normalizedPhone: string;
} {
  const normalizedEmail = normalizeEmail(email);
  if (normalizedEmail) {
    return {
      contactKey: `email:${normalizedEmail}`,
      normalizedEmail,
      normalizedPhone: "",
    };
  }

  const normalizedPhone = normalizePhone(phone);
  if (normalizedPhone) {
    return {
      contactKey: `phone:${normalizedPhone}`,
      normalizedEmail: "",
      normalizedPhone,
    };
  }

  return {
    contactKey: "",
    normalizedEmail: "",
    normalizedPhone: "",
  };
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

function notifyExternalBill(data: any, restaurant_code: string, subscriber_code: string): void {
  const enabled = process.env.NOTIFY_BILL_ENABLED === 'true';
  const url = process.env.NOTIFY_BILL_URL;
  const apiKey = process.env.NOTIFY_BILL_API_KEY;

  if (!enabled) {
    console.log(`[${getItalianDateString()}] NOTIFY_BILL_ENABLED=false, skip notifica`);
    return;
  }

  if (!url || !apiKey) {
    console.log(`[${getItalianDateString()}] NOTIFY_BILL_URL o NOTIFY_BILL_API_KEY non configurati, skip notifica`);
    return;
  }

  const payload = {
    data: data,
    merchant: restaurant_code,
    subscriber: subscriber_code
  };

  fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(10000),
  })
    .then(response => {
      if (!response.ok) {
        console.error(`[${getItalianDateString()}] Notifica bill fallita: ${response.status} ${response.statusText}`);
      } else {
        console.log(`[${getItalianDateString()}] Notifica bill inviata con successo a ${url}`);
      }
    })
    .catch(error => {
      console.error(`[${getItalianDateString()}] Errore notifica bill (non bloccante):`, error instanceof Error ? error.message : error);
    });
}

export async function POST(request: NextRequest) {
  const start = Date.now();
  const limit = pLimit(CONCURRENCY);

  try {
    const searchParams = request.nextUrl.searchParams;
    const body = await parseLargeJSON(request);
    const restaurant_code = searchParams.get("restaurant_code") ?? "";
    const subscriber_code = searchParams.get("subscriber_code") ?? "";

  
    const clientIP = request.headers.get('x-forwarded-for')?.split(',')[0] || 'unknown';
    console.log(`[${getItalianDateString()}] Request from ${clientIP} - Payload: customers=${body.customerList?.length || 0}, movements=${body.movimenti?.length || 0}, sales=${body.movimentivend?.length || 0}, tickets=${body.ticketList?.length || 0}`);

    // Notifica server esterno (asincrono, non bloccante)
    notifyExternalBill(body, restaurant_code, subscriber_code);

  
    const response = NextResponse.json({ 
      status: "success", 
      message: "Richiesta ricevuta e in processamento",
      timestamp: getItalianDateString(),
      received: {
        customers: body.customerList?.length || 0,
        movements: body.movimenti?.length || 0, 
        sales: body.movimentivend?.length || 0,
        tickets: body.ticketList?.length || 0
      }
    }, { status: 201 });

  
    processDataInBackground(body, restaurant_code, subscriber_code, clientIP, start, limit);

    return response;
  } catch (error) {
    console.error("Errore POST:", error);
    
    // Anche in caso di errore, restituisce sempre successo
    return NextResponse.json({ 
      status: "success", 
      message: "Richiesta ricevuta",
      timestamp: getItalianDateString(),
      note: "Errore registrato per analisi"
    }, { status: 201 });
  }
}

// Funzione per processare i dati in background
async function processDataInBackground(
  body: any, 
  restaurant_code: string, 
  subscriber_code: string, 
  clientIP: string, 
  start: number,
  limit: any
) {
  try {
    console.log(`[${getItalianDateString()}] Inizio processamento background...`);
    
    // Inizializza stats object
    const stats: any = {};

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

          const movimentoCustomer = movimento.customer || {};
          const rawMovEmail = typeof movimentoCustomer.email === "string" ? movimentoCustomer.email.trim() : "";
          const movimentoPhoneCandidates = [
            movimentoCustomer.mobile,
            movimentoCustomer.phone,
            movimentoCustomer.telefono,
            movimentoCustomer.cellphone,
          ];
          const rawMovPhone = movimentoPhoneCandidates.find((value) => typeof value === "string" && value.trim().length > 0) || "";
          const { contactKey: movimentoContactKey } = computeContactKey(rawMovEmail, rawMovPhone);

          const movimentoCustomerId = movimentoCustomer.idCustomerExt || "";

          // Mappa CustomerOrdersFlat se ci sono dettagli e almeno un identificativo (idCustomerExt o contact_key)
          if ((movimentoCustomerId || movimentoContactKey) && Array.isArray(movimento.dettagli)) {
            for (const dettaglio of movimento.dettagli) {
              try {
                const orderDate = parseSignaDate(movimento.MovimentoData || "", movimento.MovimentoOra || "");
                const quantity = parseFloat(dettaglio.Quantita?.toString() || "0") || 0;
                const unitPrice = parseFloat(dettaglio.Valore?.toString() || "0") || 0;

                await prisma.customerOrdersFlat.upsert({
                  where: {
                    detail_id: `${restaurant_code}_${movimento.IDReferencePOS}_${dettaglio.Riga}`
                  },
                  update: {
                    idCustomer: movimentoCustomerId,
                    contact_key: movimentoContactKey,
                    order_date: orderDate,
                    order_time: movimento.MovimentoOra || "",
                    order_year: movimento.MovimentoAnno || new Date().getFullYear(),
                    movement_type: dettaglio.CodTipoMovimento || "",
                    is_return: dettaglio.CodTipoMovimento === "RC",
                    product_code: dettaglio.CodArticolo || "",
                    product_name: dettaglio.Article_Description_Short || "",
                    category: dettaglio.Famiglia || "",
                    subcategory: dettaglio.SottoFamiglia || "",
                    brand: dettaglio.Marchio || "",
                    season: dettaglio.CodStagione || "",
                    color: dettaglio.Colore || "",
                    size: dettaglio.Taglia || "",
                    quantity,
                    unit_price: unitPrice,
                    total_amount: quantity * unitPrice,
                    updated_at: new Date()
                  },
                  create: {
                    detail_id: `${restaurant_code}_${movimento.IDReferencePOS}_${dettaglio.Riga}`,
                    idCustomer: movimentoCustomerId,
                    contact_key: movimentoContactKey,
                    order_id: movimento.IDReferencePOS?.toString() || "",
                    public_code: restaurant_code,
                    source: "retail",
                    order_date: orderDate,
                    order_time: movimento.MovimentoOra || "",
                    order_year: movimento.MovimentoAnno || new Date().getFullYear(),
                    movement_type: dettaglio.CodTipoMovimento || "",
                    is_return: dettaglio.CodTipoMovimento === "RC",
                    product_code: dettaglio.CodArticolo || "",
                    product_name: dettaglio.Article_Description_Short || "",
                    category: dettaglio.Famiglia || "",
                    subcategory: dettaglio.SottoFamiglia || "",
                    brand: dettaglio.Marchio || "",
                    season: dettaglio.CodStagione || "",
                    color: dettaglio.Colore || "",
                    size: dettaglio.Taglia || "",
                    quantity,
                    unit_price: unitPrice,
                    total_amount: quantity * unitPrice,
                    created_at: new Date(),
                    updated_at: new Date()
                  }
                });
              } catch (flatError) {
                console.error(`[${getItalianDateString()}] Errore salvando CustomerOrdersFlat per dettaglio ${dettaglio.Riga}: ${flatError}`);
              }
            }
          }
        } catch (error) {
          console.error(`[${getItalianDateString()}] Errore nel salvare movimento Signa con IDReferencePOS ${movimento.IDReferencePOS}: ${error}`);
          errori++;
        }
      }
      console.log(`[${getItalianDateString()}] Completato processamento movimenti Signa: ${salvati} salvati, ${saltati} saltati, ${errori} errori`);
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

              const rawTicketEmailCandidates = [
                typeof orderWebInfo?.Email === "string" ? orderWebInfo.Email.trim() : "",
                typeof ticket.Email === "string" ? ticket.Email.trim() : "",
              ].filter(Boolean);
              const rawTicketEmail = rawTicketEmailCandidates.length > 0 ? rawTicketEmailCandidates[0] : "";

              const ticketPhoneCandidates = [
                orderWebInfo?.Telefono,
                orderWebInfo?.Phone,
                orderWebInfo?.Mobile,
                orderWebInfo?.Cellulare,
                ticket.Mobile,
                ticket.Phone,
              ];
              const rawTicketPhone = ticketPhoneCandidates.find((value) => typeof value === "string" && value.trim().length > 0) || "";
              const {
                contactKey: ticketContactKey,
              } = computeContactKey(rawTicketEmail, rawTicketPhone);

              const orderCustomerId = orderWebInfo?.IDCustomer || "";

              if (!orderWebInfo || (!orderCustomerId && !ticketContactKey)) {
                console.warn(`[${getItalianDateString()}] Ticket DylogApp senza identificativi cliente utili, skip.`);
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

              const canMapCustomer = Boolean(orderCustomerId || ticketContactKey);

              // Mappa CustomerOrdersFlat per ogni item in DetailList
              if (canMapCustomer && Array.isArray(ticket.DetailList)) {
                for (let index = 0; index < ticket.DetailList.length; index++) {
                  const detail = ticket.DetailList[index];
                  
                  try {
                    const orderDate = new Date(ticket.DateBill);
                    const quantity = parseFloat(detail.Qta?.toString() || "0") || 0;
                    const unitPrice = parseFloat(detail.Price?.toString() || "0") || 0;

                    await prisma.customerOrdersFlat.upsert({
                      where: {
                        detail_id: `${restaurant_code}_${ticket.IDTickets}_${detail.BillRow || (index + 1)}`
                      },
                      update: {
                        idCustomer: orderCustomerId,
                        contact_key: ticketContactKey,
                        order_date: orderDate,
                        order_time: moment(ticket.DateBill).format("HH:mm:ss"),
                        order_year: orderDate.getFullYear(),
                        movement_type: ticket.DocTipo || "",
                        is_return: false,
                        product_code: detail.Code || "",
                        product_name: detail.Name || "",
                        category: detail.GroupDescription || "",
                        subcategory: "",
                        brand: "",
                        season: "",
                        color: "",
                        size: "",
                        quantity,
                        unit_price: unitPrice,
                        total_amount: quantity * unitPrice,
                        updated_at: new Date()
                      },
                      create: {
                        detail_id: `${restaurant_code}_${ticket.IDTickets}_${detail.BillRow || (index + 1)}`,
                        idCustomer: orderCustomerId,
                        contact_key: ticketContactKey,
                        order_id: ticket.IDTickets?.toString() || "",
                        public_code: restaurant_code,
                        source: "restaurant",
                        order_date: orderDate,
                        order_time: moment(ticket.DateBill).format("HH:mm:ss"),
                        order_year: orderDate.getFullYear(),
                        movement_type: ticket.DocTipo || "",
                        is_return: false,
                        product_code: detail.Code || "",
                        product_name: detail.Name || "",
                        category: detail.GroupDescription || "",
                        subcategory: "",
                        brand: "",
                        season: "",
                        color: "",
                        size: "",
                        quantity,
                        unit_price: unitPrice,
                        total_amount: quantity * unitPrice,
                        created_at: new Date(),
                        updated_at: new Date()
                      }
                    });
                  } catch (flatError) {
                    console.error(`[${getItalianDateString()}] Errore salvando CustomerOrdersFlat per ticket item ${detail.BillRow || index}: ${flatError}`);
                    erroriUpdate++;
                  }
                }
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

              const rawEmail = typeof customer.email === "string" ? customer.email.trim() : "";
              const phoneCandidates = [customer.mobile, customer.phone, customer.telephone, customer.cellphone];
              const rawPhone = phoneCandidates.find((value) => typeof value === "string" && value.trim().length > 0) || "";
              const { contactKey, normalizedEmail } = computeContactKey(rawEmail, rawPhone);
              
              let existing = null;
              let effectiveCustomerId = "";
              
              if (arrivedFrom === "app") {
                // LOGICA APP: usa idCustomerExt o idCustomer
                effectiveCustomerId = customer.idCustomerExt || customer.idCustomer;
                
                if (!effectiveCustomerId) {
                  console.warn(`[${getItalianDateString()}] Cliente App senza idCustomer/idCustomerExt, skip.`);
                  continue;
                }

                const searchOr: any[] = [{ idCustomer: effectiveCustomerId }];
                if (contactKey) {
                  searchOr.push({ contact_key: contactKey });
                }
                const emailVariants = Array.from(new Set([customer.email, normalizedEmail].filter(Boolean)));
                for (const emailVariant of emailVariants) {
                  searchOr.push({ email: emailVariant });
                }

                const whereClause: any = { restaurant_code };
                if (searchOr.length > 0) {
                  whereClause.OR = searchOr;
                }

                existing = await prisma.customer.findFirst({ where: whereClause });
              } else {
                // LOGICA NON-APP
                if (customer.idCustomerExt) {
                  // Ha idCustomerExt → salvalo in idCustomer
                  effectiveCustomerId = customer.idCustomerExt;

                  const searchOr: any[] = [{ idCustomer: effectiveCustomerId }];
                  if (contactKey) {
                    searchOr.push({ contact_key: contactKey });
                  }
                  const emailVariants = Array.from(new Set([customer.email, normalizedEmail].filter(Boolean)));
                  for (const emailVariant of emailVariants) {
                    searchOr.push({ email: emailVariant });
                  }

                  const whereClause: any = { restaurant_code };
                  if (searchOr.length > 0) {
                    whereClause.OR = searchOr;
                  }

                  existing = await prisma.customer.findFirst({ where: whereClause });
                } else {
                  // NON ha idCustomerExt → preserva idCustomer esistente o lascia vuoto per nuovi clienti
                  effectiveCustomerId = "";

                  const searchOr: any[] = [];
                  if (contactKey) {
                    searchOr.push({ contact_key: contactKey });
                  }
                  const emailVariants = Array.from(new Set([customer.email, normalizedEmail].filter(Boolean)));
                  for (const emailVariant of emailVariants) {
                    searchOr.push({ email: emailVariant });
                  }

                  if (searchOr.length > 0) {
                    const whereClause: any = { restaurant_code, OR: searchOr };
                    existing = await prisma.customer.findFirst({ where: whereClause });
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
                  idCustomer: effectiveCustomerId || existing.idCustomer || "",
                  contact_key: contactKey || existing.contact_key || "",
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
                  mobile: rawPhone || existing.mobile || "",
                  email: rawEmail || existing.email || "",
                  publicCode: customer.publicCode || existing.publicCode || "",
                  subscriber: customer.subscriber || existing.subscriber || "",
                  arrived_from: customer.arrived_from || existing.arrived_from || "",
                  fidelity_card_number: customer.fidelity_card_number || existing.fidelity_card_number || "",
                  consent_marketing: customer.consent_marketing || existing.consent_marketing || "",
                  consent_third_parties_marketing: customer.consent_third_parties_marketing || existing.consent_third_parties_marketing || "",
                  dateCreation: existing.dateCreation || "", // PRESERVA SEMPRE la data di creazione originale
                  dateLastUpdate: incomingLastUpdate || existing.dateLastUpdate || "", // Preserva se vuoto
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
                    idCustomer: effectiveCustomerId || existing.idCustomer || "", // Preserva idCustomer esistente se non viene fornito uno nuovo
                    contact_key: contactKey || existing.contact_key || "",
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
                  contact_key: contactKey,
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
                  mobile: rawPhone || "",
                  email: rawEmail || "",
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
                    contact_key: contactKey,
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
    console.log(`[${getItalianDateString()}] Completato processamento background in ${duration}s: ${JSON.stringify(stats)}`);
  } catch (error) {
    console.error("Errore nel processamento background:", error);
    
    // Salva l'errore nel database per analisi successiva
    try {
      await prisma.requestLog.create({
        data: {
          method: "POST",
          url: "/api/mapper/storedata",
          status: 500,
          error: error instanceof Error ? error.message : "Errore generico",
          headers: {
            restaurant_code: restaurant_code,
            subscriber_code: subscriber_code,
            clientIP: clientIP
          }
        }
      });
    } catch (logError) {
      console.error("Errore nel salvare log:", logError);
    }
  }
}
