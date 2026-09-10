import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';

const prisma = new PrismaClient();

async function main() {
  console.log('Clearing existing records for fresh deterministic seed...');
  await prisma.notification.deleteMany({});
  await prisma.auditLog.deleteMany({});
  await prisma.verificationReading.deleteMany({});
  await prisma.certificate.deleteMany({});
  await prisma.verificationInspection.deleteMany({});
  await prisma.verificationApplication.deleteMany({});
  await prisma.instrument.deleteMany({});
  await prisma.instrumentTypeRule.deleteMany({});
  await prisma.user.deleteMany({});

  // 1. Password Hashes
  const adminPassword = await bcrypt.hash('admin123', 10);
  const officerPassword = await bcrypt.hash('officer123', 10);
  const ownerPassword = await bcrypt.hash('owner123', 10);
  const shopPassword = await bcrypt.hash('shop123', 10);

  // 2. Users
  const admin = await prisma.user.create({
    data: {
      email: 'admin@emaanak.gov.in',
      name: 'Dr. A. K. Verma (Controller)',
      passwordHash: adminPassword,
      role: 'ADMIN',
    },
  });

  const officerSharma = await prisma.user.create({
    data: {
      email: 'v.sharma@emaanak.gov.in',
      name: 'Inspector Vikram Sharma',
      passwordHash: officerPassword,
      role: 'OFFICER',
    },
  });

  const officerPatel = await prisma.user.create({
    data: {
      email: 'p.patel@emaanak.gov.in',
      name: 'Inspector Priya Patel',
      passwordHash: officerPassword,
      role: 'OFFICER',
    },
  });

  const ownerTechCorp = await prisma.user.create({
    data: {
      email: 'techcorp@example.com',
      name: 'TechCorp Industries Ltd.',
      passwordHash: ownerPassword,
      role: 'OWNER',
    },
  });

  const ownerShop = await prisma.user.create({
    data: {
      email: 'shop@example.com',
      name: 'Sharma General & Retail Store',
      passwordHash: shopPassword,
      role: 'OWNER',
    },
  });

  const ownerAgro = await prisma.user.create({
    data: {
      email: 'agriproducts@example.com',
      name: 'Apex Agro Commodities',
      passwordHash: ownerPassword,
      role: 'OWNER',
    },
  });

  const ownerLogistics = await prisma.user.create({
    data: {
      email: 'metrofuel@example.com',
      name: 'Metro Logistics & Fuel Hub',
      passwordHash: ownerPassword,
      role: 'OWNER',
    },
  });

  // 3. Verification Rules
  const rules = await Promise.all([
    prisma.instrumentTypeRule.create({
      data: {
        typeCode: 'CLASS_II_SCALE',
        name: 'Electronic Weighing Scale (Class II)',
        category: 'Non-Automatic Weighing Instrument',
        ruleVersion: 'LM-RULE-2026.1',
        mpeMultiplier: 1.0, // MPE = 1.0 * e
        maxAllowedErrorPct: 0.15,
        testPointsJson: JSON.stringify([
          { name: 'Minimum Operating Load (20% Max)', fraction: 0.2 },
          { name: 'Mid-Scale Operational Load (50% Max)', fraction: 0.5 },
          { name: 'Maximum Rated Capacity (100% Max)', fraction: 1.0 },
        ]),
        description: 'Standard multi-point calibration verification for high accuracy Class II commercial counter scales.',
      }
    }),
    prisma.instrumentTypeRule.create({
      data: {
        typeCode: 'PLATFORM_SCALE',
        name: 'Platform Scale',
        category: 'Industrial Weighing System',
        ruleVersion: 'LM-RULE-2026.1',
        mpeMultiplier: 1.5,
        maxAllowedErrorPct: 0.25,
        testPointsJson: JSON.stringify([
          { name: 'Quarter Capacity Load (25% Max)', fraction: 0.25 },
          { name: 'Half Capacity Load (50% Max)', fraction: 0.5 },
          { name: 'Full Load Stress Point (100% Max)', fraction: 1.0 },
        ]),
        description: 'Industrial platform scale verification protocol covering quarter, half, and maximum payload.',
      }
    }),
    prisma.instrumentTypeRule.create({
      data: {
        typeCode: 'WEIGHBRIDGE',
        name: 'Weighbridge',
        category: 'Heavy Vehicle Weighing',
        ruleVersion: 'LM-RULE-2026.1',
        mpeMultiplier: 2.0,
        maxAllowedErrorPct: 0.5,
        testPointsJson: JSON.stringify([
          { name: 'Tare Calibration Load (20% Max)', fraction: 0.2 },
          { name: 'Standard Laden Load (60% Max)', fraction: 0.6 },
          { name: 'Maximum Gross Rating (100% Max)', fraction: 1.0 },
        ]),
        description: 'Heavy duty road vehicle weighbridge verification with dead-weight and substituted loads.',
      }
    }),
    prisma.instrumentTypeRule.create({
      data: {
        typeCode: 'DISPENSING_PUMP',
        name: 'Dispensing Pump',
        category: 'Liquid Volume Measurement',
        ruleVersion: 'LM-RULE-2026.1',
        mpeMultiplier: 1.0,
        maxAllowedErrorPct: 0.3,
        testPointsJson: JSON.stringify([
          { name: 'Low Delivery Volume (10 L)', fraction: 0.2 },
          { name: 'Standard Commercial Fill (20 L)', fraction: 0.4 },
          { name: 'High Volume Continuous Delivery (50 L)', fraction: 1.0 },
        ]),
        description: 'Commercial retail fuel/liquid delivery metering verification checking displacement errors.',
      }
    }),
  ]);

  // 4. Instruments
  // Inst 1: TechCorp - Class II Scale (VERIFIED, Active Certificate)
  const inst1 = await prisma.instrument.create({
    data: {
      ownerId: ownerTechCorp.id,
      type: 'Electronic Weighing Scale (Class II)',
      manufacturer: 'Avery India Ltd.',
      model: 'DS-852 Pro',
      serialNumber: 'SN-TC-99882211',
      maxCapacity: 50.0,
      verificationInterval: 0.005, // e = 5g
      status: 'VERIFIED',
    },
  });

  // Inst 2: TechCorp - Platform Scale (PENDING Verification, Application submitted)
  const inst2 = await prisma.instrument.create({
    data: {
      ownerId: ownerTechCorp.id,
      type: 'Platform Scale',
      manufacturer: 'Mettler Toledo',
      model: 'PT-500 Heavy',
      serialNumber: 'SN-TC-77665544',
      maxCapacity: 500.0,
      verificationInterval: 0.05, // e = 50g
      status: 'PENDING',
    },
  });

  // Inst 3: Agro - Weighbridge (EXPIRED Certificate, 370 days ago)
  const inst3 = await prisma.instrument.create({
    data: {
      ownerId: ownerAgro.id,
      type: 'Weighbridge',
      manufacturer: 'Essae-Teraoka',
      model: 'WB-60T',
      serialNumber: 'SN-AG-44332211',
      maxCapacity: 60000.0,
      verificationInterval: 10.0, // e = 10kg
      status: 'EXPIRED',
    },
  });

  // Inst 4: Metro Logistics - Dispensing Pump (REVOKED Certificate, Seal Tampered)
  const inst4 = await prisma.instrument.create({
    data: {
      ownerId: ownerLogistics.id,
      type: 'Dispensing Pump',
      manufacturer: 'Tokheim Global',
      model: 'Quantium 510',
      serialNumber: 'SN-ML-11223344',
      maxCapacity: 50.0,
      verificationInterval: 0.02,
      status: 'REJECTED',
    },
  });

  // Inst 5: Agro - Freshly Registered Instrument (REGISTERED, Not yet applied)
  const inst5 = await prisma.instrument.create({
    data: {
      ownerId: ownerAgro.id,
      type: 'Electronic Weighing Scale (Class II)',
      manufacturer: 'Sartorius AG',
      model: 'Entris II',
      serialNumber: 'SN-AG-55667788',
      maxCapacity: 10.0,
      verificationInterval: 0.001,
      status: 'REGISTERED',
    },
  });

  // Inst 6: TechCorp - Near-Expiry Scale (Expiring in 8 days - great for notification demo!)
  const inst6 = await prisma.instrument.create({
    data: {
      ownerId: ownerTechCorp.id,
      type: 'Electronic Weighing Scale (Class II)',
      manufacturer: 'Citizen Scales',
      model: 'CX-120',
      serialNumber: 'SN-TC-33221100',
      maxCapacity: 30.0,
      verificationInterval: 0.005,
      status: 'VERIFIED',
    },
  });

  // 5. Completed Inspection & Certificate for Inst 1 (Active VALID Certificate)
  const app1 = await prisma.verificationApplication.create({
    data: {
      instrumentId: inst1.id,
      applicantId: ownerTechCorp.id,
      status: 'APPROVED',
      createdAt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000), // 30 days ago
    }
  });

  const insp1 = await prisma.verificationInspection.create({
    data: {
      applicationId: app1.id,
      officerId: officerSharma.id,
      ruleVersion: 'LM-RULE-2026.1',
      result: 'PASS',
      remarks: 'All 3 test points within statutory tolerance limits. Lead stamp intact.',
      createdAt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
    }
  });

  await prisma.verificationReading.createMany({
    data: [
      {
        inspectionId: insp1.id,
        pointName: 'Minimum Operating Load (20% Max)',
        referenceLoad: 10.0,
        observedValue: 10.002,
        error: 0.002,
        percentageError: 0.02,
        maxPermissibleError: 0.005,
        status: 'PASS',
      },
      {
        inspectionId: insp1.id,
        pointName: 'Mid-Scale Operational Load (50% Max)',
        referenceLoad: 25.0,
        observedValue: 25.003,
        error: 0.003,
        percentageError: 0.012,
        maxPermissibleError: 0.005,
        status: 'PASS',
      },
      {
        inspectionId: insp1.id,
        pointName: 'Maximum Rated Capacity (100% Max)',
        referenceLoad: 50.0,
        observedValue: 50.004,
        error: 0.004,
        percentageError: 0.008,
        maxPermissibleError: 0.005,
        status: 'PASS',
      },
    ]
  });

  const cert1 = await prisma.certificate.create({
    data: {
      inspectionId: insp1.id,
      certificateNumber: 'CERT-2026-901',
      issueDate: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
      expiryDate: new Date(Date.now() + 335 * 24 * 60 * 60 * 1000), // 335 days remaining
      status: 'VALID',
      qrToken: 'tok_active_cert_901_valid_hash',
    }
  });

  // 6. Application 2 (Pending inspection for Inst 2 - ready for demo)
  const app2 = await prisma.verificationApplication.create({
    data: {
      instrumentId: inst2.id,
      applicantId: ownerTechCorp.id,
      status: 'SUBMITTED',
      createdAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000),
    }
  });

  // 7. Completed Inspection & Expired Certificate for Inst 3
  const app3 = await prisma.verificationApplication.create({
    data: {
      instrumentId: inst3.id,
      applicantId: ownerAgro.id,
      status: 'APPROVED',
      createdAt: new Date(Date.now() - 380 * 24 * 60 * 60 * 1000),
    }
  });

  const insp3 = await prisma.verificationInspection.create({
    data: {
      applicationId: app3.id,
      officerId: officerPatel.id,
      ruleVersion: 'LM-RULE-2025.2',
      result: 'PASS',
      remarks: 'Weighbridge calibrated and stamped for 12 calendar months.',
      createdAt: new Date(Date.now() - 380 * 24 * 60 * 60 * 1000),
    }
  });

  const cert3 = await prisma.certificate.create({
    data: {
      inspectionId: insp3.id,
      certificateNumber: 'CERT-2025-412',
      issueDate: new Date(Date.now() - 380 * 24 * 60 * 60 * 1000),
      expiryDate: new Date(Date.now() - 15 * 24 * 60 * 60 * 1000), // Expired 15 days ago
      status: 'EXPIRED',
      qrToken: 'tok_expired_cert_412_hash',
    }
  });

  // 8. Completed Inspection & Revoked Certificate for Inst 4
  const app4 = await prisma.verificationApplication.create({
    data: {
      instrumentId: inst4.id,
      applicantId: ownerLogistics.id,
      status: 'APPROVED',
      createdAt: new Date(Date.now() - 120 * 24 * 60 * 60 * 1000),
    }
  });

  const insp4 = await prisma.verificationInspection.create({
    data: {
      applicationId: app4.id,
      officerId: officerSharma.id,
      ruleVersion: 'LM-RULE-2026.1',
      result: 'PASS',
      remarks: 'Initial verification approved.',
      createdAt: new Date(Date.now() - 120 * 24 * 60 * 60 * 1000),
    }
  });

  const cert4 = await prisma.certificate.create({
    data: {
      inspectionId: insp4.id,
      certificateNumber: 'CERT-2026-664',
      issueDate: new Date(Date.now() - 120 * 24 * 60 * 60 * 1000),
      expiryDate: new Date(Date.now() + 245 * 24 * 60 * 60 * 1000),
      status: 'REVOKED',
      qrToken: 'tok_revoked_cert_664_hash',
      revokedAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000),
      revocationReason: 'Statutory inspection detected unauthorized electronic pulse generator alteration and broken seal.',
      revokedBy: officerSharma.name,
    }
  });

  // 9. Inst 6 Near-Expiry Certificate
  const app6 = await prisma.verificationApplication.create({
    data: {
      instrumentId: inst6.id,
      applicantId: ownerTechCorp.id,
      status: 'APPROVED',
      createdAt: new Date(Date.now() - 357 * 24 * 60 * 60 * 1000),
    }
  });

  const insp6 = await prisma.verificationInspection.create({
    data: {
      applicationId: app6.id,
      officerId: officerPatel.id,
      ruleVersion: 'LM-RULE-2025.2',
      result: 'PASS',
      remarks: 'Precision counter scale stamped.',
      createdAt: new Date(Date.now() - 357 * 24 * 60 * 60 * 1000),
    }
  });

  const cert6 = await prisma.certificate.create({
    data: {
      inspectionId: insp6.id,
      certificateNumber: 'CERT-2025-889',
      issueDate: new Date(Date.now() - 357 * 24 * 60 * 60 * 1000),
      expiryDate: new Date(Date.now() + 8 * 24 * 60 * 60 * 1000), // 8 days remaining!
      status: 'VALID',
      qrToken: 'tok_near_expiry_cert_889_hash',
    }
  });

  // 10. Sample Notifications
  await prisma.notification.createMany({
    data: [
      {
        userId: ownerTechCorp.id,
        title: 'Re-Verification Due Soon (8 Days)',
        message: 'Certificate CERT-2025-889 for Citizen Scales CX-120 expires on ' + new Date(Date.now() + 8 * 24 * 60 * 60 * 1000).toLocaleDateString() + '. Please apply for re-verification to avoid statutory penalties.',
        type: 'WARNING',
        isRead: false,
      },
      {
        userId: ownerTechCorp.id,
        title: 'Verification Stamped & Certified',
        message: 'Certificate CERT-2026-901 for Avery India DS-852 Pro is active and stamped valid.',
        type: 'SUCCESS',
        isRead: true,
      },
      {
        userId: officerSharma.id,
        title: 'New Verification Request In Queue',
        message: 'TechCorp Industries Ltd. submitted a new verification application for Platform Scale (SN-TC-77665544).',
        type: 'INFO',
        isRead: false,
      },
      {
        userId: ownerLogistics.id,
        title: 'Statutory Notice: Certificate Revoked',
        message: 'Certificate CERT-2026-664 has been REVOKED due to broken seal and meter alteration. Continued commercial use is an offence.',
        type: 'ALERT',
        isRead: false,
      }
    ]
  });

  // 11. Initial Audit Logs
  await prisma.auditLog.createMany({
    data: [
      {
        actorId: admin.id,
        action: 'SYSTEM_BOOTSTRAP',
        entity: 'System',
        entityId: 'ROOT',
        metadata: JSON.stringify({ event: 'Platform initialized with standard 2026 legal metrology calibration rules.' }),
      },
      {
        actorId: ownerTechCorp.id,
        action: 'REGISTER_INSTRUMENT',
        entity: 'Instrument',
        entityId: inst1.id,
        metadata: JSON.stringify({ serial: inst1.serialNumber, type: inst1.type }),
      },
      {
        actorId: officerSharma.id,
        action: 'INSPECTION_COMPLETED',
        entity: 'VerificationInspection',
        entityId: insp1.id,
        metadata: JSON.stringify({ result: 'PASS', cert: cert1.certificateNumber }),
      },
      {
        actorId: officerSharma.id,
        action: 'CERTIFICATE_REVOCATION',
        entity: 'Certificate',
        entityId: cert4.id,
        metadata: JSON.stringify({ certNumber: cert4.certificateNumber, reason: cert4.revocationReason }),
      },
    ]
  });

  console.log('Deterministic Phase 4 seed completed successfully!');
  console.log(`- Users seeded: Admin (${admin.email}), Officers (${officerSharma.email}, ${officerPatel.email}), Owners (3)`);
  console.log(`- Instruments seeded: 6 (VALID, PENDING, EXPIRED, REVOKED, REGISTERED)`);
  console.log(`- Rules seeded: 4 standard categories`);
}

main()
  .catch((e) => {
    console.error('Seed error:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
