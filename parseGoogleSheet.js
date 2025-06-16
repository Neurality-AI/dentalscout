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
const SHEET_ID = "1uzwwZy4eP-t7xVyqz-HbLU_dINnsLVZh9GWWtc_BBhI";
const RANGE = "Owners!A2:D"; //TODO: change to Owners!A2:G

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
    const emptyG = []; // NEW: Track rows with blank column G

    const FLAGS = ["No email found", "NO FB PAGE", "Error"];
    const STATUS_IGNORE = ["Ready", "Skip"]; // NEW: Define statuses to ignore

    rows.forEach((row, i) => {
      const rowNum = i + 2;
      const colA = row[0] || "";
      const colB = row[1] || "";
      const colC = row[2] || "";
      const colD = row[3] || "";
      const colG = row[6] || ""; // NEW: Read column G (Status)

      //New logic for column G and previous logic for column D and flagged D
      if (!colG.trim()) {
        if (colD.trim() === "Processed - No results") {
          emptyG.push({ rowNum, colA, colB, colC, status: "Skip" }); // NEW: Mark to skip
        } else {
          emptyG.push({ rowNum, colA, colB, colC, status: "Blank" }); // NEW: Mark to blank
          // Continue with existing logic for blank Column D and flagged D
          if (!colD.trim()) {
            emptyD.push({ rowNum, colA, colB, colC });
          } else if (FLAGS.some(flag => colD.trim().toLowerCase() === flag.toLowerCase())) {
            flaggedD.push({ rowNum, colA, colB, colC });
          }
        }
      } else if (!STATUS_IGNORE.includes(colG.trim())) {
        // NEW: Only consider rows that are not marked Ready or Skip
        if (!colD.trim()) {
          emptyD.push({ rowNum, colA, colB, colC });
        } else if (FLAGS.some(flag => colD.trim().toLowerCase() === flag.toLowerCase())) {
          flaggedD.push({ rowNum, colA, colB, colC });
        }
      }
    });

    log(`Found ${emptyD.length} rows with blank Column D`);
    log(`Found ${flaggedD.length} rows with flagged Column D`);
    log(`Found ${emptyG.length} rows with blank Column G and 'Processed - No results' in Column D`);

    return { flaggedD, emptyD, emptyG };
  } catch (error) {
    log(`Error reading sheet: ${error.message}`);
    throw error;
  }
}

export async function parseGoogleSheet() {
  try {
    log("Starting Google Sheet parsing job...");
    const { flaggedD, emptyD, emptyG } = await readSheet();

    // Get the actual number of rows to process (up to 10)
    const emptyRowsToProcess = Math.min(emptyD.length, 10);
    const flaggedRowsToProcess = Math.min(flaggedD.length, 10);

    // Get the limited sets of rows
    const limitedEmptyD = emptyD.slice(0, emptyRowsToProcess);
    const limitedFlaggedD = flaggedD.slice(0, flaggedRowsToProcess);

    // Process empty rows if any exist
    if (emptyRowsToProcess > 0) {
      log(`Processing ${emptyRowsToProcess} empty row${emptyRowsToProcess === 1 ? '' : 's'} (${emptyD.length} total available)`);
      await processRows(limitedEmptyD, SHEET_ID, "Owners");
    } else {
      log("No empty rows found, skipping processing.");
    }

    // Process flagged rows if any exist
    if (flaggedRowsToProcess > 0) {
      log(`Processing ${flaggedRowsToProcess} flagged row${flaggedRowsToProcess === 1 ? '' : 's'} (${flaggedD.length} total available)`);
      await crawlAndWriteToGoogleSheet(limitedFlaggedD, SHEET_ID, "Owners");
    } else {
      log("No flagged rows found, skipping processing.");
    }

    // Calculate remaining rows
    const remainingEmpty = Math.max(0, emptyD.length - emptyRowsToProcess);
    const remainingFlagged = Math.max(0, flaggedD.length - flaggedRowsToProcess);

    log("Job completed successfully");
    log(`Summary:
    - Processed ${emptyRowsToProcess} empty rows (${remainingEmpty} remaining)
    - Processed ${flaggedRowsToProcess} flagged rows (${remainingFlagged} remaining)`);

    return { 
      success: true,
      processed: {
        emptyRows: emptyRowsToProcess,
        flaggedRows: flaggedRowsToProcess,
        remainingEmpty,
        remainingFlagged,
        totalEmpty: emptyD.length,
        totalFlagged: flaggedD.length
      }
    };
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
