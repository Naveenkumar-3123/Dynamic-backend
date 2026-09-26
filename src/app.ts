import express, { Application, Request, Response } from 'express';
import cors from 'cors';
import healthRoutes from './routes/healthRoutes';
import qrRoutes from './routes/qrRoutes';
import { redirectQR } from './controllers/qrController';
import { errorHandler } from './middleware/errorHandler';
import { securityHeaders } from './middleware/securityHeaders';
import { redirectLimiter } from './middleware/rateLimiter';

const app: Application = express();

// Disable 'x-powered-by: Express' fingerprinting header
app.disable('x-powered-by');

// Trust reverse proxy (Vercel / Cloudflare) to correctly obtain client IP for rate limiting
app.set('trust proxy', 1);

// Apply Security HTTP Headers across all routes
app.use(securityHeaders);

// Configured CORS: Only allow web requests if origin matches allowed hosts (or no origin for native mobile/curl apps)
const ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(',').map((o) => o.trim())
  : ['*']; // Safe default; mobile apps don't use origin header

app.use(
  cors({
    origin: (origin, callback) => {
      // Allow requests with no origin (like native Android apps, Postman, curl)
      if (!origin || ALLOWED_ORIGINS.includes('*') || ALLOWED_ORIGINS.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error('Blocked by CORS policy'));
      }
    },
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Secret-Key'],
    maxAge: 86400,
  })
);

// Payload size limit: reject any request larger than 32KB (protects against DOS/memory exhaustion)
app.use(express.json({ limit: '32kb' }));
app.use(express.urlencoded({ extended: false, limit: '32kb' }));

// Root welcome route
app.get('/', (req: Request, res: Response) => {
  res.json({
    service: 'DecodeNow Dynamic QR Backend',
    version: '1.1.0',
    documentation: '/api/health',
  });
});

// Primary API Routes
app.use('/api/health', healthRoutes);
app.use('/api/qr', qrRoutes);

// High-performance direct redirect route with dedicated redirect rate limiter
app.get('/q/:shortCode', redirectLimiter, redirectQR);

// Catch-all for undefined routes
app.use((req: Request, res: Response) => {
  res.status(404).json({
    success: false,
    error: {
      code: 'ROUTE_NOT_FOUND',
      message: `Cannot ${req.method} ${req.path}`,
    },
  });
});

// Global Error Handler
app.use(errorHandler);

export default app;
