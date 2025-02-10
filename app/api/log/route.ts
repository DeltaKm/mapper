// app/api/log/route.ts
import { NextResponse } from 'next/server';
import prisma from "@/app/lib/prisma";

// Inizializza un'istanza di Prisma (usa un singleton se necessario)


export async function POST(request: Request) {
  try {
    const { method, url, headers, status, error } = await request.json();
    
    const logEntry = await prisma.requestLog.create({
      data: {
        method,
        url,
        headers, // verrà salvato come JSON
        status,
        error,
        // dataId rimane null in questo caso; puoi impostarlo se hai un riferimento a un record in Data
        dataId: null,
      },
    });
    
    return NextResponse.json({ success: true, log: logEntry });
  } catch (err) {
    console.error("Errore nel salvataggio del log:", err);
    return NextResponse.json(
      { error: "Errore nel salvataggio del log" },
      { status: 500 }
    );
  }
}
