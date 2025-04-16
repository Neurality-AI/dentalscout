import dotenv from 'dotenv';
import { google } from 'googleapis';
import { Hyperbrowser } from "@hyperbrowser/sdk";
import { connect } from "puppeteer-core";
import { setTimeout } from "node:timers/promises";
import pLimit from "p-limit";
import Fuse from 'fuse.js';

dotenv.config();

// --- Google Sheets client helper ---
function getSheetsClient() {
  const base64Key = process.env.GOOGLE_SERVICE_KEY_B64;
  if (!base64Key) throw new Error("Missing GOOGLE_SERVICE_KEY_B64");
  const creds = JSON.parse(Buffer.from(base64Key, 'base64').toString('utf8'));
  const auth  = new google.auth.GoogleAuth({
    credentials: creds,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  return google.sheets({ version: 'v4', auth });
}

// --- Update a single cell live ---
async function updateCell(sheets, spreadsheetId, sheetName, cell, value) {
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `${sheetName}!${cell}`,
    valueInputOption: 'RAW',
    requestBody: { values: [[value]] },
  });
}

// --- Exported entry point ---
export async function processRows(dataRows, spreadsheetId, sheetName) {
  if (!process.env.HYPERBROWSER_API_KEY) {
    throw new Error("Missing HYPERBROWSER_API_KEY");
  }

  // 1) Start Hyperbrowser + Puppeteer with increased timeouts
  const client  = new Hyperbrowser({ apiKey: process.env.HYPERBROWSER_API_KEY });
  const session = await client.sessions.create();
  const browser = await connect({
    browserWSEndpoint: session.wsEndpoint,
    defaultViewport: null,
    protocolTimeout: 120000, // Increase protocol timeout to 2 minutes
  });
  const sheets = getSheetsClient();

  const limit  = pLimit(1); // Process one row at a time
  let processedCount = 0;
  let failedCount = 0;

  const tasks = dataRows.slice(0, 24).map(row => 
    limit(async () => {
      const { rowNum, colA: practice, colB: rawDomain, colC: owner } = row;
      if (!rawDomain) return;
  
      const page = await browser.newPage();
      try {
        // Set page timeouts
        await page.setDefaultNavigationTimeout(60000); // 60 seconds
        await page.setDefaultTimeout(30000); // 30 seconds
        
        const url = rawDomain.startsWith("http")
          ? rawDomain
          : `https://${rawDomain}`;
        console.log(`🔍 Row ${rowNum}: ${practice} – ${owner} @ ${url}`);
  
        await page.goto("about:blank");
        await setUserAgent(page);
        await goToGoogle(page);
        await acceptCookies(page);
  
        await searchFacebookPage(page, practice, owner);
        const links = await scrapeGoogleLinks(page);
        console.log(`🔗 Found ${links.length} links`);
        const [emails, phones] = await findEmailFromLinks(page, links, practice, owner);
        console.log(`📧 Emails: ${emails.length}, Phones: ${phones.length}`);
  
        const email = emails[0] || "No email found";
        const phone = phones[0] || "No phone found";
  
        await updateCell(sheets, spreadsheetId, sheetName, `D${rowNum}`, email);
        await updateCell(sheets, spreadsheetId, sheetName, `E${rowNum}`, phone);
  
        console.log(`✅ Row ${rowNum}: ${email}, ${phone}`);
        processedCount++;
      } catch (err) {
        console.error(`❌ Row ${row.rowNum} error:`, err.message);
        await updateCell(sheets, spreadsheetId, sheetName, `D${row.rowNum}`, "Error");
        await updateCell(sheets, spreadsheetId, sheetName, `E${row.rowNum}`, "Error");
        failedCount++;
      } finally {
        try {
          if (!page.isClosed()) await page.close();
        } catch (err) {
          console.warn(`⚠️ Error closing page for row ${rowNum}: ${err.message}`);
        }
      }
    })
  );
  
  // Run all tasks in parallel (limited by pLimit)
  await Promise.all(tasks);
  await browser.close();
  console.log(`🎯 Done: processed ${processedCount} rows successfully, ${failedCount} rows failed.`);
}


// ========== Helpers (unchanged) ==========

async function setUserAgent(page) {
  await page.setUserAgent(
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) " +
    "AppleWebKit/537.36 (KHTML, like Gecko) " +
    "Chrome/119.0.0.0 Safari/537.36"
  );
}

async function goToGoogle(page) {
  await page.goto("https://www.google.com", { waitUntil: "domcontentloaded" });
}

async function acceptCookies(page) {
  await page.evaluate(() => {
    const btn = document.querySelector('form[action*="consent"] button');
    if (btn) btn.click();
  });
}

