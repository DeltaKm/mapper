
import { NextRequest, NextResponse } from 'next/server';
import prisma from "@/app/lib/prisma";

enum StatusCodes {
  Success = 200,
  Created = 201,
  BadRequest = 400,
  InternalServerError = 500,
}

export async function POST(request: NextRequest) {
    let savedData = null;
    let statusCode = StatusCodes.Created;
    let errorMessage: string | null = null;
    
    try {     
      const body = await request.json();    
    
      savedData = await prisma.data.create({
        data: { content: body },
      });
    } catch (error) {
      console.error("Errore durante la creazione dei dati:", error);
      statusCode = StatusCodes.InternalServerError;
      errorMessage = error instanceof Error ? error.message : "Errore sconosciuto";
    }
    
   
    try {
      await prisma.requestLog.create({
        data: {
          method: request.method,
          url: request.nextUrl.toString(),
        
          dataId: savedData ? savedData.id : null,
          headers: Object.fromEntries(request.headers.entries()),
          status: statusCode,
          error: errorMessage,
        },
      });
    } catch (logError) {
   
      console.error("Errore durante la registrazione del log:", logError);
    }
    

    if (statusCode === StatusCodes.Created) {
      return NextResponse.json(
        { status: "success", savedData },
        { status: StatusCodes.Created }
      );
    } else {
      return NextResponse.json(
        { message: "Errore durante la creazione dei dati", error: errorMessage },
        { status: statusCode }
      );
    }
  }
  