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
    const body = await parseLargeJSON(request);
    const searchParams = request.nextUrl.searchParams;
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

    // Salva i dati dei movimenti nella collezione SignaMovimenti
    if (Array.isArray(content.movimenti) && content.movimenti.length > 0) {
      // Per ogni movimento nell'array movimenti, salva i dati con i dettagli dei prodotti
      for (const movimento of content.movimenti) {
        // Verifica se esiste già un documento con lo stesso IDReferencePOS
        const existingMovimento = await prisma.signaMovimenti.findFirst({
          where: {
            IDReferencePOS: movimento.IDReferencePOS?.toString() || ""
          }
        });
        
        // Se esiste già, salta questo movimento
        if (existingMovimento) {
          console.log(`Movimento Signa con IDReferencePOS ${movimento.IDReferencePOS} già presente, skip.`);
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
      }
    }
    
    // Salva i dati delle vendite nella collezione SignaMovimentiVend
    if (Array.isArray(content.movimentivend) && content.movimentivend.length > 0) {

      await Promise.allSettled(
        content.movimentivend.map((movimento: any) =>
          limit(async () => {
            // Verifica se esiste già un documento con lo stesso IDMovimentoPOS
            const existingMovimentoVend = await prisma.signaMovimentiVend.findFirst({
              where: {
                IDMovimentoPOS: movimento.IDMovimentoPOS?.toString() || ""
              }
            });
            
            // Se esiste già, salta questo movimento
            if (existingMovimentoVend) {
              console.log(`Movimento Signa con IDMovimentoPOS ${movimento.IDMovimentoPOS} già presente in SignaMovimentiVend, skip.`);
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
            const idCustomer = movimento.customer?.idCustomerExt || movimento.customer?.idCustomer;
            await updateCustomerOrders(movimento, "signa", idCustomer, restaurant_code);
          })
        )
      );
    }

    if (Array.isArray(content.TicketList) && content.TicketList.length > 0) {
      await Promise.allSettled(
        content.TicketList.map((ticket: any) =>
          limit(async () => {
            let orderWebInfo = null;
            if (Array.isArray(ticket.DetailList)) {
              for (const detail of ticket.DetailList) {
                if (detail.OrderWebInfo) {
                  orderWebInfo = detail.OrderWebInfo;
                  break;
                }
              }
            }

            if (!orderWebInfo || !orderWebInfo.IDCustomer) return;

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
            // Per semplicità, salviamo sempre il ticket senza verificare duplicati
            // In futuro potremmo implementare una verifica più robusta
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
              console.log(`Ticket DylogApp con IDTickets ${orderWebInfo.IDTickets} salvato con successo.`);
            } catch (error) {
              // Gestione errori: potrebbe essere un duplicato o altro problema
              console.log(`Errore nel salvare il ticket DylogApp con IDTickets ${orderWebInfo.IDTickets}: ${error}`);
            }

            // Utilizzo updateCustomerOrders per aggiornare i campi aggregati
            await updateCustomerOrders(ticket, "dylogapp", orderWebInfo.IDCustomer, restaurant_code);
          })
        )
      );
    }

    if (Array.isArray(content.customerList) && content.customerList.length > 0) {
      await Promise.allSettled(
        content.customerList.map((customer: any) =>
          limit(async () => {
            const existing = await prisma.customer.findFirst({
              where: {
                idCustomer: customer.idCustomer,
                publicCode: customer.publicCode,
              },
            });

            if (existing) {
              await prisma.customer.delete({ where: { id: existing.id } });
            }

            await prisma.customer.create({
              data: {
                ...customer,
                restaurant_code,
                subscriber_code,
              },
            });
          })
        )
      );
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
