
import { NextResponse } from 'next/server';
import prisma from "@/app/lib/prisma";


export async function GET() {
  try {
    // Recupera tutti i record del modello RequestLog, ordinati per createdAt decrescente
    const logRecords = await prisma.requestLog.findMany({
      orderBy: { createdAt: 'desc' },
    });
    
    return NextResponse.json({
      success: true,
      logs: logRecords,
    });
  } catch (error) {
    console.error('Errore nel recupero dei log:', error);
    return NextResponse.json(
      { error: 'Errore nel recupero dei log' },
      { status: 500 }
    );
  }
}
