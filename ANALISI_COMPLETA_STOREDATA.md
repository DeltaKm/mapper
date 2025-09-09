# Analisi Completa del Sistema eosMapper - Route Storedata

## Panoramica del Sistema

Il sistema eosMapper è un'applicazione di mappatura e standardizzazione dati che aggrega informazioni di vendita da due fonti principali:

1. **Signa POS Software** - Sistema POS tradizionale
2. **DylogApp** - Applicazione di delivery/takeaway

**Endpoint principale**: `POST /api/mapper/storedata?restaurant_code={code}&subscriber_code={code}`

## Architettura dei Dati

### Modelli di Database Principali

#### 1. Dati Grezzi (Raw Data)
- **SignaMovimenti**: Movimenti grezzi da Signa POS
- **TicketData**: Tutti i ticket da DylogApp  
- **ticketListBaccoDylogAPP**: Ticket filtrati con OrderWebInfo

#### 2. Dati Standardizzati
- **Customer**: Anagrafica clienti standardizzata
- **CustomerOrders**: Ordini aggregati per cliente con dettagli standardizzati
- **CustomerSalesSummary**: Metriche aggregate per marketing selettivo

## Flusso di Elaborazione Dati

### 1. Ricezione e Parsing del Payload

```typescript
// Limite dimensione payload: ~16MB
const MAX_SIZE = 16 * 1024 * 1024;

// Parsing sequenziale per ridurre uso memoria
async function parseLargeJSON(request: NextRequest): Promise<any>
```

**Controlli eseguiti:**
- Validazione dimensione payload
- Parsing JSON con gestione errori
- Logging dettagliato delle operazioni

### 2. Processamento Sequenziale dei Dati

Il sistema processa i dati in sequenza per ottimizzare l'uso della memoria:

1. **Movimenti Generali** (`movimenti`)
2. **Movimenti di Vendita** (`movimentivend`) 
3. **Ticket DylogApp** (`TicketList`)
4. **Lista Clienti** (`customerList`)

**Controllo di Concorrenza:**
```typescript
const limit = pLimit(5); // Massimo 5 operazioni simultanee
```

## Logiche di Mapping Specifiche per Fonte

### A. Signa POS Software

#### Movimenti Generali (`movimenti`)
**Struttura dati in ingresso:**
```typescript
{
  IDMovimentoPOS: string,
  IDReferencePOS: string,
  PagamentoData: "DD/MM/YYYY",
  PagamentoOra: "HH:mm:ss",
  customer: {
    idCustomerExt: string,
    fidelity_card_number: string
  },
  pagamenti: Array<{Importo: number, Tipo: string}>,
  dettagli: Array<ProductDetail>
}
```

**Logica di mapping:**
1. **Identificazione duplicati**: Controllo su `IDReferencePOS`
2. **Gestione date**: Conversione da formato italiano a ISO con timezone Europe/Rome
3. **Calcolo importi**: Somma di tutti i pagamenti
4. **Salvataggio**: Upsert in `SignaMovimenti` con payload completo

#### Movimenti di Vendita (`movimentivend`)
**Differenze rispetto ai movimenti generali:**
- Dati più strutturati per le vendite
- Collegamento diretto con anagrafica cliente
- Aggiornamento automatico di `CustomerOrders` e `CustomerSalesSummary`

**Processo di elaborazione:**
```typescript
// 1. Controllo duplicati
const existing = await prisma.signaMovimenti.findFirst({
  where: { IDReferencePOS: movimento.IDReferencePOS }
});

// 2. Upsert movimento
await prisma.signaMovimenti.upsert({...});

// 3. Aggiornamento aggregati
await updateCustomerOrders(movimento, "signa", idCustomer, restaurant_code);
await updateCustomerSalesSummary(idCustomer, restaurant_code);
```

### B. DylogApp

#### Ticket List (`TicketList`)
**Struttura dati in ingresso:**
```typescript
{
  IDTickets: number,
  DateBill: string,
  Totoal: number,
  PaymentMode: string,
  DetailList: Array<{
    Code: string,
    Name: string,
    Qta: number,
    Price: number
  }>,
  orderWebInfo: {
    idCustomer: string,
    fidelity_card_number: string
  }
}
```

**Logica di mapping:**
1. **Filtro iniziale**: Solo ticket con `orderWebInfo` valido
2. **Salvataggio completo**: Tutti i ticket in `TicketData`
3. **Salvataggio filtrato**: Ticket con `orderWebInfo` in `ticketListBaccoDylogAPP`
4. **Aggiornamento aggregati**: Per ticket con cliente identificato

### C. Lista Clienti (`customerList`)

**Gestione anagrafica unificata:**
```typescript
// Priorità campi mobile
const mobile = customer.mobile || 
  (isValidMobileNumber(customer.phone) ? customer.phone : null);

// Upsert cliente
await prisma.customer.upsert({
  where: { idCustomer: customer.idCustomerExt },
  update: { /* campi aggiornabili */ },
  create: { /* nuovo cliente */ }
});
```

## Sistema di Aggregazione - updateCustomerOrders

### Funzionalità Principali

