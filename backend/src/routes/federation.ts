import { Router, Response } from 'express';
import { authenticate, authorize, AuthRequest } from '../middleware/authMiddleware';
import { exportToFederatedRepository, getFederationAdapterStatus } from '../adapters/stateFederationAdapter';

const router = Router();

// Federation status & node health (Admin & Officer)
router.get(['/health', '/status'], authenticate, authorize(['OFFICER', 'ADMIN']), async (req: AuthRequest, res: Response) => {
  try {
    const status = await getFederationAdapterStatus();
    res.json(status);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch federation adapter status' });
  }
});

// Export certificate to external state/central repository format
router.post('/export/:certificateNumber', authenticate, authorize(['OFFICER', 'ADMIN']), async (req: AuthRequest, res: Response) => {
  try {
    const certNumber = String(req.params.certificateNumber);
    const { targetRepository } = req.body;
    const result = await exportToFederatedRepository(certNumber, targetRepository);
    res.json(result);
  } catch (error: any) {
    res.status(400).json({ error: error.message || 'Federation export failed' });
  }
});

export default router;
