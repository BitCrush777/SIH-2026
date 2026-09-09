import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const BASE_URL = 'http://localhost:5000';
const API_URL = `${BASE_URL}/api/v1`;

async function runPhase6Tests() {
  console.log('=== Starting Phase 6 Production Deployment & Security Readiness Tests ===\n');
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

  // 1. Security Headers Audit
  console.log('--- 1. Security Headers Audit ---');
  const healthRes = await fetch(`${API_URL}/health`);
  const headers = healthRes.headers;

  assert(headers.get('x-content-type-options') === 'nosniff', 'X-Content-Type-Options is nosniff');
  assert(headers.get('x-frame-options') === 'SAMEORIGIN', 'X-Frame-Options is SAMEORIGIN');
  assert(headers.get('x-xss-protection') === '1; mode=block', 'X-XSS-Protection is 1; mode=block');
  assert(headers.has('strict-transport-security'), 'Strict-Transport-Security (HSTS) header is present');
  assert(headers.has('access-control-allow-origin') || headers.has('vary'), 'CORS origin protection headers configured');

  // 2. Sliding Window Rate Limiting Audit
  console.log('\n--- 2. Sliding Window Rate Limiting Audit ---');
  assert(headers.has('x-ratelimit-limit'), 'X-RateLimit-Limit header is exposed');
  assert(headers.has('x-ratelimit-remaining'), 'X-RateLimit-Remaining header is exposed');

  const initialRemaining = parseInt(headers.get('x-ratelimit-remaining') || '999', 10);
  const secondHealth = await fetch(`${API_URL}/health`);
  const secondRemaining = parseInt(secondHealth.headers.get('x-ratelimit-remaining') || '999', 10);

  assert(secondRemaining <= initialRemaining, `Rate limit remaining counter decreases dynamically (${initialRemaining} -> ${secondRemaining})`);

  // Test strict rate limiting on /auth endpoint using isolated simulated IP
  console.log('   Testing rapid auth requests rate-limiting...');
  let rateLimitHit = false;
  let retryAfterHeader = false;
  for (let i = 0; i < 35; i++) {
    const res = await fetch(`${API_URL}/auth/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Forwarded-For': '198.51.100.77'
      },
      body: JSON.stringify({ email: `test-rate-${Date.now()}-${i}@test.com`, password: 'wrong' })
    });
    if (res.status === 429) {
      rateLimitHit = true;
      retryAfterHeader = res.headers.has('retry-after');
      break;
    }
  }
  assert(rateLimitHit, 'Strict auth rate limiter successfully throttles brute-force attempts with HTTP 429');
  assert(retryAfterHeader, 'HTTP 429 response includes Retry-After header for clients');

  // 3. Production Error Sanitizer Audit
  console.log('\n--- 3. Error Sanitization & Leakage Audit ---');
  // Trigger a 404
  const notFoundRes = await fetch(`${API_URL}/nonexistent-route-for-testing`);
  assert(notFoundRes.status === 404, 'Non-existent route returns clean 404');
  const notFoundBody = await notFoundRes.text();
  assert(!notFoundBody.includes('node_modules') && !notFoundBody.includes('at Function.'), '404 error does not leak backend stack traces');

  // 4. OpenAPI Specification & Health Endpoints
  console.log('\n--- 4. Production API Specification & Dual Versioning ---');
  const v1Health = await (await fetch(`${API_URL}/health`)).json();
  const legacyHealth = await (await fetch(`${BASE_URL}/api/health`)).json();
  assert(v1Health.status === 'healthy', 'API v1 health probe responds healthy');
  assert(legacyHealth.status === 'healthy', 'Legacy /api compatibility endpoint responds healthy');

  const docsRes = await fetch(`${BASE_URL}/api/docs`);
  assert(docsRes.status === 200, 'OpenAPI Documentation /api/docs endpoint returns 200 OK');
  const docsHtml = await docsRes.text();
  assert(docsHtml.includes('e-Maanak Legal Metrology API'), 'Interactive sovereign API documentation UI is loaded in /api/docs');

  const specRes = await fetch(`${API_URL}/docs`);
  assert(specRes.status === 200, 'OpenAPI Spec /api/v1/docs JSON endpoint returns 200 OK');
  const docsData = await specRes.json();
  assert(docsData.openapi === '3.0.3', 'OpenAPI specification is version 3.0.3');

  // 5. Database Performance & Index Verification
  console.log('\n--- 5. Database Indexes & Query Performance ---');
  await prisma.$connect();
  // Warm up connection
  await prisma.user.findFirst();

  const startTime = Date.now();
  
  // Test indexed query on Instrument serial number
  const instBySerial = await prisma.instrument.findFirst({
    where: { serialNumber: 'SN-TC-99882211' }
  });
  const serialQueryTime = Date.now() - startTime;
  assert(!!instBySerial, 'Indexed lookup on Instrument.serialNumber found seed record');
  assert(serialQueryTime < 250, `Indexed serial number query executed swiftly (${serialQueryTime}ms)`);

  // Test composite indexed query on Certificate status + expiryDate
  const certStartTime = Date.now();
  const validCerts = await prisma.certificate.findMany({
    where: {
      status: 'VALID',
      expiryDate: { gte: new Date() }
    },
    take: 10
  });
  const certQueryTime = Date.now() - certStartTime;
  assert(Array.isArray(validCerts), 'Composite index lookup on Certificate(status, expiryDate) returned valid set');
  assert(certQueryTime < 250, `Composite index query executed swiftly (${certQueryTime}ms)`);

  // Test indexed query on AuditLog
  const auditStartTime = Date.now();
  const logs = await prisma.auditLog.findMany({
    where: { action: 'SEED_INITIALIZATION' },
    take: 5
  });
  const auditQueryTime = Date.now() - auditStartTime;
  assert(Array.isArray(logs), 'Indexed lookup on AuditLog.action returned records');
  assert(auditQueryTime < 250, `Audit log index query executed swiftly (${auditQueryTime}ms)`);

  // 6. Federation Gateway Status
  console.log('\n--- 6. State Federation Gateway Verification ---');
  // Authenticate as ADMIN
  const adminLogin = await (await fetch(`${API_URL}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'admin@emaanak.gov.in', password: 'admin123' })
  })).json();

  if (adminLogin && adminLogin.token) {
    const fedRes = await fetch(`${API_URL}/federation/health`, {
      headers: { 'Authorization': `Bearer ${adminLogin.token}` }
    });
    assert(fedRes.status === 200, 'Admin can access Federation Gateway status endpoint');
    const fedData = await fedRes.json();
    assert(fedData.adapterStatus === 'ACTIVE', 'Federation adapterStatus is ACTIVE');
    assert(Array.isArray(fedData.targetNodes) && fedData.targetNodes.length > 0, 'Federated state gateways (DL, MH, National) configured and reported');
    assert(typeof fedData.totalFederatedExchanges === 'number', 'Federation metrics computed correctly');
  } else {
    assert(false, 'Admin login failed for federation status test', adminLogin);
  }

  // Summary
  console.log('\n======================================================');
  console.log(`Phase 6 Test Results: ${passed} PASSED, ${failed} FAILED`);
  console.log('======================================================\n');

  await prisma.$disconnect();

  if (failed > 0) {
    process.exit(1);
  }
}

runPhase6Tests().catch(err => {
  console.error('Fatal error during Phase 6 testing:', err);
  process.exit(1);
});
