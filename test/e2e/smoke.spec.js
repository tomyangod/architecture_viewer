const { test, expect } = require('@playwright/test');

test.describe('Architecture Viewer MVP smoke', () => {
  test('landing page loads and switches language', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('h1')).toContainText('架构图');
    await page.locator('#lang-toggle').click();
    await expect(page).toHaveURL(/lang=en/);
    await expect(page.locator('h1')).toContainText('Architecture diagrams go stale');
    await page.goto('/?lang=zh');
    await expect(page.locator('h1')).toContainText('架构图');
  });

  test('showcase six-view page renders Mermaid SVG across tabs', async ({ page }) => {
    await page.goto('/samples/showcase/');
    await expect(page.locator('#av-showcase-banner')).toBeVisible();
    await expect(page.locator('.tab-panel.active .mermaid svg, .tab-panel.active svg').first()).toBeVisible({
      timeout: 45_000
    });

    const tabs = page.locator('button.tab-btn');
    const n = await tabs.count();
    expect(n).toBeGreaterThanOrEqual(6);

    for (let i = 0; i < n; i++) {
      await tabs.nth(i).click();
      const panel = page.locator('.tab-panel.active');
      await expect(panel).toBeVisible();
      await expect(panel.locator('svg').first()).toBeVisible({ timeout: 20_000 });
      await expect(panel.locator('.source-status.error')).toHaveCount(0);
    }

    const mermaidRes = page.waitForResponse(
      (r) => r.url().includes('/vendor/mermaid.min.js') && r.status() === 200
    );
    await page.reload();
    await mermaidRes;
  });

  test('drift-fail sample page opens', async ({ page }) => {
    await page.goto('/samples/drift-fail/');
    await expect(page.locator('#av-showcase-banner')).toContainText(/漂移|红灯|FAIL/i);
  });

  test('health API', async ({ request }) => {
    const res = await request.get('/api/health');
    expect(res.ok()).toBeTruthy();
    const json = await res.json();
    expect(json.ok).toBeTruthy();
  });
});
