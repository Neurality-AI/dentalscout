import { Hyperbrowser } from "@hyperbrowser/sdk";
import { config } from "dotenv";
import { connect } from "puppeteer-core";
import { setTimeout } from "node:timers/promises";
import { parseColumns } from './parseColumns.js';
import { Cluster } from 'puppeteer-cluster';
import pLimit from 'p-limit';
import * as XLSX from 'xlsx/xlsx.mjs';
import * as fs from 'fs';
import Fuse from 'fuse.js';

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

// await Promise.all(
//   data.map(({ rowIndex, colA: practice, colC: owner }) =>
//     limit(async () => {
//       const page = await browser.newPage();
//       try {
//         console.log(`${practice} – ${owner}`);
//         await page.goto('about:blank');
//         await setUserAgent(page);
//         await goToGoogle(page);
//         await acceptCookies(page);
//         await searchFacebookPage(page, practice, owner);
//         const links = await scrapeGoogleLinks(page);
//         const contactInfo = await findEmailFromLinks(page, links);

//         const email = contactInfo?.[0]?.[0] ?? 'No email found';
//         const phone = contactInfo?.[1]?.[0] ?? 'No phone found';

//         const emailCell = `D${rowIndex}`;
//         const phoneCell = `E${rowIndex}`;
//         worksheet[emailCell] = { t: 's', v: email };
//         worksheet[phoneCell] = { t: 's', v: phone };

//         const updatedBuffer = XLSX.write(workbook, { bookType: 'xlsx', type: 'buffer' });
//         fs.writeFileSync(filePath, updatedBuffer);

//         console.log(`Row ${rowIndex}: ${email}, ${phone}`);
//       } catch (err) {
//         console.error(`${owner}:`, err.message);

//         worksheet[`D${rowIndex}`] = { t: 's', v: 'Error' };
//         worksheet[`E${rowIndex}`] = { t: 's', v: 'Error' };

//         const updatedBuffer = XLSX.write(workbook, { bookType: 'xlsx', type: 'buffer' });
//         fs.writeFileSync(filePath, updatedBuffer);
//       } finally {
//         await page.close();
//       }
//     })
//   )
// );

// Variable to track the number of processed rows
let processedCount = 0;

for (let i = 0; i < data.length; i++) {
  // Exit if 24 rows have been processed
  if (processedCount >= 24) break;

  // Get the current row's data
  const { rowIndex, colA: practice, colC: owner } = data[i];

  // Open a new page for each row (using the same browser session)
  const page = await browser.newPage();
  try {
    // Log the current practice and owner
    console.log(`${practice} – ${owner}`);
    
    // Navigate to a blank page to start the scraping process
    await page.goto('about:blank');

    // Set the user agent for the page (important for web scraping to avoid blocking)
    await setUserAgent(page);

    // Visit Google search
    await goToGoogle(page);

    // Accept cookies on the website if prompted
    await acceptCookies(page);

    // Perform a search on Facebook for the given practice and owner
    await searchFacebookPage(page, practice, owner);

    // Scrape the Google links from the search results
    const links = await scrapeGoogleLinks(page);

    // Extract the contact information (email and phone) from the scraped links
    const contactInfo = await findEmailFromLinks(page, links, practice, owner);

    // Use the extracted email and phone, or default to 'No email found' and 'No phone found' if not found
    const email = contactInfo?.[0]?.[0] ?? 'No email found';
    const phone = contactInfo?.[1]?.[0] ?? 'No phone found';

    // Define the cells to update in the Excel sheet (column D for email and column E for phone)
    const emailCell = `D${rowIndex}`;
    const phoneCell = `E${rowIndex}`;

    // Update the Excel worksheet with the found email and phone
    worksheet[emailCell] = { t: 's', v: email };
    worksheet[phoneCell] = { t: 's', v: phone };

    // Write the updated workbook to a buffer and save it to the file
    const updatedBuffer = XLSX.write(workbook, { bookType: 'xlsx', type: 'buffer' });
    fs.writeFileSync(filePath, updatedBuffer);

    // Log the updated contact info for the current row
    console.log(`Row ${rowIndex}: ${email}, ${phone}`);

    // Increment the counter after processing a row
    processedCount++;
  } catch (err) {
    // If an error occurs, log it and update the Excel sheet with 'Error' for email and phone
    console.error(`${owner}:`, err.message);

    worksheet[`D${rowIndex}`] = { t: 's', v: 'Error' };
    worksheet[`E${rowIndex}`] = { t: 's', v: 'Error' };

    // Write the updated workbook to a buffer and save it to the file in case of error
    const updatedBuffer = XLSX.write(workbook, { bookType: 'xlsx', type: 'buffer' });
    fs.writeFileSync(filePath, updatedBuffer);
  } finally {
    // Close the browser page after processing the row
    await page.close();
  }
}