async function searchFacebookPage(page, businessName, personName) {
  const query = `${businessName} ${personName} facebook`;
  console.log(`🔍 Searching for: ${query}`);
  const url   = `https://www.google.com/search?q=${encodeURIComponent(query)}`;
  console.log(`🔗 Google URL: ${url}`);
  await page.setExtraHTTPHeaders({ "accept-language": "en-US,en;q=0.9" });
  await page.goto(url, { 
    waitUntil: "domcontentloaded", 
    timeout: 60000 
  });
  await setTimeout(500 + Math.random() * 500);
  await page.mouse.move(100, 100);
}

async function scrapeGoogleLinks(page) {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll("a h3"), h => h.parentElement.href)
  );
}

// function getFacebookAboutURL(fbLink) {
//   if (/^https?:\/\/(www\.)?facebook\.com\//.test(fbLink)) {
//     const m = /^(https?:\/\/[^\/]+\/)([^\/?#]+)/.exec(fbLink);
//     return m ? `${m[1]}${m[2]}/about` : fbLink;
//   }
//   return fbLink;
// }
function getFacebookAboutURL(fbLink) {
  if (/^https?:\/\/(www\.)?facebook\.com\//.test(fbLink)) {
    // Normalize trailing slash
    const normalized = fbLink.replace(/\/+$/, '');

    // Don't append if already ends in /about
    if (normalized.endsWith('/about')) return fbLink;

    return `${normalized}/about`;
  }
  return fbLink;
}


async function visitFacebookAbout(page, aboutUrl) {
  await page.goto(aboutUrl, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForSelector("body", { visible: true, timeout: 10000 });
  console.log(`🔗 Visiting: ${aboutUrl}`);
}

async function extractContactInfo(page) {
  return page.evaluate(() => {
    const txt = document.body.innerText;
    const emailRe = /[\w.-]+@[\w.-]+\.\w+/g;
    const phoneRe = /(?:\+?\d{1,3}[ -]?)?(?:\(?\d{3}\)?[ -]?)?\d{3}[ -]?\d{4}/g;
    return {
      emails: txt.match(emailRe) || [],
      phones: txt.match(phoneRe) || []
    };
  });
}

function normalizeName(name) {
  return name
    .toLowerCase()
    .replace(/[,\.]/g, ' ')
    .replace(/\b(dr|dds|inc|llc|clinic|center|of|the|dental|corp|corporation|ltd|co)\b/g, '')
    .replace(/\s{2,}/g, ' ')
    .replace(/\slodi\b/g, '')
    .trim();
}

function isLikelyMatch(practiceName, pageName, ownerName) {
  const cleanPractice = normalizeName(practiceName);
  const cleanOwner    = normalizeName(ownerName);
  const cleanPage     = normalizeName(pageName);

  if (/-|–/.test(practiceName)) {
    const parts = practiceName.split(/[-–]/).map(p => p.trim());
    if (parts[1] && cleanPage.includes(normalizeName(parts[1]))) return true;
  }

  if (
    cleanPage.includes(cleanPractice) ||
    cleanPractice.includes(cleanPage) ||
    cleanPage.includes(cleanOwner) ||
    cleanOwner.includes(cleanPage)
  ) return true;

  const fuse = new Fuse([cleanPractice, cleanOwner].filter(Boolean), {
    includeScore: true,
    threshold: 0.5
  });
  const match = fuse.search(cleanPage)[0];
  return match && match.score <= 0.5;
}

export async function findEmailFromLinks(page, links, practice, ownerName) {
  const emails = [];
  const phones = [];
  let fbPagesVisited = 0;

  for (let i = 0; i < links.length && (emails.length === 0 || phones.length === 0); i++) {
    const aboutLink = getFacebookAboutURL(links[i]);
    console.log(`🔗 Visiting: ${aboutLink}`);
    if (!aboutLink) continue;
    if (aboutLink.includes("facebook.com")) fbPagesVisited++;

    try {
      await visitFacebookAbout(page, aboutLink);
    } catch {
      continue;
    }

    let pageName;
    try {
      pageName = await page.$eval('h1', el => el.innerText.trim());
      console.log(`📄 Page name: ${pageName}`);
    } catch {
      pageName = await page.title();
    }

    if (!isLikelyMatch(practice, pageName, ownerName)) continue;
    console.log(`✅ Likely match: ${pageName}`);

    const { emails: e, phones: p } = await extractContactInfo(page);
    if (!emails.length && e.length) emails.push(...e);
    if (!phones.length && p.length) phones.push(...p);
    console.log(`📧 Found emails: ${emails.length}, phones: ${phones.length}`);
  }

  if (!fbPagesVisited) {
    console.log("❌ No Facebook pages visited, returning empty results.");
    return [
      emails.length ? emails : ["NO FB PAGE"],
      phones.length ? phones : ["NO FB PAGE"]
    ];
  }
  return [emails, phones];
}
