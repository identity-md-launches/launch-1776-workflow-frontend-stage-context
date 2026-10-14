import { chromium } from "playwright";
import { readFile } from "node:fs/promises";
const browser = await chromium.launch();
try {
  const page = await browser.newPage({
    viewport: { width: 1200, height: 630 },
    deviceScaleFactor: 1,
  });
  await page.setContent(
    `<style>body{margin:0}</style>${await readFile(new URL("../artwork/share.svg", import.meta.url), "utf8")}`,
  );
  await page.screenshot({
    path: new URL("../public/share.png", import.meta.url).pathname,
  });
} finally {
  await browser.close();
}
