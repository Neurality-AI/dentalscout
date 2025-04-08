const puppeteer = require('puppeteer');

(async () => {
  const browser = await puppeteer.launch({ headless: false });
  const page = await browser.newPage();

  await page.goto('https://www.google.com');

  await page.type('textarea[name="q"]', 'site:facebook.com Lodi Dental Care Dr. Susana Ung');
  await page.keyboard.press('Enter');

  await page.waitForSelector('a[href^="https://www.facebook.com"]', { timeout: 60000 });

  const links = await page.$$eval('a', (anchors) =>
    anchors.map(a => a.href).filter(link => link.includes('facebook.com'))
  );

  console.log('Top Facebook result:', links[0]);

  await browser.close();
})();