1. **Standardizzazione Ordini**: Converte dati da entrambe le fonti in formato uniforme
2. **Gestione Duplicati**: Controllo su `orderId` per evitare duplicazioni
3. **Calcolo Metriche**: Aggiornamento automatico di totali e contatori
4. **Gestione Resi**: Identificazione e trattamento speciale dei resi

### Mapping Prodotti

#### Signa Products
```typescript
function mapSignaProducts(prodotti: any[]): any[] {
  return prodotti.map(prod => ({
    productId: prod.CodArticolo || "",
    name: prod.Article_Description_Short || "",
    quantity: parseFloat(prod.Quantita) || 0,
    unitPrice: parseFloat(prod.Valore) || 0,
    totalPrice: quantity * unitPrice,
    category: prod.Famiglia || prod.CodFamiglia || "Non specificato"
  }));
}
```

#### DylogApp Products
```typescript
function mapDylogAppProducts(items: any[]): any[] {
  return items.map(item => ({
    productId: item.Code || "",
    name: item.Name || "",
    quantity: item.Qta || 0,
    unitPrice: item.Price || 0,
    totalPrice: item.Price * item.Qta || 0,
    category: item.GroupDescription || "Non specificato"
  }));
}
```

### Gestione Resi (Signa)

**Identificazione resi:**
```typescript
// Reso identificato da pagamenti vuoti
const isReso = !Array.isArray(movimento.pagamenti) || movimento.pagamenti.length === 0;

// Calcolo valore reso da dettagli con CodTipoMovimento = 'RC'
if (isReso) {
  for (const dettaglio of prodottiDettagli) {
    if (dettaglio.CodTipoMovimento === 'RC') {
      resoValue += quantity * value;
    }
  }
  amount = -resoValue; // Importo negativo per resi
}
```

**Protezioni per totalSpent:**
```typescript
// Impedisce totalSpent negativo
if (updatedTotalSpent < 0) {
  console.log(`Attenzione: totalSpent negativo per cliente ${idCustomer}, impostato a 0`);
  updatedTotalSpent = 0;
}
```

## Struttura Dati CustomerOrders

### Schema del Record
```typescript
{
  idCustomer: string,           // ID cliente nel sistema originale
  totalSpent: number,           // Importo totale speso
  totalOrders: number,          // Numero totale ordini (inclusi resi)
  firstOrderDate: Date,         // Data primo ordine
  lastOrderDate: Date,          // Data ultimo ordine
  restaurant_code: string,      // Codice ristorante
  orderData: Array<{            // Array dettagli ordini
    orderId: string,
    sourceType: "signa" | "dylogapp",
    sourceId: string,
    orderDate: string,
    amount: number,
    items: Array<ProductItem>,
    paymentMethod?: string,     // Solo Signa
    paymentMode?: string,       // Solo DylogApp
    rawSourceData: any,         // Dati originali per tracciabilità
    isReso: boolean            // Flag identificazione resi
  }>,
  orderDates: string[]          // Array date ordini per query ottimizzate
}
```

## Gestione Errori e Logging

### Livelli di Logging
1. **Info**: Contatori elaborazione, progressi
2. **Warning**: Dati mancanti, fallback applicati
3. **Error**: Errori database, parsing fallito

### Metriche Tracciate
- Numero record processati per tipo
- Numero record saltati (duplicati)
- Numero errori per tipo
- Tempi di elaborazione
- Dimensioni payload

## Controlli di Qualità Dati

### Validazioni Implementate
1. **Date**: Conversione e validazione formato
2. **Importi**: Controllo valori numerici, gestione null/undefined
3. **ID Cliente**: Verifica presenza e validità
4. **Duplicati**: Controllo su chiavi univoche per fonte
5. **Mobile**: Validazione formato numero cellulare

### Gestione Retrocompatibilità
- Supporto campi legacy e nuovi
- Fallback su campi alternativi
- Gestione formati data multipli

## Performance e Scalabilità

### Ottimizzazioni Implementate
1. **Processamento sequenziale**: Riduce uso memoria
2. **Limite concorrenza**: Evita sovraccarico database
3. **Upsert batch**: Operazioni database ottimizzate
4. **Indici database**: Su campi di ricerca frequenti

### Limiti Attuali
- Payload massimo: ~16MB
- Concorrenza: 5 operazioni simultanee
- Timeout: Gestito a livello Next.js

## Integrazione con Marketing Selettivo

Il sistema eosMapper alimenta il sistema di marketing selettivo attraverso:

1. **CustomerSalesSummary**: Metriche aggregate per filtri rapidi
2. **CustomerOrders**: Dettagli ordini per filtri complessi
3. **Customer**: Anagrafica per invio notifiche

**Flusso di utilizzo:**
```
eosMapper → CustomerSalesSummary → Filtri Marketing → Customer.idCustomer → Notifiche Push
```

## Monitoraggio e Manutenzione

### Log da Monitorare
- Errori di parsing payload
- Fallimenti operazioni database
- Resi con valori anomali
- Clienti con totalSpent negativo

### Manutenzione Periodica
- Pulizia log vecchi
- Verifica integrità dati aggregati
- Ottimizzazione indici database
- Aggiornamento mapping prodotti

---

*Documentazione generata dall'analisi completa del codice eosMapper v1.0*