console.log("Processing finished or 24 rows processed.");


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
  // If it's a Facebook link, rewrite to /about
  if (/^https?:\/\/(www\.)?facebook\.com\//.test(fbLink)) {
    const m = /^(https?:\/\/[^\/]+\/)([^\/?#]+)/.exec(fbLink);
    return m ? `${m[1]}${m[2]}/about` : fbLink;
  }

  // Otherwise, return the link as is
  return fbLink;
}


async function visitFacebookAbout(page, aboutUrl) {
  console.log("Navigating to About:", aboutUrl);

  try {
    await page.goto(aboutUrl, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForSelector("body", { visible: true, timeout: 10000 });
    console.log("✅ Loaded About Page:", page.url());
  } catch (err) {
    if (!aboutUrl.includes("facebook.com")) {
      console.log("⚠️ Not a Facebook page. Skipping error and moving on.");
      return;
    }

    console.error(`❌ Error while visiting Facebook page: ${aboutUrl}`);
    console.error("Error Reason:", err.message);
    throw new Error(`visitFacebookAbout failed for Facebook URL: ${err.message}`);
  }
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





function normalizeName(name) {
  return name
    .toLowerCase()
    .replace(/[,\.]/g, ' ') // replace punctuation with space
    .replace(/\b(dr|dds|inc|llc|clinic|center|of|the|dental|corp|corporation|ltd|co)\b/g, '')
    .replace(/\s{2,}/g, ' ') // collapse multiple spaces
    .replace(/\slodi\b/g, '') // optional city filter
    .trim();
}

function isLikelyMatch(practiceName, pageName, ownerName) {
  const cleanPractice = normalizeName(practiceName);
  const cleanOwner = normalizeName(ownerName);
  const cleanPage = normalizeName(pageName);

  const dashRegex = /[-–]/;
  if (dashRegex.test(practiceName)) {
    const parts = practiceName.split(dashRegex).map(p => p.trim());
    if (parts.length > 1) {
      const doctorPart = normalizeName(parts[1]);
      if (cleanPage.includes(doctorPart)) {
        return true;
      }
    }
  }

  // ✅ Substring match
  if (
    cleanPage.includes(cleanPractice) || cleanPractice.includes(cleanPage) ||
    cleanPage.includes(cleanOwner) || cleanOwner.includes(cleanPage)
  ) return true;

  // ✅ Fuzzy fallback
  const fuse = new Fuse([cleanPractice, cleanOwner].filter(Boolean), {
    includeScore: true,
    threshold: 0.5, // slightly more lenient
  });

  const match = fuse.search(cleanPage)[0];
  return match && match.score <= 0.5;
}


export async function findEmailFromLinks(page, links, practice, ownerName) {
  const emails = [];
  const phones = [];

  for (let i = 0; i < links.length && (emails.length === 0 || phones.length === 0); i++) {
    const aboutLink = getFacebookAboutURL(links[i]);
    if (!aboutLink) continue;

    await visitFacebookAbout(page, aboutLink);

    let pageName;
    try {
      pageName = await page.$eval('h1', el => el.innerText.trim());
    } catch {
      pageName = await page.title();
    }

    if (!isLikelyMatch(practice, pageName, ownerName)) {
      console.log(`⚠️ Skipping "${pageName}"—insufficient match for "${practice}" or "${ownerName}"`);
      continue;
    }

    console.log(`✅ Validated page "${pageName}" matches "${practice}" or "${ownerName}"`);

    const contactInfo = await extractContactInfo(page);

    if (emails.length === 0 && contactInfo.emails.length > 0) {
      emails.push(...contactInfo.emails);
      console.log(`📧 Email(s) found on link[${i}]:`, contactInfo.emails);
    }
    if (phones.length === 0 && contactInfo.phones.length > 0) {
      phones.push(...contactInfo.phones);
      console.log(`📞 Phone(s) found on link[${i}]:`, contactInfo.phones);
    }
  }

  if (emails.length === 0 && phones.length === 0) {
    console.log("No email or phone found in any of the validated links.");
    return null;
  }

  return [emails, phones];
}







//defining the batch size using the following function
function chunkArray(array, size) {
  const chunks = [];
  for (let i = 0; i < array.length; i += size) {
    chunks.push(array.slice(i, i + size));
  }
  return chunks;
}