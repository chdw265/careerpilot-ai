import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { chromium, webkit } from "playwright";

const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const style = html.match(/<style>([\s\S]*?)<\/style>/)?.[1];
const header = html.match(/<header>[\s\S]*?<\/header>/)?.[0];
const viewport = html.match(/<meta name="viewport"[^>]*>/)?.[0];

assert.ok(style, "The page must contain its stylesheet");
assert.ok(header, "The page must contain the site header");
assert.match(
  viewport || "",
  /viewport-fit=cover/,
  "The viewport must support iPhone safe areas",
);
assert.match(style, /#signedInNav[\s\S]{0,300}?flex-wrap:\s*wrap/);
assert.match(style, /safe-area-inset-left/);
assert.match(style, /safe-area-inset-right/);

const viewports = [
  { name: "small-phone", width: 320, height: 720 },
  { name: "iphone", width: 390, height: 844 },
  { name: "large-phone", width: 430, height: 932 },
  { name: "phone-landscape", width: 844, height: 390 },
  { name: "tablet", width: 1024, height: 768 },
];

async function inspectLayout(page, mode, viewportWidth) {
  await page.evaluate((navigationMode) => {
    const signedOut = document.getElementById("signedOutNav");
    const signedIn = document.getElementById("signedInNav");
    const userPill = document.getElementById("userPill");
    const userName = document.getElementById("headerUserName");

    if (navigationMode === "signed-in") {
      signedOut.style.display = "none";
      signedIn.style.display = "flex";
      userPill.style.display = "flex";
      userName.textContent = "A Very Long ApplyStronger Mobile Display Name";
    } else {
      signedOut.style.display = "flex";
      signedIn.style.display = "none";
      userPill.style.display = "none";
    }
  }, mode);

  await page.waitForTimeout(50);

  const result = await page.evaluate((navigationMode) => {
    const header = document.querySelector("header");
    const nav = document.getElementById(
      navigationMode === "signed-in" ? "signedInNav" : "signedOutNav",
    );
    const items = [...nav.children].map((element) => {
      const rect = element.getBoundingClientRect();
      return {
        id: element.id,
        left: rect.left,
        right: rect.right,
        top: rect.top,
        bottom: rect.bottom,
        width: rect.width,
        height: rect.height,
        visible: rect.width > 0 && rect.height > 0,
      };
    });
    const headerRect = header.getBoundingClientRect();
    const navStyle = getComputedStyle(nav);
    const documentWidth = Math.max(
      document.documentElement.scrollWidth,
      document.body.scrollWidth,
    );

    window.scrollTo(1000, 0);

    return {
      innerWidth: window.innerWidth,
      documentWidth,
      horizontalScroll: window.scrollX,
      navFlexWrap: navStyle.flexWrap,
      header: {
        left: headerRect.left,
        right: headerRect.right,
        top: headerRect.top,
        bottom: headerRect.bottom,
        width: headerRect.width,
      },
      items,
    };
  }, mode);

  assert.ok(
    result.documentWidth <= viewportWidth + 1,
    `${mode}: document overflowed at ${viewportWidth}px: ${JSON.stringify(result)}`,
  );
  assert.equal(result.horizontalScroll, 0, `${mode}: page must not pan sideways`);
  assert.equal(result.navFlexWrap, "wrap", `${mode}: navigation must wrap`);
  assert.ok(result.header.left >= -1, `${mode}: header begins outside viewport`);
  assert.ok(
    result.header.right <= viewportWidth + 1,
    `${mode}: header ends outside viewport`,
  );

  for (const item of result.items) {
    assert.ok(item.visible, `${mode}: ${item.id} must remain visible`);
    assert.ok(item.left >= result.header.left - 1, `${mode}: ${item.id} escapes left`);
    assert.ok(item.right <= result.header.right + 1, `${mode}: ${item.id} escapes right`);
    assert.ok(item.top >= result.header.top - 1, `${mode}: ${item.id} escapes top`);
    assert.ok(item.bottom <= result.header.bottom + 1, `${mode}: ${item.id} escapes bottom`);
    if (item.id !== "userPill") {
      assert.ok(
        item.height >= 44,
        `${mode}: ${item.id} must keep a mobile-sized touch target`,
      );
    }
  }
}

for (const [engineName, browserType] of [
  ["chromium", chromium],
  ["webkit", webkit],
]) {
  const browser = await browserType.launch({ headless: true });
  try {
    for (const size of viewports) {
      const page = await browser.newPage({
        viewport: { width: size.width, height: size.height },
      });
      await page.setContent(
        `<!doctype html><html><head>${viewport}<style>${style}</style></head><body>${header}</body></html>`,
        { waitUntil: "load" },
      );
      await inspectLayout(page, "signed-in", size.width);
      await inspectLayout(page, "signed-out", size.width);
      await page.close();
      console.log(`${engineName}: ${size.name} passed`);
    }
  } finally {
    await browser.close();
  }
}

console.log("Mobile Safari and Chromium header regression checks passed.");
