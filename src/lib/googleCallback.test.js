// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest'
import { createRequire } from 'node:module'

const { createGoogleCallback, validateGoogleUrl } = createRequire(import.meta.url)('../../electron/google-auth.cjs')
let callback
afterEach(() => { callback?.cancel(); callback = null })

describe('desktop Google loopback callback', () => {
  it('accepts a one-time code on its random path and keeps tokens out of the browser response', async () => {
    callback = await createGoogleCallback({ port: 0 })
    const response = await fetch(`${callback.redirectTo}?code=test-authorization-code`)
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(await response.text()).not.toContain('test-authorization-code')
    expect(await callback.result).toEqual({ code: 'test-authorization-code' })
    await expect(fetch(`${callback.redirectTo}?code=replayed`)).rejects.toThrow()
  })

  it('ignores wrong paths and missing codes, then accepts the correct callback', async () => {
    callback = await createGoogleCallback({ port: 0 })
    const wrong = new URL(callback.redirectTo)
    wrong.pathname = '/auth/callback/wrong-state'
    expect((await fetch(`${wrong}?code=wrong`)).status).toBe(404)
    expect((await fetch(callback.redirectTo)).status).toBe(400)
    expect((await fetch(`${callback.redirectTo}?code=correct`, { method: 'POST' })).status).toBe(404)
    await fetch(`${callback.redirectTo}?code=correct`)
    expect(await callback.result).toEqual({ code: 'correct' })
  })

  it('handles cancellation, provider denial, timeout, and occupied ports', async () => {
    callback = await createGoogleCallback({ port: 0 })
    await expect(createGoogleCallback({ port: Number(new URL(callback.redirectTo).port) })).rejects.toThrow(/port 43821 is in use/)
    await fetch(`${callback.redirectTo}?error=access_denied&error_description=untrusted-text`)
    expect((await callback.result).error).toContain('cancelled or denied')
    callback = await createGoogleCallback({ port: 0 })
    callback.cancel()
    expect((await callback.result).error).toContain('cancelled')
    callback = await createGoogleCallback({ port: 0, timeoutMs: 25 })
    expect((await callback.result).error).toContain('timed out')
  })

  it('only opens Supabase Google PKCE authorization with the exact active callback', () => {
    const redirectTo = 'http://127.0.0.1:43821/auth/callback/secret'
    const url = new URL('https://project.supabase.co/auth/v1/authorize')
    url.search = new URLSearchParams({ provider: 'google', redirect_to: redirectTo, code_challenge_method: 's256', code_challenge: 'a'.repeat(43) })
    expect(validateGoogleUrl(url.href, redirectTo)).toBe(url.href)
    for (const update of [
      (next) => { next.protocol = 'http:' },
      (next) => { next.hostname = 'supabase.co.evil.test' },
      (next) => { next.pathname = '/other' },
      (next) => { next.searchParams.set('provider', 'github') },
      (next) => { next.searchParams.set('redirect_to', 'http://evil.test') },
      (next) => { next.searchParams.set('code_challenge_method', 'plain') },
    ]) {
      const next = new URL(url)
      update(next)
      expect(() => validateGoogleUrl(next.href, redirectTo)).toThrow(/Invalid Google/)
    }
  })
})
