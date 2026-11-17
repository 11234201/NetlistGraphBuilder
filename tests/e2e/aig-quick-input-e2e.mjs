import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { runBrowserTest } from './browser_test_session.mjs';

const { chromium } = await import(process.env.NGB_PLAYWRIGHT_MODULE || 'playwright');
const root = fileURLToPath(new URL('../..', import.meta.url));
const blif = await readFile(new URL('../fixtures/aig/shared_cone.blif', import.meta.url), 'utf8');
const dot = await readFile(new URL('../fixtures/aig/shared_cone.dot', import.meta.url), 'utf8');
const file = (name, text) => ({ name, mimeType: 'text/plain', buffer: Buffer.from(text) });
await runBrowserTest(async ({ browser, url }) => {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(url);
  await page.locator('#schematicMount svg').waitFor();
  const loaded = async (name) => {
    await page.waitForFunction((name) => document.querySelector('#statusBar').textContent.includes(`Loaded ${name}`), name);
    await page.locator('#schematicMount [data-aig-node]').first().waitFor();
  };
  for (const id of ['fileInput', 'aigFileInput']) {
    assert.ok((await page.locator(`#${id}`).getAttribute('accept')).split(',').includes('.blif'));
  }
  await page.locator('#fileInput').setInputFiles(file('generic.BLIF', blif));
  await loaded('generic.BLIF');
  await page.locator('#aigFileInput').setInputFiles(file('saved_as_text.txt', blif));
  await loaded('saved_as_text.txt');
  await page.locator('#pasteAigButton').evaluate((button) => button.click());
  await page.locator('#netlistTextInput').fill(dot);
  await page.locator('#netlistTextInput').press('Control+Enter');
  await loaded('pasted AIG');
  assert.equal(await page.locator('#netlistTextDialog').evaluate((dialog) => dialog.open), false);
  const snapshot = () => page.evaluate(() => JSON.parse(sessionStorage.getItem('ngb.domain-workspace.v1')).source.text);
  assert.equal(await snapshot(), dot.trim());
  await page.locator('#pasteAigButton').evaluate((button) => button.click());
  await page.locator('#netlistTextInput').fill('.model invalid\n.end');
  await page.locator('#netlistTextInput').press('Control+Enter');
  await page.waitForFunction(() => document.querySelector('#statusBar').textContent.includes('Paste failed'));
  assert.equal(await snapshot(), dot.trim());
  assert.equal(await page.locator('#netlistTextDialog').evaluate((dialog) => dialog.open), true);
  await page.locator('#cancelNetlistTextButton').click();
  await page.evaluate((text) => {
    const data = new DataTransfer(); data.setData('text/plain', text);
    window.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, cancelable: true }));
  }, blif);
  await page.waitForFunction((text) => JSON.parse(sessionStorage.getItem('ngb.domain-workspace.v1')).source.text === text, blif);
  await page.evaluate((text) => {
    const data = new DataTransfer(); data.items.add(new File([text], 'dropped.blif'));
    window.dispatchEvent(new DragEvent('drop', { dataTransfer: data, cancelable: true }));
  }, blif);
  await loaded('dropped.blif');
  await page.evaluate(() => {
    const read = File.prototype.text;
    File.prototype.text = async function (...args) {
      const text = await read.apply(this, args);
      if (this.name === 'held.blif') {
        await new Promise((resolve) => { window.releaseHeldAig = resolve; });
        window.heldAigReadFinished = true;
      }
      return text;
    };
  });
  await page.locator('#fileInput').setInputFiles(file('held.blif', blif));
  await page.waitForFunction(() => Boolean(window.releaseHeldAig));
  await page.locator('#pasteAigButton').evaluate((button) => button.click());
  await page.locator('#netlistTextInput').fill(dot);
  await page.locator('#netlistTextInput').press('Control+Enter');
  await loaded('pasted AIG');
  await page.evaluate(() => window.releaseHeldAig());
  await page.waitForFunction(() => window.heldAigReadFinished);
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  assert.equal(await snapshot(), dot.trim(), 'a stale file read cannot replace the newer pasted AIG');
  if (process.env.NGB_AIG_SAMPLE) {
    const sample = await readFile(process.env.NGB_AIG_SAMPLE, 'utf8');
    await page.locator('#fileInput').setInputFiles(file('user_sample.blif', sample));
    await loaded('user_sample.blif');
    const count = await page.locator('#schematicMount [data-aig-node]').count();
    assert.ok(count > 0);
    await page.locator('#pasteAigButton').evaluate((button) => button.click());
    await page.locator('#netlistTextInput').fill(sample);
    await page.locator('#netlistTextInput').press('Control+Enter');
    await loaded('pasted AIG');
    assert.equal(await page.locator('#schematicMount [data-aig-node]').count(), count);
    console.log(JSON.stringify({ sampleNodes: count, fileAndPaste: 'passed' }));
  }
  assert.deepEqual(errors, []);
  await page.close();
}, { root, chromium, executablePath: process.env.NGB_CHROME });
console.log('AIG quick input: file filters, content detection, paste, drop and failure retention passed');
