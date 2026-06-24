import { chromium } from 'playwright';

const BASE = 'http://localhost:3000';
const OUT = '/Users/morkeeth/CODE/world-relay/public';
// Square 1080x1080 output — use a mobile viewport, screenshot, then crop to square
const viewport = { width: 430, height: 430 };

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport, deviceScaleFactor: 3 });

// Pre-seed localStorage
const seed = await ctx.newPage();
await seed.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 15000 });
await seed.evaluate(() => {
  localStorage.setItem('relay_user_id', 'demo_screenshot');
  localStorage.setItem('relay_verification_level', 'dev');
});
await seed.close();

// Screenshot 1: Feed — scroll to show tasks
const p1 = await ctx.newPage();
await p1.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 15000 });
await p1.waitForTimeout(3000);
await p1.screenshot({ path: `${OUT}/showcase-1.png` });
console.log('showcase-1: feed (1290x1290 @ 3x)');

// Screenshot 2: Demo
const p2 = await ctx.newPage();
await p2.goto(`${BASE}/demo`, { waitUntil: 'domcontentloaded', timeout: 15000 });
await p2.waitForTimeout(2000);
await p2.screenshot({ path: `${OUT}/showcase-2.png` });
console.log('showcase-2: demo');

// Screenshot 3: Chat
const p3 = await ctx.newPage();
await p3.goto(`${BASE}/xmtp`, { waitUntil: 'domcontentloaded', timeout: 15000 });
await p3.waitForTimeout(2000);
const input = p3.getByPlaceholder(/ask the relay/i);
if (await input.isVisible({ timeout: 3000 }).catch(() => false)) {
  await input.fill("what's available right now?");
  await input.press('Enter');
  await p3.waitForTimeout(8000);
}
await p3.screenshot({ path: `${OUT}/showcase-3.png` });
console.log('showcase-3: chat');

await browser.close();

// Resize all to exactly 1080x1080
import { readFileSync, writeFileSync } from 'fs';

// Use sharp-free approach: Python PIL
import { execSync } from 'child_process';
for (const f of ['showcase-1.png', 'showcase-2.png', 'showcase-3.png']) {
  execSync(`python3 -c "
from PIL import Image
img = Image.open('${OUT}/${f}')
img = img.resize((1080, 1080), Image.LANCZOS)
img.save('${OUT}/${f}')
print('${f}:', img.size)
"`);
}
console.log('All resized to 1080x1080');
