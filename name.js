import { google } from "googleapis";

function getSheetsClient() {
  const base64Key = process.env.GOOGLE_SERVICE_KEY_B64;
  if (!base64Key) throw new Error("Missing GOOGLE_SERVICE_KEY_B64");
  const creds = JSON.parse(Buffer.from(base64Key, 'base64').toString('utf8'));
  const auth = new google.auth.GoogleAuth({
    credentials: creds,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  return google.sheets({ version: 'v4', auth });
}

async function getNames(limitedEmptyG, sheetId, sheetName) {
  try {
    const sheets = getSheetsClient();

    // Filter entries where status is "Skip"
    const skipRows = limitedEmptyG.filter(entry => entry.status === "Skip");

    if (skipRows.length === 0) return;

    // Prepare batch update requests
    const requests = skipRows.map(entry => ({
      range: `${sheetName}!G${entry.rowNum}`,
      values: [["Skip"]],
    }));

    // Execute the updates
    for (const req of requests) {
      await sheets.spreadsheets.values.update({
        spreadsheetId: sheetId,
        range: req.range,
        valueInputOption: "USER_ENTERED",
        requestBody: {
          values: req.values,
        },
      });
    }
  } catch (error) {
    console.error(`Error updating sheet with Skip status: ${error.message}`);
    throw error;
  }
}

export { getNames };
