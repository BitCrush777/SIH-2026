import { Router, Response } from 'express';
import { prisma } from '../utils/prisma';
import { authenticate, authorize, AuthRequest } from '../middleware/authMiddleware';

const router = Router();

// Owner Analytics
router.get('/owner', authenticate, authorize(['OWNER']), async (req: AuthRequest, res: Response) => {
  try {
    const ownerId = req.user!.id;

    const totalInstruments = await prisma.instrument.count({ where: { ownerId } });
    const verified = await prisma.instrument.count({ where: { ownerId, status: 'VERIFIED' } });
    const pending = await prisma.instrument.count({ where: { ownerId, status: 'PENDING' } });
    const expired = await prisma.instrument.count({ where: { ownerId, status: 'EXPIRED' } });
    const rejected = await prisma.instrument.count({ where: { ownerId, status: 'REJECTED' } });

    // Expiring within 30 days
    const now = new Date();
    const in30Days = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    const expiringSoon = await prisma.certificate.count({
      where: {
        status: 'VALID',
        expiryDate: { gte: now, lte: in30Days },
        inspection: {
          application: {
            applicantId: ownerId
          }
        }
      }
    });

    res.json({
      totalInstruments,
      verified,
      pending,
      expired,
      rejected,
      expiringSoon,
      complianceRate: totalInstruments > 0 ? Math.round((verified / totalInstruments) * 100) : 0
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch owner analytics' });
  }
});

// Officer Analytics
router.get('/officer', authenticate, authorize(['OFFICER', 'ADMIN']), async (req: AuthRequest, res: Response) => {
  try {
    const officerId = req.user!.id;

    const pendingQueueCount = await prisma.verificationApplication.count({
      where: { status: 'SUBMITTED' }
    });

    const totalInspectedByOfficer = await prisma.verificationInspection.count({
      where: { officerId }
    });

    const passedCount = await prisma.verificationInspection.count({
      where: { officerId, result: 'PASS' }
    });

    const failedCount = await prisma.verificationInspection.count({
      where: { officerId, result: 'FAIL' }
    });

    // Recent inspections
    const recentInspections = await prisma.verificationInspection.findMany({
      where: { officerId },
      include: {
        certificate: true,
        application: {
          include: {
            instrument: true,
            applicant: { select: { name: true } }
          }
        }
      },
      orderBy: { createdAt: 'desc' },
      take: 5
    });

    res.json({
      pendingQueueCount,
      totalInspectedByOfficer,
      passedCount,
      failedCount,
      passRate: totalInspectedByOfficer > 0 ? Math.round((passedCount / totalInspectedByOfficer) * 100) : 100,
      recentInspections
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch officer analytics' });
  }
});

// Admin System-wide Analytics
router.get('/admin', authenticate, authorize(['ADMIN']), async (req: AuthRequest, res: Response) => {
  try {
    const totalInstruments = await prisma.instrument.count();
    const totalOwners = await prisma.user.count({ where: { role: 'OWNER' } });
    const totalOfficers = await prisma.user.count({ where: { role: 'OFFICER' } });
    const totalApplications = await prisma.verificationApplication.count();
    const totalInspections = await prisma.verificationInspection.count();

    const passedInspections = await prisma.verificationInspection.count({ where: { result: 'PASS' } });
    const failedInspections = await prisma.verificationInspection.count({ where: { result: 'FAIL' } });

    const totalCertificates = await prisma.certificate.count();
    const validCertificates = await prisma.certificate.count({ where: { status: 'VALID' } });
    const expiredCertificates = await prisma.certificate.count({ where: { status: 'EXPIRED' } });
    const revokedCertificates = await prisma.certificate.count({ where: { status: 'REVOKED' } });

    // Instruments by Type
    const instruments = await prisma.instrument.findMany({ select: { type: true } });
    const typeCounts: Record<string, number> = {};
    instruments.forEach(i => {
      typeCounts[i.type] = (typeCounts[i.type] || 0) + 1;
    });

    // Status distribution
    const statusCounts = {
      VERIFIED: await prisma.instrument.count({ where: { status: 'VERIFIED' } }),
      PENDING: await prisma.instrument.count({ where: { status: 'PENDING' } }),
      REGISTERED: await prisma.instrument.count({ where: { status: 'REGISTERED' } }),
      EXPIRED: await prisma.instrument.count({ where: { status: 'EXPIRED' } }),
      REJECTED: await prisma.instrument.count({ where: { status: 'REJECTED' } }),
    };

    res.json({
      overview: {
        totalInstruments,
        totalOwners,
        totalOfficers,
        totalApplications,
        totalInspections,
        totalCertificates,
      },
      inspections: {
        passed: passedInspections,
        failed: failedInspections,
        passRate: totalInspections > 0 ? Math.round((passedInspections / totalInspections) * 100) : 0,
      },
      certificates: {
        valid: validCertificates,
        expired: expiredCertificates,
        revoked: revokedCertificates,
      },
      instrumentTypeDistribution: typeCounts,
      instrumentStatusDistribution: statusCounts,
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch admin analytics' });
  }
});

export default router;
