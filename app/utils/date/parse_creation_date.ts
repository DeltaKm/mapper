import moment from "moment-timezone";

// Prova a interpretare una data in vari formati comuni (ISO, DD/MM/YYYY, ecc.)
// e restituisce il timestamp in millisecondi, oppure null se non è parsabile.
// Usata per confrontare in modo affidabile dateCreation in arrivo vs quella salvata,
// anche quando le sorgenti (Signa, DylogApp, app) inviano formati diversi.
export function parseFlexibleDate(value: any): number | null {
  if (!value) return null;

  const str = value.toString().trim();
  if (!str) return null;

  const nativeAttempt = moment(str, moment.ISO_8601, true);
  if (nativeAttempt.isValid()) return nativeAttempt.valueOf();

  const formats = [
    "DD/MM/YYYY HH:mm:ss",
    "DD/MM/YYYY",
    "YYYY-MM-DD HH:mm:ss",
    "YYYY-MM-DD",
  ];
  const strictAttempt = moment(str, formats, true);
  if (strictAttempt.isValid()) return strictAttempt.valueOf();

  const looseAttempt = moment(str);
  if (looseAttempt.isValid()) return looseAttempt.valueOf();

  return null;
}