import { Router } from 'express';
import {
  createQR,
  getQR,
  updateQR,
  disableQR,
} from '../controllers/qrController';

const router = Router();

router.post('/', createQR);
router.get('/:shortCode', getQR);
router.put('/:shortCode', updateQR);
router.delete('/:shortCode', disableQR);

export default router;
