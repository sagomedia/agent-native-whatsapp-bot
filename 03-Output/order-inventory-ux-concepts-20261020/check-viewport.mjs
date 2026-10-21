import assert from 'node:assert/strict';
import {mkdir, writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {chromium} from '/home/gk-pc/.hermes/hermes-agent/node_modules/playwright/index.mjs';

const out = resolve(new URL('.', import.meta.url).pathname, 'evidence');
await mkdir(out, {recursive: true});
const browser = await chromium.launch({headless: true, executablePath: '/usr/bin/google-chrome'});
const page = await browser.newPage();
const errors = [];
page.on('pageerror', error => errors.push(error.message));
const metrics = [];

async function fits(label) {
  const dimensions = await page.evaluate(() => ({
    viewport: [innerWidth, innerHeight],
    document: [document.documentElement.scrollWidth, document.documentElement.scrollHeight],
    body: [document.body.scrollWidth, document.body.scrollHeight],
    offset: [scrollX, scrollY],
  }));
  for (const element of ['document', 'body']) {
    assert.ok(dimensions[element][0] <= dimensions.viewport[0] + 1, label + ': horizontal page overflow');
    assert.ok(dimensions[element][1] <= dimensions.viewport[1] + 1, label + ': vertical page overflow');
  }
  assert.deepEqual(dimensions.offset, [0, 0], label + ': the outer page moved');
  return dimensions;
}

async function wheelInside(selector, label) {
  const region = page.locator(selector);
  assert.ok(await region.evaluate(e => e.scrollHeight > e.clientHeight + 1), label + ': content should exceed the panel');
  await region.hover();
  await page.mouse.wheel(0, 7000);
  await page.waitForTimeout(100);
  assert.ok(await region.evaluate(e => e.scrollTop > 0), label + ': the panel should scroll');
  await page.mouse.wheel(0, 7000);
  await page.waitForTimeout(100);
  await fits(label + ' at the end of the panel');
}

try {
  for (const [width, height] of [[1536,1024],[1440,900],[1366,768],[1280,600],[1024,600],[768,600],[390,844],[360,640],[320,480],[844,390]]) {
    const label = width + 'x' + height;
    await page.setViewportSize({width, height});
    await page.goto('http://127.0.0.1:5183/prototype.html');
    const base = await fits(label + ' initial order');
    const header = await page.locator('.sheet-head').boundingBox();
    const footer = await page.locator('.actionbar').boundingBox();
    const itemArea = await page.locator('.order-scroll').boundingBox();
    assert.ok(itemArea.height >= 48, label + ': leave working space for the items');
    assert.ok(footer.y >= 0 && footer.y + footer.height <= height + 1, label + ': main action must stay visible');
    assert.equal(await page.getByRole('button', {name: 'Save draft', exact: true}).isVisible(), true, label + ': keep draft save accessible');

    if (['1536x1024', '1366x768', '390x844'].includes(label)) {
      await page.screenshot({path: resolve(out, 'fitted-order-' + label + '.png')});
    }

    // Stress a long order without changing the demo's underlying item data.
    await page.locator('.lines tbody').evaluate(body => {
      const row = body.firstElementChild;
      for (let i = 0; i < 40; i++) {
        const copy = row.cloneNode(true);
        copy.removeAttribute('id');
        body.append(copy);
      }
    });
    await wheelInside('.order-scroll', label + ' long order');
    assert.deepEqual(await page.locator('.sheet-head').boundingBox(), header, label + ': order header moved');
    assert.deepEqual(await page.locator('.actionbar').boundingBox(), footer, label + ': total or action moved');

    if (width > 900) {
      const search = await page.locator('.queue > label').boundingBox();
      await page.locator('.queue-scroll').evaluate(region => {
        const order = region.firstElementChild;
        for (let i = 0; i < 30; i++) region.append(order.cloneNode(true));
      });
      await wheelInside('.queue-scroll', label + ' long order queue');
      assert.deepEqual(await page.locator('.queue > label').boundingBox(), search, label + ': queue search moved');
      assert.deepEqual(await page.locator('.actionbar').boundingBox(), footer, label + ': scrolling orders moved the quote');
    }

    await page.getByRole('button', {name: 'Original message', exact: true}).click();
    assert.equal(await page.locator('#original-details').evaluate(e => e.open), true);
    await fits(label + ' original request');
    await page.getByRole('button', {name: 'Resolve 2 items', exact: true}).click();
    await fits(label + ' product dialog');
    await page.getByRole('button', {name: 'Close product choices', exact: true}).click();

    await page.getByRole('button', {name: 'Stock', exact: true}).click();
    await fits(label + ' stock task');
    await page.getByRole('button', {name: 'Choose another product', exact: true}).click();
    await page.locator('#stock-search').waitFor({state: 'visible'});
    await page.locator('.stock-rows').evaluate(region => {
      const product = region.firstElementChild;
      for (let i = 0; i < 40; i++) region.append(product.cloneNode(true));
    });
    await wheelInside('.stock-rows', label + ' stock list');
    await page.getByRole('button', {name: 'Select Safety gloves', exact: true}).click();
    await page.locator('.stock-card').getByText('Safety gloves', {exact: true}).waitFor();
    await fits(label + ' selected stock item');
    await page.locator('.stock-card').evaluate(card => {
      const extra = document.createElement('p');
      extra.textContent = 'Long stock history entry. '.repeat(200);
      card.append(extra);
    });
    await wheelInside('.stock-task-pane', label + ' long stock task');
    if (label === '390x844') {
      await page.getByRole('button', {name: 'Reset demo', exact: true}).click();
      await page.screenshot({path: resolve(out, 'fitted-stock-' + label + '.png')});
    }
    metrics.push({width, height, itemAreaHeight: itemArea.height, footerBottom: footer.y + footer.height, ...base});
  }
  assert.deepEqual(errors, []);
  await writeFile(resolve(out, 'viewport-checks.json'), JSON.stringify({status: 'passed', viewports: metrics, pageErrors: errors}, null, 2) + '\n');
  console.log('Viewport checks passed at 10 sizes: no outer-page scrolling, independently scrolling long orders/order queues/stock panels, stationary order header and footer, visible main action, original request and product dialog.');
} finally {
  await browser.close();
}
