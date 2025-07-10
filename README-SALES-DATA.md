# ARCHITETTURA DEI DATI DI VENDITA

## Schema Dati
Abbiamo implementato un sistema che standardizza e aggrega dati di vendita da due fonti:

### 1. Modelli di Dati Principali:
- **SalesData**: Collezione standardizzata per tutti i dati di vendita
  - sourceType: "signa" o "dylogapp"
  - sourceId: ID di riferimento nel sistema di origine
  - saleDate: Data della vendita (per filtri temporali)
  - totalAmount: Importo totale (per filtri su spesa)
  - customerId: Riferimento all'ID MongoDB del Cliente
  - fidelityCard: Numero tessera fedeltà
  - restaurant_code: Codice ristorante
  - subscriber_code: Codice sottoscrittore
  - sourceData: JSON con dati specifici della fonte

- **CustomerSalesSummary**: Metriche aggregate per cliente
  - customerId: Riferimento all'ID MongoDB del Cliente
  - totalOrders: Numero totale di ordini
  - totalSpent: Importo totale speso
  - firstOrderDate, lastOrderDate: Prima e ultima data ordine
  - orderDates: Array con tutte le date degli ordini
  - signaOrders, signaSpent: Metriche specifiche Signa
  - dylogappOrders, dylogappSpent: Metriche specifiche DylogApp

- **Customer**: Dati anagrafici del cliente
  - id: ID MongoDB (referenziato come customerId nelle altre collezioni)
  - idCustomer: Identificativo esterno usato per notifiche push
  - fidelity_card_number: Numero tessera fedeltà
  - mobile: Numero di cellulare (per SMS marketing)
  - email: Email del cliente

### 2. Dati Grezzi:
- **SignaMovimenti**: Dati grezzi delle vendite da Signa
- **TicketData**: Tutti i ticket da DylogApp
- **ticketListBaccoDylogAPP**: Ticket filtrati con OrderWebInfo

## Relazioni e Flusso Dati per Marketing Selettivo
Per inviare notifiche push attraverso il marketing selettivo:

1. Filtrare i clienti target usando `CustomerSalesSummary` o `SalesData` 
2. Recuperare i `customerId` (ID MongoDB) risultanti
3. Fare una query su `Customer` per trovare i documenti con quegli ID
4. Estrarre il campo `idCustomer` da ciascun documento Customer
5. Inviare questi `idCustomer` al sistema di notifiche

## Esempi di Filtri Implementabili

### 1. Filtro per numero di ordini
```typescript
// Clienti con più di 5 ordini
const clienti = await prisma.customerSalesSummary.findMany({
  where: {
    totalOrders: { gt: 5 } // o { gte, lt, lte, equals }
  }
});
```

### 2. Filtro per importo speso
```typescript
// Clienti che hanno speso più di 100€
const clienti = await prisma.customerSalesSummary.findMany({
  where: {
    totalSpent: { gt: 100 }
  }
});
```

### 3. Filtro per singolo ordine di valore elevato
```typescript
// Clienti con almeno un ordine > 50€
const ordiniGrandi = await prisma.salesData.findMany({
  where: { totalAmount: { gt: 50 } },
  distinct: ['customerId']
});
```

### 4. Filtro per periodo temporale
```typescript
// Ordini in un periodo specifico
const dataInizio = new Date('2025-01-01');
const dataFine = new Date('2025-06-30');

const clientiAttivi = await prisma.salesData.findMany({
  where: {
    saleDate: {
      gte: dataInizio,
      lte: dataFine
    }
  },
  distinct: ['customerId']
});
```

### 5. Combinazione di filtri
```typescript
// Esempio di filtri combinati
// Clienti che hanno fatto almeno 3 ordini E speso più di 200€ in un periodo specifico

// Prima troviamo gli ordini nel periodo
const dataInizio = new Date('2025-01-01');
const dataFine = new Date('2025-06-30');

// Possiamo usare CustomerSalesSummary per filtri rapidi su totali
const clientiTarget = await prisma.customerSalesSummary.findMany({
  where: {
    totalOrders: { gt: 3 },
    totalSpent: { gt: 200 },
    // Per il periodo, possiamo verificare che l'ultimo ordine sia nel periodo
    lastOrderDate: {
      gte: dataInizio,
      lte: dataFine
    }
  },
  select: {
    customerId: true
  }
});

// Recuperare gli ID cliente MongoDB
const customerIds = clientiTarget.map(c => c.customerId);

// Ottenere i dati completi dei clienti (inclusi idCustomer per notifiche)
const clientiCompleti = await prisma.customer.findMany({
  where: {
    id: { in: customerIds }
  }
});

// Estrarre gli idCustomer per inviarli al sistema di notifiche
const idCustomerList = clientiCompleti.map(c => c.idCustomer).filter(id => id);
```

## Nota Importante per Mobile
Quando arrivano dati cliente da Signa, verifichiamo sia il campo `mobile` che `phone`. Se `mobile` è vuoto o non valido ma `phone` contiene un numero di cellulare valido, questo viene salvato nel campo `mobile` del cliente per garantire che i messaggi SMS raggiungano tutti i potenziali destinatari.
