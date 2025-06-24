// import { NextRequest, NextResponse } from "next/server";
// import prisma from "@/app/lib/prisma";
// import moment from "moment-timezone";

// enum StatusCodes {
//   Success = 200,
//   Created = 201,
//   BadRequest = 400,
//   InternalServerError = 500,
// }

// function getItalianDate(): Date {
//   return moment().tz("Europe/Rome").toDate();
// }

// function getItalianDateString(): string {
//   return moment().tz("Europe/Rome").format("YYYY-MM-DD HH:mm:ss");
// }

// const italianDate = getItalianDate();
// const italianDateString = getItalianDateString();


// export async function POST(request: NextRequest) {
//   let savedData = null;
//   let statusCode = StatusCodes.Created;
//   let errorMessage: string | null = null;

//   try {
//     const body = await request.json();
//     const searchParams = request.nextUrl.searchParams;
//     const restaurant_code = searchParams.get("restaurant_code");
//     const subscriber_code = searchParams.get("subscriber_code");

//     let content: any;
//     if (typeof body === "object" && body !== null) {
//       content = { ...body };
//     } else {
//       content = { data: body };
//     }

//     if (restaurant_code !== null) {
//       content.restaurant_code = restaurant_code;
//     }
//     if (subscriber_code !== null) {
//       content.subscriber_code = subscriber_code;
//     }


//     // savedData = await prisma.data.create({
//     //   data: { 
//     //     content,
//     //     createdAt: italianDate,
//     //     createdAtIta: italianDateString

//     //   },
//     // });

//     if (content.customerList && Array.isArray(content.customerList)) {
//       const customerPromises = content.customerList.map(async (customer: any) => {
//         const existingCustomer = await prisma.customer.findFirst({
//           where: {
//             idCustomer: customer.idCustomer,
//             arrived_from: customer.arrived_from,
//           },
//         });

//         const customerData = {
//           idReferenceGateway: customer.idReferenceGateway || "",
//           idCustomer: customer.idCustomer || "",
//           gender: customer.gender || "",
//           name: customer.name || "",
//           surname: customer.surname || "",
//           birth_data: customer.birth_data || "",
//           vat_number: customer.vat_number || "",
//           residence_address: customer.residence_address || "",
//           residence_zipcode: customer.residence_zipcode || "",
//           residence_city: customer.residence_city || "",
//           residence_province: customer.residence_province || "",
//           residence_region: customer.residence_region || "",
//           residence_state: customer.residence_state || "",
//           domicile_address: customer.domicile_address || "",
//           domicile_zipcode: customer.domicile_zipcode || "",
//           domicile_city: customer.domicile_city || "",
//           domicile_province: customer.domicile_province || "",
//           domicile_region: customer.domicile_region || "",
//           domicile_state: customer.domicile_state || "",
//           mobile: customer.mobile || "",
//           email: customer.email || "",
//           publicCode: customer.publicCode || "",
//           subscriber: customer.subscriber || "",
//           arrived_from: customer.arrived_from || "",
//           fidelity_card_number: customer.fidelity_card_number || "",
//           consent_marketing: customer.consent_marketing || "",
//           consent_third_parties_marketing: customer.consent_third_parties_marketing || "",
//           dateCreation: customer.dateCreation || "",
//           dateLastUpdate: customer.dateLastUpdate || "",
//           deleted: customer.deleted || "",
//           restaurant_code: content.restaurant_code || "",
//           subscriber_code: content.subscriber_code || "",
//         };

//         if (existingCustomer) {
//           return await prisma.customer.update({
//             where: { id: existingCustomer.id },
//             data: customerData,
//           });
//         } else {
//           return await prisma.customer.create({
//             data: customerData,
//           });
//         }
//       });

//       await Promise.all(customerPromises);
//     }
//   } catch (error) {
//     console.error("Errore durante la creazione dei dati:", error);
//     statusCode = StatusCodes.InternalServerError;
//     errorMessage = error instanceof Error ? error.message : "Errore sconosciuto";
//   }


//   if (statusCode === StatusCodes.Created) {
//     return NextResponse.json(
//       { status: "success", savedData },
//       { status: StatusCodes.Created }
//     );
//   } else {
//     return NextResponse.json(
//       { message: "Errore durante la creazione dei dati", error: errorMessage },
//       { status: statusCode }
//     );
//   }
// }

// c'è un problema sul campo fidelity nuumber, dobbiamo capire da dove proviene il problema, dal mapper, gateway o easyappear

