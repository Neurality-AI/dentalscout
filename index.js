import { Hyperbrowser } from "@hyperbrowser/sdk";
import { config } from "dotenv";
import { connect } from "puppeteer-core";
import { setTimeout } from "node:timers/promises";
import { parseColumns } from './parseColumns.js';
import { Cluster } from 'puppeteer-cluster';
import pLimit from 'p-limit';
import * as XLSX from 'xlsx/xlsx.mjs';
import * as fs from 'fs';

config();

const client = new Hyperbrowser({ apiKey: "hb_39dbccf019ab326fe91bbf4f3a67" });
const session = await client.sessions.create();
const browser = await connect({ browserWSEndpoint: session.wsEndpoint, defaultViewport: null });
const limit = pLimit(5);

const filePath = './test1.xlsx';
const fileBuffer = fs.readFileSync(filePath);
const workbook = XLSX.read(fileBuffer, { type: 'buffer' });
const sheetName = workbook.SheetNames[0];
const worksheet = workbook.Sheets[sheetName];

const data = await parseColumns(filePath); // Includes rowIndex, colA, colC
console.log(`Processing ${data.length} new rows...`);

await Promise.all(
  data.map(({ rowIndex, colA: practice, colC: owner }) =>
    limit(async () => {
      const page = await browser.newPage();
      try {
        console.log(`${practice} – ${owner}`);
        await page.goto('about:blank');
        await setUserAgent(page);
        await goToGoogle(page);
        await acceptCookies(page);
        await searchFacebookPage(page, practice, owner);
        const links = await scrapeGoogleLinks(page);
        const contactInfo = await findEmailFromLinks(page, links);

        const email = contactInfo?.[0]?.[0] ?? 'No email found';
        const phone = contactInfo?.[1]?.[0] ?? 'No phone found';

        const emailCell = `D${rowIndex}`;
        const phoneCell = `E${rowIndex}`;
        worksheet[emailCell] = { t: 's', v: email };
        worksheet[phoneCell] = { t: 's', v: phone };

        const updatedBuffer = XLSX.write(workbook, { bookType: 'xlsx', type: 'buffer' });
        fs.writeFileSync(filePath, updatedBuffer);

        console.log(`Row ${rowIndex}: ${email}, ${phone}`);
      } catch (err) {
        console.error(`${owner}:`, err.message);

        worksheet[`D${rowIndex}`] = { t: 's', v: 'Error' };
        worksheet[`E${rowIndex}`] = { t: 's', v: 'Error' };

        const updatedBuffer = XLSX.write(workbook, { bookType: 'xlsx', type: 'buffer' });
        fs.writeFileSync(filePath, updatedBuffer);
      } finally {
        await page.close();
      }
    })
  )
);

console.log('All rows processed.');





//experimental part ends here


// ========== Helper Functions ==========

async function setUserAgent(page) {
    //TODO: Because setting the UA is already a single DevTools call, there’s essentially no “speed” left to squeeze out of a wrapper function—but you can eliminate that call entirely at runtime by moving your UA override into the browser launch/session parameters. Here are two approaches:
  await page.setUserAgent(
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36"
  );
  console.log("User agent set to Chrome 119 on Windows 10.");
}

async function goToGoogle(page) {
    //NOT much here to speed up unless we modify the config code
  await page.goto("https://www.google.com", { waitUntil: "domcontentloaded" });
}

async function acceptCookies(page) {
    const clicked = await page.evaluate(() => {
      const btn = document.querySelector('form[action*="consent"] button');
      if (btn) {
        btn.click();
        return true;
      }
      return false;
    });
  
    if (clicked) {
      console.log("Accepted cookie consent.");
    } else {
      console.log("No consent screen detected.");
    }
  }


async function searchFacebookPage(page, businessName, personName) {
  // 1. Build and go directly to the Google search URL
  // const query = `site:facebook.com ${businessName} ${personName}`;
  const query = `${businessName} ${personName} facebook`;
  const url = `https://www.google.com/search?q=${encodeURIComponent(query)}`;
  console.log("Navigating directly to:", url);

  await page.setExtraHTTPHeaders({ "accept-language": "en-US,en;q=0.9" });
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });

  // 2. Tiny randomized pause (0.5–1 s) to mimic human think‑time
  await setTimeout(500 + Math.random() * 500);  // replaces page.waitForTimeout :contentReference[oaicite:1]{index=1}

  // 3. (Optional) subtle mouse movement to look more human
  await page.mouse.move(100, 100);
}

async function scrapeGoogleLinks(page) {
    // One DevTools round‑trip, no extra logging inside
    return page.evaluate(() =>
      Array.from(document.querySelectorAll("a h3"), h => h.parentElement.href)
    );  // :contentReference[oaicite:0]{index=0}
  }

function getFacebookAboutURL(fbLink) {
    // Inline regex literal: (origin/)(username or ID)
    const m = /^(https?:\/\/[^\/]+\/)([^\/?#]+)/.exec(fbLink);
    return m ? `${m[1]}${m[2]}/about` : null;
  }

async function visitFacebookAbout(page, aboutUrl) {
  console.log("Navigating to About:", aboutUrl);
  await page.goto(aboutUrl, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForSelector("body", { visible: true });
  console.log("Loaded About Page:", page.url());
}

async function extractContactInfo(page) {
  const contactInfo = await page.evaluate(() => {
    const content = document.body.innerText;

    const emailRegex = /[\w.-]+@[\w.-]+\.\w+/g;
    const phoneRegex = /(?:\+?\d{1,3}[ -]?)?(?:\(?\d{3}\)?[ -]?)?\d{3}[ -]?\d{4}/g;

    const emails = content.match(emailRegex) || [];
    const phones = content.match(phoneRegex) || [];

    return { emails, phones };
  });

  // Optional: still show logs
  if (contactInfo.emails.length === 0 && contactInfo.phones.length === 0) {
    console.log("Profile appears to be private or no contact info found.");
  } else {
    if (contactInfo.emails.length > 0) {
      console.log("Email(s):", contactInfo.emails);
    } else {
      console.log("No email found.");
    }

    if (contactInfo.phones.length > 0) {
      console.log("Phone(s):", contactInfo.phones);
    } else {
      console.log("No phone found.");
    }
  }

  return contactInfo;
}

async function findEmailFromLinks(page, links) {
  let emailFound = false;
  let phoneFound = false;
  let result = [[], []]; // [emails, phones]

  for (let i = 0; i < links.length && (!emailFound || !phoneFound); i++) {
    const aboutLink = getFacebookAboutURL(links[i]);
    if (!aboutLink) continue;

    await visitFacebookAbout(page, aboutLink);
    const contactInfo = await extractContactInfo(page);

    if (contactInfo.emails.length > 0 && !emailFound) {
      emailFound = true;
      result[0] = contactInfo.emails;
      console.log("Email(s) found.");
    } else if (!emailFound) {
      console.log(`No email in link[${i}], checking next...`);
    }

    if (contactInfo.phones.length > 0 && !phoneFound) {
      phoneFound = true;
      result[1] = contactInfo.phones;
      console.log("Phone number(s) found.");
    } else if (!phoneFound) {
      console.log(`No phone in link[${i}], checking next...`);
    }
  }

  if (!emailFound && !phoneFound) {
    console.log("No email or phone found in any of the links.");
    return null;
  }

  return result;
}


//defining the batch size using the following function
function chunkArray(array, size) {
  const chunks = [];
  for (let i = 0; i < array.length; i += size) {
    chunks.push(array.slice(i, i + size));
  }
  return chunks;
}