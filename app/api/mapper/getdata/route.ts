import { NextRequest, NextResponse } from "next/server";
import prisma from "@/app/lib/prisma";

enum StatusCodes {
  Success = 200,
  NotFound = 404,
  MethodNotAllowed = 405,
  InternalServerError = 500,
}

export async function GET(request: NextRequest) {
  try {
    const id = request.nextUrl.searchParams.get("id");

    if (id) {
      const data = await prisma.data.findUnique({ where: { id } });
      if (!data) {
        return NextResponse.json(
          { message: "id non trovato" },
          { status: StatusCodes.NotFound }
        );
      }
      return NextResponse.json(data, { status: StatusCodes.Success });
    } else {
      return NextResponse.json(
        { message: "Errore durante il fetch dei dati, inserire id in query param" },
        { status: StatusCodes.MethodNotAllowed }
      );      
    }
  } catch (error) {
    console.error("Errore durante il fetch dei dati", error);
    return NextResponse.json(
      { message: "Errore durante il fetch dei dati" },
      { status: StatusCodes.InternalServerError }
    );
  }
}