import { NextRequest, NextResponse } from "next/server";
import prisma from "@/app/lib/prisma";
import moment from "moment-timezone";

enum StatusCodes {
  Success = 200,
  Created = 201,
  BadRequest = 400,
  InternalServerError = 500,
}

function getItalianDate(): Date {
  return moment().tz("Europe/Rome").toDate();
}

function getItalianDateString(): string {
  return moment().tz("Europe/Rome").format("YYYY-MM-DD HH:mm:ss");
}

const italianDate = getItalianDate();
const italianDateString = getItalianDateString();

export async function POST(request: NextRequest) {
  let savedData = null;
  let statusCode = StatusCodes.Created;
  let errorMessage: string | null = null;

  try {
    const body = await request.json();
    const searchParams = request.nextUrl.searchParams;
    const restaurant_code = searchParams.get("restaurant_code");
    const subscriber_code = searchParams.get("subscriber_code");

    let content: any;
    if (typeof body === "object" && body !== null) {
      content = { ...body };
    } else {
      content = { data: body };
    }

    if (restaurant_code !== null) {
      content.restaurant_code = restaurant_code;
    }
    if (subscriber_code !== null) {
      content.subscriber_code = subscriber_code;
    }

    // --- Salvataggio globale dei dati ricevuti ---
    savedData = await prisma.data.create({
      data: { 
        content,
        createdAt: italianDate,
        createdAtIta: italianDateString

      },
    });
    // --- Fine salvataggio globale ---

    // --- Gestione BillList ---
    if (content.BillList && Array.isArray(content.BillList) && content.BillList.length > 0) {
      console.log("BillList trovato, salvataggio in corso...");
      
      const billListPromises = content.BillList.map(async (bill: any) => {
        return await prisma.billList.create({
          data: {
            billData: bill,
            restaurant_code: content.restaurant_code || "",
            subscriber_code: content.subscriber_code || "",
          }
        });
      });

      await Promise.all(billListPromises);
      console.log(`Salvati ${content.BillList.length} record nella collezione BillList`);
    }
    // --- Fine gestione BillList ---

    if (content.customerList && Array.isArray(content.customerList)) {
      const customerPromises = content.customerList.map(async (customer: any) => {
        const existingCustomer = await prisma.customer.findFirst({
          where: {
            idCustomer: customer.idCustomer,
            publicCode: customer.publicCode,
          },
        });

        const customerData = {
          idReferenceGateway: customer.idReferenceGateway || "",
          idCustomer: customer.idCustomer || "",
          gender: customer.gender || "",
          name: customer.name || "",
          surname: customer.surname || "",
          birth_data: customer.birth_data || "",
          vat_number: customer.vat_number || "",
          residence_address: customer.residence_address || "",
          residence_zipcode: customer.residence_zipcode || "",
          residence_city: customer.residence_city || "",
          residence_province: customer.residence_province || "",
          residence_region: customer.residence_region || "",
          residence_state: customer.residence_state || "",
          domicile_address: customer.domicile_address || "",
          domicile_zipcode: customer.domicile_zipcode || "",
          domicile_city: customer.domicile_city || "",
          domicile_province: customer.domicile_province || "",
          domicile_region: customer.domicile_region || "",
          domicile_state: customer.domicile_state || "",
          mobile: customer.mobile || "",
          email: customer.email || "",
          publicCode: customer.publicCode || "",
          subscriber: customer.subscriber || "",
          arrived_from: customer.arrived_from || "",
          fidelity_card_number: customer.fidelity_card_number || "",
          consent_marketing: customer.consent_marketing || "",
          consent_third_parties_marketing: customer.consent_third_parties_marketing || "",
          dateCreation: customer.dateCreation || "",
          dateLastUpdate: customer.dateLastUpdate || "",
          deleted: customer.deleted || "",
          restaurant_code: content.restaurant_code || "",
          subscriber_code: content.subscriber_code || "",
        };

        if (existingCustomer) {
          await prisma.customer.delete({
            where: { id: existingCustomer.id },
          });
        }

        return await prisma.customer.create({
          data: customerData,
        });
      });

      await Promise.all(customerPromises);
    }
  } catch (error) {
    console.error("Errore durante la creazione dei dati:", error);
    statusCode = StatusCodes.InternalServerError;
    errorMessage = error instanceof Error ? error.message : "Errore sconosciuto";
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
