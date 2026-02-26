This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.

## Invio rapido payload Signa

Lo script `scripts/send-signa-payload.js` legge il payload da `TempSignaWowRestGateWay_Clienti.txt` e lo invia all'endpoint `/api/mapper/storedata` aggiungendo automaticamente le query string richieste. Il codice ristorante di default è `ANTRL0000702`.

1. Imposta le variabili d'ambiente (anche in `.env.local`):
   - `NEXT_PUBLIC_API_KEY` (o `API_KEY`) con la chiave del gateway.
   - `SIGNA_RESTAURANT_CODE` con il codice ristorante predefinito.
   - `SIGNA_SUBSCRIBER_CODE` opzionale (default `SIGNA`).
   - `SIGNA_STORE_ENDPOINT` opzionale (default `http://localhost:3000/api/mapper/storedata`).
2. Esegui:

```bash
node scripts/send-signa-payload.js \
  --restaurant ANTRL0000702 \
  --endpoint https://<host>/api/mapper/storedata \
  --file /path/TempSignaWowRestGateWay_Clienti.txt
```

Tutti i parametri sono opzionali se già forniti dalle variabili d'ambiente. Lo script usa l'header `x-api-key` con la chiave caricata e mostra a console l'esito della chiamata.
