import { PrismaClient } from '@prisma/client';
import jwt from 'jsonwebtoken';

const prisma = new PrismaClient();
const BASE_URL = 'http://localhost:5000';
const API_URL = `${BASE_URL}/api/v1`;
const JWT_SECRET = process.env.JWT_SECRET || 'super-secret-key-for-sih';

async function runSecurityAuthTests() {
  console.log('=== Starting Security Patch & RBAC Audit Tests ===\n');
  let passed = 0;
  let failed = 0;

  function assert(condition: boolean, testName: string, detail?: any) {
    if (condition) {
      console.log(`[PASS] ${testName}`);
      passed++;
    } else {
      console.error(`[FAIL] ${testName}`, detail ?? '');
      failed++;
    }
  }

  // --- 1. AUTHENTICATION INTEGRITY & CREDENTIAL VERIFICATION ---
  console.log('--- 1. Authentication Integrity & Credential Verification ---');

  // Valid Owner Login
  const ownerRes = await fetch(`${API_URL}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'techcorp@example.com', password: 'owner123' })
  });
  assert(ownerRes.status === 200, 'Valid Owner login returns HTTP 200');
  const ownerData = await ownerRes.json();
  assert(!!ownerData.token, 'Owner login returns signed JWT token');
  assert(ownerData.user?.role === 'OWNER', 'Owner role is correctly resolved from backend identity');
  const ownerToken = ownerData.token;

  // Valid Officer Login
  const officerRes = await fetch(`${API_URL}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'v.sharma@emaanak.gov.in', password: 'officer123' })
  });
  assert(officerRes.status === 200, 'Valid Officer login returns HTTP 200');
  const officerData = await officerRes.json();
  assert(officerData.user?.role === 'OFFICER', 'Officer role is correctly resolved from backend identity');
  const officerToken = officerData.token;

  // Valid Admin Login
  const adminRes = await fetch(`${API_URL}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'admin@emaanak.gov.in', password: 'admin123' })
  });
  assert(adminRes.status === 200, 'Valid Admin login returns HTTP 200');
  const adminData = await adminRes.json();
  assert(adminData.user?.role === 'ADMIN', 'Admin role is correctly resolved from backend identity');
  const adminToken = adminData.token;

  // Invalid Password
  const badPassRes = await fetch(`${API_URL}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'admin@emaanak.gov.in', password: 'WrongPassword999!' })
  });
  assert(badPassRes.status === 401, 'Invalid password returns HTTP 401 Unauthorized');
  const badPassData = await badPassRes.json();
  assert(badPassData.error === 'Invalid credentials. Please verify your sign-in details.', 'Invalid password returns generic non-enumerating message');

  // Unknown Email
  const badEmailRes = await fetch(`${API_URL}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'nonexistent_user@gov.in', password: 'AnyPassword123!' })
  });
  assert(badEmailRes.status === 401, 'Unknown email returns HTTP 401 Unauthorized');
  const badEmailData = await badEmailRes.json();
  assert(badEmailData.error === 'Invalid credentials. Please verify your sign-in details.', 'Unknown email returns identical generic message (anti-enumeration)');

  // Missing Fields
  const emptyRes = await fetch(`${API_URL}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: '' })
  });
  assert(emptyRes.status === 400, 'Missing email/password returns HTTP 400 Bad Request');

  // --- 2. TOKEN INTEGRITY & ANTI-TAMPERING ---
  console.log('\n--- 2. Token Integrity & Anti-Tampering ---');

  // Unauthenticated request to protected endpoint
  const unauthRes = await fetch(`${API_URL}/auth/me`);
  assert(unauthRes.status === 401, 'Request with no Authorization header returns HTTP 401 Unauthorized');

  // Malformed Bearer token
  const malformedRes = await fetch(`${API_URL}/auth/me`, {
    headers: { 'Authorization': 'Bearer NOT_A_VALID_JWT_TOKEN' }
  });
  assert(malformedRes.status === 401, 'Malformed JWT token returns HTTP 401 Unauthorized');

  // Forged token: valid payload signed with wrong key
  const forgedToken = jwt.sign(
    { id: 'hacker-id', role: 'ADMIN', name: 'Hacker', email: 'hacker@dark.web' },
    'attacker-private-key-12345'
  );
  const forgedRes = await fetch(`${API_URL}/analytics/admin`, {
    headers: { 'Authorization': `Bearer ${forgedToken}` }
  });
  assert(forgedRes.status === 401, 'Forged JWT with tampered signature is rejected with HTTP 401');

  // Expired token
  const expiredToken = jwt.sign(
    { id: ownerData.user.id, role: 'OWNER', email: ownerData.user.email },
    JWT_SECRET,
    { expiresIn: '-10s' } // Expired 10 seconds ago
  );
  const expiredRes = await fetch(`${API_URL}/instruments`, {
    headers: { 'Authorization': `Bearer ${expiredToken}` }
  });
  assert(expiredRes.status === 401, 'Expired JWT token returns HTTP 401 Unauthorized');

  // --- 3. ROLE-BASED ACCESS CONTROL (RBAC) MATRIX ---
  console.log('\n--- 3. Role-Based Access Control (RBAC) Matrix ---');

  // Owner Permissions
  const ownerInstRes = await fetch(`${API_URL}/instruments`, {
    headers: { 'Authorization': `Bearer ${ownerToken}` }
  });
  assert(ownerInstRes.status === 200, 'Owner can access permitted /instruments API');

  const ownerAnalyticsRes = await fetch(`${API_URL}/analytics/owner`, {
    headers: { 'Authorization': `Bearer ${ownerToken}` }
  });
  assert(ownerAnalyticsRes.status === 200, 'Owner can access permitted /analytics/owner API');

  // Owner attempting Officer endpoints -> must be 403
  const ownerOfficerPendingRes = await fetch(`${API_URL}/verifications/pending`, {
    headers: { 'Authorization': `Bearer ${ownerToken}` }
  });
  assert(ownerOfficerPendingRes.status === 403, 'Owner CANNOT access Officer pending queue (HTTP 403)');

  const ownerOfficerInspectRes = await fetch(`${API_URL}/verifications/inspect`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${ownerToken}` },
    body: JSON.stringify({ applicationId: 'fake-app-id', readings: [] })
  });
  assert(ownerOfficerInspectRes.status === 403, 'Owner CANNOT access Officer inspect benchmark (HTTP 403)');

  // Owner attempting Admin endpoints -> must be 403
  const ownerAdminAnalyticsRes = await fetch(`${API_URL}/analytics/admin`, {
    headers: { 'Authorization': `Bearer ${ownerToken}` }
  });
  assert(ownerAdminAnalyticsRes.status === 403, 'Owner CANNOT access Admin analytics (HTTP 403)');

  const ownerAuditLogsRes = await fetch(`${API_URL}/audit-logs`, {
    headers: { 'Authorization': `Bearer ${ownerToken}` }
  });
  assert(ownerAuditLogsRes.status === 403, 'Owner CANNOT access Administrative Audit Logs (HTTP 403)');

  const ownerUsersRes = await fetch(`${API_URL}/auth/users`, {
    headers: { 'Authorization': `Bearer ${ownerToken}` }
  });
  assert(ownerUsersRes.status === 403, 'Owner CANNOT access System User Registry (HTTP 403)');

  // Officer attempting Admin endpoints -> must be 403
  const officerAuditLogsRes = await fetch(`${API_URL}/audit-logs`, {
    headers: { 'Authorization': `Bearer ${officerToken}` }
  });
  assert(officerAuditLogsRes.status === 403, 'Officer CANNOT access Administrative Audit Logs (HTTP 403)');

  const officerAdminAnalyticsRes = await fetch(`${API_URL}/analytics/admin`, {
    headers: { 'Authorization': `Bearer ${officerToken}` }
  });
  assert(officerAdminAnalyticsRes.status === 403, 'Officer CANNOT access Statewide Admin Analytics (HTTP 403)');

  // Admin access -> 200
  const adminAuditLogsRes = await fetch(`${API_URL}/audit-logs`, {
    headers: { 'Authorization': `Bearer ${adminToken}` }
  });
  assert(adminAuditLogsRes.status === 200, 'Admin can access Administrative Audit Logs (HTTP 200)');

  const adminUsersRes = await fetch(`${API_URL}/auth/users`, {
    headers: { 'Authorization': `Bearer ${adminToken}` }
  });
  assert(adminUsersRes.status === 200, 'Admin can access System User Registry (HTTP 200)');

  // --- 4. INSECURE DIRECT OBJECT REFERENCE (IDOR) & RESOURCE OWNERSHIP ---
  console.log('\n--- 4. Insecure Direct Object Reference (IDOR) & Resource Ownership ---');

  // Create another owner (Owner B)
  const ownerBEmail = `owner_b_${Date.now()}@test.com`;
  const ownerB = await prisma.user.create({
    data: {
      name: 'Owner B Logistics Ltd.',
      email: ownerBEmail,
      passwordHash: 'dummy_hash',
      role: 'OWNER'
    }
  });

  const ownerBToken = jwt.sign(
    { id: ownerB.id, role: ownerB.role, name: ownerB.name, email: ownerB.email },
    JWT_SECRET,
    { expiresIn: '1h' }
  );

  // Retrieve an existing certificate owned by Owner A (TechCorp)
  const existingCert = await prisma.certificate.findFirst({
    where: {
      inspection: {
        application: {
          applicant: { email: 'techcorp@example.com' }
        }
      }
    }
  });

  if (existingCert) {
    // Owner A retrieves own certificate
    const ownerAGetRes = await fetch(`${API_URL}/certificates/${existingCert.certificateNumber}`, {
      headers: { 'Authorization': `Bearer ${ownerToken}` }
    });
    assert(ownerAGetRes.status === 200, 'Owner A can retrieve own certificate');

    // Owner B attempts to retrieve Owner A's certificate
    const ownerBGetRes = await fetch(`${API_URL}/certificates/${existingCert.certificateNumber}`, {
      headers: { 'Authorization': `Bearer ${ownerBToken}` }
    });
    assert(ownerBGetRes.status === 403, 'Owner B is FORBIDDEN from accessing Owner A certificate (IDOR protected, HTTP 403)');

    // Officer can access for physical stamping verification
    const officerGetRes = await fetch(`${API_URL}/certificates/${existingCert.certificateNumber}`, {
      headers: { 'Authorization': `Bearer ${officerToken}` }
    });
    assert(officerGetRes.status === 200, 'Authorized Officer can access certificate for physical audit');
  }

  // --- 5. PUBLIC QR VERIFICATION ROUTE ---
  console.log('\n--- 5. Public QR Verification Route ---');
  if (existingCert) {
    // Unauthenticated public request with valid QR token
    const publicQRRes = await fetch(`${API_URL}/certificates/public/verify/${existingCert.qrToken}`);
    assert(publicQRRes.status === 200, 'Public QR verification accessible WITHOUT login (HTTP 200)');
    const publicData = await publicQRRes.json();
    assert(publicData.certificateNumber === existingCert.certificateNumber, 'Public QR returns sanitized certificate verification data');
    assert(!publicData.inspection?.officer?.passwordHash, 'Public QR payload does not leak internal hashes or credentials');
  }

  // Unauthenticated request with invalid QR token
  const invalidQRRes = await fetch(`${API_URL}/certificates/public/verify/tok_invalid_fake_qr_12345`);
  assert(invalidQRRes.status === 404, 'Invalid QR token correctly returns HTTP 404 Not Found');

  // Clean up Owner B
  await prisma.user.delete({ where: { id: ownerB.id } });

  // Summary
  console.log('\n======================================================');
  console.log(`Security & RBAC Audit Results: ${passed} PASSED, ${failed} FAILED`);
  console.log('======================================================\n');

  await prisma.$disconnect();

  if (failed > 0) {
    process.exit(1);
  }
}

runSecurityAuthTests().catch(err => {
  console.error('Fatal error during security testing:', err);
  process.exit(1);
});
