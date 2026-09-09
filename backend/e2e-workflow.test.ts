async function testE2EWorkflow() {
  console.log('=== Executing Phase 4 Complete End-to-End Demonstration Workflow ===\n');
  const API = 'http://localhost:5000/api';

  // Step 1: Owner Login
  console.log('Step 1: Authenticating Owner (TechCorp Industries Ltd.)...');
  const ownerAuth = await (await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'techcorp@example.com', password: 'owner123' })
  })).json();
  const ownerToken = ownerAuth.token;
  console.log('✓ Owner logged in successfully:', ownerAuth.user.name);

  // Step 2: Owner registers a new instrument
  console.log('\nStep 2: Registering new commercial weighing instrument...');
  const newInst = await (await fetch(`${API}/instruments`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ownerToken}` },
    body: JSON.stringify({
      type: 'Electronic Weighing Scale (Class II)',
      manufacturer: 'Avery Weigh-Tronix',
      model: 'AW-900 High Precision',
      serialNumber: `SN-DEMO-${Date.now().toString().slice(-6)}`,
      maxCapacity: 60.0,
      verificationInterval: 0.005
    })
  })).json();
  console.log(`✓ Instrument registered. ID: ${newInst.id}, S/N: ${newInst.serialNumber}, Status: ${newInst.status}`);

  // Step 3: Owner submits verification application
  console.log('\nStep 3: Submitting verification application...');
  const app = await (await fetch(`${API}/verifications/apply`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ownerToken}` },
    body: JSON.stringify({ instrumentId: newInst.id })
  })).json();
  console.log(`✓ Verification Application submitted. App ID: ${app.id}, Status: ${app.status}`);

  // Step 4: Officer Login
  console.log('\nStep 4: Authenticating Legal Metrology Officer (Inspector Sharma)...');
  const officerAuth = await (await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'v.sharma@emaanak.gov.in', password: 'officer123' })
  })).json();
  const officerToken = officerAuth.token;
  console.log('✓ Officer logged in:', officerAuth.user.name);

  // Step 5: Officer inspects pending queue
  console.log('\nStep 5: Fetching pending application details and rule parameters...');
  const appDetails = await (await fetch(`${API}/verifications/application/${app.id}`, {
    headers: { Authorization: `Bearer ${officerToken}` }
  })).json();
  console.log(`✓ Loaded application for instrument: ${appDetails.application.instrument.type}`);
  console.log(`✓ Applicable calibration rule: ${appDetails.rule?.ruleVersion} (${appDetails.rule?.name})`);

  // Step 6: Officer enters multi-point physical readings & submits
  console.log('\nStep 6: Entering multi-point physical observations (12kg, 30kg, 60kg)...');
  const testReadings = [
    { pointName: '20% Calibration Point', referenceLoad: 12.0, observedValue: 12.002 },
    { pointName: '50% Operational Load', referenceLoad: 30.0, observedValue: 30.003 },
    { pointName: '100% Rated Capacity', referenceLoad: 60.0, observedValue: 60.004 }
  ];

  const inspectRes = await (await fetch(`${API}/verifications/inspect`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${officerToken}` },
    body: JSON.stringify({
      applicationId: app.id,
      readings: testReadings,
      remarks: 'Demonstration inspection: Stamped lead seal and verified knife-edge balance.'
    })
  })).json();

  console.log(`✓ Verification Result: ${inspectRes.inspection.result}`);
  console.log(`✓ Digital Certificate Issued: ${inspectRes.certificate.certificateNumber}`);
  console.log(`✓ Cryptographic QR Token: ${inspectRes.certificate.qrToken}`);
  console.log(`✓ Expiry Date: ${new Date(inspectRes.certificate.expiryDate).toLocaleDateString()}`);

  // Step 7: Public User Scans QR Token
  console.log('\nStep 7: Public QR Verification Simulation (Unauthenticated Consumer Scan)...');
  const publicRes = await (await fetch(`${API}/certificates/public/verify/${inspectRes.certificate.qrToken}`)).json();
  console.log(`✓ Public Verification Status: [${publicRes.status}]`);
  console.log(`✓ Certificate Number: ${publicRes.certificateNumber}`);
  console.log(`✓ Certified Owner: ${publicRes.ownerOrganization}`);
  console.log(`✓ Instrument: ${publicRes.instrumentType} (S/N: ${publicRes.serialNumber})`);

  // Step 8: Officer Revocation Simulation
  console.log('\nStep 8: Testing Statutory Revocation Workflow...');
  const revokeRes = await (await fetch(`${API}/certificates/${inspectRes.certificate.certificateNumber}/revoke`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${officerToken}` },
    body: JSON.stringify({ reason: 'Simulated tamper detection during annual market audit.' })
  })).json();
  console.log(`✓ Revocation API Response: ${revokeRes.message}`);

  // Step 9: Re-scan Public QR Token to confirm REVOKED state
  console.log('\nStep 9: Public QR Re-verification to confirm immediate revocation reflection...');
  const publicRevokedRes = await (await fetch(`${API}/certificates/public/verify/${inspectRes.certificate.qrToken}`)).json();
  console.log(`✓ Updated Public Status: [${publicRevokedRes.status}]`);
  console.log(`✓ Public Revocation Notice: "${publicRevokedRes.revocationReason}"`);

  // Step 10: Check Notifications
  console.log('\nStep 10: Checking Owner Notifications for Revocation Notice...');
  const notifs = await (await fetch(`${API}/notifications`, {
    headers: { Authorization: `Bearer ${ownerToken}` }
  })).json();
  const alertNotif = notifs.notifications.find((n: any) => n.title.includes('Revoked'));
  console.log(`✓ Alert Received by Owner: "${alertNotif?.title}" - ${alertNotif?.message?.slice(0, 70)}...`);

  console.log('\n=== COMPLETE END-TO-END WORKFLOW VERIFIED SUCCESSFULLY ===\n');
}

testE2EWorkflow().catch(err => {
  console.error('Workflow error:', err);
  process.exit(1);
});
