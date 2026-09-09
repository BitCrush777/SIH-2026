import { prisma } from './src/utils/prisma';
import jwt from 'jsonwebtoken';

const API_BASE = 'http://localhost:5000/api/v1';
const JWT_SECRET = process.env.JWT_SECRET || 'sih2026-super-secret-jwt-key';

interface TestAssertion {
  name: string;
  fn: () => Promise<void>;
}

const tests: TestAssertion[] = [];
function test(name: string, fn: () => Promise<void>) {
  tests.push({ name, fn });
}

let ownerToken: string;
let officerToken: string;
let adminToken: string;

test('1. Database Warmup: Prisma Client connects to Supabase PostgreSQL', async () => {
  await prisma.$connect();
  const userCount = await prisma.user.count();
  if (userCount === 0) throw new Error('Database contains 0 users. Seed required.');
});

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://pmvwmiyuqroeqypxadto.supabase.co';
const SUPABASE_ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY || 'sb_publishable_DYXfHRq6KYNRGJVc12wAwA_JQIi1bJa';
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

test('2. Owner Authentication: sign in via Supabase Auth and verify live access token', async () => {
  const { data, error } = await supabase.auth.signInWithPassword({
    email: 'techcorp@example.com',
    password: 'owner123'
  });
  if (error || !data.session) throw new Error(`Supabase sign-in failed: ${error?.message}`);
  ownerToken = data.session.access_token;
  if (!ownerToken) throw new Error('Missing Supabase access token');

  // Verify backend resolves the Supabase token to OWNER role
  const res = await fetch(`${API_BASE}/auth/me`, {
    headers: { Authorization: `Bearer ${ownerToken}` }
  });
  if (res.status !== 200) throw new Error(`Expected 200 from backend /me, got ${res.status}`);
  const me = await res.json();
  if (me.user.role !== 'OWNER') throw new Error(`Expected OWNER, got ${me.user.role}`);
  if (me.user.supabaseAuthId !== data.user.id) throw new Error('supabaseAuthId mismatch');
});

test('3. Officer Authentication: sign in via Supabase Auth and map to OFFICER role', async () => {
  const { data, error } = await supabase.auth.signInWithPassword({
    email: 'v.sharma@emaanak.gov.in',
    password: 'officer123'
  });
  if (error || !data.session) throw new Error(`Supabase sign-in failed: ${error?.message}`);
  officerToken = data.session.access_token;

  const res = await fetch(`${API_BASE}/auth/me`, {
    headers: { Authorization: `Bearer ${officerToken}` }
  });
  if (res.status !== 200) throw new Error(`Expected 200 from backend /me, got ${res.status}`);
  const me = await res.json();
  if (me.user.role !== 'OFFICER') throw new Error(`Expected OFFICER, got ${me.user.role}`);
  if (me.user.supabaseAuthId !== data.user.id) throw new Error('supabaseAuthId mismatch');
});

test('4. Admin Authentication: sign in via Supabase Auth and map to ADMIN role', async () => {
  const { data, error } = await supabase.auth.signInWithPassword({
    email: 'admin@emaanak.gov.in',
    password: 'admin123'
  });
  if (error || !data.session) throw new Error(`Supabase sign-in failed: ${error?.message}`);
  adminToken = data.session.access_token;

  const res = await fetch(`${API_BASE}/auth/me`, {
    headers: { Authorization: `Bearer ${adminToken}` }
  });
  if (res.status !== 200) throw new Error(`Expected 200 from backend /me, got ${res.status}`);
  const me = await res.json();
  if (me.user.role !== 'ADMIN') throw new Error(`Expected ADMIN, got ${me.user.role}`);
  if (me.user.supabaseAuthId !== data.user.id) throw new Error('supabaseAuthId mismatch');
});

