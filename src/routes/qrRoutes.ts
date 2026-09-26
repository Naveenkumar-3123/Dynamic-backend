import { Router } from 'express';
import {
  createQR,
  getQR,
  updateQR,
  disableQR,
} from '../controllers/qrController';
import {
  qrCreationLimiter,
  qrManagementLimiter,
  apiReadLimiter,
} from '../middleware/rateLimiter';

const router = Router();

// Apply dedicated rate limiting per endpoint type
router.post('/', qrCreationLimiter, createQR);
router.get('/:shortCode', apiReadLimiter, getQR);
router.put('/:shortCode', qrManagementLimiter, updateQR);
router.delete('/:shortCode', qrManagementLimiter, disableQR);

export default router;
