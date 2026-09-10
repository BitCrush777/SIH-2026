import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import { prisma } from './src/utils/prisma';
import authRoutes from './src/routes/auth';
import instrumentRoutes from './src/routes/instruments';
import verificationRoutes from './src/routes/verifications';
import certificateRoutes from './src/routes/certificates';
import notificationRoutes from './src/routes/notifications';
import analyticsRoutes from './src/routes/analytics';
import auditLogRoutes from './src/routes/auditLogs';
import federationRoutes from './src/routes/federation';
import { securityHeaders, rateLimiter, errorHandler } from './src/middleware/securityMiddleware';

dotenv.config();

const app = express();

// Security Headers
app.use(securityHeaders);

// CORS configuration with allowed origins
const allowedOrigins = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(',').map(o => o.trim())
  : ['http://localhost:5173', 'http://localhost:3000', 'https://emaanak.gov.in'];

app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (e.g. mobile PWA native shells, curl, same-origin)
    if (!origin || allowedOrigins.includes(origin) || (origin && origin.endsWith('.vercel.app')) || process.env.NODE_ENV !== 'production') {
      callback(null, true);
    } else {
      callback(new Error('CORS request blocked by statutory policy.'));
    }
  },
  credentials: true,
}));

// Body parsing with payload size boundary limit
app.use(express.json({ limit: '1mb' }));

// Global Rate Limiting: 200 requests per minute per IP
app.use(rateLimiter(200, 60000));

// Stricter Rate Limiting on Authentication (30 requests per minute)
app.use(['/api/auth/login', '/api/v1/auth/login'], rateLimiter(30, 60000));

// Helper function to mount routes on a prefix
function mountRoutes(prefix: string) {
  app.use(`${prefix}/auth`, authRoutes);
  app.use(`${prefix}/instruments`, instrumentRoutes);
  app.use(`${prefix}/verifications`, verificationRoutes);
  app.use(`${prefix}/certificates`, certificateRoutes);
  app.use(`${prefix}/notifications`, notificationRoutes);
  app.use(`${prefix}/analytics`, analyticsRoutes);
  app.use(`${prefix}/audit-logs`, auditLogRoutes);
  app.use(`${prefix}/federation`, federationRoutes);
}

// 1. Versioned API Namespace (v1)
mountRoutes('/api/v1');

// 2. Backward-Compatible API Namespace (v0/default)
mountRoutes('/api');

// Health Check
app.get(['/api/health', '/api/v1/health'], (req, res) => {
  res.json({
    status: 'healthy',
    environment: process.env.NODE_ENV || 'development',
    version: '6.0.0-production-ready',
    timestamp: new Date().toISOString()
  });
});

// OpenAPI Spec JSON Endpoint
app.get(['/api/v1/docs', '/api/docs/json'], (req, res) => {
  const candidatePaths = [
    path.join(__dirname, 'src', 'docs', 'openapi.json'),
    path.join(__dirname, '..', 'src', 'docs', 'openapi.json'),
    path.join(process.cwd(), 'src', 'docs', 'openapi.json'),
    path.join(process.cwd(), 'backend', 'src', 'docs', 'openapi.json')
  ];
  const specPath = candidatePaths.find(p => fs.existsSync(p));
  if (specPath) {
    const spec = JSON.parse(fs.readFileSync(specPath, 'utf8'));
    res.json(spec);
  } else {
    res.status(404).json({ error: 'OpenAPI specification file not found.' });
  }
});

