import { NextRequest, NextResponse } from "next/server";
import prisma from "@/app/lib/prisma";

export async function GET(
  request: NextRequest,
  { params }: { params: { jobId: string } }
) {
  try {
    const { jobId } = params;

    if (!jobId) {
      return NextResponse.json(
        { error: "jobId è obbligatorio" },
        { status: 400 }
      );
    }

    const job = await prisma.asyncJob.findUnique({
      where: { id: jobId },
      select: {
        id: true,
        status: true,
        progress: true,
        createdAt: true,
        startedAt: true,
        completedAt: true,
        result: true,
        error: true,
        restaurant_code: true,
        subscriber_code: true
      }
    });

    if (!job) {
      return NextResponse.json(
        { error: "Job non trovato" },
        { status: 404 }
      );
    }

    // Calcola durata
    let duration = null;
    if (job.startedAt) {
      const endTime = job.completedAt || new Date();
      duration = Math.round((endTime.getTime() - job.startedAt.getTime()) / 1000);
    }

    const response = {
      jobId: job.id,
      status: job.status,
      progress: job.progress || 0,
      restaurant_code: job.restaurant_code,
      subscriber_code: job.subscriber_code,
      createdAt: job.createdAt,
      startedAt: job.startedAt,
      completedAt: job.completedAt,
      duration: duration ? `${duration}s` : null,
      result: job.result,
      error: job.error
    };

    return NextResponse.json(response);

  } catch (error) {
    console.error("Errore recupero status job:", error);
    return NextResponse.json(
      { 
        error: "Errore interno del server",
        details: error instanceof Error ? error.message : String(error)
      },
      { status: 500 }
    );
  }
}
