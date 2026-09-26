import express, { Application, Request, Response } from 'express';
import cors from 'cors';
import healthRoutes from './routes/healthRoutes';
import qrRoutes from './routes/qrRoutes';
import { redirectQR } from './controllers/qrController';
import { errorHandler } from './middleware/errorHandler';

const app: Application = express();

// Global middleware
app.use(cors({ origin: '*' }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Root welcome route
app.get('/', (req: Request, res: Response) => {
  res.json({
    service: 'DecodeNow Dynamic QR Backend',
    version: '1.0.0',
    documentation: '/api/health',
  });
});

// Primary API Routes
app.use('/api/health', healthRoutes);
app.use('/api/qr', qrRoutes);

// High-performance direct redirect route
app.get('/q/:shortCode', redirectQR);

// Global Error Handler
app.use(errorHandler);

export default app;
