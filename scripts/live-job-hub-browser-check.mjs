import { chromium, webkit } from 'playwright';

const base = 'https://applystronger.com';

async function run(browserType, label) {
  const browser = await browserType.launch({ headless: true });
  try {
    for (const viewport of [
      { name: 'desktop', width: 1280, height: 900 },
      { name: 'mobile', width: 390, height: 844 }
    ]) {
      const page = await browser.newPage({ viewport });
      const errors = [];
      const coverageResponses = [];
      page.on('pageerror', err => errors.push(String(err)));
      page.on('response', async response => {
        if (response.url().includes('/rest/v1/rpc/applystronger_resolve_employer_search')) {
          let body = '';
          try { body = await response.text(); } catch {}
          coverageResponses.push({ status: response.status(), body });
        }
      });

      await page.goto(base, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await page.waitForSelector('#jobCompany', { timeout: 30000 });

      if (!(await page.locator('#jobCoveragePrompt').count())) {
        throw new Error(`${label}/${viewport.name}: live site does not contain Job Hub coverage prompt`);
      }
      if (!(await page.locator('#missingJobForm').count())) {
        throw new Error(`${label}/${viewport.name}: live site does not contain missing-job form`);
      }

      await page.fill('#jobCompany', 'springhealth66');
      await page.click('#jobSearchForm button[type="submit"]');
      await page.waitForTimeout(2500);
      const springNames = await page.locator('.company-link').allTextContents();
      if (!springNames.some(value => value.includes('Spring Health'))) {
        throw new Error(`${label}/${viewport.name}: Spring Health canonical name not found in live results`);
      }

      coverageResponses.length = 0;
      await page.fill('#jobCompany', 'Cardinal Health');
      await page.fill('#jobKeyword', 'Operations Manager, Access Patient and Support');
      await page.click('#jobSearchForm button[type="submit"]');
      await page.waitForTimeout(3000);
      const note = await page.locator('#jobCoverageStatusNote').textContent().catch(() => '');
      const statusText = await page.locator('#jobSearchStatus').textContent().catch(() => '');
      const promptOpen = await page.locator('#jobCoveragePrompt').evaluate(el => el.classList.contains('open')).catch(() => false);
      const employerPrefill = await page.inputValue('#missingEmployerName').catch(() => '');

      console.log(`${label}/${viewport.name} cardinal diagnostics:`, JSON.stringify({ note, statusText, promptOpen, employerPrefill, coverageResponses }));

      const rpcWorked = coverageResponses.some(entry => entry.status === 200 && /Cardinal Health/.test(entry.body));
      if (!rpcWorked) {
        throw new Error(`${label}/${viewport.name}: Cardinal Health coverage RPC did not return expected live registry data`);
      }
      if (!String(note).includes('Cardinal Health')) {
        throw new Error(`${label}/${viewport.name}: live coverage note did not mention Cardinal Health`);
      }
      if (!promptOpen) {
        throw new Error(`${label}/${viewport.name}: live missing-job prompt did not open`);
      }
      if (employerPrefill !== 'Cardinal Health') {
        throw new Error(`${label}/${viewport.name}: live missing employer was not prefilled`);
      }

      const bodyWidth = await page.evaluate(() => document.body.scrollWidth);
      if (bodyWidth > viewport.width + 2) {
        throw new Error(`${label}/${viewport.name}: live page has horizontal overflow (${bodyWidth}px > ${viewport.width}px)`);
      }

      const relevantErrors = errors.filter(e => /applystronger_resolve_employer_search|applystronger_report_missing_job|jobCoveragePrompt|missingJobForm/i.test(e));
      if (relevantErrors.length) throw new Error(`${label}/${viewport.name}: app error: ${relevantErrors.join(' | ')}`);

      console.log(`${label}/${viewport.name}: live verification passed`);
      await page.close();
    }
  } finally {
    await browser.close();
  }
}

await run(chromium, 'chromium');
await run(webkit, 'webkit');
console.log('Live ApplyStronger Job Hub verification passed in Chromium and WebKit at desktop and mobile sizes.');
