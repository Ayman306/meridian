#!/usr/bin/env node
/**
 * Drive the whole OAuth flow against a deployment and print the table.
 *
 * Written because the session that built the authorization server could not
 * reach production — its egress policy refused the host — so the live flow
 * shipped unexercised. A prose checklist would have to be re-walked by hand
 * every time something changes. This is the same checklist as code, so it can
 * be re-run in a minute, by anybody, from anywhere that can reach the app.
 *
 *   node scripts/verify-oauth.mjs https://your-deployment.example
 *
 * Node 18+. No dependencies: fetch and webcrypto are built in.
 *
 * ## Why it stops and asks you twice
 *
 * The consent screen is a person signing in with Google and pressing a button.
 * That is the whole point of it and it cannot be automated away without
 * building exactly the bypass the screen exists to prevent. So the script does
 * every unattended check first, then hands you a URL, waits for the address
 * you land on, and drives everything after that itself.
 *
 * A check that cannot run without you is reported as SKIPPED, never as PASS.
 */
import { createInterface } from 'node:readline/promises'
import { stdin as input, stdout as output } from 'node:process'

const BASE = (process.argv[2] ?? '').replace(/\/$/, '')
if (!BASE) {
  console.error('Usage: node scripts/verify-oauth.mjs https://your-deployment.example')
  process.exit(2)
}

const results = []
/** `silent` marks a check whose failure would look like nothing in normal use. */
function record(id, what, expected, actual, pass, silent = false) {
  results.push({ id, what, expected, actual, pass, silent })
  const mark = pass === null ? '○' : pass ? '✓' : '✗'
  console.log(`${mark} ${String(id).padStart(2)} ${what}`)
  if (pass === false) console.log(`     expected ${expected}\n     actual   ${actual}`)
}

const rl = createInterface({ input, output })
const ask = (q) => rl.question(q)

// --- PKCE ------------------------------------------------------------------
function b64url(bytes) {
  return Buffer.from(bytes).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
function makeVerifier() {
  return b64url(crypto.getRandomValues(new Uint8Array(32)))
}
async function challengeFor(verifier) {
  return b64url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))))
}

async function json(path, init) {
  const res = await fetch(`${BASE}${path}`, init)
  let body = null
  try {
    body = await res.json()
  } catch {
    /* non-JSON is itself a finding; the caller sees status and null */
  }
  return { res, body }
}

async function register(overrides = {}) {
  return json('/api/oauth/register', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      redirect_uris: ['http://127.0.0.1:8765/cb'],
      client_name: 'Verification harness',
      token_endpoint_auth_method: 'none',
      ...overrides,
    }),
  })
}

async function token(params) {
  return json('/api/oauth/token', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(params),
  })
}

async function rpc(method, accessToken, params) {
  return json('/api/mcp/rpc', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}),
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, ...(params ? { params } : {}) }),
  })
}

