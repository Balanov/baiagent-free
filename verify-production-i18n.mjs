import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';

const output = path.resolve('validation');
await mkdir(output, { recursive: true });
const url = 'https://baiagent.ru/free/';
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
  if (typeof result.value !== 'string') return result.value;
  try { return JSON.parse(result.value); } catch { return result.value; }
};
const results = [];
let injected;
try {
  await call('find_tab', { url });
  await call('navigate', { url: `${url}?i18n=20261101`, newTab: false });
  await new Promise(resolve => setTimeout(resolve, 900));
  const originalLocale = await evaluate("(() => navigator.languages[0] || navigator.language || 'ru-RU')()");
  injected = await call('cdp', { method: 'Page.addScriptToEvaluateOnNewDocument', params: { source: "Object.defineProperty(navigator,'languages',{get:()=>[localStorage.getItem('__test_locale')||'en-US']});" } });
  const cases = [
    ['ru-RU', 'ru', 'RUB', 'Ваш бизнес.'],
    ['en-GB', 'en', 'GBP', 'Your business.'],
    ['de-DE', 'de', 'EUR', 'Ihr Unternehmen.'],
    ['zh-CN', 'zh', 'CNY', '您的企业。'],
  ];
  for (const [locale, language, currency, heading] of cases) {
    await evaluate(`(() => { localStorage.setItem('__test_locale', ${JSON.stringify(locale)}); localStorage.removeItem('baiagent-language'); return true; })()`);
    await call('cdp', { method: 'Page.reload', params: { ignoreCache: true } });
    await new Promise(resolve => setTimeout(resolve, 900));
    for (const [viewport, width, height] of [['desktop', 1440, 960], ['mobile', 390, 844]]) {
      if (viewport === 'mobile' && locale !== 'en-GB') continue;
      await call('cdp', { method: 'Emulation.setDeviceMetricsOverride', params: { width, height, deviceScaleFactor: 1, mobile: width < 600 } });
      const page = await evaluate(`(() => ({
        lang: document.documentElement.lang,
        currency: window.baiagentI18n?.currency,
        heading: document.querySelector('h1')?.innerText,
        support: document.querySelector('.support-card > strong')?.textContent,
        noteHidden: document.querySelector('.support-price-note')?.hidden,
        download: document.querySelector('.hero-actions .button-primary')?.href,
        logosLoaded: [...document.images].every(image => image.complete && image.naturalWidth > 0),
        languages: document.querySelectorAll('#language-select option').length,
        russianRemnants: /Скачать|Ваш бизнес|советник|ПОДДЕРЖКА|Напишите|Где подвох/.test(document.body.innerText),
        overflow: document.documentElement.scrollWidth > window.innerWidth,
        scripts: [...document.scripts].map(script => script.src).filter(Boolean)
      }))()`);
      assert.equal(page.lang, language, `${locale}: язык`);
      assert.equal(page.currency, currency, `${locale}: валюта`);
      assert.ok(page.heading.includes(heading), `${locale}: заголовок`);
      assert.equal(new URL(page.download).pathname, '/xray/downloads/BAIagent-Director-Setup-Windows-1.3.0-x64.exe');
      assert.equal(page.logosLoaded, true);
      assert.equal(page.languages, 6);
      assert.equal(page.overflow, false, `${locale}/${viewport}: переполнение`);
      assert.equal(page.noteHidden, currency === 'RUB');
      if (language !== 'ru') assert.equal(page.russianRemnants, false, `${locale}: непереведённый текст`);
      results.push({ locale, viewport, ...page });
      if (locale === 'en-GB' && viewport === 'desktop') await call('screenshot', { format: 'png', path: path.join(output, 'production-i18n-en-GB.png') });
      console.log(JSON.stringify({ locale, viewport, language, currency, support: page.support, overflow: false }));
    }
  }
  await evaluate("(() => { localStorage.setItem('__test_locale', 'ru-RU'); localStorage.removeItem('baiagent-language'); return true; })()");
  await call('cdp', { method: 'Page.reload', params: { ignoreCache: true } });
  await new Promise(resolve => setTimeout(resolve, 900));
  await evaluate("(() => { document.querySelector('#language-select').value = 'zh'; document.querySelector('#language-select').dispatchEvent(new Event('change', {bubbles:true})); return true; })()");
  const readManual = "() => ({lang:document.documentElement.lang,currency:window.baiagentI18n?.currency,heading:document.querySelector('h1')?.innerText,saved:localStorage.getItem('baiagent-language')})";
  const manual = await evaluate(`(${readManual})()`);
  assert.equal(manual.lang, 'zh');
  assert.equal(manual.currency, 'CNY');
  assert.equal(manual.saved, 'zh');
  assert.ok(manual.heading.includes('您的企业。'));
  assert.ok(manual.heading.includes('¥'));
  assert.ok(!manual.heading.includes('₽'));
  await call('cdp', { method: 'Page.reload', params: { ignoreCache: true } });
  await new Promise(resolve => setTimeout(resolve, 900));
  const reloaded = await evaluate(`(${readManual})()`);
  assert.deepEqual(reloaded, manual, 'На боевой странице CNY должен сохраниться после перезагрузки');
  await call('screenshot', { format: 'png', path: path.join(output, 'production-i18n-zh-manual-reloaded.png') });
  results.push({ locale: 'ru-RU→zh→reload', viewport: 'desktop', ...reloaded });
  const scriptId = injected?.identifier || injected?.result?.identifier;
  if (scriptId) await call('cdp', { method: 'Page.removeScriptToEvaluateOnNewDocument', params: { identifier: scriptId } });
  await evaluate("(() => { localStorage.removeItem('baiagent-language'); localStorage.removeItem('__test_locale'); return true; })()");
  await call('cdp', { method: 'Emulation.clearDeviceMetricsOverride', params: {} });
  await call('navigate', { url, newTab: false });
  await new Promise(resolve => setTimeout(resolve, 900));
  const restored = await evaluate("(() => ({lang:document.documentElement.lang,currency:window.baiagentI18n?.currency,title:document.title,locale:navigator.languages[0]}))()");
  await writeFile(path.join(output, 'production-i18n-results.json'), JSON.stringify({ conclusion: 'success', originalLocale, restored, results }, null, 2));
  console.log(JSON.stringify({ restored, conclusion: 'PRODUCTION_I18N_VALIDATION_PASSED' }));
} finally {
  await call('cdp', { method: 'Emulation.clearDeviceMetricsOverride', params: {} });
}
