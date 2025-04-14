import { google } from "googleapis";
import { config } from "dotenv";
import fs from "fs";

config(); // Loads .env

const SCOPES = ["https://www.googleapis.com/auth/spreadsheets.readonly"];
const auth = new google.auth.GoogleAuth({
  keyFile: "./credentials.json", // Path to your JSON file
  scopes: SCOPES,
});

const SHEET_ID = "149gY7myL9-nE5Q_Mz8PnIBkQF5_Ettql0lVIEuF0Qgg"; // Replace with your sheet ID
const RANGE = "Sheet1!A2:D"; // Adjust sheet name if not "Sheet1"

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
    const rowNum = i + 2; // because we start from A2
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

  console.log("Rows with blank Column D:");
  console.log(emptyD);

  console.log("\nRows with flagged Column D:");
  console.log(flaggedD);
}

readSheet();
