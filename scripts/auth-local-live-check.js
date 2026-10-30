async page => {
  await page.unrouteAll({ behavior: 'ignoreErrors' });
  await page.goto('http://localhost:3001/');
  const credentials = await page.evaluate(() => ({ email: `login-check-${crypto.randomUUID()}@example.test`, password: crypto.randomUUID() + 'Aa1!' }));
  const start = await page.request.post('http://localhost:3001/api/auth/email/start', { data: { ...credentials, mode: 'register', termsAccepted: true } });
  if (!start.ok()) throw new Error(`Test email challenge failed: ${start.status()}`);
  const challenge = await start.json();
  if (!challenge.devCode) throw new Error('Run this check with local development email delivery; a verification code is required');
  const registration = await page.request.post('http://localhost:3001/api/auth/email/verify', { data: { challengeId: challenge.challengeId, code: challenge.devCode } });
  if (!registration.ok()) throw new Error(`Test registration failed: ${registration.status()}`);
  const account = await registration.json();
  await page.request.post('http://localhost:3001/api/auth/logout');
  await page.goto('http://localhost:3001/?view=login');
  await page.getByRole('button', { name: '密码登录', exact: true }).click();
  await page.getByLabel('邮箱', { exact: true }).fill(credentials.email);
  await page.getByLabel('密码', { exact: true }).fill(credentials.password);
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await page.getByRole('dialog').waitFor({ state: 'detached' });
  await page.getByRole('button', { name: '账户与设置', exact: true }).waitFor();
  await page.reload();
  await page.getByRole('button', { name: '账户与设置', exact: true }).waitFor();
  const current = await (await page.request.get('http://localhost:3001/api/auth/me')).json();
  if (current.user.id !== account.user.id || current.user.isGuest) throw new Error('Session did not persist');
  await page.request.post('http://localhost:3001/api/auth/logout');
  await page.reload();
  return { userId: account.user.id, email: credentials.email, loginPassed: true, sessionPersistedAfterReload: true };
}