test('5. Session Identity Verification: GET /me returns full user profile including supabaseAuthId', async () => {
  const res = await fetch(`${API_BASE}/auth/me`, {
    headers: { Authorization: `Bearer ${ownerToken}` }
  });
  if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`);
  const data = await res.json();
  if (data.user.email !== 'techcorp@example.com') throw new Error('Email mismatch');
  if (data.user.role !== 'OWNER') throw new Error('Role mismatch');
  if (!data.user.supabaseAuthId) throw new Error('Missing mapped supabaseAuthId');
});

test('6. Supabase Token Resolution: authMiddleware validates token containing sub = supabaseAuthId', async () => {
  // Simulate a token formatted by Supabase Auth with sub = supabaseAuthId
  const appUser = await prisma.user.findUnique({ where: { email: 'techcorp@example.com' } });
  const simulatedSupabaseToken = jwt.sign(
    {
      sub: appUser?.supabaseAuthId,
      email: appUser?.email,
      aud: 'authenticated',
      role: 'authenticated'
    },
    JWT_SECRET,
    { expiresIn: '1h' }
  );

  const res = await fetch(`${API_BASE}/auth/me`, {
    headers: { Authorization: `Bearer ${simulatedSupabaseToken}` }
  });
  if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`);
  const data = await res.json();
  if (data.user.id !== appUser?.id) throw new Error('Failed to resolve application user by supabaseAuthId');
  if (data.user.role !== 'OWNER') throw new Error('Failed to resolve statutory role');
});

test('7. Anti-Account Enumeration: Incorrect password returns 401 with generic error', async () => {
  const res = await fetch(`${API_BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'techcorp@example.com', password: 'wrong-password' })
  });
  if (res.status !== 401) throw new Error(`Expected 401, got ${res.status}`);
  const data = await res.json();
  if (!data.error.includes('Invalid credentials')) throw new Error('Exposed password enumeration clue');
});

test('8. Anti-Account Enumeration: Non-existent email returns 401 with identical generic error', async () => {
  const res = await fetch(`${API_BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'ghost-user@emaanak.gov.in', password: 'random-password' })
  });
  if (res.status !== 401) throw new Error(`Expected 401, got ${res.status}`);
  const data = await res.json();
  if (!data.error.includes('Invalid credentials')) throw new Error('Exposed email enumeration clue');
});

test('9. Security Defense: Forged JWT token signature is rejected with 401 Unauthorized', async () => {
  const forgedToken = jwt.sign(
    { sub: 'sb_auth_admin_001', email: 'admin@emaanak.gov.in', role: 'ADMIN' },
    'forged-malicious-secret-key-12345'
  );
  const res = await fetch(`${API_BASE}/audit-logs`, {
    headers: { Authorization: `Bearer ${forgedToken}` }
  });
  if (res.status !== 401) throw new Error(`Expected 401, got ${res.status}`);
});

test('10. Security Defense: Malformed token is rejected with 401 Unauthorized', async () => {
  const res = await fetch(`${API_BASE}/audit-logs`, {
    headers: { Authorization: 'Bearer this-is-not-a-valid-jwt-structure' }
  });
  if (res.status !== 401) throw new Error(`Expected 401, got ${res.status}`);
});

test('11. Security Defense: Expired token is rejected with 401 Unauthorized', async () => {
  const expiredToken = jwt.sign(
    { sub: 'sb_auth_owner_techcorp_001', email: 'techcorp@example.com' },
    JWT_SECRET,
    { expiresIn: '-10s' }
  );
  const res = await fetch(`${API_BASE}/instruments`, {
    headers: { Authorization: `Bearer ${expiredToken}` }
  });
  if (res.status !== 401) throw new Error(`Expected 401, got ${res.status}`);
});

test('12. Security Defense: Missing Authorization header on protected route returns 401', async () => {
  const res = await fetch(`${API_BASE}/instruments`);
  if (res.status !== 401) throw new Error(`Expected 401, got ${res.status}`);
});

test('13. RBAC Matrix: Owner is permitted to access Owner instruments (200 OK)', async () => {
  const res = await fetch(`${API_BASE}/instruments`, {
    headers: { Authorization: `Bearer ${ownerToken}` }
  });
  if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`);
});

test('14. RBAC Matrix: Owner is BLOCKED from Field Officer pending verifications (403 Forbidden)', async () => {
  const res = await fetch(`${API_BASE}/verifications/pending`, {
    headers: { Authorization: `Bearer ${ownerToken}` }
  });
  if (res.status !== 403) throw new Error(`Expected 403 Forbidden, got ${res.status}`);
});

test('15. RBAC Matrix: Owner is BLOCKED from Central Government Audit Logs (403 Forbidden)', async () => {
  const res = await fetch(`${API_BASE}/audit-logs`, {
    headers: { Authorization: `Bearer ${ownerToken}` }
  });
  if (res.status !== 403) throw new Error(`Expected 403 Forbidden, got ${res.status}`);
});

test('16. RBAC Matrix: Officer is permitted to access pending verifications (200 OK)', async () => {
  const res = await fetch(`${API_BASE}/verifications/pending`, {
    headers: { Authorization: `Bearer ${officerToken}` }
  });
  if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`);
});

