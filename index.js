import { Hyperbrowser } from "@hyperbrowser/sdk";
import { config } from "dotenv";
import { connect } from "puppeteer-core";
import { setTimeout } from "node:timers/promises";
import { parseColumns } from './parseColumns.js';

//config commands start here
config(); //TODO fix .env and API key issue
const client = new Hyperbrowser({
  apiKey: "hb_39dbccf019ab326fe91bbf4f3a67",
});
const session = await client.sessions.create();
const browser = await connect({
  browserWSEndpoint: session.wsEndpoint,
  defaultViewport: null,
});
const [page] = await browser.pages();
//config commands end here

// ========== Main Script ==========
const data = await parseColumns('./doctors.csv'); //check parseColumns.js for details
const results = [];

//experimental part begins here

const BATCH_COUNT = 5; // number of sessions to run in parallel
const chunks = chunkArray(data, Math.ceil(data.length / BATCH_COUNT)); // split data across sessions

// 👇 Create a helper function to handle each chunk/session
async function processChunk(chunk, index) {
  console.log(`🚀 Starting session ${index + 1}`);

  const session = await client.sessions.create();
  const browser = await connect({
    browserWSEndpoint: session.wsEndpoint,
    defaultViewport: null,
    headless: false,
  });

  const [page] = await browser.pages();

  for (const [practice, owner] of chunk) {
    try {
      console.log(`🔍 [Session ${index + 1}] Processing: ${practice} - ${owner}`);
      await page.goto('about:blank');
      await setUserAgent(page);
      await goToGoogle(page);
      await acceptCookies(page);
      await searchFacebookPage(page, practice, owner);
      const links = await scrapeGoogleLinks(page);
      console.log("🔗 Found links:", links);
      const contactInfo = await findEmailFromLinks(page, links);

      if (contactInfo) {
        console.log("📧 Email(s):", contactInfo.emails);
        results.push([owner, contactInfo.emails[0]]);
      } else {
        results.push([owner, "No email found"]);
      }

    } catch (err) {
      console.error(`❌ [Session ${index + 1}] Error processing ${practice} - ${owner}:`, err.message);
      results.push([owner, "Error"]);
      continue;
    }
  }

  await browser.close();
  console.log(`✅ [Session ${index + 1}] Finished.`);
}

// Launch all sessions in parallel
await Promise.all(chunks.map((chunk, index) => processChunk(chunk, index)));

console.log("\n📋 Final Results:");
for (const [owner, email] of results) {
  console.log(`${owner}: ${email}`);
}


// ========== Helper Functions ==========

async function setUserAgent(page) {
    //TODO: Because setting the UA is already a single DevTools call, there’s essentially no “speed” left to squeeze out of a wrapper function—but you can eliminate that call entirely at runtime by moving your UA override into the browser launch/session parameters. Here are two approaches:
  await page.setUserAgent(
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36"
  );
  console.log("🔧 User agent set to Chrome 119 on Windows 10.");
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
      console.log("✅ Accepted cookie consent.");
    } else {
      console.log("ℹ️ No consent screen detected.");
    }
  }


async function searchFacebookPage(page, businessName, personName) {
  // 1. Build and go directly to the Google search URL
  // const query = `site:facebook.com ${businessName} ${personName}`;
  const query = `${businessName} ${personName} facebook`;
  const url = `https://www.google.com/search?q=${encodeURIComponent(query)}`;
  console.log("🔍 Navigating directly to:", url);

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
  console.log("📘 Navigating to About:", aboutUrl);
  await page.goto(aboutUrl, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForSelector("body", { visible: true });
  console.log("🌐 Loaded About Page:", page.url());
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
    console.log("🔒 Profile appears to be private or no contact info found.");
  } else {
    if (contactInfo.emails.length > 0) {
      console.log("📧 Email(s):", contactInfo.emails);
    } else {
      console.log("📭 No email found.");
    }

    if (contactInfo.phones.length > 0) {
      console.log("📞 Phone(s):", contactInfo.phones);
    } else {
      console.log("📵 No phone found.");
    }
  }

  return contactInfo;
}

async function findEmailFromLinks(page, links) {
  let emailFound = false;

  for (let i = 0; i < links.length && !emailFound; i++) {
    const aboutLink = getFacebookAboutURL(links[i]);
    if (!aboutLink) continue;

    await visitFacebookAbout(page, aboutLink);
    const contactInfo = await extractContactInfo(page);

    if (contactInfo.emails.length > 0) {
      emailFound = true;
      console.log("✅ Email found, stopping search.");
      return contactInfo; // return email info early
    } else {
      console.log(`⏭️ No email in link[${i}], moving to next...`);
    }
  }

  if (!emailFound) {
    console.log("❌ No email found in any of the links.");
    return null;
  }
}

//defining the batch size using the following function
function chunkArray(array, size) {
  const chunks = [];
  for (let i = 0; i < array.length; i += size) {
    chunks.push(array.slice(i, i + size));
  }
  return chunks;
}
