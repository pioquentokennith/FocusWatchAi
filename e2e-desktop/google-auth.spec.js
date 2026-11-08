import { _electron as electron, expect, test } from '@playwright/test'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import path from 'node:path'
import os from 'node:os'
import { mockSupabase } from '../e2e/helpers/supabase.mjs'

test('desktop Google sign-in uses the external browser, loopback code and original PKCE verifier', async () => {
  const tempRoot = path.join(os.tmpdir(), 'opencode')
  await mkdir(tempRoot, { recursive: true })
  const userData = await mkdtemp(path.join(tempRoot, 'focuswatch-google-test-'))
  const { ELECTRON_RUN_AS_NODE, ...env } = process.env
  const application = await electron.launch({ args: [path.resolve('.')], env: { ...env, FOCUSWATCH_USER_DATA_DIR: userData } })
  try {
    const page = await application.firstWindow()
    const backend = await mockSupabase(page, { signedIn: false, google: true, provisioned: false })
    // Observe the exact OS-browser launch without opening a real Google account.
    await application.evaluate(({ shell }) => { shell.openExternal = async (url) => { globalThis.__googleUrl = url } })
    await page.reload()
    await page.getByRole('button', { name: 'Continue with Google' }).click()
    await expect(page.getByRole('button', { name: 'Cancel Google sign-in' })).toBeVisible()
    await expect.poll(() => application.evaluate(() => globalThis.__googleUrl || '')).toContain('/auth/v1/authorize')
    const authorize = new URL(await application.evaluate(() => globalThis.__googleUrl))
    expect(authorize.searchParams.get('provider')).toBe('google')
    expect(authorize.searchParams.get('code_challenge_method')).toBe('s256')
    expect(page.url()).toBe('focuswatch://app/')
    const redirectTo = authorize.searchParams.get('redirect_to')
    expect(redirectTo).toMatch(/^http:\/\/127\.0\.0\.1:43821\/auth\/callback\/[a-f0-9]{64}$/)
    const response = await fetch(`${redirectTo}?code=desktop-fixture-code`)
    expect(response.status).toBe(200)
    await expect(page.getByRole('heading', { name: 'Pending admin approval' })).toBeVisible()
    expect(backend.oauthExchanges).toHaveLength(1)
    expect(createHash('sha256').update(backend.oauthExchanges[0].code_verifier).digest('base64url')).toBe(authorize.searchParams.get('code_challenge'))
    expect(backend.oauthExchanges[0].auth_code).toBe('desktop-fixture-code')
    await expect(page.getByRole('button', { name: 'Start camera', exact: true })).toHaveCount(0)

    await page.getByRole('button', { name: 'Sign out', exact: true }).click()
    await page.getByRole('button', { name: 'Continue with Google' }).click()
    await page.getByRole('button', { name: 'Cancel Google sign-in' }).click()
    await expect(page.getByRole('alert')).toContainText('cancelled')
    await expect(page.getByRole('button', { name: 'Continue with Google' })).toBeEnabled()
  } finally {
    await application.close()
    await rm(userData, { recursive: true, force: true, maxRetries: 3 })
  }
})
