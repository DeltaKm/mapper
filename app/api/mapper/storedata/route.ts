import { NextRequest, NextResponse } from "next/server";
import { Buffer } from "buffer";
import prisma from "@/app/lib/prisma";
import moment from "moment-timezone";
import pLimit from "p-limit";

// ─────────────────────────────────────────────────────────────
// ENDPOINT PRINCIPALE DI INGESTION DATI
//
// Riceve payload da sistemi esterni (DylogApp, Signa) contenenti:
//   - customerList    → anagrafiche clienti
//   - movimenti       → vendite retail Signa (con dettaglio prodotti)
//   - movimentivend   → movimenti cassa Signa (pagamenti)
//   - TicketList      → scontrini/ordini ristorante DylogApp
//   - BillList        → conti aperti DylogApp (non ancora pagati, ignorati)
//
// Risponde subito con 201 e processa tutto in background
// per non tenere in attesa il chiamante.
// ─────────────────────────────────────────────────────────────

// Limite massimo dimensione payload accettato
const MAX_MB = 32; // da ridurre da 32MB a 16MB
// Numero massimo di operazioni DB in parallelo nel processamento background
const CONCURRENCY = 5; 

function getItalianDate(): Date {
  return moment().tz("Europe/Rome").toDate();
}

// Restituisce la data/ora corrente italiana formattata come stringa (per i log)
function getItalianDateString(): string {
  return moment().tz("Europe/Rome").format("YYYY-MM-DD HH:mm:ss");
}

// Converte la data e ora Signa dal formato "DD/MM/YYYY HH:mm:ss" a oggetto Date
// Signa invia la data e l'ora in campi separati (es. "25/03/2026 00:00:00" e "12:36:00")
function parseSignaDate(data: string, ora: string): Date {
  try {
    const dataPart = data.split(' ')[0];
    return new Date(moment(`${dataPart} ${ora}`, "DD/MM/YYYY HH:mm:ss").toISOString());
  } catch {
    return new Date();
  }
}

// Normalizza l'email: trim + lowercase
// Es: "  Mario.Rossi@Example.COM  " → "mario.rossi@example.com"
function normalizeEmail(email?: string | null): string {
  if (!email) return "";
  return email.trim().toLowerCase();
}

// Normalizza il telefono: rimuove tutto ciò che non è cifra
// Es: "+39 333-123 4567" → "393331234567"
function normalizePhone(phone?: string | null): string {
  if (!phone) return "";
  return phone.replace(/\D+/g, "");
}

// Calcola la contact_key univoca del cliente.
// È la chiave di collegamento tra anagrafiche, ordini retail e ticket ristorante.
//
// Priorità:
//   1. Email (se presente) → "email:mario.rossi@example.com"
//   2. Telefono (se email assente) → "phone:393331234567"
//   3. Stringa vuota (se nessun contatto disponibile)
//
// Questa chiave viene usata in CustomerOrdersFlat per collegare
// gli ordini al cliente anche in assenza di idCustomer.
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

// Legge il body della request come JSON e verifica che non superi il limite di dimensione.
// Next.js di default ha un limite di 4MB; per payload più grandi
// il limite va alzato anche in next.config.ts (bodyParser).
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

// Notifica DylogApp quando viene eseguito un merge anagrafico:
// ovvero quando due identità (una da app, una da POS) vengono ricollegate
// sullo stesso record nel DB.
// Chiama SETIDCUSTOMEREXT per comunicare al gateway che idCustomer
// è ora associato a quel idReferenceGateway (ID interno POS).
//
// URL: https://restgate1.dylog.it:9191/CustomerService.svc/JSON/SUBSCRIBERS/DylogAPP/MERCHANT/{PublicCode}/SETIDCUSTOMEREXT
// Payload: { idReferenceGateway: number, idCustomer: string }
//
// Fire-and-forget: errori loggati ma non bloccanti.
function notifyDylogSetIdCustomerExt(
  publicCode: string,
  idReferenceGateway: string | number,
  idCustomer: string
): void {
  if (!publicCode || !idReferenceGateway || !idCustomer) {
    console.warn(`[${getItalianDateString()}] SETIDCUSTOMEREXT skippato - dati mancanti (publicCode=${publicCode}, idReferenceGateway=${idReferenceGateway}, idCustomer=${idCustomer})`);
    return;
  }

  const url = `https://restgate1.dylog.it:9191/CustomerService.svc/JSON/SUBSCRIBERS/DylogAPP/MERCHANT/${publicCode}/SETIDCUSTOMEREXT`;
  const payload = {
    idReferenceGateway: typeof idReferenceGateway === "string" ? Number(idReferenceGateway) : idReferenceGateway,
    idCustomer,
  };

  console.log(`[${getItalianDateString()}] SETIDCUSTOMEREXT → ${url} payload: ${JSON.stringify(payload)}`);

  fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(10000),
  })
    .then((response) => {
      if (!response.ok) {
        console.error(`[${getItalianDateString()}] SETIDCUSTOMEREXT fallito: ${response.status} ${response.statusText}`);
      } else {
        console.log(`[${getItalianDateString()}] SETIDCUSTOMEREXT completato con successo per idCustomer=${idCustomer} publicCode=${publicCode}`);
      }
    })
    .catch((error) => {
      console.error(`[${getItalianDateString()}] SETIDCUSTOMEREXT errore (non bloccante):`, error instanceof Error ? error.message : error);
    });
}

// Notifica opzionale verso un sistema esterno quando arriva un BillList/TicketList.
// Configurabile tramite variabili d'ambiente:
//   NOTIFY_BILL_ENABLED  → "true" per abilitare
//   NOTIFY_BILL_URL      → URL del sistema esterno da notificare
//   NOTIFY_BILL_API_KEY  → API key da passare nell'header x-api-key
//
// L'invio è fire-and-forget (non bloccante): eventuali errori vengono
// solo loggati senza impattare la risposta al chiamante.
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

