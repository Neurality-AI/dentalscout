// parseGoogleSheet.js
import { google } from "googleapis";
import dotenv from "dotenv";
import { crawlAndWriteToGoogleSheet } from "./errorIndex.js"; // Adjust path if needed
import { processRows } from './index.js';
import fs from 'fs';
import path from 'path';

dotenv.config();

// Configure logging
const LOG_DIR = './logs';
if (!fs.existsSync(LOG_DIR)) {
  fs.mkdirSync(LOG_DIR);
}

const logStream = fs.createWriteStream(
  path.join(LOG_DIR, `parseGoogleSheet_${new Date().toISOString().split('T')[0]}.log`),
  { flags: 'a' }
);

function log(message) {
  const timestamp = new Date().toISOString();
  const logMessage = `[${timestamp}] ${message}`;
  console.log(logMessage);
  logStream.write(logMessage + '\n');
}

const SCOPES = ["https://www.googleapis.com/auth/spreadsheets.readonly"];
const SHEET_ID = "149gY7myL9-nE5Q_Mz8PnIBkQF5_Ettql0lVIEuF0Qgg";
const RANGE = "Sheet1!A2:D";

const credentialsB64 = process.env.GOOGLE_SERVICE_KEY_B64;
if (!credentialsB64) {
  throw new Error("GOOGLE_SERVICE_KEY_B64 is not defined in the environment.");
}

const credentials = JSON.parse(Buffer.from(credentialsB64, "base64").toString("utf-8"));

const auth = new google.auth.GoogleAuth({
  credentials,
  scopes: SCOPES,
});

async function readSheet() {
  try {
    const client = await auth.getClient();
    const sheets = google.sheets({ version: "v4", auth: client });

    log("Fetching data from Google Sheet...");
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: RANGE,
    });

    const rows = response.data.values || [];
    const emptyD = [];
    const flaggedD = [];

    const FLAGS = ["No email found", "NO FB PAGE", "Error"];

    rows.forEach((row, i) => {
      const rowNum = i + 2;
      const colA = row[0] || "";
      const colB = row[1] || "";
      const colC = row[2] || "";
      const colD = row[3] || "";

      if (!colD.trim()) {
        emptyD.push({ rowNum, colA, colB, colC });
      } else if (FLAGS.some(flag => colD.trim().toLowerCase() === flag.toLowerCase())) {
        flaggedD.push({ rowNum, colA, colB, colC });
      }
    });

    log(`Found ${emptyD.length} rows with blank Column D`);
    log(`Found ${flaggedD.length} rows with flagged Column D`);

    return { flaggedD, emptyD };
  } catch (error) {
    log(`Error reading sheet: ${error.message}`);
    throw error;
  }
}

export async function parseGoogleSheet() {
  try {
    log("Starting Google Sheet parsing job...");
    const { flaggedD, emptyD } = await readSheet();

    if (emptyD.length > 0) {
      log(`Processing ${emptyD.length} empty rows...`);
      await processRows(emptyD, SHEET_ID, "Sheet1");
    } else {
      log("No empty rows found, skipping processing.");
    }

    if (flaggedD.length > 0) {
      log(`Processing ${flaggedD.length} flagged rows...`);
      await crawlAndWriteToGoogleSheet(flaggedD, SHEET_ID, "Sheet1");
    } else {
      log("No flagged rows found, skipping processing.");
    }

    log("Job completed successfully");
    return { success: true };
  } catch (error) {
    log(`Job failed: ${error.message}`);
    throw error;
  } finally {
    logStream.end();
  }
}

// Handle process termination
process.on('SIGINT', () => {
  log('Process interrupted');
  logStream.end();
  process.exit(0);
});

process.on('uncaughtException', (error) => {
  log(`Uncaught exception: ${error.message}`);
  logStream.end();
  process.exit(1);
});
