// Regenerate original PNG artwork using the project's local Playwright Chromium.
import { chromium } from 'playwright';
import { readFile, mkdir, copyFile } from 'node:fs/promises';
const svg = await readFile(new URL('./logo.svg', import.meta.url), 'utf8');
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ deviceScaleFactor: 1 });
  for (const [name, size] of [['icon', 256], ['readme', 512]]) {
    await page.setViewportSize({ width: size, height: size });
    await page.setContent(`<style>html,body{margin:0;background:transparent}svg{width:100vw;height:100vh;display:block}</style>${svg}`);
    await page.screenshot({ path: new URL(`./${name}.png`, import.meta.url).pathname, omitBackground: true });
  }
  const brand = new URL('../../custom_components/petsafe_freshfeed/brand/', import.meta.url);
  await mkdir(brand, { recursive: true });
  await copyFile(new URL('./icon.png', import.meta.url), new URL('icon.png', brand));
} finally {
  await browser.close();
}
