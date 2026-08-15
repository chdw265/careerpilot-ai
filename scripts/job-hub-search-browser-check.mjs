import http from 'node:http';
import fs from 'node:fs/promises';
import { chromium, webkit } from 'playwright';

const html = await fs.readFile(new URL('../index.html', import.meta.url), 'utf8');
const server = http.createServer((req, res) => {
  if (req.url === '/' || req.url?.startsWith('/?')) {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(html);
    return;
  }
  res.writeHead(404);
  res.end('not found');
});
await new Promise(resolve => server.listen(4173, '127.0.0.1', resolve));

const springCoverage = [{
  registry_id: '11111111-1111-1111-1111-111111111111',
  registry_key: 'spring-health',
  canonical_name: 'Spring Health',
  coverage_status: 'covered',
  ats_provider: 'greenhouse',
  active_job_count: 29,
  collected_job_count: 69,
  hidden_job_count: 40,
  careers_url: null,
  matched_alias: 'Spring Health',
  search_terms: ['Spring Health', 'SpringHealth', 'springhealth66'],
  match_rank: 0
}];

const cardinalCoverage = [{
  registry_id: '22222222-2222-2222-2222-222222222222',
  registry_key: 'cardinal-health',
  canonical_name: 'Cardinal Health',
  coverage_status: 'validation_pending',
  ats_provider: 'workday',
  active_job_count: 0,
  collected_job_count: 0,
  hidden_job_count: 0,
  careers_url: null,
  matched_alias: 'Cardinal Health',
  search_terms: ['Cardinal Health'],
  match_rank: 0
}];

const springJob = [{
  id: '33333333-3333-3333-3333-333333333333',
  title: 'Program Manager, Payer Operations (Alma)',
  company_name: 'Springhealth66',
  location_text: 'United States (Remote)',
  work_setting: 'remote',
  salary_min: null,
  salary_max: null,
  salary_currency: 'USD',
  salary_period: 'year',
  employment_type: 'full_time',
  industry: 'Healthcare',
  category: 'Operations',
  job_function: 'Program Management',
  requirements: '',
  posted_at: new Date().toISOString(),
  employer_posted_at: new Date().toISOString(),
  applicant_count: null,
  applicant_count_source: null,
  experience_level: 'mid',
  source_name: 'Greenhouse',
  description: 'Program operations role',
  apply_url: 'https://example.com/apply',
  is_active: true
}];

async function runBrowser(browserType, label) {
  const browser = await browserType.launch({ headless: true });
  try {
    for (const viewport of [
      { name: 'desktop', width: 1280, height: 900 },
      { name: 'mobile', width: 390, height: 844 }
    ]) {
      const page = await browser.newPage({ viewport });

      await page.route('https://jebakbovivznzcmtyvcc.supabase.co/**', async route => {
        const request = route.request();
        const url = request.url();
        if (url.includes('/rest/v1/rpc/applystronger_resolve_employer_search')) {
          let body = {};
          try { body = JSON.parse(request.postData() || '{}'); } catch {}
          const query = String(body.p_query || '').toLowerCase();
          const payload = query.includes('spring') ? springCoverage : query.includes('cardinal') ? cardinalCoverage : [];
          await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(payload) });
          return;
        }
        if (url.includes('/rest/v1/careerpilot_active_us_jobs')) {
          const decoded = decodeURIComponent(url).toLowerCase();
          const payload = decoded.includes('springhealth66') || decoded.includes('spring health') ? springJob : [];
          const total = payload.length;
          await route.fulfill({
            status: 200,
            headers: {
              'content-type': 'application/json',
              'content-range': total ? `0-${total - 1}/${total}` : '*/0',
              'access-control-expose-headers': 'Content-Range'
            },
            body: JSON.stringify(payload)
          });
          return;
        }
        if (url.includes('/auth/v1/')) {
          await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
          return;
        }
        await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
      });

      await page.goto('http://127.0.0.1:4173/', { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('#jobCompany');

      await page.fill('#jobCompany', 'Spring Health');
      await page.click('#jobSearchForm button[type="submit"]');
      await page.waitForFunction(() => document.querySelector('#jobSearchStatus')?.textContent?.includes('1 current job'));
      const companyText = await page.locator('.job-company').first().textContent().catch(() => '');
      if (!String(companyText).includes('Spring Health')) throw new Error(`${label}/${viewport.name}: canonical Spring Health name was not rendered`);

      await page.fill('#jobCompany', 'Cardinal Health');
      await page.fill('#jobKeyword', 'Operations Manager, Access Patient and Support');
      await page.click('#jobSearchForm button[type="submit"]');
      await page.waitForFunction(() => document.querySelector('#jobSearchStatus')?.textContent?.includes('0 current job'));
      const note = await page.locator('#jobCoverageStatusNote').textContent();
      if (!note.includes('Cardinal Health') || !note.includes('validated')) throw new Error(`${label}/${viewport.name}: validation-pending coverage message missing`);
      if (!(await page.locator('#jobCoveragePrompt').evaluate(el => el.classList.contains('open')))) throw new Error(`${label}/${viewport.name}: missing-job prompt did not open`);
      if ((await page.inputValue('#missingEmployerName')) !== 'Cardinal Health') throw new Error(`${label}/${viewport.name}: missing-job employer was not prefilled`);

      await page.click('#missingJobSubmit');
      await page.waitForFunction(() => document.querySelector('#authModal')?.classList.contains('open'));

      const bodyWidth = await page.evaluate(() => document.body.scrollWidth);
      if (bodyWidth > viewport.width + 2) throw new Error(`${label}/${viewport.name}: horizontal overflow (${bodyWidth}px > ${viewport.width}px)`);

      await page.close();
    }
  } finally {
    await browser.close();
  }
}

try {
  await runBrowser(chromium, 'chromium');
  await runBrowser(webkit, 'webkit');
  console.log('Job Hub browser checks passed in Chromium and WebKit at desktop and mobile sizes.');
} finally {
  await new Promise(resolve => server.close(resolve));
}
