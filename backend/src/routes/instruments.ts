import { Router, Response } from 'express';
import { prisma } from '../utils/prisma';
import { authenticate, authorize, AuthRequest } from '../middleware/authMiddleware';

const router = Router();

// Get instruments with search, filtering, and role isolation
router.get('/', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const user = req.user!;
    const { search, status, type } = req.query;

    const whereClause: any = {};

    // Role-based isolation
    if (user.role === 'OWNER') {
      whereClause.ownerId = user.id;
    }

    // Status filter
    if (status && typeof status === 'string' && status !== 'ALL') {
      whereClause.status = status;
    }

    // Instrument Type filter
    if (type && typeof type === 'string' && type !== 'ALL') {
      whereClause.type = { contains: type };
    }

    // Search keyword
    if (search && typeof search === 'string' && search.trim() !== '') {
      const q = search.trim();
      whereClause.OR = [
        { serialNumber: { contains: q } },
        { manufacturer: { contains: q } },
        { model: { contains: q } },
        { type: { contains: q } },
      ];
    }

    const instruments = await prisma.instrument.findMany({
      where: whereClause,
      include: {
        owner: { select: { id: true, name: true, email: true } },
        applications: {
          orderBy: { createdAt: 'desc' },
          include: {
            inspection: {
              include: {
                certificate: true
              }
            }
          }
        }
      },
      orderBy: { createdAt: 'desc' }
    });

    res.json(instruments);
  } catch (error) {
    console.error('Fetch instruments error:', error);
    res.status(500).json({ error: 'Failed to fetch instruments' });
  }
});

// Create Instrument (Owner only)
router.post('/', authenticate, authorize(['OWNER']), async (req: AuthRequest, res: Response) => {
  try {
    const user = req.user!;
    const { type, manufacturer, model, serialNumber, maxCapacity, verificationInterval } = req.body;

    if (!type || !manufacturer || !model || !serialNumber || !maxCapacity || !verificationInterval) {
      return res.status(400).json({ error: 'All instrument specification fields are required.' });
    }

    // Check serial number uniqueness per owner
    const existing = await prisma.instrument.findFirst({
      where: { serialNumber: String(serialNumber).trim() }
    });
    if (existing) {
      return res.status(400).json({ error: `An instrument with Serial Number ${serialNumber} is already registered.` });
    }

    const instrument = await prisma.instrument.create({
      data: {
        ownerId: user.id,
        type: String(type).trim(),
        manufacturer: String(manufacturer).trim(),
        model: String(model).trim(),
        serialNumber: String(serialNumber).trim(),
        maxCapacity: parseFloat(maxCapacity),
        verificationInterval: parseFloat(verificationInterval),
        status: 'REGISTERED'
      }
    });

    await prisma.auditLog.create({
      data: {
        actorId: user.id,
        action: 'CREATE_INSTRUMENT',
        entity: 'Instrument',
        entityId: instrument.id,
        metadata: JSON.stringify({ serial: instrument.serialNumber, type: instrument.type })
      }
    });

    // Confirmation notification to owner
    await prisma.notification.create({
      data: {
        userId: user.id,
        title: 'Instrument Registered',
        message: `${instrument.type} (${instrument.serialNumber}) registered in state repository. Ready for verification application.`,
        type: 'INFO',
      }
    });

    res.status(201).json(instrument);
  } catch (error) {
    console.error('Create instrument error:', error);
    res.status(500).json({ error: 'Failed to create instrument' });
  }
});

export default router;