// ─────────────────────────────────────────────────────────────
// SISTEMA DI LOG REMOTO
//
// Invia i log a https://logservice-416914793312.europe-west1.run.app/api/logs
// - app      → publicCode del merchant (restaurant_code)
// - level    → "success" | "error" | "warning" | "info"
// - message  → descrizione dell'evento
// - metadata → dati aggiuntivi dell'evento
//
// Fire-and-forget: non bloccante.
// ─────────────────────────────────────────────────────────────
function sendLog(
  publicCode: string,
  level: "success" | "error" | "warning" | "info",
  message: string,
  metadata?: Record<string, any>,
  responsePayload?: any
): void {
  const xApiKey = process.env.LOG_SERVICE_API_KEY;
  const mergedMetadata: Record<string, any> = { ...(metadata ?? {}) };
  if (responsePayload !== undefined) {
    mergedMetadata.incomingPayload = responsePayload;
  }

  const body: Record<string, any> = {
    app: publicCode || "unknown",
    level,
    message,
    metadata: mergedMetadata,
    environment: process.env.NODE_ENV || "production",
  };

  if (responsePayload !== undefined) {
    body.responsePayload = responsePayload;
  }

  fetch("https://logservice-416914793312.europe-west1.run.app/api/logs", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(xApiKey ? { "x-api-key": xApiKey } : {}),
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(8000),
  }).catch(() => {
    // silenzioso — il log remoto non è bloccante
  });
}


//
// Flusso:
//   1. Parsing e validazione dimensione payload
//   2. Log della richiesta in ingresso
//   3. Notifica esterna non bloccante (NOTIFY_BILL)
//   4. Risposta immediata 201 al chiamante
//   5. Avvio processamento dati in background (processDataInBackground)
//
// Risponde SEMPRE 201 anche in caso di errore di parsing,
// per evitare che il sistema chiamante faccia retry aggressivi.
// ─────────────────────────────────────────────────────────────


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

    processDataInBackground(body, restaurant_code, subscriber_code, clientIP, start, limit, JSON.parse(JSON.stringify(body)));

    return response;
  } catch (error) {
    console.error("Errore POST:", error);
    
    return NextResponse.json({ 
      status: "success", 
      message: "Richiesta ricevuta",
      timestamp: getItalianDateString(),
      note: "Errore registrato per analisi"
    }, { status: 201 });
  }
}

// ─────────────────────────────────────────────────────────────
// PROCESSAMENTO BACKGROUND
//
// Viene lanciato in modo asincrono DOPO aver risposto al chiamante.
// Gestisce 3 tipi di dati in sequenza:
//   1. movimenti Signa  → SignaMovimenti + CustomerOrdersFlat (source: "retail")
//   2. TicketList       → ticketListBaccoDylogAPP + CustomerOrdersFlat (source: "restaurant")
//   3. customerList     → Customer (create o update)
//
// Il parametro `limit` (pLimit) controlla la concorrenza sulle operazioni DB
// per evitare di saturare il pool di connessioni MongoDB.
// ─────────────────────────────────────────────────────────────

