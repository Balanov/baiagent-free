import { createServer } from 'vite';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';

const output = path.resolve('validation');
await mkdir(output, { recursive: true });
const server = await createServer({ server: { host: '127.0.0.1', port: 7189, strictPort: true } });
const url = 'http://127.0.0.1:7189/';
const results = [];
const call = async (action, args) => {
  const response = await fetch('http://127.0.0.1:10086/command', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, args, session: 'baiagent-free-i18n' }),
  });
  const data = await response.json();
  if (!data.ok && action !== 'find_tab') throw new Error(`${action}: ${JSON.stringify(data)}`);
  return data.data;
};
const evaluate = async code => {
  const result = await call('evaluate', { code });
  return typeof result.value === 'string' ? JSON.parse(result.value) : result.value;
};
try {
  await server.listen();
  const existing = await call('find_tab', { url });
  await call('navigate', { url, newTab: !existing?.success });
  await new Promise(resolve => setTimeout(resolve, 500));
  await call('cdp', { method: 'Page.addScriptToEvaluateOnNewDocument', params: { source: "Object.defineProperty(navigator,'languages',{get:()=>[localStorage.getItem('__test_locale')||'en-US']});" } });
  const cases = [
    ['ru-RU', 'ru', 'RUB', 'Ваш бизнес.'],
    ['en-US', 'en', 'USD', 'Your business.'],
    ['en-GB', 'en', 'GBP', 'Your business.'],
    ['de-DE', 'de', 'EUR', 'Ihr Unternehmen.'],
    ['fr-FR', 'fr', 'EUR', 'Votre entreprise.'],
    ['es-ES', 'es', 'EUR', 'Tu negocio.'],
    ['zh-CN', 'zh', 'CNY', '您的企业。'],
    ['kk-KZ', 'en', 'KZT', 'Your business.'],
  ];
  for (const [locale, language, currency, heading] of cases) {
    await evaluate(`(() => { localStorage.setItem('__test_locale', ${JSON.stringify(locale)}); localStorage.removeItem('baiagent-language'); return true; })()`);
    await call('cdp', { method: 'Page.reload', params: { ignoreCache: true } });
    await new Promise(resolve => setTimeout(resolve, 650));
    for (const [viewport, width, height] of [['desktop', 1440, 960], ['mobile', 390, 844], ['small', 320, 740]]) {
      if (viewport !== 'desktop' && !['en-US', 'de-DE', 'zh-CN', 'ru-RU'].includes(locale)) continue;
      await call('cdp', { method: 'Emulation.setDeviceMetricsOverride', params: { width, height, deviceScaleFactor: 1, mobile: width < 600 } });
      const page = await evaluate(`(() => ({
        lang: document.documentElement.lang,
        currency: window.baiagentI18n?.currency,
        heading: document.querySelector('h1')?.innerText,
        title: document.title,
        support: document.querySelector('.support-card > strong')?.textContent,
        noteHidden: document.querySelector('.support-price-note')?.hidden,
        download: document.querySelector('.hero-actions .button-primary')?.href,
        logosLoaded: [...document.images].every(image => image.complete && image.naturalWidth > 0),
        languages: document.querySelectorAll('#language-select option').length,
        nameLabel: document.querySelector('input[name="name"]')?.closest('label')?.innerText,
        russianRemnants: /Скачать|Ваш бизнес|советник|ПОДДЕРЖКА|Напишите|Где подвох/.test(document.body.innerText),
        overflow: document.documentElement.scrollWidth > window.innerWidth,
        scrollWidth: document.documentElement.scrollWidth,
        viewport: window.innerWidth
      }))()`);
      assert.equal(page.lang, language, `${locale}: язык`);
      assert.equal(page.currency, currency, `${locale}: валюта`);
      assert.ok(page.heading.includes(heading), `${locale}: заголовок ${page.heading}`);
      assert.equal(new URL(page.download).pathname, '/xray/downloads/BAIagent-Director-Setup-Windows-1.3.0-x64.exe');
      assert.equal(page.logosLoaded, true, `${locale}: изображения`);
      assert.equal(page.languages, 6, `${locale}: переключатель`);
      assert.equal(page.overflow, false, `${locale}/${viewport}: переполнение ${page.scrollWidth} > ${page.viewport}`);
      assert.equal(page.noteHidden, currency === 'RUB', `${locale}: пояснение пересчёта`);
      if (language !== 'ru') {
        assert.equal(page.russianRemnants, false, `${locale}: непереведённый текст`);
        assert.ok(!page.title.includes('ваш бизнес'), `${locale}: title`);
        assert.ok(!page.nameLabel.includes('Ваше имя'), `${locale}: форма`);
      }
      results.push({ locale, viewport, ...page, overflow: false });
      if ((locale === 'en-US' && viewport === 'desktop') || (locale === 'de-DE' && viewport === 'mobile')) {
        await call('screenshot', { format: 'png', path: path.join(output, `i18n-${locale}-${viewport}.png`) });
      }
      console.log(JSON.stringify({ locale, viewport, language, currency, support: page.support, overflow: false }));
    }
  }
  await evaluate("(() => { document.querySelector('#language-select').value = 'de'; document.querySelector('#language-select').dispatchEvent(new Event('change', {bubbles:true})); return {lang:document.documentElement.lang,saved:localStorage.getItem('baiagent-language')}; })()");
  const manual = await evaluate("(() => ({lang:document.documentElement.lang,saved:localStorage.getItem('baiagent-language')}))()");
  assert.deepEqual(manual, { lang: 'de', saved: 'de' });
  await evaluate("(() => { localStorage.removeItem('baiagent-language'); localStorage.removeItem('__test_locale'); return true; })()");
  await call('cdp', { method: 'Emulation.clearDeviceMetricsOverride', params: {} });
  await writeFile(path.join(output, 'i18n-results.json'), JSON.stringify({ conclusion: 'success', manual, results }, null, 2));
  console.log('I18N_VALIDATION_PASSED');
} finally {
  await server.close();
}
