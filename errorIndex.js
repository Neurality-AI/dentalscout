// errorIndex.js
import { config } from "dotenv";
import { Hyperbrowser } from "@hyperbrowser/sdk";
import * as XLSX from "xlsx/xlsx.mjs";           // ESM build
import { readFileSync, writeFileSync } from "fs";
import { parseColumns } from "./parseErrorColumns.js";

config(); // Load HYPERBROWSER_API_KEY

const client = new Hyperbrowser({
  apiKey: "hb_39dbccf019ab326fe91bbf4f3a67",
});

// Helper: extract emails via regex from raw HTML
function extractEmailsFromHtml(html) {
  return html.match(/[\w.-]+@[\w.-]+\.\w+/g) || [];
}

// Helper: find facebook URLs in hrefs or onclick handlers
function extractFacebookUrls(html) {
  const urls = new Set();
  let m;

  // <a href="https://facebook.com/…">
  const linkRe = /href=["'](https?:\/\/(?:www\.)?facebook\.com\/[^"']+)["']/g;
  while ((m = linkRe.exec(html))) urls.add(m[1]);

  // onclick="…facebook.com/…"
  const onClickRe = /onclick=["'][^"']*(https?:\/\/(?:www\.)?facebook\.com\/[^"']+)[^"']*["']/g;
  while ((m = onClickRe.exec(html))) urls.add(m[1]);

  return Array.from(urls);
}

async function main() {
  const filePath = "./test1.xlsx";

  // 1) Load workbook into a Buffer (Node ESM) :contentReference[oaicite:2]{index=2}
  const buf      = readFileSync(filePath);
  const wb       = XLSX.read(buf, { type: "buffer" });
  const ws       = wb.Sheets[wb.SheetNames[0]];

  // 2) Only rows marked for retry
  const rows = await parseColumns(filePath);

  for (const { rowIndex, colB: rawUrl } of rows) {
    if (!rawUrl) continue;
    const url       = rawUrl.startsWith("http") ? rawUrl : `https://${rawUrl}`;
    const emailCell = `D${rowIndex}`;
    const noteCell  = `F${rowIndex}`;

    // 3) Crawl the site (follow links, up to 5 pages) :contentReference[oaicite:3]{index=3}
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

    // 4) Aggregate emails and facebook URLs
    let emails = [];
    const fbUrls = new Set();

    for (const page of crawlResult.data) {
      if (page.status !== "completed") continue;
      const html = page.html || "";
      emails.push(...extractEmailsFromHtml(html));
      extractFacebookUrls(html).forEach(u => fbUrls.add(u));
    }

    // 5) Crawl each FB link once for additional emails
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
        // ignore FB crawl errors
      }
    }

    // 6) Dedupe & write back if we found any
    emails = Array.from(new Set(emails));
    console.log(`Row ${rowIndex}, URL: ${url} ➜ Found emails:`, emails);

    if (emails.length > 0) {
      const joined = emails.join(", ");
      ws[emailCell] = { t: "s", v: joined };
      ws[noteCell]  = { t: "s", v: "Found from URL" };
    }
  }

  // 7) Overwrite the same file :contentReference[oaicite:4]{index=4}
  const outBuf = XLSX.write(wb, { bookType: "xlsx", type: "buffer" });
  writeFileSync(filePath, outBuf);

  console.log("🎯 All done. Results saved to", filePath);
}

main();
