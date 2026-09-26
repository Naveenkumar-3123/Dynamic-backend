import { Router, Request, Response } from 'express';
import { query, isUsingMemoryDb } from '../db/pool';

const router = Router();

router.get('/', async (req: Request, res: Response) => {
  let dbStatus = 'healthy';

  try {
    await query('SELECT 1');
  } catch (err: any) {
    dbStatus = `unreachable: ${err.message}`;
  }

  res.status(200).json({
    success: true,
    service: 'DecodeNow Dynamic QR API',
    status: 'online',
    timestamp: new Date().toISOString(),
    database: {
      status: dbStatus,
      engine: isUsingMemoryDb() ? 'in-memory-pg' : 'postgresql',
    },
  });
});

export default router;
