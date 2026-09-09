import { Router, Response, Request } from 'express';
import { prisma } from '../utils/prisma';
import { authenticate, authorize, AuthRequest } from '../middleware/authMiddleware';

const router = Router();

// List all certificates with filters (Admin & Officer)
router.get('/', authenticate, authorize(['OFFICER', 'ADMIN']), async (req: AuthRequest, res: Response) => {
  try {
    const { status, search } = req.query;

    const whereClause: any = {};
    if (status && typeof status === 'string' && status !== 'ALL') {
      whereClause.status = status;
    }
    if (search && typeof search === 'string' && search.trim() !== '') {
      whereClause.OR = [
        { certificateNumber: { contains: search } },
        {
          inspection: {
            application: {
              instrument: {
                OR: [
                  { serialNumber: { contains: search } },
                  { type: { contains: search } }
                ]
              }
            }
          }
        }
      ];
    }

    const certificates = await prisma.certificate.findMany({
      where: whereClause,
      include: {
        inspection: {
          include: {
            officer: { select: { id: true, name: true, email: true } },
            application: {
              include: {
                instrument: {
                  include: {
                    owner: { select: { id: true, name: true, email: true } }
                  }
                }
              }
            }
          }
        }
      },
      orderBy: { createdAt: 'desc' }
    });

    res.json(certificates);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch certificates' });
  }
});

// Get specific certificate details (Authenticated)
router.get('/:certificateNumber', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const certificateNumber = String(req.params.certificateNumber);
    const certificate = await prisma.certificate.findUnique({
      where: { certificateNumber },
      include: {
        inspection: {
          include: {
            readings: true,
            officer: { select: { id: true, name: true, email: true } },
            application: {
              include: {
                instrument: {
                  include: {
                    owner: { select: { id: true, name: true, email: true } }
                  }
                }
              }
            }
          }
        }
      }
    });

    if (!certificate) {
      return res.status(404).json({ error: 'Certificate not found' });
    }

    // Role-based Ownership Check: An OWNER can only retrieve certificates of their own instruments
    if (req.user!.role === 'OWNER') {
      const ownerId = certificate.inspection?.application?.instrument?.owner?.id;
      if (ownerId !== req.user!.id) {
        return res.status(403).json({ error: 'Forbidden: Insufficient privileges to view this certificate' });
      }
    }

    // Dynamic Expiry Transition
    const now = new Date();
    if (certificate.status === 'VALID' && now > new Date(certificate.expiryDate)) {
      await prisma.certificate.update({
        where: { id: certificate.id },
        data: { status: 'EXPIRED' }
      });
      await prisma.instrument.update({
        where: { id: certificate.inspection.application.instrumentId },
        data: { status: 'EXPIRED' }
      });
      certificate.status = 'EXPIRED';
    }

    res.json(certificate);
  } catch (error) {
    console.error('Fetch cert error:', error);
    res.status(500).json({ error: 'Failed to fetch certificate' });
  }
});

// Revoke Certificate (Officer & Admin)
router.post('/:certificateNumber/revoke', authenticate, authorize(['OFFICER', 'ADMIN']), async (req: AuthRequest, res: Response) => {
  try {
    const certificateNumber = String(req.params.certificateNumber);
    const { reason } = req.body;
    const actor = req.user!;

    if (!reason || typeof reason !== 'string' || reason.trim() === '') {
      return res.status(400).json({ error: 'A valid statutory reason is required for certificate revocation.' });
    }

    const certificate = await prisma.certificate.findUnique({
      where: { certificateNumber },
      include: {
        inspection: {
          include: {
            application: {
              include: { instrument: true, applicant: true }
            }
          }
        }
      }
    });

    if (!certificate) {
      return res.status(404).json({ error: 'Certificate not found' });
    }

    if (certificate.status === 'REVOKED') {
      return res.status(400).json({ error: 'Certificate is already revoked.' });
    }

    const userRecord = await prisma.user.findUnique({ where: { id: actor.id } });
    const actorName = userRecord?.name || 'Authorized Legal Metrology Officer';

    // Update certificate to REVOKED
    const updatedCert = await prisma.certificate.update({
      where: { id: certificate.id },
      data: {
        status: 'REVOKED',
        revokedAt: new Date(),
        revocationReason: reason.trim(),
        revokedBy: actorName,
      }
    });

    // Update Instrument status to REJECTED / SUSPENDED
    await prisma.instrument.update({
      where: { id: certificate.inspection.application.instrumentId },
      data: { status: 'REJECTED' }
    });

    // Notify Instrument Owner
    await prisma.notification.create({
      data: {
        userId: certificate.inspection.application.applicantId,
        title: 'Statutory Notice: Certificate Revoked',
        message: `Certificate ${certificateNumber} has been revoked by ${actorName}. Reason: ${reason.trim()}. Commercial operation must cease immediately.`,
        type: 'ALERT',
      }
    });

    // Log Audit Trail
    await prisma.auditLog.create({
      data: {
        actorId: actor.id,
        action: 'CERTIFICATE_REVOCATION',
        entity: 'Certificate',
        entityId: certificate.id,
        metadata: JSON.stringify({
          certificateNumber,
          reason: reason.trim(),
          revokedBy: actorName
        })
      }
    });

    res.json({
      message: 'Certificate revoked successfully',
      certificate: updatedCert
    });
  } catch (error) {
    console.error('Revocation error:', error);
    res.status(500).json({ error: 'Failed to revoke certificate' });
  }
});

// Public Verification via QR Token (No auth required)
router.get('/public/verify/:token', async (req: Request, res: Response) => {
  try {
    const token = String(req.params.token);
    const certificate = await prisma.certificate.findUnique({
      where: { qrToken: token },
      include: {
        inspection: {
          include: {
            officer: { select: { name: true } },
            readings: true,
            application: {
              include: {
                instrument: {
                  include: {
                    owner: { select: { name: true } }
                  }
                }
              }
            }
          }
        }
      }
    });

    if (!certificate) {
      return res.status(404).json({
        status: 'INVALID',
        error: 'No authentic legal metrology record found for this verification token.'
      });
    }

    // Dynamic Expiry Evaluation
    const now = new Date();
    if (certificate.status === 'VALID' && now > new Date(certificate.expiryDate)) {
      await prisma.certificate.update({
        where: { id: certificate.id },
        data: { status: 'EXPIRED' }
      });
      await prisma.instrument.update({
        where: { id: certificate.inspection.application.instrumentId },
        data: { status: 'EXPIRED' }
      });
      certificate.status = 'EXPIRED';
    }

    const instrument = certificate.inspection.application.instrument;

    // Return sanitized public transparency dataset
    res.json({
      status: certificate.status,
      certificateNumber: certificate.certificateNumber,
      issueDate: certificate.issueDate,
      expiryDate: certificate.expiryDate,
      instrumentType: instrument.type,
      manufacturer: instrument.manufacturer,
      model: instrument.model,
      maxCapacity: instrument.maxCapacity,
      verificationInterval: instrument.verificationInterval,
      serialNumber: instrument.serialNumber,
      ownerOrganization: instrument.owner.name,
      officerName: certificate.inspection.officer.name,
      ruleVersion: certificate.inspection.ruleVersion,
      testPointsCount: certificate.inspection.readings.length,
      revokedAt: certificate.revokedAt,
      revocationReason: certificate.revocationReason,
      revokedBy: certificate.revokedBy,
    });
  } catch (error) {
    console.error('Public verify error:', error);
    res.status(500).json({ error: 'Public verification check failed' });
  }
});

export default router;
