import { Hyperbrowser } from "@hyperbrowser/sdk";
import { config } from "dotenv";
import { connect } from "puppeteer-core";

config();  // Load .env if needed

const client = new Hyperbrowser({
  apiKey: "hb_39dbccf019ab326fe91bbf4f3a67",
});

const session = await client.sessions.create();

const browser = await connect({
  browserWSEndpoint: session.wsEndpoint,
  defaultViewport: null,
  headless: false,  // Show browser window (for debugging)
});

const [page] = await browser.pages();

// ✅ Set user agent to avoid bot detection
await page.setUserAgent(
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36"
);

// ✅ 1. Go to Google
await page.goto("https://www.google.com");

// ✅ 2. Try to accept cookie consent (if it appears)
try {
  const consentBtn = 'form[action*="consent"] button';
  await page.waitForSelector(consentBtn, { timeout: 5000 });
  await page.click(consentBtn);
  console.log("✔️ Accepted cookie consent.");
} catch (err) {
  console.log("ℹ️ No consent screen detected.");
}

// ✅ 3. Wait for search box (support both input + textarea)
const searchBox = 'input[name="q"], textarea[name="q"]';
await page.waitForSelector(searchBox, { visible: true, timeout: 60000 });
await page.click(searchBox);

console.log("✔️ Search box is visible.");

// ✅ 4. Type query with delay
await page.type(
  searchBox,
  "site:facebook.com Lodi Dental Care Dr. Susana Ung",
  { delay: 100 }
);
console.log("✔️ Typed query: site:facebook.com Lodi Dental Care Dr. Susana Ung");

// ✅ 5. Press Enter
await page.keyboard.press("Enter");

console.log("🔍 Searching for: site:facebook.com Lodi Dental Care Dr. Susana Ung");

// ✅ 6. Wait for search results
await page.waitForNavigation({ waitUntil: "domcontentloaded" });

console.log("✔️ Search results loaded.");

// ✅ 7. Scrape result links
const links = await page.$$eval("a h3", (headings) =>
  headings.map((h) => h.parentElement.href)
);

console.log("🔗 Scraped Links:\n", links);
