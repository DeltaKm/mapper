
import { NextRequest, NextResponse } from 'next/server';

const allowedOrigins = [ 
  'http://localhost:3000',
  'https://eosmapper-416914793312.europe-west1.run.app',
  '*'
];

const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': '*', 
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-API-Key',
  'Access-Control-Max-Age': '86400', 
};

async function logUnauthorizedRequest(req: NextRequest, status: number, errorMsg: string) {
  const ip = req.headers.get('x-forwarded-for') || req.headers.get('x-real-ip') || 'unknown';  

  const payload = JSON.stringify({
    method: req.method,
    url: req.nextUrl.toString(),
    headers: Object.fromEntries(req.headers.entries()),
    status,
    error: errorMsg,
    ip  
  });
  
  try {
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
   if (process.env.NODE_ENV === 'development') {
    return NextResponse.next();
  }
  const origin = req.headers.get('origin');

  if (req.method === 'OPTIONS') {
    return NextResponse.json({ status: 200 }, { headers: corsHeaders });
  }

  const apiKeyHeader = req.headers.get('x-api-key');
  const apiKeyQuery = req.nextUrl.searchParams.get('apiKey');
  const apiKey = apiKeyHeader || apiKeyQuery;

  // da cambiare questo console log
  // console.log("Middleware: API Key ricevuta =", apiKey, "| API Key attesa =", process.env.NEXT_PUBLIC_API_KEY);

  if (!apiKey || apiKey !== process.env.NEXT_PUBLIC_API_KEY) {
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