test('17. RBAC Matrix: Officer is BLOCKED from Central Government Audit Logs (403 Forbidden)', async () => {
  const res = await fetch(`${API_BASE}/audit-logs`, {
    headers: { Authorization: `Bearer ${officerToken}` }
  });
  if (res.status !== 403) throw new Error(`Expected 403 Forbidden, got ${res.status}`);
});

test('18. RBAC Matrix: Admin is permitted to access Central Government Audit Logs (200 OK)', async () => {
  const res = await fetch(`${API_BASE}/audit-logs`, {
    headers: { Authorization: `Bearer ${adminToken}` }
  });
  if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`);
});

test('19. RBAC Matrix: Admin is permitted to access Central Analytics (200 OK)', async () => {
  const res = await fetch(`${API_BASE}/analytics/admin`, {
    headers: { Authorization: `Bearer ${adminToken}` }
  });
  if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`);
});

test('20. Statutory IDOR Security: Owner cannot access certificates belonging to other businesses', async () => {
  // CERT-2026-664 belongs to Metro Logistics (ownerLogistics), not TechCorp
  const res = await fetch(`${API_BASE}/certificates/CERT-2026-664`, {
    headers: { Authorization: `Bearer ${ownerToken}` }
  });
  if (res.status !== 403) throw new Error(`Expected 403 IDOR blocked, got ${res.status}`);
});

test('21. Statutory IDOR Security: Officer can inspect certificates across all owners for statutory audit', async () => {
  const res = await fetch(`${API_BASE}/certificates/CERT-2026-664`, {
    headers: { Authorization: `Bearer ${officerToken}` }
  });
  if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`);
});

test('22. Public Citizen QR Verification: Unauthenticated scan succeeds with 200 OK', async () => {
  const res = await fetch(`${API_BASE}/certificates/public/verify/tok_active_cert_901_valid_hash`);
  if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`);
  const data = await res.json();
  if (data.status !== 'VALID') throw new Error(`Expected VALID, got ${data.status}`);
  if (!data.certificateNumber) throw new Error('Missing certificateNumber');
});

test('23. Shop / Retail Persona Authentication & Instrument Verification', async () => {
  const { data, error } = await supabase.auth.signInWithPassword({
    email: 'shop@example.com',
    password: 'shop123'
  });
  if (error || !data.session) throw new Error(`Shop sign-in failed: ${error?.message}`);
  
  const res = await fetch(`${API_BASE}/auth/me`, {
    headers: { Authorization: `Bearer ${data.session.access_token}` }
  });
  if (res.status !== 200) throw new Error(`Expected 200, got ${res.status}`);
  const profile = await res.json();
  if (profile.user.role !== 'OWNER') throw new Error(`Expected OWNER role, got ${profile.user.role}`);
  if (!profile.user.name.includes('Retail') && !profile.user.name.includes('Store')) {
    throw new Error('Unexpected shop profile name');
  }

  const instRes = await fetch(`${API_BASE}/instruments`, {
    headers: { Authorization: `Bearer ${data.session.access_token}` }
  });
  if (instRes.status !== 200) throw new Error(`Expected 200, got ${instRes.status}`);
  const instruments = await instRes.json();
  const list = instruments.instruments || instruments;
  if (!Array.isArray(list) || list.length === 0) throw new Error('Expected at least 1 instrument for shop');
});

async function run() {
  console.log('\n========================================================================');
  console.log('       SUPABASE AUTH & STATUTORY RBAC AUTOMATED TEST SUITE             ');
  console.log('========================================================================\n');

  let passed = 0;
  let failed = 0;

  for (const t of tests) {
    try {
      await t.fn();
      console.log(`  ✓ ${t.name}`);
      passed++;
    } catch (err: any) {
      console.error(`  ✗ ${t.name}`);
      console.error(`    -> Error: ${err.message}\n`);
      failed++;
    }
  }

  console.log('\n========================================================================');
  console.log(`  TOTAL: ${tests.length} | PASSED: ${passed} | FAILED: ${failed}`);
  console.log('========================================================================\n');

  await prisma.$disconnect();
  if (failed > 0) process.exit(1);
}

run();
