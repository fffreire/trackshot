// Renders the SPEC section 13 TikTok list as a phone screenshot: node e2e/fixtures/poppunk-2007.mjs
import { chromium } from "@playwright/test";

const songs = [
  "Thnks fr th Mmrs, Fall Out Boy",
  "Misery Business, Paramore 🎸",
  "Check Yes Juliet, We The Kings",
  "The Great Escape, Boys Like Girls",
  "Dear Maria Count Me In, All Time Low",
  "Shake It, Metro Station",
  "Girlfriend, Avril Lavigne",
  "Untouched, The Veronicas",
  "This Ain't a Scene, It's an Arms Race, Fall Out Boy",
  "Walking Disaster, Sum 41 🤘",
];

const html = `<body style="margin:0;width:390px;height:844px;background:linear-gradient(#2a2238,#0d0b12);color:#fff;font:600 17px/1.45 Inter,sans-serif">
  <div style="display:flex;justify-content:space-between;padding:14px 24px;font-size:15px"><span>9:41</span><span>87%</span></div>
  <div style="text-align:center;font-size:16px;opacity:.7;margin:6px 0 150px">Following &nbsp; <b style="opacity:1">For You</b></div>
  <div style="padding:0 72px 0 16px;text-shadow:0 1px 2px #000">
    <p style="margin:0 0 10px">pop punk songs from 2007 that hit different 🔥</p>
    ${songs.map((song, i) => `<p style="margin:0 0 4px">${i + 1}. ${song}</p>`).join("")}
    <p style="margin:18px 0 0;font-size:16px">@poppunkforever · 2d ago</p>
    <p style="margin:2px 0 0;font-weight:400;font-size:15px">which one was your anthem?? #poppunk #emo</p>
  </div>
</body>`;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
await page.setContent(html);
await page.screenshot({ path: new URL("poppunk-2007.png", import.meta.url).pathname });
await browser.close();
