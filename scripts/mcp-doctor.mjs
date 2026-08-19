/**
 * Checks every secret the MCP server and web push depend on, and proves the
 * ones that can be proved.
 *
 *   npm run mcp:doctor                          # against .env.local
 *   MERIDIAN_URL=https://… npm run mcp:doctor   # also probe a deployment
 *
 * The point is that most of these fail *silently*. A VAPID pair from two
 * different generations surfaces as notifications that simply never arrive; a
 * JWT secret from another project surfaces as an MCP server whose every query
 * 401s, which looks exactly like a revoked token. Neither says what is wrong.
 *
 * So nothing here is checked by being present. Each one is checked by being
 * used: the push keys have to sign a real request, and the JWT secret has to
 * mint a token Supabase actually accepts.
 */
import { readFileSync } from 'node:fs'
import { SignJWT } from 'jose'

const GREEN = '[32m'
const RED = '[31m'
const DIM = '[2m'
const OFF = '[0m'

const ENV_FILE = new URL('../.env.local', import.meta.url).pathname

function loadEnv() {
  try {
    return Object.fromEntries(
      readFileSync(ENV_FILE, 'utf8')
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line && !line.startsWith('#') && line.includes('='))
        .map((line) => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1)]),
    )
  } catch {
    // No .env.local is normal in CI, where everything comes from the process.
    return {}
  }
}

// The real environment wins, so this works unchanged in a deployment.
const env = { ...loadEnv(), ...process.env }

const results = []
const record = (name, ok, detail) => results.push({ name, ok, detail })

// --- the two that everything else depends on -------------------------------
for (const key of ['NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_ANON_KEY']) {
  record(key, Boolean(env[key]), env[key] ? 'set' : 'missing')
}

// --- web push --------------------------------------------------------------
const pub = env.NEXT_PUBLIC_VAPID_PUBLIC_KEY
const priv = env.VAPID_PRIVATE_KEY
const subject = env.VAPID_SUBJECT

if (!pub || !priv || !subject) {
  record('web push', false, 'not configured — the app runs fine, but nothing is ever sent')
} else {
  try {
    const { default: webpush } = await import('web-push')
    const crypto = await import('node:crypto')

    webpush.setVapidDetails(subject, pub, priv)

    const decode = (s) => Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64')
    if (decode(pub).length !== 65 || decode(pub)[0] !== 4) {
      throw new Error('public key is not an uncompressed P-256 point')
    }
    if (decode(priv).length !== 32) throw new Error('private key is not 32 bytes')

    // Signing is the test that matters: a mismatched pair — a public key from
    // one generation and a private key from another — passes every shape check
    // above and fails here.
    const ecdh = crypto.createECDH('prime256v1')
    ecdh.generateKeys()
    webpush.generateRequestDetails(
      {
        endpoint: 'https://fcm.googleapis.com/fcm/send/EXAMPLE',
        keys: {
          p256dh: ecdh.getPublicKey().toString('base64url'),
          auth: crypto.randomBytes(16).toString('base64url'),
        },
      },
      JSON.stringify({ title: 'check' }),
    )
    record('web push', true, 'keys sign and encrypt a real push request')
  } catch (e) {
    record('web push', false, `keys present but unusable: ${e.message}`)
  }
}

// --- the MCP token exchange ------------------------------------------------
const secret = env.SUPABASE_JWT_SECRET
const url = env.NEXT_PUBLIC_SUPABASE_URL
const anon = env.NEXT_PUBLIC_SUPABASE_ANON_KEY

if (!secret) {
  record('MCP token exchange', false, 'SUPABASE_JWT_SECRET missing — Supabase → Settings → API → JWT Keys')
} else if (!url || !anon) {
  record('MCP token exchange', false, 'also needs NEXT_PUBLIC_SUPABASE_URL and _ANON_KEY')
} else {
  try {
    const token = await new SignJWT({ role: 'authenticated' })
      .setProtectedHeader({ alg: 'HS256' })
      // A syntactically valid uuid that owns nothing. Whether it exists is
      // irrelevant — the only question is whether the signature is believed.
      .setSubject('00000000-0000-0000-0000-000000000000')
      .setAudience('authenticated')
      .setIssuer(`${url}/auth/v1`)
      .setIssuedAt()
      .setExpirationTime('60s')
      .sign(new TextEncoder().encode(secret))

    const res = await fetch(`${url}/rest/v1/`, {
      headers: { apikey: anon, Authorization: `Bearer ${token}` },
    })

    if (res.status === 401) {
      record(
        'MCP token exchange',
        false,
        'Supabase rejected the signature — wrong project, or this one uses asymmetric JWT signing keys',
      )
    } else {
      record('MCP token exchange', true, `Supabase accepted a minted token (HTTP ${res.status})`)
    }
  } catch (e) {
    record('MCP token exchange', false, `could not reach Supabase to find out: ${e.message}`)
  }
}

// --- optional: a live deployment -------------------------------------------
if (env.MERIDIAN_URL) {
  const base = env.MERIDIAN_URL.replace(/\/+$/, '')
  try {
    const res = await fetch(`${base}/api/mcp/token`, {
      method: 'POST',
      // Well-formed and certainly not real. 401 is the healthy answer.
      headers: { Authorization: `Bearer mrd_${'A'.repeat(43)}` },
    })
    if (res.status === 401) {
      record('deployment', true, 'exchange is live and refusing tokens it does not know')
    } else if (res.status === 503) {
      const body = await res.json().catch(() => ({}))
      record('deployment', false, `exchange not configured there: ${body.error ?? 'no detail'}`)
    } else {
      record('deployment', false, `unexpected HTTP ${res.status}`)
    }
  } catch (e) {
    record('deployment', false, `could not reach ${base}: ${e.message}`)
  }
} else {
  console.log(`\n${DIM}  (set MERIDIAN_URL to also check a deployment)${OFF}`)
}

const width = Math.max(...results.map((r) => r.name.length))
console.log('')
for (const r of results) {
  const mark = r.ok ? `${GREEN}ok  ${OFF}` : `${RED}FAIL${OFF}`
  console.log(`  ${mark}  ${r.name.padEnd(width)}  ${r.detail}`)
}

const failed = results.filter((r) => !r.ok)
console.log(`\n  ${results.length - failed.length}/${results.length} checks passed\n`)
process.exit(failed.length > 0 ? 1 : 0)
