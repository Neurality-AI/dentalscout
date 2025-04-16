import dotenv from 'dotenv';
import { google } from 'googleapis';
import { Hyperbrowser } from "@hyperbrowser/sdk";

// Load environment variables
dotenv.config();

const client = new Hyperbrowser({ apiKey: process.env.HYPERBROWSER_API_KEY });

if (!process.env.HYPERBROWSER_API_KEY) {
  console.error("HYPERBROWSER_API_KEY is not set.");
  throw new Error("Missing HYPERBROWSER_API_KEY.");
}

// List of domains we consider personal email providers
const personalEmailDomains = ["gmail.com", "yahoo.com", "hotmail.com", "outlook.com", "aol.com", "protonmail.com", "icloud.com"];

// List of domains to exclude (monitoring services, error tracking, etc.)
const excludedEmailDomains = [
  "sentry.io",
  "sentry-next.wixpress.com",
  "newrelic.com",
  "datadoghq.com",
  "rollbar.com",
  "bugsnag.com",
  "airbrake.io",
  "raygun.com"
];

// Function to validate if a string is a valid email
function isValidEmail(email) {
  const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
  return emailRegex.test(email);
}

// Function to check if the email is personal (based on the domain)
function isPersonalEmail(email) {
  return personalEmailDomains.some(domain => email.endsWith("@" + domain));
}

// Function to check if email should be excluded
function isExcludedEmail(email) {
  return excludedEmailDomains.some(domain => email.endsWith("@" + domain));
}

// Function to extract valid emails from HTML
function extractEmailsFromHtml(html) {
  const emails = (html.match(/[\w.-]+@[\w.-]+\.\w+/g) || [])
    .map(email => email.toLowerCase())
    .filter(isValidEmail) // Filter valid emails
    .filter(email => !isExcludedEmail(email)); // Filter out excluded domains
  return emails;
}

// Function to extract Facebook URLs from HTML
function extractFacebookUrls(html) {
  const urls = new Set();
  let match;

  const linkRegex = /href=["'](https?:\/\/(?:www\.)?facebook\.com\/[^"']+)["']/g;
  while ((match = linkRegex.exec(html))) urls.add(match[1]);

  const onClickRegex = /onclick=["'][^"']*(https?:\/\/(?:www\.)?facebook\.com\/[^"']+)[^"']*["']/g;
  while ((match = onClickRegex.exec(html))) urls.add(match[1]);

  return Array.from(urls);
}

// Get Google Sheets client
function getGoogleSheetsClient() {
  const base64Key = process.env.GOOGLE_SERVICE_KEY_B64;

  if (!base64Key) {
    console.error("GOOGLE_SERVICE_KEY_B64 is not set.");
    throw new Error("Missing Google Service Key.");
  }

  const jsonString = Buffer.from(base64Key, 'base64').toString('utf8');

  let credentials;
  try {
    credentials = JSON.parse(jsonString);
  } catch (err) {
    console.error("Failed to parse credentials JSON:", err);
    throw new Error("Invalid credentials format.");
  }

  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });

  return google.sheets({ version: 'v4', auth });
}

// Function to update the Google Sheet
async function updateGoogleSheet(sheets, rowIndex, spreadsheetId, sheetName, value) {
  const cell = `D${rowIndex}`;
  try {
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `${sheetName}!${cell}`,
      valueInputOption: 'RAW',
      requestBody: {
        values: [[value]],
      },
    });
  } catch (err) {
    console.error(`Failed to write to Google Sheet for Row ${rowIndex}:`, err.message);
  }
}

// Main function to crawl and write to Google Sheet
export async function crawlAndWriteToGoogleSheet(dataRows, spreadsheetId, sheetName) {
  console.log("🚀 Starting crawlAndWriteToGoogleSheet...");
  const sheets = getGoogleSheetsClient();
  let processedCount = 0;
  let failedCount = 0;

  for (const row of dataRows) {
    console.log(`🔍 Processing row: ${JSON.stringify(row)}`);
    const rowIndex = row.rowNum;
    const rawUrl = row.colB;

    console.log(`🌐 Row ${rowIndex}: Raw URL: ${rawUrl}`);
    if (!rawUrl) continue;

    const url = rawUrl.startsWith("http") ? rawUrl : `https://${rawUrl}`;
    console.log(`🌐 Row ${rowIndex}: Crawling URL: ${url}`);

    let crawlResult;
    try {
      crawlResult = await client.crawl.startAndWait({
        url,
        maxPages: 5,
        followLinks: true,
        scrapeOptions: {
          formats: ["html", "links"],
          onlyMainContent: false,
          timeout: 60000, // Increased timeout to 60 seconds
        },
      });
    } catch (err) {
      console.error(`❌ Row ${rowIndex}: Crawl failed for ${url}:`, err.message);
      await updateGoogleSheet(sheets, rowIndex, spreadsheetId, sheetName, "Error");
      failedCount++;
      continue;
    }

    let emails = [];
    const fbUrls = new Set();

    for (const page of crawlResult.data) {
      if (page.status !== "completed") continue;
      const html = page.html || "";
      emails.push(...extractEmailsFromHtml(html));
      extractFacebookUrls(html).forEach(url => fbUrls.add(url));
    }

    for (const fbUrl of fbUrls) {
      try {
        const fbCrawl = await client.crawl.startAndWait({
          url: fbUrl,
          maxPages: 1,
          followLinks: false,
          scrapeOptions: {
            formats: ["html"],
            onlyMainContent: false,
            timeout: 60000, // Increased timeout to 60 seconds
          },
        });

        for (const page of fbCrawl.data) {
          if (page.status === "completed") {
            emails.push(...extractEmailsFromHtml(page.html || ""));
          }
        }
      } catch (err) {
        console.warn(`⚠️ Facebook crawl failed for ${fbUrl}: ${err.message}`);
        // Continue with other URLs even if one fails
      }
    }

    emails = Array.from(new Set(emails)) // Deduplicate
      .filter(email => !isExcludedEmail(email)); // Additional filter for excluded emails

    // Prioritize personal emails, if available
    let finalEmail = null;
    const personalEmails = emails.filter(isPersonalEmail);

    if (personalEmails.length > 0) {
      finalEmail = personalEmails[0]; // Select the first personal email
    } else if (emails.length > 0) {
      finalEmail = emails[0]; // Otherwise, select the first valid email (company email)
    }

    const finalValue = finalEmail || "No email found";
    console.log(`📧 Row ${rowIndex}, URL: ${url} ➜ Final Email: ${finalValue}`);

    await updateGoogleSheet(sheets, rowIndex, spreadsheetId, sheetName, finalValue);
    processedCount++;
  }

  console.log(`✅ All rows processed. Successfully processed: ${processedCount}, Failed: ${failedCount}`);
}