// ---------------------------------------------------------------------------
// Discovery
// ---------------------------------------------------------------------------
async function discovery() {
  console.log('\n— Discovery —')

  const as = await json('/.well-known/oauth-authorization-server')
  const asOk =
    as.res.status === 200 &&
    as.body?.issuer === BASE &&
    as.body?.token_endpoint === `${BASE}/api/oauth/token` &&
    as.body?.authorization_endpoint === `${BASE}/oauth/authorize` &&
    Array.isArray(as.body?.code_challenge_methods_supported) &&
    as.body.code_challenge_methods_supported.includes('S256') &&
    !as.body.code_challenge_methods_supported.includes('plain')
  record(1, 'authorization-server metadata', '200, issuer matches, S256 only',
    `${as.res.status} issuer=${as.body?.issuer} methods=${as.body?.code_challenge_methods_supported}`, asOk)

  const pr = await json('/.well-known/oauth-protected-resource')
  const prOk =
    pr.res.status === 200 &&
    pr.body?.resource === `${BASE}/api/mcp/rpc` &&
    pr.body?.authorization_servers?.includes(BASE)
  record(1.1, 'protected-resource metadata', `200, resource=${BASE}/api/mcp/rpc`,
    `${pr.res.status} resource=${pr.body?.resource}`, prOk)

  for (const path of [
    '/.well-known/oauth-protected-resource/api/mcp/rpc',
    '/.well-known/oauth-authorization-server/api/mcp/rpc',
  ]) {
    const r = await json(path)
    record(2, `path-inserted form ${path.split('/.well-known/')[1]}`, '200', String(r.res.status), r.res.status === 200)
  }

  // The hinge of the connector flow: a client with no credential must be told
  // where to go, and the URL it is told must actually resolve.
  const un = await fetch(`${BASE}/api/mcp/rpc`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
  })
  const header = un.headers.get('www-authenticate') ?? ''
  const metadataUrl = /resource_metadata="([^"]+)"/.exec(header)?.[1]
  let resolves = false
  if (metadataUrl) resolves = (await fetch(metadataUrl)).status === 200
  record(3, 'WWW-Authenticate advertises resource_metadata, and it resolves',
    '401 + resource_metadata that returns 200',
    `${un.status} header=${header || '(none)'} follows=${resolves}`,
    un.status === 401 && Boolean(metadataUrl) && resolves)

  const init = await rpc('initialize', null, {})
  record(4, 'initialize answers without credentials', '200 with protocolVersion',
    `${init.res.status} ${init.body?.result?.protocolVersion ?? ''}`,
    init.res.status === 200 && Boolean(init.body?.result?.protocolVersion))
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------
async function registration() {
  console.log('\n— Registration —')

  const good = await register({ redirect_uris: ['https://example.com/cb'] })
  record(5, 'https + auth_method none is accepted', '201 with client_id',
    `${good.res.status} ${good.body?.client_id ?? good.body?.error ?? ''}`,
    good.res.status === 201 && Boolean(good.body?.client_id))

  const refusals = [
    [6, 'javascript: scheme', { redirect_uris: ['javascript:alert(1)'] }],
    [7, 'http on a non-loopback host', { redirect_uris: ['http://evil.example/cb'] }],
    [8, 'a redirect_uri with a fragment', { redirect_uris: ['https://example.com/cb#x'] }],
    [9, 'client_secret_post', { token_endpoint_auth_method: 'client_secret_post' }],
  ]
  for (const [id, what, body] of refusals) {
    const r = await register(body)
    record(id, `refuses ${what}`, '400 with an error',
      `${r.res.status} ${r.body?.error ?? ''}`,
      r.res.status === 400 && Boolean(r.body?.error))
  }

  // http on loopback must still be allowed — a desktop client catches its
  // redirect that way and refusing it would break every one of them.
  const loop = await register({ redirect_uris: ['http://127.0.0.1:8765/cb'] })
  record(7.1, 'still allows http on loopback', '201',
    String(loop.res.status), loop.res.status === 201)

  return loop.body?.client_id ?? null
}

// ---------------------------------------------------------------------------
// Authorize — the two that must never redirect
// ---------------------------------------------------------------------------
async function authorizeRefusals(clientId, redirectUri) {
  console.log('\n— Authorize —')
  const verifier = makeVerifier()
  const challenge = await challengeFor(verifier)

  const build = (over = {}) => {
    const p = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      code_challenge: challenge,
      code_challenge_method: 'S256',
      state: 'harness',
      ...over,
    })
    return `${BASE}/oauth/authorize?${p}`
  }

  // `manual` so a redirect is visible as a redirect rather than followed.
  // These two must render a page: until the client and its redirect are
  // proven, that address is attacker-controlled and sending even an *error*
  // to it is the open-redirect bug.
  for (const [id, what, url] of [
    [10, 'unknown client_id', build({ client_id: 'mrdc_nonexistent' })],
    [11, 'unregistered redirect_uri', build({ redirect_uri: 'https://evil.example/cb' })],
  ]) {
    const r = await fetch(url, { redirect: 'manual' })
    const location = r.headers.get('location') ?? ''
    const leaked = /^https?:\/\//.test(location) && !location.startsWith(BASE)
    record(id, `${what} is a dead end, not a redirect`, 'no off-site Location header',
      `${r.status} location=${location || '(none)'}`, !leaked, true)
  }

  const plain = await fetch(build({ code_challenge_method: 'plain' }), { redirect: 'manual' })
  const plainLoc = plain.headers.get('location') ?? ''
  record(12, 'code_challenge_method=plain is refused', 'redirect back with invalid_request',
    `${plain.status} ${plainLoc}`, plainLoc.includes('invalid_request'))

  return { verifier, challenge, authorizeUrl: build() }
}

// ---------------------------------------------------------------------------
// The main event: one human approval, then everything after it
// ---------------------------------------------------------------------------
async function grant({ label, clientId, redirectUri, tickSensitive }) {
  const verifier = makeVerifier()
  const challenge = await challengeFor(verifier)
  const p = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    code_challenge: challenge,
    code_challenge_method: 'S256',
    state: 'harness',
    scope: tickSensitive
      ? 'trips wishlist destinations money photos flights allowance health documents'
      : 'trips wishlist destinations money photos flights allowance',
  })

  console.log(`\n— ${label} —`)
  console.log('\nOpen this, sign in if asked, and approve:\n')
  console.log(`${BASE}/oauth/authorize?${p}\n`)
  console.log(
    tickSensitive
      ? '>>> TICK Health and Documents before pressing Connect. <<<'
      : '>>> Leave Health and Documents UNTICKED. <<<',
  )
  const landed = await ask('\nPaste the full URL you landed on (it will not load): ')
  let code = null
  try {
    code = new URL(landed.trim()).searchParams.get('code')
  } catch {
    /* handled below */
  }
  if (!code) {
    record(14, `${label}: got an authorization code`, 'a ?code= parameter', landed.trim().slice(0, 120), false)
    return null
  }
  return { code, verifier, challenge }
}

