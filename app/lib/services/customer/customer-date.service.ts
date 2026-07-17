import { parseFlexibleDate } from "@/app/utils/date/parse_creation_date";

export function resolveDateCreation(
  incomingRaw: string,
  existingRaw: string,
  log?: (msg: string) => void
): string {
  if (!incomingRaw) return existingRaw;

  const incomingTime = parseFlexibleDate(incomingRaw);
  const existingTime = parseFlexibleDate(existingRaw);

  if (!existingRaw) {
    if (incomingTime === null) {
      log?.(`dateCreation in arrivo non parsabile ("${incomingRaw}") ma DB era vuoto → salvata comunque come fallback.`);
    }
    return incomingRaw;
  }

  if (incomingTime === null) {
    log?.(`dateCreation in arrivo non parsabile ("${incomingRaw}"), mantenuto valore esistente "${existingRaw}".`);
    return existingRaw;
  }

  if (existingTime === null) {
    log?.(`dateCreation salvata non parsabile ("${existingRaw}"), sostituita con valore in arrivo "${incomingRaw}".`);
    return incomingRaw;
  }

  if (incomingTime < existingTime) {
    log?.(`dateCreation aggiornata: "${existingRaw}" → "${incomingRaw}" (data precedente ricevuta)`);
    return incomingRaw;
  }

  return existingRaw;
}