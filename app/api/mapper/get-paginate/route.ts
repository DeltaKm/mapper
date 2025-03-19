import { NextRequest, NextResponse } from "next/server";
import prisma from "@/app/lib/prisma";

enum StatusCodes {
    Success = 200,
    NotFound = 404,
    MethodNotAllowed = 405,
    InternalServerError = 500,
}

export async function GET(request: NextRequest) {
    const currentPage = Number(request.nextUrl.searchParams?.get) || 1;    
    const perPage = 10

    try {
        return NextResponse.json, ({ status: StatusCodes.Success })
    }
    catch(error) {
        console.error("Errore durante il fetch dei dati", error);
        return NextResponse.json(
            {message: "Errore durante il fetch dei dato", error},
            {status: StatusCodes.InternalServerError}
        )
    }
    
}