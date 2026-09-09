import { Router, Response } from 'express';
import { prisma } from '../utils/prisma';
import { authenticate, authorize, AuthRequest } from '../middleware/authMiddleware';
import { evaluateVerificationReadings, RawReadingInput } from '../services/verificationEngine';
import crypto from 'crypto';

const router = Router();

// Get configured statutory verification rules
router.get('/rules', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const rules = await prisma.instrumentTypeRule.findMany({
      orderBy: { name: 'asc' }
    });
    res.json(rules);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch verification rules' });
  }
});

// Apply for verification (Owner)
router.post('/apply', authenticate, authorize(['OWNER']), async (req: AuthRequest, res: Response) => {
  try {
    const { instrumentId } = req.body;
    const user = req.user!;

    const instrument = await prisma.instrument.findFirst({
      where: { id: instrumentId, ownerId: user.id }
    });
    if (!instrument) return res.status(404).json({ error: 'Instrument not found or unauthorized' });

    // Prevent duplicate pending application
    const existingApp = await prisma.verificationApplication.findFirst({
      where: {
        instrumentId,
        status: { in: ['SUBMITTED', 'IN_PROGRESS'] }
      }
    });
    if (existingApp) {
      return res.status(400).json({ error: 'An active verification application already exists for this instrument.' });
    }

    const application = await prisma.verificationApplication.create({
      data: {
        instrumentId,
        applicantId: user.id,
        status: 'SUBMITTED'
      },
      include: { instrument: true }
    });

    await prisma.instrument.update({
      where: { id: instrumentId },
      data: { status: 'PENDING' }
    });

    // Notify Officers of new queue item
    const officers = await prisma.user.findMany({ where: { role: 'OFFICER' } });
    if (officers.length > 0) {
      await prisma.notification.createMany({
        data: officers.map(off => ({
          userId: off.id,
          title: 'New Verification In Queue',
          message: `${user.name || 'An applicant'} submitted application for ${instrument.type} (S/N: ${instrument.serialNumber}).`,
          type: 'INFO',
        }))
      });
    }

    await prisma.auditLog.create({
      data: {
        actorId: user.id,
        action: 'SUBMIT_APPLICATION',
        entity: 'VerificationApplication',
        entityId: application.id,
        metadata: JSON.stringify({ instrumentSerial: instrument.serialNumber, type: instrument.type })
      }
    });

    res.status(201).json(application);
  } catch (error) {
    console.error('Apply error:', error);
    res.status(500).json({ error: 'Failed to submit application' });
  }
});

// List pending applications (Officer & Admin)
router.get('/pending', authenticate, authorize(['OFFICER', 'ADMIN']), async (req: AuthRequest, res: Response) => {
  try {
    const applications = await prisma.verificationApplication.findMany({
      where: { status: 'SUBMITTED' },
      include: {
        instrument: true,
        applicant: { select: { id: true, name: true, email: true } }
      },
      orderBy: { createdAt: 'desc' }
    });
    res.json(applications);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch applications' });
  }
});

