import { evaluateVerificationReadings, preciseRound } from './src/services/verificationEngine';

async function runTests() {
  console.log('=== Starting Phase 4 Backend Verification & Integration Tests ===\n');
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

  // 1. Math Precision Tests
  console.log('--- 1. Verification Engine Precision Tests ---');
  const sum = preciseRound(0.1 + 0.2, 4);
  assert(sum === 0.3, '0.1 + 0.2 equals exactly 0.3 with preciseRound', sum);

  const errorCalc = preciseRound(10.005 - 10.0, 5);
  assert(errorCalc === 0.005, '10.005 - 10.0 equals exactly 0.005 without binary float artifacts', errorCalc);

  // 2. Tolerance Boundary Tests (Class II Scale: e = 0.005 kg, MPE = 0.005 kg)
  console.log('\n--- 2. Tolerance & Boundary Tests ---');
  
  // Inside tolerance
  const evalInside = await evaluateVerificationReadings(
    'Electronic Weighing Scale (Class II)',
    0.005,
    [
      { pointName: 'Point 1', referenceLoad: 10.0, observedValue: 10.003 }, // error 0.003 <= 0.005 (PASS)
      { pointName: 'Point 2', referenceLoad: 25.0, observedValue: 25.004 }, // error 0.004 <= 0.005 (PASS)
      { pointName: 'Point 3', referenceLoad: 50.0, observedValue: 49.997 }, // error -0.003, abs <= 0.005 (PASS)
    ]
  );
  assert(evalInside.overallResult === 'PASS', 'Measurements within MPE evaluate to overall PASS');
  assert(evalInside.readings.every(r => r.status === 'PASS'), 'All individual readings pass');

  // Exact boundary condition: error === MPE exactly
  const evalBoundary = await evaluateVerificationReadings(
    'Electronic Weighing Scale (Class II)',
    0.005,
    [
      { pointName: 'Exact Boundary', referenceLoad: 10.0, observedValue: 10.005 }, // error = +0.005 === MPE
    ]
  );
  assert(evalBoundary.overallResult === 'PASS', 'Exact boundary error (+0.005 kg vs MPE 0.005 kg) evaluates to PASS');

  // Outside tolerance condition: error === 0.006 > MPE (0.005)
  const evalOutside = await evaluateVerificationReadings(
    'Electronic Weighing Scale (Class II)',
    0.005,
    [
      { pointName: 'Pass Point', referenceLoad: 10.0, observedValue: 10.002 },
      { pointName: 'Fail Point (Exceeds MPE)', referenceLoad: 25.0, observedValue: 25.008 }, // error 0.008 > 0.005
    ]
  );
  assert(evalOutside.overallResult === 'FAIL', 'Any single test point exceeding MPE triggers overall FAIL');
  assert(evalOutside.readings[0].status === 'PASS', 'Individual pass point correctly flagged PASS');
  assert(evalOutside.readings[1].status === 'FAIL', 'Individual out-of-tolerance point correctly flagged FAIL');

  // 3. API Integration Tests (Fetch against running port 5000)
  console.log('\n--- 3. API Integration & Role Authorization Tests ---');
  const API_URL = 'http://localhost:5000/api';

  // Health
  const healthRes = await fetch(`${API_URL}/health`);
  const healthData = await healthRes.json();
  assert(healthRes.ok && healthData.status === 'healthy', 'GET /api/health returns 200 healthy');

  // Owner Login
  const ownerLoginRes = await fetch(`${API_URL}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'techcorp@example.com', password: 'owner123' })
  });
  const ownerData = await ownerLoginRes.json();
  assert(ownerLoginRes.ok && !!ownerData.token, 'Owner login succeeds and returns JWT');
  const ownerToken = ownerData.token;

  // Officer Login
  const officerLoginRes = await fetch(`${API_URL}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'v.sharma@emaanak.gov.in', password: 'officer123' })
  });
  const officerData = await officerLoginRes.json();
  assert(officerLoginRes.ok && !!officerData.token, 'Officer login succeeds and returns JWT');
  const officerToken = officerData.token;

  // Admin Login
  const adminLoginRes = await fetch(`${API_URL}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'admin@emaanak.gov.in', password: 'admin123' })
  });
  const adminData = await adminLoginRes.json();
  assert(adminLoginRes.ok && !!adminData.token, 'Admin login succeeds and returns JWT');
  const adminToken = adminData.token;

  // Unauthorized route testing: Owner trying to access Officer pending queue
  const unauthorizedRes = await fetch(`${API_URL}/verifications/pending`, {
    headers: { Authorization: `Bearer ${ownerToken}` }
  });
  assert(unauthorizedRes.status === 403, 'RBAC prevents Owner from accessing Officer pending queue (HTTP 403)');

  // Officer accessing pending queue
  const pendingRes = await fetch(`${API_URL}/verifications/pending`, {
    headers: { Authorization: `Bearer ${officerToken}` }
  });
  const pendingApps = await pendingRes.json();
  assert(pendingRes.ok && Array.isArray(pendingApps), 'Officer can fetch pending verification applications');

  // 4. Public QR Verification Tests
  console.log('\n--- 4. Public QR Verification Tests ---');
  // Valid token
  const validQrRes = await fetch(`${API_URL}/certificates/public/verify/tok_active_cert_901_valid_hash`);
  const validQrData = await validQrRes.json();
  assert(validQrRes.ok && validQrData.status === 'VALID', 'Active QR token returns VALID CERTIFICATE');

  // Expired token
  const expiredQrRes = await fetch(`${API_URL}/certificates/public/verify/tok_expired_cert_412_hash`);
  const expiredQrData = await expiredQrRes.json();
  assert(expiredQrRes.ok && expiredQrData.status === 'EXPIRED', 'Expired QR token correctly returns EXPIRED status');

  // Revoked token
  const revokedQrRes = await fetch(`${API_URL}/certificates/public/verify/tok_revoked_cert_664_hash`);
  const revokedQrData = await revokedQrRes.json();
  assert(revokedQrRes.ok && revokedQrData.status === 'REVOKED', 'Revoked QR token returns REVOKED status with reason');
  assert(!!revokedQrData.revocationReason, 'Revocation reason is present in public payload');

  // Bogus / Invalid token
  const bogusQrRes = await fetch(`${API_URL}/certificates/public/verify/non_existent_token_9999`);
  const bogusQrData = await bogusQrRes.json();
  assert(bogusQrRes.status === 404 && bogusQrData.status === 'INVALID', 'Unknown QR token returns 404 INVALID');

  // 5. Analytics & Notifications Tests
  console.log('\n--- 5. Analytics & Notifications Tests ---');
  const adminAnalyticsRes = await fetch(`${API_URL}/analytics/admin`, {
    headers: { Authorization: `Bearer ${adminToken}` }
  });
  const adminAnalytics = await adminAnalyticsRes.json();
  assert(adminAnalyticsRes.ok && adminAnalytics.overview.totalInstruments >= 6, 'Admin analytics returns real system metrics');

  const notificationsRes = await fetch(`${API_URL}/notifications`, {
    headers: { Authorization: `Bearer ${ownerToken}` }
  });
  const notifData = await notificationsRes.json();
  assert(notificationsRes.ok && Array.isArray(notifData.notifications), 'Notifications system returns user alerts');

  console.log(`\n=== Test Results: ${passed} PASSED, ${failed} FAILED ===\n`);
  if (failed > 0) process.exit(1);
}

runTests().catch(err => {
  console.error('Test execution error:', err);
  process.exit(1);
});
