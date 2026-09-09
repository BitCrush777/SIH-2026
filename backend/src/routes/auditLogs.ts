import { Router, Response } from 'express';
import { prisma } from '../utils/prisma';
import { authenticate, authorize, AuthRequest } from '../middleware/authMiddleware';

const router = Router();

// Get audit logs with search, filtering, and pagination (Admin only)
router.get('/', authenticate, authorize(['ADMIN']), async (req: AuthRequest, res: Response) => {
  try {
    const { action, entity, search, limit = '25' } = req.query;

    const whereClause: any = {};
    if (action && typeof action === 'string' && action !== 'ALL') {
      whereClause.action = action;
    }
    if (entity && typeof entity === 'string' && entity !== 'ALL') {
      whereClause.entity = entity;
    }
    if (search && typeof search === 'string' && search.trim() !== '') {
      whereClause.OR = [
        { action: { contains: search } },
        { entity: { contains: search } },
        { entityId: { contains: search } },
        { metadata: { contains: search } },
      ];
    }

    const takeCount = Math.min(parseInt(String(limit), 10) || 25, 100);

    const logs = await prisma.auditLog.findMany({
      where: whereClause,
      include: {
        actor: { select: { id: true, name: true, email: true, role: true } }
      },
      orderBy: { timestamp: 'desc' },
      take: takeCount,
    });

    const totalLogs = await prisma.auditLog.count({ where: whereClause });

    res.json({ logs, total: totalLogs });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch audit logs' });
  }
});

export default router;