// Interactive API Documentation Web View
app.get('/api/docs', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html>
      <head>
        <title>e-Maanak API Documentation (OpenAPI)</title>
        <meta charset="utf-8"/>
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <link href="https://fonts.googleapis.com/css2?family=Public+Sans:wght@400;600;700&display=swap" rel="stylesheet">
        <style>
          body { font-family: 'Public Sans', sans-serif; background: #f8fafc; color: #0f172a; margin: 0; padding: 2rem; }
          .container { max-width: 900px; margin: 0 auto; background: white; border: 1px solid #cbd5e1; padding: 2rem; border-radius: 4px; }
          h1 { color: #0f2d59; border-bottom: 2px solid #0f2d59; padding-bottom: 0.5rem; margin-top: 0; }
          .endpoint { margin: 1rem 0; padding: 1rem; border: 1px solid #e2e8f0; border-left: 4px solid #0f2d59; background: #f8fafc; }
          .method { font-weight: bold; padding: 0.2rem 0.5rem; border-radius: 2px; color: white; display: inline-block; font-size: 0.75rem; }
          .get { background: #15803d; }
          .post { background: #0f2d59; }
          .path { font-family: monospace; font-size: 0.9rem; font-weight: 600; margin-left: 0.5rem; }
          .desc { font-size: 0.85rem; color: #475569; margin-top: 0.5rem; }
          .spec-link { display: inline-block; margin-top: 1.5rem; font-size: 0.85rem; color: #0f2d59; font-weight: bold; }
        </style>
      </head>
      <body>
        <div class="container">
          <h1>e-Maanak Legal Metrology API (v1)</h1>
          <p>Statutory Verification, Offline Synchronization, Certificate Authentication, and State Federation Endpoints.</p>
          
          <div class="endpoint">
            <span class="method post">POST</span>
            <span class="path">/api/v1/verifications/sync</span>
            <div class="desc"><strong>Idempotent Field Synchronization:</strong> Submits queued offline physical verifications with clientOperationId deduplication.</div>
          </div>

          <div class="endpoint">
            <span class="method get">GET</span>
            <span class="path">/api/v1/certificates/public/verify/:token</span>
            <div class="desc"><strong>Public QR Verification:</strong> Unauthenticated consumer check returning sanitized statutory compliance report.</div>
          </div>

          <div class="endpoint">
            <span class="method post">POST</span>
            <span class="path">/api/v1/certificates/:certNumber/revoke</span>
            <div class="desc"><strong>Statutory Revocation:</strong> Authorized officer/admin endpoint to revoke non-compliant instruments with audit grounds.</div>
          </div>

          <div class="endpoint">
            <span class="method get">GET</span>
            <span class="path">/api/v1/federation/health</span>
            <div class="desc"><strong>State Federation Adapter:</strong> Monitors gateway connectivity to central national nodes.</div>
          </div>

          <div class="endpoint">
            <span class="method post">POST</span>
            <span class="path">/api/v1/federation/export/:certNumber</span>
            <div class="desc"><strong>Federation Export:</strong> Standardizes certificate into national exchange format.</div>
          </div>

          <a class="spec-link" href="/api/v1/docs" target="_blank">View Raw OpenAPI 3.0 JSON Specification &rarr;</a>
        </div>
      </body>
    </html>
  `);
});

// Production Error Sanitizer
app.use(errorHandler);

const PORT = process.env.PORT || 5000;

let server: any = null;
// Only start standalone listener when not in Vercel serverless environment
if (process.env.NODE_ENV !== 'test' && !process.env.VERCEL) {
  server = app.listen(PORT, () => {
    console.log(`[e-Maanak Server] Running in ${process.env.NODE_ENV || 'development'} mode on port ${PORT}`);
    console.log(`[e-Maanak Server] API v1 available at http://localhost:${PORT}/api/v1`);
    console.log(`[e-Maanak Server] OpenAPI Documentation available at http://localhost:${PORT}/api/docs`);
  });
}

// Graceful Process Shutdown (local/non-serverless only)
if (!process.env.VERCEL && process.env.NODE_ENV !== 'test') {
  const gracefulShutdown = (signal: string) => {
    console.log(`[e-Maanak Server] Received ${signal}. Starting graceful shutdown...`);
    if (server) {
      server.close(async () => {
        console.log('[e-Maanak Server] Closed pending HTTP connections.');
        await prisma.$disconnect();
        console.log('[e-Maanak Server] Disconnected Prisma database client.');
        process.exit(0);
      });
    } else {
      prisma.$disconnect().then(() => process.exit(0)).catch(() => process.exit(1));
    }

    setTimeout(() => {
      console.error('[e-Maanak Server] Forcefully shutting down after timeout.');
      process.exit(1);
    }, 10000);
  };

  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
  process.on('SIGINT', () => gracefulShutdown('SIGINT'));
}

export default app;
