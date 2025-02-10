import { NextResponse } from 'next/server';

import prisma from "@/app/lib/prisma";

export async function GET() {
  try {
    // Recupera tutti i record del modello Data, ordinati per createdAt decrescente
    const dataRecords = await prisma.data.findMany({
      orderBy: { createdAt: 'desc' },
    });
    
    return NextResponse.json({
      success: true,
      data: dataRecords,
    });
  } catch (error) {
    console.error('Errore nel recupero dei dati:', error);
    return NextResponse.json(
      { error: 'Errore nel recupero dei dati' },
      { status: 500 }
    );
  }
}
