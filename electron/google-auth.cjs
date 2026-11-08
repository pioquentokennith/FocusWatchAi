const http = require('node:http')
const { randomBytes } = require('node:crypto')

const CALLBACK_PORT = 43821

function validateGoogleUrl(value, redirectTo) {
  const url = new URL(value)
  if (url.protocol !== 'https:' || !/^[a-z0-9-]+\.supabase\.co$/.test(url.hostname) || url.port || url.username || url.password || url.hash ||
      url.pathname !== '/auth/v1/authorize' || url.searchParams.get('provider') !== 'google' ||
      url.searchParams.get('redirect_to') !== redirectTo || url.searchParams.get('code_challenge_method') !== 's256' ||
      !/^[A-Za-z0-9_-]{43}$/.test(url.searchParams.get('code_challenge') || '')) {
    throw new Error('Invalid Google sign-in URL. Use the configured Supabase Google provider with PKCE.')
  }
  return url.href
}

// The browser receives only a short-lived authorization code. The PKCE verifier
// and resulting Supabase session remain in the original renderer's local storage.
async function createGoogleCallback({ port = CALLBACK_PORT, timeoutMs = 300000 } = {}) {
  const callbackPath = `/auth/callback/${randomBytes(32).toString('hex')}`
  let finish
  let completed = false
  let timer
  const result = new Promise((resolve) => { finish = resolve })
  function complete(outcome) {
    if (completed) return
    completed = true
    clearTimeout(timer)
    server.close()
    server.closeIdleConnections()
    finish(outcome)
  }
  const server = http.createServer((request, response) => {
    let target
    try { target = new URL(request.url, 'http://127.0.0.1') }
    catch { response.writeHead(400).end('Invalid request'); return }
    response.setHeader('Cache-Control', 'no-store')
    response.setHeader('Referrer-Policy', 'no-referrer')
    response.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'")
    response.setHeader('Content-Type', 'text/plain; charset=utf-8')
    if (request.method !== 'GET' || request.headers.host !== `127.0.0.1:${server.address()?.port}` || target.pathname !== callbackPath || completed) {
      response.writeHead(404).end('Not found')
      return
    }
    const code = target.searchParams.get('code')
    if (target.searchParams.has('error')) {
      response.end('Google sign-in was not completed. Return to FocusWatchAI to try again.')
      complete({ error: 'Google sign-in was cancelled or denied. Please try again.' })
    } else if (code && /^[A-Za-z0-9._~-]{1,2048}$/.test(code)) {
      response.end('Sign-in response received. Return to FocusWatchAI to finish signing in. You may close this tab.')
      complete({ code })
    } else response.writeHead(400).end('Missing authorization code. Return to FocusWatchAI and try again.')
  })
  server.requestTimeout = 10000
  server.headersTimeout = 10000
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, '127.0.0.1', resolve)
  }).catch((error) => {
    server.close()
    throw new Error(error.code === 'EADDRINUSE' ? 'Google sign-in port 43821 is in use. Close the other FocusWatchAI sign-in window and try again.' : error.message)
  })
  timer = setTimeout(() => complete({ error: 'Google sign-in timed out. Please try again.' }), timeoutMs)
  timer.unref()
  return {
    redirectTo: `http://127.0.0.1:${server.address().port}${callbackPath}`,
    result,
    cancel: () => complete({ error: 'Google sign-in cancelled.' }),
  }
}

module.exports = { createGoogleCallback, validateGoogleUrl }
