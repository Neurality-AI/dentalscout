import { Hyperbrowser } from "@hyperbrowser/sdk";
import { config } from "dotenv";
import { connect } from "puppeteer-core";

config(); //TODO fix .env and API key issue

const client = new Hyperbrowser({
  apiKey: "hb_39dbccf019ab326fe91bbf4f3a67",
});

const session = await client.sessions.create();

const browser = await connect({
  browserWSEndpoint: session.wsEndpoint,
  defaultViewport: null,
  headless: false,
});

const [page] = await browser.pages();

await setUserAgent(page);
await goToGoogle(page);
await acceptCookies(page);
await searchFacebookPage(page, "Valley Smile Dental Pleasanton CA", "Dr. Kamlesh Jinjuwadia");

const links = await scrapeGoogleLinks(page);
if (links.length > 0) {
  const aboutLink = getFacebookAboutURL(links[0]);
  if (aboutLink) {
    await visitFacebookAbout(page, aboutLink);
    await extractContactInfo(page);
  }
} else {
  console.log("No links found.");
}

await browser.close();


// ========== 🔻 Helper Functions 🔻 ==========

async function setUserAgent(page) {
  await page.setUserAgent(
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36"
  );
}

async function goToGoogle(page) {
  await page.goto("https://www.google.com", { waitUntil: "domcontentloaded" });
}

async function acceptCookies(page) {
  try {
    const consentBtn = 'form[action*="consent"] button';
    await page.waitForSelector(consentBtn, { timeout: 5000 });
    await page.click(consentBtn);
    console.log("✅ Accepted cookie consent.");
  } catch {
    console.log("ℹ️ No consent screen detected.");
  }
}

async function searchFacebookPage(page, businessName, personName) {
  const searchBox = 'input[name="q"], textarea[name="q"]';
  await page.waitForSelector(searchBox, { visible: true, timeout: 60000 });

  const searchQuery = `site:facebook.com ${businessName} ${personName}`;
  await page.type(searchBox, searchQuery, { delay: 100 });
  await page.keyboard.press("Enter");
  console.log("🔍 Searching for:", searchQuery);

  await page.waitForNavigation({ waitUntil: "domcontentloaded" });
}

async function scrapeGoogleLinks(page) {
  const links = await page.$$eval("a h3", (headings) =>
    headings.map((h) => h.parentElement.href)
  );
  console.log("🔗 Scraped Links:\n", links);
  return links;
}

function getFacebookAboutURL(fbLink) {
  try {
    const url = new URL(fbLink);
    let pathname = url.pathname.replace(/\/$/, '');
    const match = pathname.match(/^\/([^\/?#]+)/);
    if (!match) throw new Error("Invalid Facebook page link");

    return `${url.origin}/${match[1]}/about`;
  } catch (err) {
    console.error("⚠️ Invalid URL format:", err.message);
    return null;
  }
}

async function visitFacebookAbout(page, aboutUrl) {
  console.log("📘 Navigating to About:", aboutUrl);
  await page.goto(aboutUrl, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForSelector("body", { visible: true });
  console.log("🌐 Loaded About Page:", page.url());
}

async function extractContactInfo(page) {
  await page.waitForSelector("body", { visible: true });
  const content = await page.evaluate(() => document.body.innerText);

  const emailRegex = /[\w.-]+@[\w.-]+\.\w+/g;
  const phoneRegex = /(?:\+?\d{1,3}[ -]?)?(?:\(?\d{3}\)?[ -]?)?\d{3}[ -]?\d{4}/g;

  const emails = content.match(emailRegex);
  const phones = content.match(phoneRegex);

  if (!emails && !phones) {
    console.log("🔒 Profile appears to be private or no contact info found.");
  } else {
    if (emails) console.log("📧 Email(s):", emails);
    else console.log("📭 No email found.");

    if (phones) console.log("📞 Phone(s):", phones);
    else console.log("📵 No phone found.");
  }
}