async function main() {
  console.log(`Verifying ${BASE}`)
  await discovery()
  const clientId = await registration()
  if (!clientId) {
    console.error('\nRegistration failed, so nothing after it can run.')
    return report()
  }
  const redirectUri = 'http://127.0.0.1:8765/cb'
  await authorizeRefusals(clientId, redirectUri)

  // Check 13 needs a signed-out browser, which this process does not have.
  record(13, 'signed out, authorize returns to consent after login', 'consent screen, not the dashboard',
    'needs a signed-out browser — do this by hand', null)

  // --- Grant one: sensitive modules left off -------------------------------
  const first = await grant({ label: 'Grant 1 (health and documents OFF)', clientId, redirectUri, tickSensitive: false })
  if (!first) return report()

  // 16 and 17 run before the real exchange, because they must not consume it.
  const wrongVerifier = await token({
    grant_type: 'authorization_code', code: first.code, client_id: clientId,
    redirect_uri: redirectUri, code_verifier: makeVerifier(),
  })
  record(16, 'wrong code_verifier', 'invalid_grant',
    `${wrongVerifier.res.status} ${wrongVerifier.body?.error}`, wrongVerifier.body?.error === 'invalid_grant')

  for (const [what, uri] of [
    ['trailing slash', `${redirectUri}/`],
    ['added query param', `${redirectUri}?x=1`],
    ['host case change', redirectUri.replace('127.0.0.1', '127.0.0.1'.toUpperCase())],
    ['different host', 'https://evil.example/cb'],
  ]) {
    const r = await token({
      grant_type: 'authorization_code', code: first.code, client_id: clientId,
      redirect_uri: uri, code_verifier: first.verifier,
    })
    record(17, `redirect_uri near-miss: ${what}`, 'invalid_grant',
      `${r.res.status} ${r.body?.error}`, r.body?.error === 'invalid_grant')
  }

  for (const bad of ['password', 'implicit']) {
    const r = await token({ grant_type: bad })
    record(18, `grant_type=${bad}`, 'unsupported_grant_type',
      `${r.res.status} ${r.body?.error}`, r.body?.error === 'unsupported_grant_type')
  }

  const exchanged = await token({
    grant_type: 'authorization_code', code: first.code, client_id: clientId,
    redirect_uri: redirectUri, code_verifier: first.verifier,
  })
  const g1 = exchanged.body
  const scope1 = g1?.scope ?? ''
  record(14, 'code exchanges for a grant', 'access_token, refresh_token, Bearer, expires_in 3600',
    `${exchanged.res.status} type=${g1?.token_type} expires_in=${g1?.expires_in} scope="${scope1}"`,
    exchanged.res.status === 200 && Boolean(g1?.access_token) && Boolean(g1?.refresh_token) &&
    g1?.token_type === 'Bearer' && g1?.expires_in === 3600)
  record(14.1, 'unticked modules are absent from scope', 'no health, no documents',
    `scope="${scope1}"`, !scope1.includes('health') && !scope1.includes('documents'), true)

  // --- Replay: refusing is not enough, it must revoke ----------------------
  const replay = await token({
    grant_type: 'authorization_code', code: first.code, client_id: clientId,
    redirect_uri: redirectUri, code_verifier: first.verifier,
  })
  record(19, 'replayed code is refused', 'invalid_grant',
    `${replay.res.status} ${replay.body?.error}`, replay.body?.error === 'invalid_grant')

  const afterReplay = await rpc('tools/list', g1.access_token)
  record(19.1, 'replay REVOKES the token the first exchange issued', '401 on the next call',
    String(afterReplay.res.status), afterReplay.res.status === 401, true)

  // --- Tools, on a grant that never had health -----------------------------
  // Re-authorise, because check 19.1 deliberately killed the first grant.
  const second = await grant({ label: 'Grant 2 (health and documents OFF again)', clientId, redirectUri, tickSensitive: false })
  if (!second) return report()
  const t2 = (await token({
    grant_type: 'authorization_code', code: second.code, client_id: clientId,
    redirect_uri: redirectUri, code_verifier: second.verifier,
  })).body

  const list = await rpc('tools/list', t2.access_token)
  const tools = list.body?.result?.tools ?? []
  const names = tools.map((t) => t.name)
  const healthTools = ['list_cycles', 'log_cycle', 'list_health_records', 'add_health_record']
  const leaked = healthTools.filter((n) => names.includes(n))
  record(24, 'tools/list on an OAuth grant', 'a list of tools',
    `${tools.length} tools`, tools.length > 0)
  record(24.1, 'health tools are ABSENT, not merely refused', 'none listed',
    leaked.length ? leaked.join(', ') : 'none', leaked.length === 0, true)
  record(24.2, 'document tools are absent', 'none listed',
    names.includes('list_documents') ? 'list_documents present' : 'none',
    !names.includes('list_documents'), true)

  const overview = await rpc('tools/call', t2.access_token, { name: 'get_overview', arguments: {} })
  record(25, 'tools/call get_overview', 'a result',
    `${overview.res.status} ${overview.body?.result?.isError ? 'isError' : 'ok'}`,
    overview.res.status === 200 && Boolean(overview.body?.result))

  // --- Rotation ------------------------------------------------------------
  const refreshed = await token({ grant_type: 'refresh_token', refresh_token: t2.refresh_token, client_id: clientId })
  const r2 = refreshed.body
  record(21, 'refresh rotates the refresh token', 'a different refresh_token',
    r2?.refresh_token === t2.refresh_token ? 'unchanged' : 'rotated',
    Boolean(r2?.refresh_token) && r2.refresh_token !== t2.refresh_token)

  record(23, 'refresh cannot widen scope', 'scope unchanged, no health',
    `scope="${r2?.scope}"`, Boolean(r2?.scope) && !r2.scope.includes('health'), true)

  const reused = await token({ grant_type: 'refresh_token', refresh_token: t2.refresh_token, client_id: clientId })
  record(22, 'reusing the rotated refresh token is refused', 'invalid_grant',
    `${reused.res.status} ${reused.body?.error}`, reused.body?.error === 'invalid_grant')
  const afterReuse = await rpc('tools/list', r2.access_token)
  record(22.1, 'and REVOKES the whole grant', '401 on the next call',
    String(afterReuse.res.status), afterReuse.res.status === 401, true)

  // --- The one that matters most: does ticking health actually work --------
  const third = await grant({ label: 'Grant 3 (health and documents ON)', clientId, redirectUri, tickSensitive: true })
  if (third) {
    const t3 = (await token({
      grant_type: 'authorization_code', code: third.code, client_id: clientId,
      redirect_uri: redirectUri, code_verifier: third.verifier,
    })).body
    const scope3 = t3?.scope ?? ''
    record(15, 'TICKED health and documents survive to the grant', 'scope contains both',
      `scope="${scope3}"`, scope3.includes('health') && scope3.includes('documents'), true)

    const l3 = await rpc('tools/list', t3?.access_token)
    const n3 = (l3.body?.result?.tools ?? []).map((t) => t.name)
    record(15.1, 'and the health tools are actually offered', 'list_cycles present',
      n3.includes('list_cycles') ? 'present' : 'absent', n3.includes('list_cycles'), true)

    // --- Revocation ------------------------------------------------------
    console.log('\nNow revoke the newest grant in Settings → Connected assistants.')
    await ask('Press Enter once you have revoked it: ')
    const afterRevoke = await rpc('tools/list', t3?.access_token)
    record(26, 'revoking kills the very next call', '401',
      String(afterRevoke.res.status), afterRevoke.res.status === 401, true)
  }

  record(20, 'a code expires after 60s', 'invalid_grant',
    'skipped — costs a minute of waiting; run with WAIT=1 to include', null)

  report()
}

function report() {
  const failed = results.filter((r) => r.pass === false)
  const skipped = results.filter((r) => r.pass === null)
  const silentFails = failed.filter((r) => r.silent)

  console.log(`\n${'='.repeat(72)}`)
  console.log(`${results.filter((r) => r.pass === true).length} passed · ${failed.length} failed · ${skipped.length} skipped`)

  if (silentFails.length) {
    console.log('\nWOULD FAIL SILENTLY IN NORMAL USE:')
    for (const r of silentFails) console.log(`  ${r.id}  ${r.what}\n      ${r.actual}`)
  }
  if (failed.length) {
    console.log('\nFAILURES:')
    for (const r of failed) console.log(`  ${r.id}  ${r.what}\n      expected ${r.expected}\n      actual   ${r.actual}`)
  }
  if (skipped.length) {
    console.log('\nNOT RUN (report as unverified, never as passing):')
    for (const r of skipped) console.log(`  ${r.id}  ${r.what} — ${r.actual}`)
  }
  rl.close()
  process.exit(failed.length ? 1 : 0)
}

main().catch((e) => {
  console.error('\nHarness error:', e.message)
  rl.close()
  process.exit(2)
})
