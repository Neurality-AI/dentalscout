// hyperbrowserModule.js
import dotenv from 'dotenv';
import { Hyperbrowser } from "@hyperbrowser/sdk";
import * as XLSX from "xlsx/xlsx.mjs";
import { readFileSync, writeFileSync } from "fs";

dotenv.config();

const client = new Hyperbrowser({ apiKey: process.env.HYPERBROWSER_API_KEY });

// Helper: extract emails via regex from raw HTML
function extractEmailsFromHtml(html) {
  return html.match(/[\w.-]+@[\w.-]+\.\w+/g) || [];
}

// Helper: find facebook URLs in hrefs or onclick handlers
function extractFacebookUrls(html) {
  const urls = new Set();
  let m;

  const linkRe = /href=["'](https?:\/\/(?:www\.)?facebook\.com\/[^"']+)["']/g;
  while ((m = linkRe.exec(html))) urls.add(m[1]);

  const onClickRe = /onclick=["'][^"']*(https?:\/\/(?:www\.)?facebook\.com\/[^"']+)[^"']*["']/g;
  while ((m = onClickRe.exec(html))) urls.add(m[1]);

  return Array.from(urls);
}

export async function crawlAndWriteToSheet(dataRows, filePath) {
  const buf = readFileSync(filePath);
  const wb = XLSX.read(buf, { type: "buffer" });
  const ws = wb.Sheets[wb.SheetNames[0]];

  for (const row of dataRows) {
    const rowIndex = row[0];
    const rawUrl = row[2]; // Column B (index 2)

    if (!rawUrl) continue;
    const url = rawUrl.startsWith("http") ? rawUrl : `https://${rawUrl}`;
    const emailCell = `D${rowIndex}`;
    const noteCell = `F${rowIndex}`;

    let crawlResult;
    try {
      crawlResult = await client.crawl.startAndWait({
        url,
        maxPages: 5,
        followLinks: true,
        scrapeOptions: {
          formats: ["html", "links"],
          onlyMainContent: false,
          timeout: 30000,
        },
      });
    } catch (err) {
      console.error(`Row ${rowIndex}: Crawl failed for ${url}:`, err.message);
      continue;
    }

    let emails = [];
    const fbUrls = new Set();

    for (const page of crawlResult.data) {
      if (page.status !== "completed") continue;
      const html = page.html || "";
      emails.push(...extractEmailsFromHtml(html));
      extractFacebookUrls(html).forEach(u => fbUrls.add(u));
    }

    for (const fbUrl of fbUrls) {
      try {
        const fbCrawl = await client.crawl.startAndWait({
          url: fbUrl,
          maxPages: 1,
          followLinks: false,
          scrapeOptions: { formats: ["html"], onlyMainContent: false, timeout: 30000 },
        });
        for (const page of fbCrawl.data) {
          if (page.status !== "completed") continue;
          emails.push(...extractEmailsFromHtml(page.html || ""));
        }
      } catch {
        // Ignore FB crawl errors
      }
    }

    emails = Array.from(new Set(emails));
    console.log(`Row ${rowIndex}, URL: ${url} ➜ Found emails:`, emails);

    if (emails.length > 0) {
      const joined = emails.join(", ");
      ws[emailCell] = { t: "s", v: joined };
      ws[noteCell] = { t: "s", v: "Found from URL" };
    }
  }

  const outBuf = XLSX.write(wb, { bookType: "xlsx", type: "buffer" });
  writeFileSync(filePath, outBuf);

  console.log("✅ Crawling complete. Updates saved to", filePath);
}