// Fetch application details by ID with recommended test points based on rule
router.get('/application/:id', authenticate, authorize(['OFFICER', 'ADMIN']), async (req: AuthRequest, res: Response) => {
  try {
    const app = await prisma.verificationApplication.findUnique({
      where: { id: String(req.params.id) },
      include: {
        instrument: true,
        applicant: { select: { id: true, name: true, email: true } }
      }
    });
    if (!app) return res.status(404).json({ error: 'Application not found' });

    // Fetch applicable verification rule for test point defaults
    let rule = await prisma.instrumentTypeRule.findFirst({
      where: { name: { contains: app.instrument.type } }
    });
    if (!rule) {
      rule = await prisma.instrumentTypeRule.findFirst({ where: { typeCode: 'CLASS_II_SCALE' } });
    }

    let defaultPoints: { name: string; referenceLoad: number }[] = [];
    if (rule?.testPointsJson) {
      try {
        const fractions = JSON.parse(rule.testPointsJson);
        defaultPoints = fractions.map((p: any) => ({
          name: p.name,
          referenceLoad: Math.round(app.instrument.maxCapacity * p.fraction * 100) / 100,
        }));
      } catch (e) {
        defaultPoints = [
          { name: '20% Load Point', referenceLoad: Math.round(app.instrument.maxCapacity * 0.2 * 100) / 100 },
          { name: '50% Load Point', referenceLoad: Math.round(app.instrument.maxCapacity * 0.5 * 100) / 100 },
          { name: '100% Full Load', referenceLoad: app.instrument.maxCapacity },
        ];
      }
    }

    res.json({
      application: app,
      rule,
      suggestedTestPoints: defaultPoints
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch application' });
  }
});

// Verification Engine Execution (Direct Online Physical Bench Test)
router.post('/inspect', authenticate, authorize(['OFFICER']), async (req: AuthRequest, res: Response) => {
  try {
    const { applicationId, readings, remarks, clientOperationId } = req.body;
    const officerId = req.user!.id;

    if (!readings || !Array.isArray(readings) || readings.length === 0) {
      return res.status(400).json({ error: 'At least one calibration test reading is required.' });
    }

    const application = await prisma.verificationApplication.findUnique({
      where: { id: String(applicationId) },
      include: { instrument: true, applicant: true }
    });

    if (!application || application.status !== 'SUBMITTED') {
      return res.status(400).json({ error: 'Invalid application status or already processed.' });
    }

    // Run authoritative verification engine
    const evaluation = await evaluateVerificationReadings(
      application.instrument.type,
      application.instrument.verificationInterval,
      readings as RawReadingInput[]
    );

    const overallResult = evaluation.overallResult;

    // Create Inspection record
    const inspection = await prisma.verificationInspection.create({
      data: {
        applicationId: application.id,
        officerId,
        clientOperationId: clientOperationId || `OP-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
        syncStatus: 'DIRECT',
        ruleVersion: evaluation.ruleVersion,
        result: overallResult,
        remarks: remarks || (overallResult === 'PASS' ? 'Compliant with prescribed legal metrology calibration limits.' : 'Instrument observations exceeded Maximum Permissible Error tolerance.'),
        readings: {
          create: evaluation.readings.map(r => ({
            pointName: r.pointName,
            referenceLoad: r.referenceLoad,
            observedValue: r.observedValue,
            error: r.error,
            percentageError: r.percentageError,
            maxPermissibleError: r.maxPermissibleError,
            status: r.status,
          }))
        }
      },
      include: { readings: true }
    });

    // Update Application Status
    await prisma.verificationApplication.update({
      where: { id: application.id },
      data: { status: overallResult === 'PASS' ? 'APPROVED' : 'REJECTED' }
    });

    // Update Instrument Status
    await prisma.instrument.update({
      where: { id: application.instrumentId },
      data: { status: overallResult === 'PASS' ? 'VERIFIED' : 'REJECTED' }
    });

    // Generate Certificate conditionally on PASS
    let certificate = null;
    if (overallResult === 'PASS') {
      const year = new Date().getFullYear();
      const randomHex = crypto.randomBytes(4).toString('hex').toUpperCase();
      const certNumber = `CERT-${year}-${randomHex}`;
      const qrToken = `tok_${crypto.randomBytes(16).toString('hex')}`;
      
      const issueDate = new Date();
      const expiryDate = new Date();
      expiryDate.setFullYear(issueDate.getFullYear() + 1);

      certificate = await prisma.certificate.create({
        data: {
          inspectionId: inspection.id,
          certificateNumber: certNumber,
          issueDate,
          expiryDate,
          status: 'VALID',
          qrToken,
        }
      });

      await prisma.notification.create({
        data: {
          userId: application.applicantId,
          title: 'Verification Certificate Issued',
          message: `Verification certificate ${certNumber} has been issued for ${application.instrument.type} (S/N: ${application.instrument.serialNumber}).`,
          type: 'SUCCESS',
        }
      });
    }

    await prisma.auditLog.create({
      data: {
        actorId: officerId,
        action: 'INSPECTION_COMPLETED',
        entity: 'VerificationInspection',
        entityId: inspection.id,
        metadata: JSON.stringify({ result: overallResult, certNumber: certificate?.certificateNumber ?? null })
      }
    });

    res.json({
      inspection,
      certificate,
      evaluationSummary: {
        result: overallResult,
        ruleVersion: evaluation.ruleVersion,
        mpe: evaluation.maxPermissibleError,
        points: evaluation.readings,
      }
    });
  } catch (error) {
    console.error('Inspection error:', error);
    res.status(500).json({ error: 'Inspection processing failed' });
  }
});

/**
 * IDEMPOTENT OFFLINE SYNCHRONIZATION ENDPOINT
 * Receives queued field records recorded by an offline inspector.
 * Validates idempotency via clientOperationId, prevents duplicates, handles conflicts safely.
 */
router.post('/sync', authenticate, authorize(['OFFICER']), async (req: AuthRequest, res: Response) => {
  try {
    const { clientOperationId, applicationId, readings, remarks, ruleVersion, clientCreatedAt } = req.body;
    const officerId = req.user!.id;

    if (!clientOperationId) {
      return res.status(400).json({
        syncResult: 'REJECTED',
        error: 'Missing mandatory clientOperationId for idempotent synchronization.'
      });
    }

    // 1. Idempotency Check: Was this operation already synchronized?
    const existingInspection = await prisma.verificationInspection.findUnique({
      where: { clientOperationId: String(clientOperationId) },
      include: { certificate: true, readings: true }
    });

    if (existingInspection) {
      // Operation already processed; return existing record safely without duplicate certificate creation!
      return res.json({
        syncResult: 'SYNCED_EXISTING',
        message: 'Record previously processed and accepted by server.',
        clientOperationId,
        inspection: existingInspection,
        certificate: existingInspection.certificate,
        overallResult: existingInspection.result,
      });
    }

    // 2. Conflict Detection: Application validation
    const application = await prisma.verificationApplication.findUnique({
      where: { id: String(applicationId) },
      include: {
        instrument: true,
        applicant: true,
        inspection: { include: { certificate: true } }
      }
    });

    if (!application) {
      return res.status(409).json({
        syncResult: 'CONFLICT',
        error: 'Application record not found on state server. Possible database reset or invalid ID.',
        clientOperationId,
      });
    }

    // If application already has another completed inspection
    if (application.inspection && application.inspection.clientOperationId !== clientOperationId) {
      return res.status(409).json({
        syncResult: 'CONFLICT',
        error: `Instrument (S/N: ${application.instrument.serialNumber}) was already verified by another inspection (${application.inspection.id.slice(0, 8)}).`,
        clientOperationId,
        serverState: {
          status: application.status,
          inspectionId: application.inspection.id,
          result: application.inspection.result,
          certificateNumber: application.inspection.certificate?.certificateNumber ?? null
        }
      });
    }

    // 3. Rule Version Consistency Check
    let rule = await prisma.instrumentTypeRule.findFirst({
      where: { name: { contains: application.instrument.type } }
    });
    if (!rule) {
      rule = await prisma.instrumentTypeRule.findFirst({ where: { typeCode: 'CLASS_II_SCALE' } });
    }

    if (ruleVersion && rule && rule.ruleVersion !== ruleVersion) {
      return res.status(409).json({
        syncResult: 'CONFLICT',
        error: `Rule version mismatch: Client used ${ruleVersion}, but active server statutory rule is ${rule.ruleVersion}.`,
        clientOperationId,
      });
    }

    // 4. Authoritative Verification Engine Calculation
    const evaluation = await evaluateVerificationReadings(
      application.instrument.type,
      application.instrument.verificationInterval,
      readings as RawReadingInput[]
    );

    const overallResult = evaluation.overallResult;

    // 5. Commit Synchronized Inspection Record
    const inspection = await prisma.verificationInspection.create({
      data: {
        applicationId: application.id,
        officerId,
        clientOperationId: String(clientOperationId),
        syncStatus: 'SYNCED_FROM_OFFLINE',
        ruleVersion: evaluation.ruleVersion,
        result: overallResult,
        remarks: remarks ? `[OFFLINE SYNC] ${remarks}` : '[OFFLINE SYNC] Verified via field inspection device.',
        readings: {
          create: evaluation.readings.map(r => ({
            pointName: r.pointName,
            referenceLoad: r.referenceLoad,
            observedValue: r.observedValue,
            error: r.error,
            percentageError: r.percentageError,
            maxPermissibleError: r.maxPermissibleError,
            status: r.status,
          }))
        }
      },
      include: { readings: true }
    });

    // Update statuses
    await prisma.verificationApplication.update({
      where: { id: application.id },
      data: { status: overallResult === 'PASS' ? 'APPROVED' : 'REJECTED' }
    });

    await prisma.instrument.update({
      where: { id: application.instrumentId },
      data: { status: overallResult === 'PASS' ? 'VERIFIED' : 'REJECTED' }
    });

    // 6. Generate Certificate on PASS
    let certificate = null;
    if (overallResult === 'PASS') {
      const year = new Date().getFullYear();
      const randomHex = crypto.randomBytes(4).toString('hex').toUpperCase();
      const certNumber = `CERT-${year}-${randomHex}`;
      const qrToken = `tok_${crypto.randomBytes(16).toString('hex')}`;
      
      const issueDate = new Date();
      const expiryDate = new Date();
      expiryDate.setFullYear(issueDate.getFullYear() + 1);

      certificate = await prisma.certificate.create({
        data: {
          inspectionId: inspection.id,
          certificateNumber: certNumber,
          issueDate,
          expiryDate,
          status: 'VALID',
          qrToken,
        }
      });

      await prisma.notification.create({
        data: {
          userId: application.applicantId,
          title: 'Field Verification Synchronized & Stamped',
          message: `Offline inspection for ${application.instrument.type} (${application.instrument.serialNumber}) was synchronized and approved. Certificate: ${certNumber}.`,
          type: 'SUCCESS',
        }
      });
    }

    // Audit Log
    await prisma.auditLog.create({
      data: {
        actorId: officerId,
        action: 'OFFLINE_INSPECTION_SYNCED',
        entity: 'VerificationInspection',
        entityId: inspection.id,
        metadata: JSON.stringify({
          clientOperationId,
          clientCreatedAt,
          result: overallResult,
          certNumber: certificate?.certificateNumber ?? null
        })
      }
    });

    res.status(200).json({
      syncResult: 'ACCEPTED',
      message: 'Offline verification successfully evaluated and accepted by server.',
      clientOperationId,
      inspection,
      certificate,
      overallResult,
    });
  } catch (error: any) {
    console.error('Offline sync error:', error);
    res.status(500).json({
      syncResult: 'ERROR',
      error: error.message || 'Server error during synchronization processing.'
    });
  }
});

export default router;
