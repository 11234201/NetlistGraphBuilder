import assert from "node:assert/strict";

export async function verifyStandaloneSvgStyles(page, markup, mount, selectors) {
  const inspect = (scope, selectors) => scope.evaluate((root, selectors) => {
    const properties = ["fill", "stroke", "strokeWidth", "strokeOpacity", "strokeDasharray", "visibility"];
    return Object.fromEntries(selectors.map(selector => {
      const item = root.querySelector(selector);
      if (!item) return [selector, null];
      const style = getComputedStyle(item);
      return [selector, Object.fromEntries(properties.map(key => [key, style[key]]))];
    }));
  }, selectors);
  const live = await inspect(page.locator(mount), selectors);
  for (const selector of selectors) assert.ok(live[selector], "Missing live SVG element " + selector);
  const standalone = await page.context().newPage();
  try {
    await standalone.goto("data:image/svg+xml;base64," + Buffer.from(markup).toString("base64"));
    assert.deepEqual(await inspect(standalone.locator("svg"), selectors), live);
  } finally { await standalone.close(); }
}
