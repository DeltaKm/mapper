
import { NextRequest, NextResponse } from "next/server";
import prisma from "@/app/lib/prisma";

enum StatusCodes {
  Success = 200,
  NotFound = 404,
  InternalServerError = 500,
}

export async function GET(request: NextRequest) {
  try {
    const id = request.nextUrl.searchParams.get("id");
  

    if (id) {
      const log = await prisma.requestLog.findUnique({ where: { id } });
      if (!log) {
        return NextResponse.json(
          { message: "Log non trovato" },
          { status: StatusCodes.NotFound }
        );
      }
      return NextResponse.json(log, { status: StatusCodes.Success });
    } else {
      const logs = await prisma.requestLog.findMany({
        orderBy: { createdAt: "desc" },
      });
      return NextResponse.json(logs, { status: StatusCodes.Success });
    }
  } catch (error) {
    console.error("Errore durante il fetch dei log", error);
    return NextResponse.json(
      { message: "Errore durante il fetch dei log" },
      { status: StatusCodes.InternalServerError }
    );
  }
}
