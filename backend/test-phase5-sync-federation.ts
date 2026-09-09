import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const API_URL = 'http://localhost:5000/api/v1';

async function runPhase5Tests() {
  console.log('=== Starting Phase 5 Offline Sync & Federation Integration Tests ===\n');
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

  // 1. API Versioning & OpenAPI 3.0 Tests
  console.log('--- 1. API Versioning & OpenAPI Tests ---');
  const healthV1 = await (await fetch('http://localhost:5000/api/v1/health')).json();
  const healthLegacy = await (await fetch('http://localhost:5000/api/health')).json();
  assert(healthV1.status === 'healthy' && healthLegacy.status === 'healthy', 'Versioned /api/v1 and legacy /api endpoints are both active');

  const openapiSpec = await (await fetch('http://localhost:5000/api/v1/docs')).json();
  assert(openapiSpec.openapi === '3.0.3', 'OpenAPI 3.0.3 specification is served correctly');
  assert(!!openapiSpec.paths['/verifications/sync'], 'Offline sync endpoint documented in OpenAPI');
  assert(!!openapiSpec.paths['/certificates/public/verify/{token}'], 'Public QR endpoint documented in OpenAPI');

  // 2. Authentication Tokens
  console.log('\n--- 2. Role Authentication ---');
  const officerLogin = await (await fetch(`${API_URL}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'v.sharma@emaanak.gov.in', password: 'officer123' })
  })).json();
  const officerToken = officerLogin.token;

  const ownerLogin = await (await fetch(`${API_URL}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'techcorp@example.com', password: 'owner123' })
  })).json();
  const ownerToken = ownerLogin.token;

  // 3. Register Instrument & Submit Application for Offline Testing
  console.log('\n--- 3. Setting Up Test Application ---');
  const testInst = await prisma.instrument.create({
    data: {
      ownerId: ownerLogin.user.id,
      type: 'Electronic Weighing Scale (Class II)',
      manufacturer: 'CAS Corporation',
      model: 'SW-1 Plus',
      serialNumber: `SN-OFFLINE-${Date.now().toString().slice(-6)}`,
      maxCapacity: 20.0,
      verificationInterval: 0.002, // e = 2g
      status: 'PENDING'
    }
  });

  const testApp = await prisma.verificationApplication.create({
    data: {
      instrumentId: testInst.id,
      applicantId: ownerLogin.user.id,
      status: 'SUBMITTED'
    }
  });
  console.log(`✓ Created test application ${testApp.id} for instrument ${testInst.serialNumber}`);

  // 4. Offline Synchronization Test
  console.log('\n--- 4. Idempotent Offline Sync Execution ---');
  const clientOpId = `OP-OFFLINE-TEST-${Date.now()}`;
  const syncPayload = {
    clientOperationId: clientOpId,
    applicationId: testApp.id,
    ruleVersion: 'LM-RULE-2026.1',
    readings: [
      { pointName: '20% Load (4kg)', referenceLoad: 4.0, observedValue: 4.001 },
      { pointName: '50% Load (10kg)', referenceLoad: 10.0, observedValue: 10.0015 },
      { pointName: '100% Load (20kg)', referenceLoad: 20.0, observedValue: 20.0018 }
    ],
    remarks: 'Field officer verified knife-edge balance using calibrated M1 test weights.',
    clientCreatedAt: new Date().toISOString()
  };

  // Attempt 1: First sync
  const syncRes1 = await (await fetch(`${API_URL}/verifications/sync`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${officerToken}` },
    body: JSON.stringify(syncPayload)
  })).json();

  assert(syncRes1.syncResult === 'ACCEPTED', 'First sync attempt is ACCEPTED by server');
  assert(syncRes1.overallResult === 'PASS', 'Authoritative server calculation evaluates to PASS');
  assert(!!syncRes1.certificate?.certificateNumber, 'Digital certificate and QR token generated upon sync');
  const issuedCertNumber = syncRes1.certificate.certificateNumber;

  // Attempt 2: Replay/Network retry with identical clientOperationId
  console.log('\n--- 5. Deduplication & Idempotency Check ---');
  const syncRes2 = await (await fetch(`${API_URL}/verifications/sync`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${officerToken}` },
    body: JSON.stringify(syncPayload)
  })).json();

  assert(syncRes2.syncResult === 'SYNCED_EXISTING', 'Replayed sync request with same clientOperationId returns SYNCED_EXISTING');
  assert(syncRes2.certificate?.certificateNumber === issuedCertNumber, 'Idempotent response preserves exact certificate number without creating duplicates');

  const inspectionsCount = await prisma.verificationInspection.count({
    where: { clientOperationId: clientOpId }
  });
  assert(inspectionsCount === 1, 'Database constraint guarantees exactly 1 inspection record exists for clientOperationId');

  // 6. Conflict Detection Tests
  console.log('\n--- 6. Conflict Detection & Rejection Safety ---');
  // Attempt sync for already completed application with a different clientOperationId
  const conflictPayload = {
    clientOperationId: `OP-DIFFERENT-${Date.now()}`,
    applicationId: testApp.id,
    ruleVersion: 'LM-RULE-2026.1',
    readings: [{ pointName: 'Duplicate Test', referenceLoad: 5.0, observedValue: 5.0 }],
    clientCreatedAt: new Date().toISOString()
  };
  const conflictRes = await fetch(`${API_URL}/verifications/sync`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${officerToken}` },
    body: JSON.stringify(conflictPayload)
  });
  const conflictData = await conflictRes.json();
  assert(conflictRes.status === 409 && conflictData.syncResult === 'CONFLICT', 'Syncing an already-verified application produces HTTP 409 CONFLICT');

  // Attempt sync with mismatched/deprecated rule version
  const staleRulePayload = {
    clientOperationId: `OP-STALE-RULE-${Date.now()}`,
    applicationId: testApp.id,
    ruleVersion: 'OBSOLETE-RULE-1985',
    readings: [{ pointName: 'Test Point', referenceLoad: 5.0, observedValue: 5.0 }],
    clientCreatedAt: new Date().toISOString()
  };
  const staleRuleRes = await fetch(`${API_URL}/verifications/sync`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${officerToken}` },
    body: JSON.stringify(staleRulePayload)
  });
  assert(staleRuleRes.status === 409, 'Syncing with obsolete rule version triggers CONFLICT');

  // 7. State Repository Federation Tests
  console.log('\n--- 7. State Repository Federation Tests ---');
  const fedHealth = await (await fetch(`${API_URL}/federation/health`, {
    headers: { Authorization: `Bearer ${officerToken}` }
  })).json();
  assert(fedHealth.adapterStatus === 'ACTIVE', 'Federation adapter is ACTIVE and healthy');
  assert(fedHealth.targetNodes.length >= 3, 'Federation network nodes are registered');

  // Export certificate to national gateway exchange contract
  const exportRes = await (await fetch(`${API_URL}/federation/export/${issuedCertNumber}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${officerToken}` },
    body: JSON.stringify({ targetRepository: 'NATIONAL_LEGAL_METROLOGY_GATEWAY_V1' })
  })).json();

  assert(exportRes.success === true, 'Certificate exported successfully to national exchange format');
  assert(exportRes.contract.certificateNumber === issuedCertNumber, 'Data contract contains matching certificate number');
  assert(exportRes.contract.jurisdiction === 'IN-LEGAL-METROLOGY', 'Data contract adheres to standard Indian Legal Metrology jurisdiction format');

  const fedLogs = await prisma.federationLog.findMany({
    where: { recordReference: issuedCertNumber }
  });
  assert(fedLogs.length >= 1, 'Federation exchange is recorded in immutable FederationLog');

  console.log(`\n=== Phase 5 Test Results: ${passed} PASSED, ${failed} FAILED ===\n`);
  if (failed > 0) process.exit(1);
}

runPhase5Tests().catch(err => {
  console.error('Test error:', err);
  process.exit(1);
});
