import { expect, test } from '@playwright/test'
import { mockSupabase } from './helpers/supabase.mjs'
import { createHash } from 'node:crypto'

test('assigned staff can log in, view their insights, change password, and sign out', async ({ page }) => {
  await mockSupabase(page, { signedIn: false, seed: true })
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Welcome back.' })).toBeVisible()
  await page.getByLabel('Email', { exact: true }).fill('staff@example.test')
  await page.getByLabel('Password', { exact: true }).fill('test-password-only')
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  await expect(page.getByRole('button', { name: 'My insights', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Team', exact: true })).toHaveCount(0)
  await page.getByRole('button', { name: 'My insights', exact: true }).click()
  await expect(page.getByRole('cell', { name: 'Completed', exact: true })).toBeVisible()
  await page.getByRole('button', { name: /^View session/ }).click()
  await expect(page.getByRole('heading', { name: 'Event timeline' })).toBeVisible()
  await expect(page.getByRole('cell', { name: 'No face detected' })).toBeVisible()
  await page.getByRole('button', { name: 'Account', exact: true }).click()
  await page.getByLabel('New password', { exact: true }).fill('new-test-password')
  await page.getByLabel('Confirm password', { exact: true }).fill('new-test-password')
  await page.getByRole('button', { name: 'Update password' }).click()
  await expect(page.getByText('Password updated.', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Sign out', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Welcome back.' })).toBeVisible()
})

test('admin sees team insights, date filtering, and staff controls', async ({ page }) => {
  const backend = await mockSupabase(page, { role: 'admin', seed: true })
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Your team, in view.' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Monitor', exact: true })).toHaveCount(0)
  await expect(page.getByRole('cell', { name: 'Staff One', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Team insights', exact: true }).click()
  await page.getByLabel('From', { exact: true }).fill('2026-11-09')
  await expect(page.getByText('No sessions yet.', { exact: false })).toBeVisible()
  await page.getByRole('button', { name: 'Team', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Team members.' })).toBeVisible()
  await page.getByLabel('Display name').fill('Staff One Updated')
  await page.getByLabel('Account enabled').uncheck()
  await page.getByRole('button', { name: 'Save staff account' }).click()
  await expect(page.getByText('Staff account updated.')).toBeVisible()
  expect(backend.staff).toMatchObject({ full_name: 'Staff One Updated', active: false })
})

test('daily CSV includes sessions beyond the history page and exposes recorded breaks', async ({ page }) => {
  const backend = await mockSupabase(page, { seed: true })
  const template = backend.sessions[0]
  template.break_ms = 5000
  template.breaks = [{ id: 'break-one', reason: 'Meeting', note: 'Planning', started_at: template.started_at, ended_at: template.ended_at, duration_ms: 5000 }]
  for (let index = 0; index < 30; index++) backend.sessions.push({ ...template, id: `session-${index}` })
  await page.goto('/')
  await page.getByRole('button', { name: 'My insights', exact: true }).click()
  await expect(page.getByRole('button', { name: /^View session/ })).toHaveCount(25)
  await expect(page.locator('.insight-stats > div').filter({ hasText: 'Matching sessions' }).locator('strong')).toHaveText('31')
  await page.getByRole('button', { name: 'Last 7 days', exact: true }).click()
  await expect(page.locator('.insight-stats > div').filter({ hasText: 'Matching sessions' }).locator('strong')).toHaveText('31')
  const downloaded = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Export daily CSV' }).click()
  const file = await downloaded
  expect(file.suggestedFilename()).toMatch(/^FocusWatchAI-.*\.csv$/)
  const stream = await file.createReadStream()
  const chunks = []
  for await (const chunk of stream) chunks.push(chunk)
  expect(Buffer.concat(chunks).toString('utf8')).toContain('"31","1860","1705","155"')
  await page.getByRole('button', { name: /^View session/ }).first().click()
  await expect(page.getByRole('cell', { name: 'Planning', exact: true })).toBeVisible()
})

test('settings and device preferences survive reload and mobile controls stay accessible', async ({ page }) => {
  await mockSupabase(page)
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/')
  await page.getByRole('switch', { name: 'Mirror preview' }).click()
  await page.getByRole('button', { name: 'Alert settings', exact: true }).click()
  await page.getByLabel('Eyes closed (seconds)').fill('8')
  await page.getByRole('button', { name: 'Save alert timings' }).click()
  await expect(page.getByText('Alert timings saved.', { exact: false })).toBeVisible()
  await page.reload()
  await expect(page.getByRole('switch', { name: 'Mirror preview' })).toHaveAttribute('aria-checked', 'false')
  await expect(page.getByText('Eyes closed: 8s', { exact: true })).toBeVisible()
  await page.screenshot({ path: 'test-results/workflow-mobile.png', fullPage: true })
})

test('a local sign-out failure is visible in the workspace and can be retried', async ({ page }) => {
  await mockSupabase(page)
  await page.goto('/')
  await expect(page.getByRole('button', { name: 'My insights', exact: true })).toBeVisible()
  await page.evaluate(() => {
    const remove = Storage.prototype.removeItem
    let fail = true
    Storage.prototype.removeItem = function (key) {
      if (key === 'focuswatch.auth' && fail) { fail = false; throw new Error('Local sign-out storage unavailable') }
      return remove.call(this, key)
    }
  })
  await page.getByRole('button', { name: 'Sign out', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('Could not sign out: Local sign-out storage unavailable')
  await expect(page.getByRole('button', { name: 'My insights', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Sign out', exact: true })).toBeEnabled()
  await page.getByRole('button', { name: 'Sign out', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Welcome back.' })).toBeVisible()
})

test('server logout failure still signs out locally and displays the server error', async ({ page }) => {
  await mockSupabase(page)
  await page.route('**/auth/v1/logout*', (route) => route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ message: 'Sign-out service unavailable' }) }))
  await page.goto('/')
  await expect(page.getByRole('button', { name: 'My insights', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Sign out', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Welcome back.' })).toBeVisible()
  await expect(page.getByRole('alert')).toContainText('Sign-out service unavailable')
  expect(await page.evaluate(() => localStorage.getItem('focuswatch.auth'))).toBeNull()
})

test('unprovisioned accounts see setup instructions instead of the monitoring UI', async ({ page }) => {
  await mockSupabase(page)
  await page.route('**/rest/v1/profiles?*', (route) => route.fulfill({ contentType: 'application/json', body: '[]' }))
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Account setup' })).toBeVisible()
  await expect(page.getByRole('alert')).toContainText('not provisioned')
  await expect(page.getByRole('button', { name: 'Start camera', exact: true })).toHaveCount(0)
})

test('Google browser PKCE signs in to pending access, then approval unlocks monitoring', async ({ page }) => {
  const backend = await mockSupabase(page, { signedIn: false, google: true, provisioned: false })
  await page.goto('/')
  await page.getByRole('button', { name: 'Continue with Google' }).click()
  await expect(page.getByRole('heading', { name: 'Pending admin approval' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Start camera', exact: true })).toHaveCount(0)
  await expect(page.getByText('staff@gmail.com', { exact: true })).toBeVisible()
  expect(backend.authorizations).toHaveLength(1)
  expect(backend.authorizations[0]).toMatchObject({ provider: 'google', code_challenge_method: 's256' })
  expect(backend.oauthExchanges).toHaveLength(1)
  expect(backend.oauthExchanges[0].auth_code).toBe('fixture-google-code')
  expect(createHash('sha256').update(backend.oauthExchanges[0].code_verifier).digest('base64url')).toBe(backend.authorizations[0].code_challenge)
  expect(new URL(page.url()).searchParams.has('code')).toBe(false)
  backend.provisioned = true
  backend.application.status = 'approved'
  await page.getByRole('button', { name: 'Check approval status' }).click()
  await expect(page.getByRole('button', { name: 'Start camera', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Registration requests', exact: true })).toHaveCount(0)
})

test('rejected Google applicants remain blocked and can sign out', async ({ page }) => {
  await mockSupabase(page, { google: true, provisioned: false, requestStatus: 'rejected' })
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Request not approved' })).toBeVisible()
  await page.getByRole('button', { name: 'Check approval status' }).click()
  await expect(page.getByRole('heading', { name: 'Request not approved' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Start camera', exact: true })).toHaveCount(0)
  await page.getByRole('button', { name: 'Sign out', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Continue with Google' })).toBeVisible()
})

test('admin approves a request into the last slot and can view its reviewed status', async ({ page }) => {
  const backend = await mockSupabase(page, { role: 'admin', seedRequests: true, staffSlots: 9 })
  await page.goto('/')
  await page.getByRole('button', { name: 'Registration requests', exact: true }).click()
  await expect(page.getByText('9 of 10 staff slots occupied.', { exact: false })).toBeVisible()
  await page.getByRole('button', { name: 'Approve', exact: true }).click()
  await expect(page.getByText('Staff One: approved as staff.')).toBeVisible()
  await expect(page.getByText('10 of 10 staff slots occupied.', { exact: false })).toBeVisible()
  expect(backend.application.status).toBe('approved')
  await page.getByLabel('Request status').selectOption('approved')
  await expect(page.getByRole('cell', { name: 'staff@gmail.com' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Approve', exact: true })).toHaveCount(0)
})

test('full staff capacity blocks approvals but still allows rejecting pending requests', async ({ page }) => {
  const backend = await mockSupabase(page, { role: 'admin', seedRequests: true, staffSlots: 10 })
  await page.goto('/')
  await page.getByRole('button', { name: 'Registration requests', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Approve', exact: true })).toBeDisabled()
  await page.getByRole('button', { name: 'Reject', exact: true }).click()
  await expect(page.getByText('Staff One: request rejected.')).toBeVisible()
  expect(backend.application.status).toBe('rejected')
  expect(backend.staffSlots).toBe(10)
})

test('Google callback failure is actionable and never opens the workspace', async ({ page }) => {
  await mockSupabase(page, { signedIn: false })
  await page.goto('/?error=access_denied&error_description=cancelled')
  await expect(page.getByRole('alert')).toContainText('Google sign-in was cancelled or denied')
  await expect(page.getByRole('button', { name: 'Continue with Google' })).toBeEnabled()
  await expect(page.getByRole('button', { name: 'Start camera', exact: true })).toHaveCount(0)
})
