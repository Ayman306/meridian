/**
 * Generate an ES256 JWT signing key for Supabase, without the Supabase CLI.
 *
 * Supabase's guide tells you to run `supabase gen signing-key --algorithm
 * ES256`. That is one more tool to install for a key you generate once, and
 * installing it is not always possible — a locked-down machine, no admin
 * rights, a corporate proxy. The key itself is not Supabase-specific: it is an
 * ordinary P-256 JWK, and `jose` is already a dependency of this app, so the
 * whole task is fifteen lines and no new tool.
 *
 * The output goes to two places, and it is the same value in both:
 *
 *   1. Supabase → Settings → API → JWT Keys → add a standby key, paste it,
 *      then press **Rotate key**. A standby key signs nothing until rotated.
 *   2. Vercel → SUPABASE_JWT_PRIVATE_KEY, Production scope. Then redeploy.
 *
 * This is the only moment the private half exists. Supabase will not give it
 * back — that guarantee is the whole point of the signing keys system — which
 * is why a key created *in the dashboard* has no private half to copy and
 * cannot be used to mint anything. If you lose this output, generate another
 * and rotate again; there is no recovery path, by design.
 *
 * Printed as one line, because that is the form both destinations want, and a
 * multi-line value truncated at the first newline is the failure this exists to
 * avoid.
 */
import { generateKeyPair, exportJWK } from 'jose'
import { randomUUID } from 'node:crypto'

const { privateKey, publicKey } = await generateKeyPair('ES256', { extractable: true })

// The kid is ours to choose and must be identical on both sides. A uuid matches
// the shape Supabase generates, so the key list stays visually consistent.
const kid = randomUUID()
const common = { kid, alg: 'ES256', use: 'sig' }

const priv = { ...(await exportJWK(privateKey)), ...common }
const pub = { ...(await exportJWK(publicKey)), ...common }

console.log('\nPRIVATE KEY — paste into BOTH Supabase (import) and Vercel:\n')
console.log(JSON.stringify(priv))
console.log('\nKey id: ' + kid)
console.log('\nPublic half, reference only — never paste this into Vercel:')
console.log(JSON.stringify(pub))
console.log(
  '\nNext:\n' +
    '  1. Supabase → Settings → API → JWT Keys → add standby key, paste the private key\n' +
    '  2. Press Rotate key (a standby key signs nothing)\n' +
    '  3. Vercel → SUPABASE_JWT_PRIVATE_KEY (Production) → the same private key\n' +
    '  4. Redeploy\n' +
    'Key state changes are throttled by Supabase for about five minutes.\n',
)
