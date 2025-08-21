# Documentazione Flusso di Mappatura Dati
## Sistema eosMapper - Versione 1.0

---

## 1. PANORAMICA GENERALE

Il sistema **eosMapper** standardizza e aggrega dati di vendita provenienti da due fonti principali:
- **Signa POS Software** 
- **DylogApp**

### Endpoint Principale
```
POST /api/mapper/storedata?restaurant_code={code}&subscriber_code={code}
```

---

## 2. FONTI DATI IN INGRESSO

### 2.1 Signa POS Software
**Payload Structure:**
```json
{
  "customerList": [...],     // Anagrafica clienti
  "movimenti": [...],        // Movimenti generali
  "movimentivend": [...]     // Movimenti di vendita
}
```

**Campi Cliente (customerList):**
- `idCustomer` / `idCustomerExt` → Identificativo cliente
- `dateCreation` / `dateCreationProduct` → Data creazione
- `dateLastUpdate` / `dateLastUpdateProduct` → Data ultimo aggiornamento
- `fidelity_card_number` → Tessera fedeltà
- `mobile`, `email` → Contatti
- Dati anagrafici completi (nome, cognome, indirizzo, etc.)

**Campi Movimento Vendita (movimentivend):**
- `IDMovimentoPOS` → ID univoco movimento
- `IDReferencePOS` → Riferimento POS
- `PagamentoData` → Data pagamento (DD/MM/YYYY)
- `PagamentoOra` → Ora pagamento (HH:mm:ss)
- `pagamenti[]` → Array pagamenti con campo `Importo`
- `prodotti[]` → Array prodotti acquistati
- `customer` → Dati cliente associato

### 2.2 DylogApp
**Payload Structure:**
```json
{
  "TicketList": [...]        // Lista ticket
}
```

**Campi Ticket:**
- `IDTickets` → ID univoco ticket
- `DateBill` → Data fatturazione
- `PaymentMode` → Modalità pagamento
- `DetailList[]` → Dettagli prodotti
- `OrderWebInfo` → Informazioni ordine web con `IDCustomer`

---

## 3. MODELLI DI DESTINAZIONE

### 3.1 Customer (Anagrafica Standardizzata)
```typescript
{
  id: String,                    // MongoDB ObjectId
  idCustomer: String,            // ID cliente esterno
  fidelity_card_number: String,  // Tessera fedeltà
  mobile: String,                // Cellulare
  email: String,                 // Email
  dateCreation: String,          // Data creazione (SEMPRE questo campo)
  dateLastUpdate: String,        // Data aggiornamento (SEMPRE questo campo)
  // ... altri campi anagrafici
}
```

### 3.2 CustomerOrders (Ordini Aggregati)
```typescript
{
  idCustomer: String,            // Riferimento al cliente
  totalSpent: Float,             // Importo totale speso
  totalOrders: Int,              // Numero ordini totali
  firstOrderDate: DateTime,      // Data primo ordine
  lastOrderDate: DateTime,       // Data ultimo ordine
  orderData: Json[],             // Array ordini dettagliati
  orderDates: Json[],            // Array date ordini
  restaurant_code: String
}
```

### 3.3 Dati Grezzi
- **SignaMovimenti**: Payload completo movimenti Signa
- **SignaMovimentiVend**: Movimenti vendita Signa
- **TicketData**: Tutti i ticket DylogApp
- **ticketListBaccoDylogAPP**: Ticket filtrati con OrderWebInfo

---

## 4. FLUSSO DI MAPPATURA

### 4.1 Processo Clienti (customerList)
```
Input → Validazione → Mapping Campi → Upsert Database
```

**Mapping Campi Critici:**
```typescript
// Gestione retrocompatibilità date
dateCreation: customer.dateCreationProduct || customer.dateCreation || ""
dateLastUpdate: customer.dateLastUpdateProduct || customer.dateLastUpdate || ""

// Gestione ID cliente
effectiveCustomerId = customer.idCustomerExt || customer.idCustomer
```

**Logica Upsert:**
1. Cerca cliente esistente per `idCustomer`
2. Se esiste → Controlla `dateLastUpdate`
   - Se `dateLastUpdate` nuova > esistente → **UPDATE** con nuovi dati
   - Se `dateLastUpdate` nuova ≤ esistente → **SKIP** (dati più vecchi)
3. Se non esiste → **CREATE** nuovo record

### 4.2 Processo Vendite Signa (movimentivend)
```
Input → Controllo Duplicati → Salvataggio Grezzo → Standardizzazione → Aggregazione
```

**Controllo Duplicati:**
- Verifica esistenza per `IDMovimentoPOS`
- Se esiste → Skip movimento

**Standardizzazione:**
1. **Data/Ora**: `PagamentoData` + `PagamentoOra` → DateTime
2. **Importo**: Somma array `pagamenti[].Importo`
3. **Prodotti**: Mapping da `prodotti[]` a formato standard
4. **Cliente**: Estrazione da `customer.idCustomerExt` o `customer.idCustomer`

**Gestione Resi:**
- Rileva resi quando `pagamenti[]` è vuoto
- Calcola valore reso da dettagli prodotti con `CodTipoMovimento = 'RC'`
- Imposta importo negativo per resi

### 4.3 Processo Ticket DylogApp (TicketList)
```
Input → Filtro OrderWebInfo → Salvataggio → Standardizzazione → Aggregazione
```

**Filtro Validazione:**
- Richiede `OrderWebInfo.IDCustomer` presente
- Skip ticket senza informazioni cliente

