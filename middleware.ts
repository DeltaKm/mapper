
// import { NextRequest, NextResponse } from 'next/server';

// // accettare tutte le origini prima di pushare
// const allowedOrigins = [ 
//   'http://localhost:3000',
//   'consegnoio-data-api.vercel.app'
// ];

// const corsHeaders: Record<string, string> = {
//   'Access-Control-Allow-Origin': '*', 
//   'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
//   'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-API-Key',
//   'Access-Control-Max-Age': '86400', 
// };

// export async function middleware(req: NextRequest) {
//   const origin = req.headers.get('origin');

//   if (req.method === 'OPTIONS') {
//     const response = NextResponse.json(
//       { status: 200 },
//       { headers: corsHeaders }
//     );
//     return response;
//   }

//   const apiKeyHeader = req.headers.get('x-api-key');
//   const apiKeyQuery = req.nextUrl.searchParams.get('apiKey');
//   const apiKey = apiKeyHeader || apiKeyQuery;

//   if (!apiKey || apiKey !== process.env.NEXT_PUBLIC_API_KEY) {
//     const errorResponse = NextResponse.json(
//       { error: "Non autorizzato: API Key non valida o mancante" },
//       { 
//         status: 401,
//         headers: {
//           ...corsHeaders,
//           'Content-Type': 'application/json'
//         }
//       }
//     );
//     return errorResponse;
//   }

//   const response = NextResponse.next();
//   Object.entries(corsHeaders).forEach(([key, value]) => {
//     response.headers.set(key, value);
//   });

//   if (origin && !allowedOrigins.includes(origin)) {
//     const errorResponse = NextResponse.json(
//       { error: "Origine non consentita" },
//       { 
//         status: 403,
//         headers: {
//           ...corsHeaders,
//           'Content-Type': 'application/json'
//         }
//       }
//     );
//     return errorResponse;
//   }

//   return response;
// }

// export const config = {
//   matcher: '/api/:path*',
// };

// middleware.ts
import { NextRequest, NextResponse } from 'next/server';

// Origini consentite
const allowedOrigins = [ 
  'http://localhost:3000',
  'consegnoio-data-api.vercel.app',
  '*'
];

const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': '*', 
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-API-Key',
  'Access-Control-Max-Age': '86400', 
};

/**
 * Funzione per inviare una richiesta al logging endpoint
 * per registrare le richieste non autorizzate o con origine non consentita.
 * Ora include anche l'indirizzo IP della richiesta.
 */
async function logUnauthorizedRequest(req: NextRequest, status: number, errorMsg: string) {
  // Estrae l'IP dai comuni header utilizzati per indicare l'IP reale
  const ip = req.headers.get('x-forwarded-for') || req.headers.get('x-real-ip') || 'unknown';
  
  // Prepara il payload da inviare (convertito in JSON)
  const payload = JSON.stringify({
    method: req.method,
    url: req.nextUrl.toString(),
    headers: Object.fromEntries(req.headers.entries()),
    status,
    error: errorMsg,
    ip  // Campo aggiunto per salvare l'indirizzo IP
  });
  
  try {
    // Costruisci l'URL assoluto per il logging endpoint usando la URL della richiesta corrente come base
    const logUrl = new URL('/api/log', req.url).toString();
    
    await fetch(logUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: payload,
    });
  } catch (err) {
    console.error("Errore nel logging dal middleware:", err);
  }
}

export async function middleware(req: NextRequest) {
  const origin = req.headers.get('origin');

  if (req.method === 'OPTIONS') {
    return NextResponse.json({ status: 200 }, { headers: corsHeaders });
  }

  // Leggi l'API key dall'header o dal parametro di query
  const apiKeyHeader = req.headers.get('x-api-key');
  const apiKeyQuery = req.nextUrl.searchParams.get('apiKey');
  const apiKey = apiKeyHeader || apiKeyQuery;

  // Log di debug: controlla i valori
  console.log("Middleware: API Key ricevuta =", apiKey, "| API Key attesa =", process.env.NEXT_PUBLIC_API_KEY);

  if (!apiKey || apiKey !== process.env.NEXT_PUBLIC_API_KEY) {
    // Logga il tentativo non autorizzato (incluso l'indirizzo IP)
    await logUnauthorizedRequest(req, 401, "Non autorizzato: API Key non valida o mancante");
    return NextResponse.json(
      { error: "Non autorizzato: API Key non valida o mancante" },
      { 
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    );
  }

  if (origin && !allowedOrigins.includes(origin)) {
    await logUnauthorizedRequest(req, 403, "Origine non consentita");
    return NextResponse.json(
      { error: "Origine non consentita" },
      { 
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    );
  }

  const response = NextResponse.next();
  Object.entries(corsHeaders).forEach(([key, value]) => {
    response.headers.set(key, value);
  });
  return response;
}

export const config = {
  matcher: '/api/:path*',
};
