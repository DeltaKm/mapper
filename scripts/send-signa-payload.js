'use strict';

const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const DEFAULT_PAYLOAD_PATH = path.join(PROJECT_ROOT, 'TempSignaWowRestGateWay_Clienti.txt');
const DEFAULT_RESTAURANT_CODE =
  process.env.SIGNA_RESTAURANT_CODE ||
  'ANTRL0000702';
const DEFAULT_SUBSCRIBER_CODE =
  process.env.SIGNA_SUBSCRIBER_CODE ||
  'SIGNA';
const DEFAULT_ENDPOINT =
  process.env.SIGNA_STORE_ENDPOINT ||
  'http://localhost:3000/api/mapper/storedata';

function loadEnvFiles() {
  const envFiles = ['.env.local', '.env'];
  for (const envFile of envFiles) {
    const fullPath = path.join(PROJECT_ROOT, envFile);
    if (fs.existsSync(fullPath)) {
      dotenv.config({
        path: fullPath,
        override: false
      });
    }
  }
}

function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    file: DEFAULT_PAYLOAD_PATH,
    endpoint: DEFAULT_ENDPOINT,
    restaurant: DEFAULT_RESTAURANT_CODE,
    subscriber: DEFAULT_SUBSCRIBER_CODE
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (!arg.startsWith('--')) {
      continue;
    }

    const nextValue = args[i + 1];
    switch (arg) {
      case '--file':
        if (!nextValue) {
          throw new Error('Valore mancante per --file');
        }
        options.file = path.isAbsolute(nextValue)
          ? nextValue
          : path.resolve(process.cwd(), nextValue);
        i++;
        break;
      case '--endpoint':
        if (!nextValue) {
          throw new Error('Valore mancante per --endpoint');
        }
        options.endpoint = nextValue;
        i++;
        break;
      case '--restaurant':
        if (!nextValue) {
          throw new Error('Valore mancante per --restaurant');
        }
        options.restaurant = nextValue;
        i++;
        break;
      case '--subscriber':
        if (!nextValue) {
          throw new Error('Valore mancante per --subscriber');
        }
        options.subscriber = nextValue;
        i++;
        break;
      default:
        console.warn(`Argomento sconosciuto ignorato: ${arg}`);
    }
  }

  return options;
}

async function sendPayload({ file, endpoint, restaurant, subscriber }) {
  if (!restaurant) {
    throw new Error('Specificare il codice ristorante con --restaurant o SIGNA_RESTAURANT_CODE.');
  }

  if (!subscriber) {
    throw new Error('Specificare il codice subscriber con --subscriber o SIGNA_SUBSCRIBER_CODE.');
  }

  const apiKey = process.env.NEXT_PUBLIC_API_KEY || process.env.API_KEY;
  if (!apiKey) {
    throw new Error('NEXT_PUBLIC_API_KEY (o API_KEY) non impostata nelle variabili di ambiente.');
  }

  const payloadPath = file || DEFAULT_PAYLOAD_PATH;
  if (!fs.existsSync(payloadPath)) {
    throw new Error(`File payload non trovato: ${payloadPath}`);
  }

  const payload = await fs.promises.readFile(payloadPath, 'utf8');
  const payloadSizeMB = Buffer.byteLength(payload, 'utf8') / (1024 * 1024);
  console.log(`Payload caricato da ${payloadPath} (${payloadSizeMB.toFixed(2)} MB)`);

  let url;
  try {
    url = new URL(endpoint);
  } catch (error) {
    throw new Error(`Endpoint non valido: ${endpoint}. Specificare un URL completo (es: https://.../api/mapper/storedata).`);
  }

  url.searchParams.set('restaurant_code', restaurant);
  url.searchParams.set('subscriber_code', subscriber);

  console.log(`Invio richiesta POST a ${url.toString()}`);

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey
    },
    body: payload
  });

  const text = await response.text();
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = text;
  }

  if (!response.ok) {
    console.error('Errore dalla API:', parsed);
    throw new Error(`Richiesta fallita con status ${response.status}`);
  }

  console.log('Risposta API:', parsed);
}

async function main() {
  try {
    loadEnvFiles();
    const options = parseArgs();
    await sendPayload(options);
    console.log('Invio completato con successo.');
  } catch (error) {
    console.error('Errore durante l\'invio del payload:', error.message);
    process.exitCode = 1;
  }
}

if (require.main === module) {
  main();
}
