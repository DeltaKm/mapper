import { NextResponse } from "next/server";

export async function GET() {
  try {
    // Health check semplice
    return NextResponse.json({
      status: "healthy",
      timestamp: new Date().toISOString(),
      service: "eosMapper",
      version: "1.0.0"
    }, { status: 200 });
  } catch (error) {
    return NextResponse.json({
      status: "unhealthy",
      error: error instanceof Error ? error.message : "Unknown error"
    }, { status: 503 });
  }
}

export async function HEAD() {
  // Per health check più veloci
  return new Response(null, { status: 200 });
}