**Standardizzazione:**
1. **Data**: `DateBill` → DateTime
2. **Importo**: Calcolo da `DetailList[]` o `Totoal`
3. **Prodotti**: Mapping da `DetailList[]`
4. **Cliente**: Estrazione da `OrderWebInfo.IDCustomer`

---

## 5. REGOLE DI MAPPATURA

### 5.1 Gestione Date
- **Input**: Supporta sia nomi vecchi che nuovi
- **Output**: Salva SEMPRE nei campi standard (`dateCreation`, `dateLastUpdate`)
- **Formato**: Mantiene formato originale come stringa

### 5.2 Gestione ID Cliente
- **Priorità**: `idCustomerExt` > `idCustomer`
- **Validazione**: Skip record senza ID cliente valido

### 5.3 Gestione Duplicati
- **Signa**: Controllo per `IDMovimentoPOS` e `IDReferencePOS`
- **DylogApp**: Controllo per `IDTickets`
- **Strategia**: Skip silenzioso con log

### 5.4 Gestione Errori
- **Isolamento**: Errore su singolo record non blocca batch
- **Logging**: Log dettagliato per debugging
- **Contatori**: Tracciamento salvati/saltati/errori

---

## 6. MODELLI AGGREGATI

### 6.1 CustomerOrders
**Scopo**: Aggregazione ordini per cliente con dettagli completi

**Campi Calcolati:**
- `totalSpent`: Somma importi (gestisce resi con valori negativi)
- `totalOrders`: Conteggio ordini (include resi)
- `firstOrderDate`/`lastOrderDate`: Range temporale
- `orderDates[]`: Array date per analisi frequenza

**Array orderData:**
```typescript
{
  orderId: string,           // ID ordine univoco
  sourceType: "signa"|"dylogapp",
  sourceId: string,          // ID nel sistema origine
  orderDate: string,         // ISO DateTime
  amount: number,            // Importo (negativo per resi)
  items: ProductItem[],      // Prodotti standardizzati
  paymentMethod?: string,    // Metodo pagamento (Signa)
  paymentMode?: string,      // Modalità pagamento (DylogApp)
  rawSourceData: any,        // Dati originali
  isReso?: boolean          // Flag reso (solo Signa)
}
```

### 6.2 CustomerSalesSummary
**Scopo**: Metriche aggregate per filtri marketing

**Metriche Globali:**
- `totalOrders`, `totalSpent`
- `firstOrderDate`, `lastOrderDate`
- `orderDates[]` per analisi frequenza

**Metriche per Fonte:**
- `signaOrders`, `signaSpent`
- `dylogappOrders`, `dylogappSpent`

---

## 7. FLUSSO TECNICO DETTAGLIATO

### 7.1 Ricezione Payload
```typescript
POST /api/mapper/storedata
├── Parsing JSON (max 32MB)
├── Estrazione parametri URL
└── Salvataggio payload completo in Data collection
```

### 7.2 Processamento Parallelo
```typescript
Promise.allSettled([
  processCustomerList(),     // Anagrafica clienti
  processMovimenti(),        // Movimenti Signa generali
  processMovimentiVend(),    // Vendite Signa
  processTicketList()        // Ticket DylogApp
])
```

### 7.3 Controllo Concorrenza
- **Limite**: 5 operazioni simultanee (`pLimit(5)`)
- **Strategia**: Batch processing per performance

---

## 8. ESEMPI PRATICI

### 8.1 Mapping Cliente Signa
**Input:**
```json
{
  "idCustomerExt": "126764",
  "name": "Valerio",
  "dateCreationProduct": "2021-04-15T12:12:15",
  "fidelity_card_number": "0444910974928"
}
```

**Output (Customer):**
```json
{
  "idCustomer": "126764",
  "name": "Valerio", 
  "dateCreation": "2021-04-15T12:12:15",
  "fidelity_card_number": "0444910974928"
}
```

### 8.2 Mapping Vendita Signa
**Input:**
```json
{
  "IDMovimentoPOS": "12345",
  "PagamentoData": "15/08/2025",
  "PagamentoOra": "14:30:00",
  "pagamenti": [{"Importo": 25.50}],
  "customer": {"idCustomerExt": "126764"}
}
```

**Output (CustomerOrders.orderData):**
```json
{
  "orderId": "12345",
  "sourceType": "signa",
  "orderDate": "2025-08-15T14:30:00.000Z",
  "amount": 25.50,
  "paymentMethod": "...",
  "isReso": false
}
```

---

## 9. CONSIDERAZIONI TECNICHE

### 9.1 Performance
- **Indici**: Ottimizzati per query frequenti
- **Batch Processing**: Gestione payload grandi
- **Controllo Memoria**: Limite 32MB per payload

### 9.2 Affidabilità
- **Transazioni**: Isolamento errori per record
- **Idempotenza**: Controllo duplicati robusto
- **Logging**: Tracciamento completo operazioni

### 9.3 Scalabilità
- **Architettura**: Separazione dati grezzi/aggregati
- **Flessibilità**: Supporto nuovi campi senza breaking changes
- **Monitoring**: Contatori dettagliati per monitoraggio

---

## 10. NOTE PER SVILUPPATORI

### 10.1 Aggiunta Nuovi Campi
1. Aggiungere campo a schema Prisma
2. Aggiornare mapping in route.ts
3. Mantenere retrocompatibilità

### 10.2 Debugging
- Controllare log console per errori specifici
- Verificare contatori salvati/saltati/errori
- Analizzare `sourceData` per problemi mapping

### 10.3 Manutenzione
- Monitorare crescita collezioni dati grezzi
- Verificare performance query aggregate
- Aggiornare indici se necessario

---

**Documento generato il:** 18/08/2025  
**Versione Sistema:** 1.0  
**Team:** CMH Development