async function processDataInBackground(
  body: any, 
  restaurant_code: string, 
  subscriber_code: string, 
  clientIP: string, 
  start: number,
  limit: any,
  incomingPayload?: any
) {
  try {
    console.log(`[${getItalianDateString()}] Inizio processamento background...`);
    
    const stats: any = {};

    if (Array.isArray(body.movimenti) && body.movimenti.length > 0) {
      console.log(`[${getItalianDateString()}] Processando ${body.movimenti.length} movimenti Signa per SignaMovimenti...`);
      sendLog(restaurant_code, "info", `📦 MOVIMENTI SIGNA IN ARRIVO: ${body.movimenti.length} movimenti`, { count: body.movimenti.length, restaurant_code }, incomingPayload);
      let salvati = 0, saltati = 0, errori = 0;
      
      for (const movimento of body.movimenti) {
        try {
          console.log(`[${getItalianDateString()}] [SIGNA] ── Processo movimento IDReferencePOS=${movimento.IDReferencePOS} restaurant_code=${restaurant_code}`);

          // Controlla duplicati usando IDReferencePOS + restaurant_code come chiave univoca
          // Se il movimento esiste già per questo negozio, lo salta per evitare duplicati
          const existingMovimento = await prisma.signaMovimenti.findFirst({
            where: {
              IDReferencePOS: movimento.IDReferencePOS?.toString() || "",
              restaurant_code: restaurant_code,
            }
          });
          
          if (existingMovimento) {
            console.log(`[${getItalianDateString()}] [SIGNA] SKIP duplicato: IDReferencePOS=${movimento.IDReferencePOS} già presente (id=${existingMovimento.id}).`);
            sendLog(restaurant_code, "warning", `⚠️ SIGNA SKIP duplicato: IDReferencePOS=${movimento.IDReferencePOS}`, { IDReferencePOS: movimento.IDReferencePOS, existingId: existingMovimento.id }, incomingPayload);
            saltati++;
            continue;
          }
          
          // Cerca il Customer corrispondente tramite idCustomerProduct == customer.idCustomer
          // (idCustomer in Signa è l'ID interno del POS, equivalente a idCustomerProduct nel gateway)
          // REGOLA: se idCustomer è assente o il Customer non esiste nel DB → skip completo
          // Non salviamo mai un movimento senza reference_customer risolto.
          const signaIdCustomer = movimento.customer?.idCustomer?.toString().trim() || "";
          console.log(`[${getItalianDateString()}] [SIGNA] customer.idCustomer="${signaIdCustomer}" idCustomerExt="${movimento.customer?.idCustomerExt ?? "null"}" email="${movimento.customer?.email ?? ""}" mobile="${movimento.customer?.mobile ?? ""}"`);

          if (!signaIdCustomer) {
            console.log(`[${getItalianDateString()}] [SIGNA] SKIP IDReferencePOS=${movimento.IDReferencePOS}: idCustomer assente nel payload → movimento ignorato.`);
            sendLog(restaurant_code, "warning", `⚠️ SIGNA SKIP IDReferencePOS=${movimento.IDReferencePOS}: idCustomer assente`, { IDReferencePOS: movimento.IDReferencePOS }, incomingPayload);
            saltati++;
            continue;
          }

          const matchedCustomer = await prisma.customer.findFirst({
            where: {
              idCustomerProduct: signaIdCustomer,
              restaurant_code: restaurant_code,
            },
            select: { id: true, idCustomerProduct: true },
          });

          // Fallback: se non trovato per idCustomerProduct, prova con idCustomerExt
          // cercando il Customer per idCustomer (ID gateway/app)
          let resolvedCustomer = matchedCustomer;
          let resolvedMatchType = "idCustomerProduct";

          if (!resolvedCustomer) {
            const signaIdCustomerExt = movimento.customer?.idCustomerExt?.toString().trim() || "";
            if (signaIdCustomerExt) {
              console.log(`[${getItalianDateString()}] [SIGNA] Fallback: cerco per idCustomer="${signaIdCustomerExt}" (da idCustomerExt nel movimento)`);
              resolvedCustomer = await prisma.customer.findFirst({
                where: {
                  idCustomer: signaIdCustomerExt,
                  restaurant_code: restaurant_code,
                },
                select: { id: true, idCustomerProduct: true },
              });
              if (resolvedCustomer) {
                resolvedMatchType = `idCustomerExt→idCustomer="${signaIdCustomerExt}"`;
                console.log(`[${getItalianDateString()}] [SIGNA] Fallback OK: Customer trovato per idCustomer="${signaIdCustomerExt}" id=${resolvedCustomer.id}`);

                // Se il customer trovato non ha ancora idCustomerProduct, lo aggiorniamo
                // con il valore idCustomer del movimento Signa (= ID interno POS)
                if (!resolvedCustomer.idCustomerProduct?.trim() && signaIdCustomer) {
                  await prisma.customer.update({
                    where: { id: resolvedCustomer.id },
                    data: { idCustomerProduct: signaIdCustomer, updateAt: new Date() },
                  });
                  console.log(`[${getItalianDateString()}] [SIGNA] Aggiornato idCustomerProduct="${signaIdCustomer}" su Customer id=${resolvedCustomer.id}`);
                  sendLog(restaurant_code, "info", `🔗 SIGNA Customer aggiornato con idCustomerProduct="${signaIdCustomer}" (trovato via idCustomerExt="${signaIdCustomerExt}")`, { customerId: resolvedCustomer.id, idCustomerProduct: signaIdCustomer, idCustomerExt: signaIdCustomerExt }, incomingPayload);
                }
              }
            }
          }

          if (!resolvedCustomer) {
            console.log(`[${getItalianDateString()}] [SIGNA] SKIP IDReferencePOS=${movimento.IDReferencePOS}: nessun Customer trovato per idCustomerProduct="${signaIdCustomer}" né per idCustomerExt="${movimento.customer?.idCustomerExt ?? ""}" restaurant_code="${restaurant_code}" → movimento ignorato.`);
            sendLog(restaurant_code, "warning", `⚠️ SIGNA SKIP IDReferencePOS=${movimento.IDReferencePOS}: nessun Customer per idCustomerProduct="${signaIdCustomer}" né idCustomerExt="${movimento.customer?.idCustomerExt ?? ""}"`, { IDReferencePOS: movimento.IDReferencePOS, idCustomerProduct: signaIdCustomer, idCustomerExt: movimento.customer?.idCustomerExt ?? "" }, incomingPayload);
            saltati++;
            continue;
          }

          const referenceCustomerId = resolvedCustomer.id;
          console.log(`[${getItalianDateString()}] [SIGNA] Customer trovato: id=${referenceCustomerId} (match via ${resolvedMatchType}).`);

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
              reference_customer: referenceCustomerId,
              createdAt: new Date(),
              updateAt: new Date(),
            },
          });
          salvati++;
          console.log(`[${getItalianDateString()}] [SIGNA] SignaMovimenti salvato: IDReferencePOS=${movimento.IDReferencePOS}.`);
          sendLog(restaurant_code, "success", `✅ SIGNA vendita salvata: IDReferencePOS=${movimento.IDReferencePOS} customer=${signaIdCustomer}`, { IDReferencePOS: movimento.IDReferencePOS, idCustomerProduct: signaIdCustomer, referenceCustomerId, dettagli: Array.isArray(movimento.dettagli) ? movimento.dettagli.length : 0 }, incomingPayload);

          // Estrae i dati cliente annidati nel movimento (campo "customer")
          // per ricavare la contact_key e collegare i dettagli a CustomerOrdersFlat
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

          // ID cliente per CustomerOrdersFlat:
          // 1. idCustomerExt se presente (ID DylogApp)
          // 2. altrimenti referenceCustomerId (id MongoDB trovato tramite idCustomerProduct)
          const movimentoCustomerId = movimentoCustomer.idCustomerExt?.toString().trim() || referenceCustomerId;

          console.log(`[${getItalianDateString()}] [SIGNA] CustomerOrdersFlat check: movimentoCustomerId="${movimentoCustomerId}" movimentoContactKey="${movimentoContactKey}" dettagli=${Array.isArray(movimento.dettagli) ? movimento.dettagli.length : "non-array"}`);

          // Salva una riga in CustomerOrdersFlat per ogni dettaglio del movimento
          // solo se abbiamo almeno un identificativo cliente (ID o contact_key)
          // Questa tabella è la fonte dati per i filtri prodotti in mktselettivo
          if ((movimentoCustomerId || movimentoContactKey) && Array.isArray(movimento.dettagli)) {
            for (const dettaglio of movimento.dettagli) {
              try {
                const detail_id = `${restaurant_code}_${movimento.IDReferencePOS}_${dettaglio.Riga}`;
                const orderDate = parseSignaDate(movimento.MovimentoData || "", movimento.MovimentoOra || "");
                const quantity = parseFloat(dettaglio.Quantita?.toString() || "0") || 0;
                const unitPrice = parseFloat(dettaglio.Valore?.toString() || "0") || 0;
                console.log(`[${getItalianDateString()}] [SIGNA] Upsert CustomerOrdersFlat detail_id="${detail_id}" quantity=${quantity} unitPrice=${unitPrice}`);

                await prisma.customerOrdersFlat.upsert({
                  where: {
                    detail_id,
                  },
                  update: {
                    idCustomer: movimentoCustomerId,
                    contact_key: movimentoContactKey,
                    reference_customer: referenceCustomerId,
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
                    detail_id,
                    idCustomer: movimentoCustomerId,
                    contact_key: movimentoContactKey,
                    reference_customer: referenceCustomerId,
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
                console.log(`[${getItalianDateString()}] [SIGNA] CustomerOrdersFlat OK: detail_id="${detail_id}"`);
              } catch (flatError) {
                console.error(`[${getItalianDateString()}] [SIGNA] ERRORE CustomerOrdersFlat detail_id="${restaurant_code}_${movimento.IDReferencePOS}_${dettaglio.Riga}": ${flatError}`);
              }
            }
          } else {
            console.log(`[${getItalianDateString()}] [SIGNA] CustomerOrdersFlat SALTATO per IDReferencePOS=${movimento.IDReferencePOS}: movimentoCustomerId="${movimentoCustomerId}" movimentoContactKey="${movimentoContactKey}" dettagliIsArray=${Array.isArray(movimento.dettagli)}`);
          }
        } catch (error) {
          console.error(`[${getItalianDateString()}] [SIGNA] ERRORE GENERALE movimento IDReferencePOS=${movimento.IDReferencePOS}: ${error}`);
          sendLog(restaurant_code, "error", `❌ SIGNA ERRORE movimento IDReferencePOS=${movimento.IDReferencePOS}: ${error instanceof Error ? error.message : error}`, { IDReferencePOS: movimento.IDReferencePOS }, incomingPayload);
          errori++;
        }
      }
      console.log(`[${getItalianDateString()}] Completato processamento movimenti Signa: ${salvati} salvati, ${saltati} saltati, ${errori} errori`);
      sendLog(restaurant_code, "info", `📊 SIGNA completato: ${salvati} salvati, ${saltati} saltati, ${errori} errori`, { salvati, saltati, errori }, incomingPayload);
    }

    if (Array.isArray(body.TicketList) && body.TicketList.length > 0) {
      console.log(`[${getItalianDateString()}] Processando ${body.TicketList.length} ticket DylogApp...`);
      sendLog(restaurant_code, "info", `🎫 TICKET DYLOGAPP IN ARRIVO: ${body.TicketList.length} ticket`, { count: body.TicketList.length, restaurant_code }, incomingPayload);
      let salvati = 0, saltati = 0, errori = 0, erroriUpdate = 0;

      for (const ticket of body.TicketList) {
            try {
              // Cerca OrderWebInfo nella prima riga del DetailList che lo contiene.
              // OrderWebInfo è presente solo per ordini arrivati dall'app/web (asporto/delivery).
              // Per ordini al tavolo normali non esiste e il ticket viene saltato.
              let orderWebInfo = null;
              if (Array.isArray(ticket.DetailList)) {
                for (const detail of ticket.DetailList) {
                  if (detail.OrderWebInfo) {
                    orderWebInfo = detail.OrderWebInfo;
                    break;
                  }
                }
              }

              // Estrae l'email preferendo quella in OrderWebInfo (più affidabile, viene dall'app)
              // rispetto a quella nel root del ticket (può essere vuota o meno aggiornata)
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

              // Cerca il Customer nel DB per valorizzare reference_customer in CustomerOrdersFlat
              // REGOLA: se OrderWebInfo è assente, IDCustomer è assente, o il Customer
              // non esiste nel DB → skip completo. Non salviamo mai un ticket senza
              // reference_customer risolto (stesso gate duro applicato a Signa).
              if (!orderWebInfo) {
                console.log(`[${getItalianDateString()}] [BACCO] SKIP IDTickets=${ticket.IDTickets}: OrderWebInfo assente → ticket ignorato.`);
                sendLog(restaurant_code, "warning", `⚠️ BACCO SKIP IDTickets=${ticket.IDTickets}: OrderWebInfo assente`, { IDTickets: ticket.IDTickets }, incomingPayload);
                saltati++;
                continue;
              }

              if (!orderCustomerId) {
                console.log(`[${getItalianDateString()}] [BACCO] SKIP IDTickets=${ticket.IDTickets}: IDCustomer assente in OrderWebInfo → ticket ignorato.`);
                sendLog(restaurant_code, "warning", `⚠️ BACCO SKIP IDTickets=${ticket.IDTickets}: IDCustomer assente in OrderWebInfo`, { IDTickets: ticket.IDTickets }, ticket);
                saltati++;
                continue;
              }

              // Match su idCustomer == orderCustomerId e restaurant_code
              const matchedTicketCustomer = await prisma.customer.findFirst({
                where: { idCustomer: orderCustomerId, restaurant_code },
                select: { id: true },
              });

              if (!matchedTicketCustomer) {
                console.log(`[${getItalianDateString()}] [BACCO] SKIP IDTickets=${ticket.IDTickets}: nessun Customer trovato per idCustomer="${orderCustomerId}" restaurant_code="${restaurant_code}" → ticket ignorato.`);
                sendLog(restaurant_code, "warning", `⚠️ BACCO SKIP IDTickets=${ticket.IDTickets}: nessun Customer per idCustomer="${orderCustomerId}"`, { IDTickets: ticket.IDTickets, idCustomer: orderCustomerId }, incomingPayload);
                saltati++;
                continue;
              }

              const ticketReferenceCustomerId = matchedTicketCustomer.id;
              console.log(`[${getItalianDateString()}] [BACCO] Customer trovato: id=${ticketReferenceCustomerId} (idCustomer=${orderCustomerId}).`);

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
                sendLog(restaurant_code, "success", `✅ BACCO ticket salvato: IDTickets=${orderWebInfo.IDTickets} customer=${orderCustomerId}`, { IDTickets: orderWebInfo.IDTickets, idCustomer: orderCustomerId, referenceCustomerId: ticketReferenceCustomerId, items: ticket.DetailList?.length || 0 }, incomingPayload);
                salvati++;
              } catch (error) {
              
                console.error(`[${getItalianDateString()}] Errore nel salvare il ticket DylogApp con IDTickets ${orderWebInfo.IDTickets}: ${error}`);
                sendLog(restaurant_code, "error", `❌ BACCO ERRORE salvataggio IDTickets=${orderWebInfo.IDTickets}: ${error instanceof Error ? error.message : error}`, { IDTickets: orderWebInfo.IDTickets }, incomingPayload);
                errori++;
              }

              const canMapCustomer = Boolean(orderCustomerId || ticketContactKey);

            
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
                        reference_customer: ticketReferenceCustomerId,
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
                        reference_customer: ticketReferenceCustomerId,
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
              sendLog(restaurant_code, "error", `❌ BACCO ERRORE GENERALE ticket IDTickets=${ticket.IDTickets}: ${error instanceof Error ? error.message : error}`, { IDTickets: ticket.IDTickets }, incomingPayload);
              errori++;
            }
      }
      console.log(`[${getItalianDateString()}] Completato processamento ticket DylogApp: ${salvati} salvati, ${saltati} saltati, ${errori} errori, ${erroriUpdate} errori di aggiornamento`);
      sendLog(restaurant_code, "info", `📊 BACCO completato: ${salvati} salvati, ${saltati} saltati, ${errori} errori, ${erroriUpdate} errori update`, { salvati, saltati, errori, erroriUpdate }, incomingPayload);
    }

    if (Array.isArray(body.customerList) && body.customerList.length > 0) {
      console.log(`[${getItalianDateString()}] Processando ${body.customerList.length} clienti...`);
      let aggiornati = 0, creati = 0, saltati = 0, aggiornatiParziale = 0, errori = 0;

      for (const customer of body.customerList) {
        try {
          // arrived_from indica la sorgente del cliente:
          //   "app"                      → cliente EasyAppear (ha sempre idCustomer/idCustomerExt)
          //   "bacco"                    → cliente da POS fisico Bacco/DylogApp
          //   "signa"                    → cliente da POS retail Signa
          //   "customer_data_fidelityweb"→ tessera fidelity web
          //   "customer_data_tickets"    → estratto dallo scontrino fiscale
          //   "customer_data_retail"     → estratto dal movimento vendita retail
          const arrivedFrom = customer.arrived_from?.toLowerCase() || "";

          // dateLastUpdateProduct è usato come guardia per evitare di sovrascrivere
          // un record più recente con uno più vecchio (i sistemi POS come bacco/signa
          // possono inviare lo stesso cliente più volte in ordine non garantito).
          // Per i dati provenienti dall'app la guardia sulla data NON viene applicata:
          // l'app è la fonte autoritativa e i suoi aggiornamenti passano sempre.
          const incomingLastUpdate = customer.dateLastUpdateProduct || customer.dateLastUpdate || "";

          const rawEmail = typeof customer.email === "string" ? customer.email.trim() : "";
          // Prova i vari campi telefono in ordine di priorità
          const phoneCandidates = [customer.mobile, customer.phone, customer.telephone, customer.cellphone];
          const rawPhone = phoneCandidates.find((value) => typeof value === "string" && value.trim().length > 0) || "";
          const { contactKey, normalizedEmail } = computeContactKey(rawEmail, rawPhone);

          // idCustomerProduct è l'ID cliente interno al POS (es. Bacco/Signa),
          // diverso da idCustomer che può essere l'ID gateway/app
          const rawIdCustomerProduct = customer.idCustomerProduct?.toString() || "";
          const incomingPublicCode = customer.publicCode?.toString() || "";

          let existing: any = null;
          let effectiveCustomerId = "";

          if (arrivedFrom === "app") {
            // ── CASO APP (EasyAppear) ──────────────────────────────────
            effectiveCustomerId = customer.idCustomerExt || customer.idCustomer;

            if (!effectiveCustomerId) {
              console.warn(`[${getItalianDateString()}] [APP] SKIP: idCustomer e idCustomerExt entrambi assenti.`);
              continue;
            }

            // Step 1: cerca per idCustomer
            existing = await prisma.customer.findFirst({
              where: { restaurant_code, idCustomer: effectiveCustomerId },
            });

            if (existing) {
              const logMsg = `📥 CLIENTE ESISTENTE | cercato idCustomer="${effectiveCustomerId}" → trovato db.idCustomer="${existing.idCustomer}" db.email="${existing.email || ""}" db.mobile="${existing.mobile || ""}" db.publicCode="${existing.publicCode || ""}"`;
              console.log(`[${getItalianDateString()}] ${logMsg}`);
              sendLog(restaurant_code, "info", logMsg, { cercato: { idCustomer: effectiveCustomerId }, trovato: { idCustomer: existing.idCustomer, email: existing.email, mobile: existing.mobile, publicCode: existing.publicCode }, sorgente: arrivedFrom }, incomingPayload);
            } else {
              // Step 2: fallback su (publicCode + email) OPPURE (publicCode + phone)
              if (incomingPublicCode && (rawEmail || rawPhone)) {
                const orClauses: any[] = [];
                if (rawEmail) orClauses.push({ publicCode: incomingPublicCode, email: rawEmail });
                if (rawPhone) orClauses.push({ publicCode: incomingPublicCode, mobile: rawPhone });

                existing = await prisma.customer.findFirst({
                  where: { restaurant_code, OR: orClauses },
                });

                if (existing) {
                  const matchReason = rawEmail && existing.email === rawEmail
                    ? `cercato email="${rawEmail}" + publicCode="${incomingPublicCode}"`
                    : `cercato phone="${rawPhone}" + publicCode="${incomingPublicCode}"`;
                  const logMsg2 = `📥 CLIENTE ESISTENTE | ${matchReason} → trovato db.idCustomer="${existing.idCustomer || ""}" db.email="${existing.email || ""}" db.mobile="${existing.mobile || ""}" db.publicCode="${existing.publicCode || ""}"`;
                  console.log(`[${getItalianDateString()}] ${logMsg2}`);
                  sendLog(restaurant_code, "info", logMsg2, { cercato: { email: rawEmail, phone: rawPhone, publicCode: incomingPublicCode }, trovato: { idCustomer: existing.idCustomer, email: existing.email, mobile: existing.mobile, publicCode: existing.publicCode }, sorgente: arrivedFrom }, incomingPayload);
                }
              }
            }

          } else if (arrivedFrom === "bacco") {
            // ── CASO BACCO ────────────────────────────────────────────
            effectiveCustomerId = customer.idCustomer?.toString() || "";

            if (effectiveCustomerId) {
              existing = await prisma.customer.findFirst({
                where: { restaurant_code, idCustomer: effectiveCustomerId },
              });

              if (existing) {
                const logMsgB1 = `📥 CLIENTE ESISTENTE | cercato idCustomer="${effectiveCustomerId}" → trovato db.idCustomer="${existing.idCustomer || ""}" db.email="${existing.email || ""}" db.mobile="${existing.mobile || ""}" db.publicCode="${existing.publicCode || ""}"`;
                console.log(`[${getItalianDateString()}] ${logMsgB1}`);
                sendLog(restaurant_code, "info", logMsgB1, { cercato: { idCustomer: effectiveCustomerId }, trovato: { idCustomer: existing.idCustomer, email: existing.email, mobile: existing.mobile, publicCode: existing.publicCode }, sorgente: "bacco" }, incomingPayload);
              }
            } else {
              if (incomingPublicCode && rawEmail) {
                existing = await prisma.customer.findFirst({
                  where: { restaurant_code, publicCode: incomingPublicCode, email: rawEmail },
                });

                if (existing) {
                  const logMsgB2 = `📥 CLIENTE ESISTENTE | cercato email="${rawEmail}" + publicCode="${incomingPublicCode}" → trovato db.idCustomer="${existing.idCustomer || ""}" db.email="${existing.email || ""}" db.publicCode="${existing.publicCode || ""}"`;
                  console.log(`[${getItalianDateString()}] ${logMsgB2}`);
                  sendLog(restaurant_code, "info", logMsgB2, { cercato: { email: rawEmail, publicCode: incomingPublicCode }, trovato: { idCustomer: existing.idCustomer, email: existing.email, publicCode: existing.publicCode }, sorgente: "bacco" }, incomingPayload);
                }
              }

              if (!existing && incomingPublicCode && rawIdCustomerProduct) {
                existing = await prisma.customer.findFirst({
                  where: { restaurant_code, publicCode: incomingPublicCode, idCustomer: rawIdCustomerProduct },
                });

                if (existing) {
                  const logMsgB3 = `📥 CLIENTE ESISTENTE | cercato idCustomerProduct="${rawIdCustomerProduct}" + publicCode="${incomingPublicCode}" → trovato db.idCustomer="${existing.idCustomer || ""}" db.email="${existing.email || ""}" db.publicCode="${existing.publicCode || ""}"`;
                  console.log(`[${getItalianDateString()}] ${logMsgB3}`);
                  sendLog(restaurant_code, "info", logMsgB3, { cercato: { idCustomerProduct: rawIdCustomerProduct, publicCode: incomingPublicCode }, trovato: { idCustomer: existing.idCustomer, email: existing.email, publicCode: existing.publicCode }, sorgente: "bacco" }, incomingPayload);
                }
              }

              // Se trovato tramite idCustomerProduct usalo come effectiveCustomerId
              if (existing && !effectiveCustomerId) {
                effectiveCustomerId = existing.idCustomer || rawIdCustomerProduct;
              }
            }

          } else {
            // ── CASO ALTRI (SIGNA, FIDELITY, TICKETS, RETAIL...) ──────
            // Mantiene la logica originale basata su idCustomerExt / contact_key
            if (customer.idCustomerExt) {
              effectiveCustomerId = customer.idCustomerExt;

              const searchOr: any[] = [{ idCustomer: effectiveCustomerId }];
              const emailVariants = Array.from(new Set([customer.email, normalizedEmail].filter(Boolean)));
              for (const emailVariant of emailVariants) {
                searchOr.push({ email: emailVariant });
              }

              const whereClause: any = { restaurant_code, OR: searchOr };
              existing = await prisma.customer.findFirst({ where: whereClause });

              if (existing) {
                let cercato = "";
                if (effectiveCustomerId && existing.idCustomer?.trim() === effectiveCustomerId) {
                  cercato = `idCustomer="${effectiveCustomerId}"`;
                } else {
                  const foundEmail = emailVariants.find(e => existing.email === e);
                  cercato = foundEmail ? `email="${foundEmail}"` : `idCustomer="${effectiveCustomerId}"`;
                }
                const logMsgA = `📥 CLIENTE ESISTENTE | cercato ${cercato} → trovato db.idCustomer="${existing.idCustomer || ""}" db.email="${existing.email || ""}" db.mobile="${existing.mobile || ""}" db.publicCode="${existing.publicCode || ""}"`;
                console.log(`[${getItalianDateString()}] ${logMsgA}`);
                sendLog(restaurant_code, "info", logMsgA, { cercato, trovato: { idCustomer: existing.idCustomer, email: existing.email, mobile: existing.mobile, publicCode: existing.publicCode }, sorgente: arrivedFrom }, incomingPayload);
              }
            } else {
              // Nessun idCustomerExt → cerca solo per email
              effectiveCustomerId = "";

              const emailVariants = Array.from(new Set([customer.email, normalizedEmail].filter(Boolean)));
              const searchOr: any[] = emailVariants.map(e => ({ email: e }));

              if (searchOr.length > 0) {
                const whereClause: any = { restaurant_code, OR: searchOr };
                existing = await prisma.customer.findFirst({ where: whereClause });

                if (existing) {
                  const foundEmail = emailVariants.find(e => existing.email === e) || customer.email;
                  const cercato = `email="${foundEmail}"`;
                  const logMsgC = `📥 CLIENTE ESISTENTE | cercato ${cercato} → trovato db.idCustomer="${existing.idCustomer || ""}" db.email="${existing.email || ""}" db.mobile="${existing.mobile || ""}" db.publicCode="${existing.publicCode || ""}"`;
                  console.log(`[${getItalianDateString()}] ${logMsgC}`);
                  sendLog(restaurant_code, "info", logMsgC, { cercato, trovato: { idCustomer: existing.idCustomer, email: existing.email, mobile: existing.mobile, publicCode: existing.publicCode }, sorgente: arrivedFrom }, incomingPayload);
                }
              }
            }
          }

          // ── LOG NUOVO CLIENTE ──────────────────────────────────────
          if (!existing) {
            const idLabel = effectiveCustomerId || rawIdCustomerProduct || "(nessuno)";
            const logMsgNew = `🆕 NUOVO CLIENTE | id=${idLabel}`;
            console.log(`[${getItalianDateString()}] ${logMsgNew}`);
            sendLog(restaurant_code, "success", logMsgNew, { id: idLabel, sorgente: arrivedFrom, email: rawEmail, mobile: rawPhone }, incomingPayload);
          }

          if (existing) {
            // ── UPDATE ──────────────────────────────────────────────
            const existingLastUpdate = existing.dateLastUpdate || "";

            // [GUARDIA 1] Data non più recente → skip (solo per sorgenti NON-app)
            // L'app è fonte autoritativa: i suoi aggiornamenti bypassano sempre il controllo data.
            // Eccezione: se arriva un idCustomerProduct che nel DB è assente, lo salviamo
            // comunque anche se la data non è più recente (serve per collegare app ↔ gestionale).
            if (arrivedFrom !== "app" && incomingLastUpdate && existingLastUpdate && incomingLastUpdate <= existingLastUpdate) {
              if (rawIdCustomerProduct && !existing.idCustomerProduct?.trim()) {
                await prisma.customer.update({
                  where: { id: existing.id },
                  data: { idCustomerProduct: rawIdCustomerProduct, updateAt: new Date() },
                });
                aggiornatiParziale++;
              } else {
                saltati++;
              }
              continue;
            }

            // [GUARDIA 2] Record ha già idCustomer e la sorgente non è app → skip
            // Eccezione: se arriva un idCustomerProduct che nel DB è assente,
            // lo salviamo comunque con un update mirato prima di skippare.
            // Questo campo serve a collegare il profilo app con il gestionale POS.
            if (existing.idCustomer && existing.idCustomer.trim() !== "" && arrivedFrom !== "app") {
              if (rawIdCustomerProduct && !existing.idCustomerProduct?.trim()) {
                await prisma.customer.update({
                  where: { id: existing.id },
                  data: { idCustomerProduct: rawIdCustomerProduct, updateAt: new Date() },
                });
                aggiornatiParziale++;
              } else {
                saltati++;
              }
              continue;
            }

            // Per i dati provenienti dall'app usiamo i valori in arrivo come
            // priorità assoluta (sovrascrittura diretta): l'app è la fonte
            // più affidabile e aggiornata dell'anagrafica.
            // Per le altre sorgenti manteniamo il fallback sul valore esistente
            // in modo da non cancellare dati già presenti con campi vuoti.
            const pick = (incoming: any, fallback: any) =>
              arrivedFrom === "app"
                ? (incoming ?? fallback ?? "")   // app: prende sempre il valore in arrivo, anche se stringa vuota
                : (incoming || fallback || "");  // altri: fallback se il valore in arrivo è falsy

            const filteredCustomerData = {
              idReferenceGateway: pick(customer.idReferenceGateway,                         existing.idReferenceGateway),
              idCustomer: effectiveCustomerId || existing.idCustomer || "",
              // idCustomerProduct: viene aggiornato solo se arriva un valore nuovo
              // e il record in DB non ne aveva uno (o era vuoto).
              // Non si sovrascrive mai un idCustomerProduct già presente.
              idCustomerProduct: rawIdCustomerProduct && !existing.idCustomerProduct?.trim()
                ? rawIdCustomerProduct
                : (existing.idCustomerProduct || rawIdCustomerProduct || ""),
              contact_key: contactKey || existing.contact_key || "",
              gender:                         pick(customer.gender,                         existing.gender),
              name:                           pick(customer.name,                           existing.name),
              surname:                        pick(customer.surname,                        existing.surname),
              birth_data:                     pick(customer.birth_data,                     existing.birth_data),
              vat_number:                     pick(customer.vat_number,                     existing.vat_number),
              residence_address:              pick(customer.residence_address,              existing.residence_address),
              residence_zipcode:              pick(customer.residence_zipcode,              existing.residence_zipcode),
              residence_city:                 pick(customer.residence_city,                 existing.residence_city),
              residence_province:             pick(customer.residence_province,             existing.residence_province),
              residence_region:               pick(customer.residence_region,               existing.residence_region),
              residence_state:                pick(customer.residence_state,                existing.residence_state),
              domicile_address:               pick(customer.domicile_address,               existing.domicile_address),
              domicile_zipcode:               pick(customer.domicile_zipcode,               existing.domicile_zipcode),
              domicile_city:                  pick(customer.domicile_city,                  existing.domicile_city),
              domicile_province:              pick(customer.domicile_province,              existing.domicile_province),
              domicile_region:                pick(customer.domicile_region,                existing.domicile_region),
              domicile_state:                 pick(customer.domicile_state,                 existing.domicile_state),
              mobile:                         pick(rawPhone,                                existing.mobile),
              email:                          pick(rawEmail,                                existing.email),
              publicCode:                     pick(customer.publicCode,                     existing.publicCode),
              subscriber:                     pick(customer.subscriber,                     existing.subscriber),
              arrived_from:                   pick(customer.arrived_from,                   existing.arrived_from),
              fidelity_card_number:           pick(customer.fidelity_card_number,           existing.fidelity_card_number),
              consent_marketing:              pick(customer.consent_marketing,              existing.consent_marketing),
              consent_third_parties_marketing:pick(customer.consent_third_parties_marketing,existing.consent_third_parties_marketing),
              dateCreation:  existing.dateCreation || "",
              dateLastUpdate: incomingLastUpdate || existing.dateLastUpdate || "",
              deleted:                        pick(customer.deleted,                        existing.deleted),
              restaurant_code,
              subscriber_code,
              updateAt: new Date(),
            };

            await prisma.customer.update({
              where: { id: existing.id },
              data: {
                ...filteredCustomerData,
                idCustomer: effectiveCustomerId || existing.idCustomer || "",
                contact_key: contactKey || existing.contact_key || "",
              },
            });

            // ── MERGE DETECTION ─────────────────────────────────────
            // Rilevamento merge anagrafico: si verifica in due scenari:
            //
            //   A) arrived_from === "app" e il record in DB non aveva idCustomer
            //      → l'app sta "rivendicando" un profilo precedentemente creato
            //        da bacco/signa/fidelity tramite match su email/publicCode.
            //        Notifica DylogApp con idReferenceGateway del record esistente.
            //
            //   B) arrived_from !== "app" (es. bacco) e il record in DB aveva già
            //      un idCustomer (app) → il POS ha trovato lo stesso utente tramite
            //      publicCode+email o publicCode+idCustomerProduct.
            //      Notifica DylogApp con il nuovo idReferenceGateway arrivato.
            //
            // In entrambi i casi inviamo SETIDCUSTOMEREXT al gateway Dylog
            // per allineare l'associazione idReferenceGateway ↔ idCustomer.
            const mergedIdCustomer = effectiveCustomerId || existing.idCustomer || "";
            const mergedPublicCode = customer.publicCode || existing.publicCode || "";
            const mergedIdReferenceGateway = customer.idReferenceGateway || existing.idReferenceGateway || "";

            const isMergeScenarioA =
              arrivedFrom === "app" &&
              (!existing.idCustomer || existing.idCustomer.trim() === "") &&
              mergedIdCustomer &&
              mergedIdReferenceGateway;

            const isMergeScenarioB =
              arrivedFrom !== "app" &&
              existing.idCustomer && existing.idCustomer.trim() !== "" &&
              mergedIdReferenceGateway &&
              mergedIdCustomer;

            if (isMergeScenarioA || isMergeScenarioB) {
              const scenario = isMergeScenarioA ? "A (app arriva su profilo POS)" : "B (POS arriva su profilo app)";
              console.log(`[${getItalianDateString()}] MERGE ANAGRAFICO scenario ${scenario} - idCustomer=${mergedIdCustomer}, idReferenceGateway=${mergedIdReferenceGateway}, publicCode=${mergedPublicCode}`);
              notifyDylogSetIdCustomerExt(mergedPublicCode, mergedIdReferenceGateway, mergedIdCustomer);
            }

            aggiornati++;
          } else {
            // ── CREATE ──────────────────────────────────────────────
            // Cliente non trovato nel DB → creazione nuovo record.
            const filteredCustomerData = {
              idReferenceGateway: customer.idReferenceGateway || "",
              idCustomer: effectiveCustomerId || rawIdCustomerProduct,
              idCustomerProduct: rawIdCustomerProduct || "",
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

            await prisma.customer.create({
              data: {
                ...filteredCustomerData,
                idCustomer: effectiveCustomerId || rawIdCustomerProduct,
                contact_key: contactKey,
                createdAt: new Date(),
              },
            });
            creati++;
          }
        } catch (error) {
          console.error(`[${getItalianDateString()}] Errore nell'aggiornamento/creazione del cliente ${customer?.idCustomer || 'sconosciuto'}: ${error}`);
          errori++;
        }
      }
      console.log(`[${getItalianDateString()}] Completato processamento clienti: ${aggiornati} aggiornati, ${aggiornatiParziale} aggiornati parzialmente (solo idCustomerProduct), ${creati} creati, ${saltati} saltati, ${errori} errori`);
    }

    const duration = ((Date.now() - start) / 1000).toFixed(2);
    console.log(`[${getItalianDateString()}] Completato processamento background in ${duration}s: ${JSON.stringify(stats)}`);
  } catch (error) {
    console.error("Errore nel processamento background:", error);
    
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
