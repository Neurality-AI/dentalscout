// parseGoogleSheet.js
import { google } from "googleapis";
import dotenv from "dotenv";
import { crawlAndWriteToGoogleSheet } from "./errorIndex.js"; // Adjust path if needed

dotenv.config();

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
  const client = await auth.getClient();
  const sheets = google.sheets({ version: "v4", auth: client });

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

  console.log("✅ Rows with blank Column D:", emptyD);
  console.log("🚩 Rows with flagged Column D:", flaggedD);

  return { flaggedD, emptyD };
}

async function main() {
  const { flaggedD } = await readSheet();

  if (flaggedD.length > 0) {
    await crawlAndWriteToGoogleSheet(flaggedD, SHEET_ID, "Sheet1");
  } else {
    console.log("🎉 No flagged rows found, nothing to crawl.");
  }
}

main();
