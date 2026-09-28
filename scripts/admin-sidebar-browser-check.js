async page => {
  await page.unrouteAll({ behavior: 'ignoreErrors' });
  const user = { id: 'admin-check', role: 'admin', isSuperAdmin: true, isGuest: false, status: 'active', displayName: '侧边栏检查管理员', email: 'sidebar-check@picup.test', creditBalance: 0, quotaUnlimited: true };
  await page.route('**/api/**', route => {
    const path = '/api/' + route.request().url().split('/api/')[1].split('?')[0];
    const json = value => route.fulfill({ json: value });
    if (path === '/api/auth/me') return json({ user, credits: { balance: 0, rechargePlans: [] }, quota: { remaining: 0 } });
    if (path === '/api/auth/logout') throw Error('Visual check must not log out');
    if (path.includes('/overview')) return json({ totals: { jobs: 12 }, jobs: { rangeCreated: 4, successRate: 100, succeeded: 4, failed: 0, refunded: 0, queued: 0, running: 0, retrying: 0 }, models: [], recentFailures: [] });
    if (path.includes('/providers')) return json({ providers: [] });
    return json({ users: [], jobs: [], logs: [], items: [] });
  });
  const assert = (value, message) => { if (!value) throw Error(message); };
  const sidebar = page.locator('.admin-sidebar');
  // No two interactive controls inside the sidebar may overlap, and nothing may escape the sidebar horizontally.
  const noOverlap = async state => {
    const report = await sidebar.evaluate(aside => {
      const box = aside.getBoundingClientRect();
      const controls = [...aside.querySelectorAll('a, button')].filter(el => !el.closest('.admin-user-menu') && el.getClientRects().length)
        .map(el => ({ name: el.getAttribute('aria-label') || el.textContent.trim(), rect: el.getBoundingClientRect() }));
      const overlaps = [];
      for (let i = 0; i < controls.length; i++) for (let j = i + 1; j < controls.length; j++) {
        const a = controls[i].rect, b = controls[j].rect;
        if (a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1) overlaps.push(`${controls[i].name} × ${controls[j].name}`);
      }
      const escaped = controls.filter(c => c.rect.left < box.left - 1 || c.rect.right > box.right + 1).map(c => c.name);
      return { overlaps, escaped, width: box.width };
    });
    assert(!report.overlaps.length, `${state}: overlapping controls ${report.overlaps.join(', ')}`);
    assert(!report.escaped.length, `${state}: controls outside sidebar ${report.escaped.join(', ')}`);
    return report;
  };

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('http://127.0.0.1:3001/admin');
  await page.evaluate(() => localStorage.removeItem('picup.admin.sidebarCollapsed'));
  await page.reload();
  await page.getByRole('navigation', { name: '后台导航' }).waitFor();
  assert((await noOverlap('expanded')).width === 248, 'Expanded sidebar should be 248px');
  await page.screenshot({ path: 'output/admin-sidebar-expanded.png' });

  await page.getByRole('button', { name: /账号菜单/ }).click();
  await page.getByRole('menu', { name: '账号菜单' }).waitFor();
  await page.screenshot({ path: 'output/admin-sidebar-menu.png' });
  await page.keyboard.press('Escape');
  assert(!(await page.getByRole('menu').count()), 'Escape should close account menu');

  await page.getByRole('button', { name: '收起侧边栏' }).click();
  await page.waitForTimeout(300);
  assert((await noOverlap('collapsed')).width === 64, 'Collapsed rail should be 64px');
  await page.getByRole('button', { name: '用户' }).hover();
  await page.waitForTimeout(450);
  await page.screenshot({ path: 'output/admin-sidebar-collapsed.png' });
  await page.getByRole('button', { name: /账号菜单/ }).click();
  await page.screenshot({ path: 'output/admin-sidebar-collapsed-menu.png' });
  await page.keyboard.press('Escape');

  await page.reload();
  await page.getByRole('navigation', { name: '后台导航' }).waitFor();
  assert((await sidebar.boundingBox()).width === 64, 'Collapsed state should persist across reloads');
  await page.keyboard.press('Control+b');
  await page.waitForTimeout(300);
  assert((await sidebar.boundingBox()).width === 248, 'Ctrl+B should expand the sidebar');

  await page.setViewportSize({ width: 390, height: 800 });
  await page.waitForTimeout(250);
  await page.screenshot({ path: 'output/admin-sidebar-mobile.png' });
  const mobile = await page.locator('.admin-nav').evaluate(nav => ({ vertical: nav.getBoundingClientRect().height < 60, pageOverflow: document.documentElement.scrollWidth > innerWidth + 1 }));
  assert(mobile.vertical && !mobile.pageOverflow, `Mobile nav layout broken: ${JSON.stringify(mobile)}`);
  return 'admin sidebar check passed';
}
