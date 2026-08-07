import puppeteer from 'puppeteer';

(async () => {
  const browser = await puppeteer.launch();
  const page = await browser.newPage();
  
  page.on('pageerror', error => console.log('PAGE EXCEPTION:', error.stack));
  
  console.log("Navigating to port 3001...");
  await page.goto('http://localhost:3001/draw', { waitUntil: 'networkidle0' });
  
  await browser.close();
})();
