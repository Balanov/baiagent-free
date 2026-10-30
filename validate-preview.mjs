import { createServer } from 'vite';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';

const output = path.resolve('validation');
await mkdir(output, { recursive: true });
const server = await createServer({ server: { host: '127.0.0.1', port: 7100, strictPort: true } });
const url = 'http://127.0.0.1:7100/';
try {
  await server.listen();
  const call = async (action, args) => {
    const response = await fetch('http://127.0.0.1:10086/command', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, args, session: 'free-preview-120' }),
    });
    const data = await response.json();
    if (!data.ok && action !== 'find_tab') throw new Error(`${action}: ${JSON.stringify(data)}`);
    return data.data;
  };
  const existing = await call('find_tab', { url });
  await call('navigate', { url, newTab: !existing?.success });
  await new Promise(resolve => setTimeout(resolve, 1200));
  for (const [name, width, height] of [['desktop', 1440, 960], ['mobile', 390, 844]]) {
    await call('cdp', { method: 'Emulation.setDeviceMetricsOverride', params: { width, height, deviceScaleFactor: 1, mobile: width < 600 } });
    const result = await call('evaluate', { code: "(() => ({title:document.title,download:document.querySelector('.hero-actions .button-primary')?.href,logosLoaded:[...document.images].every(image=>image.complete&&image.naturalWidth>0),oldNaming:document.body.innerText.toLowerCase().includes('рентген'),overflow:document.documentElement.scrollWidth>window.innerWidth,viewport:window.innerWidth,scrollWidth:document.documentElement.scrollWidth}))()" });
    const page = typeof result.value === 'string' ? JSON.parse(result.value) : result.value;
    assert.equal(new URL(page.download).pathname, '/xray/downloads/BAIagent-Director-Setup-Windows-1.2.0-x64.exe');
    assert.equal(page.logosLoaded, true, `${name}: логотипы должны загружаться`);
    assert.equal(page.oldNaming, false);
    assert.equal(page.overflow, false, `${name}: горизонтальное переполнение ${page.scrollWidth} > ${page.viewport}`);
    await call('screenshot', { format: 'png', path: path.join(output, `${name}.png`) });
    console.log(JSON.stringify({ viewport: name, ...page, overflow: false }));
  }
  await call('cdp', { method: 'Emulation.clearDeviceMetricsOverride', params: {} });
} finally {
  await server.close();
}
