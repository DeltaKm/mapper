import { NextResponse } from 'next/server';

import prisma from "@/app/lib/prisma";

export async function GET() {
  try {
    const dataRecords = await prisma.data.findMany({
      orderBy: { createdAt: 'desc' },
    });
    
    return NextResponse.json({
      status: "success", 
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
