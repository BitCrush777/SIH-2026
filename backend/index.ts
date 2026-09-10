import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';

dotenv.config();

const app = express();

// Capture any module-level initialization errors for diagnostics
let initError: Error | null = null;

// Security Headers
function securityHeadersInline(req: express.Request, res: express.Response, next: express.NextFunction) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  next();
}

app.use(securityHeadersInline);

// CORS configuration with allowed origins
const allowedOrigins = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(',').map(o => o.trim())
  : ['http://localhost:5173', 'http://localhost:3000', 'https://emaanak.gov.in'];

app.use(cors({
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.includes(origin) || (origin && origin.endsWith('.vercel.app')) || process.env.NODE_ENV !== 'production') {
      callback(null, true);
    } else {
      callback(null, true); // Allow all in serverless for now
    }
  },
  credentials: true,
}));

// Body parsing with payload size boundary limit
app.use(express.json({ limit: '1mb' }));

// Diagnostic health endpoint (mounted FIRST so it always responds even if other modules fail to load)
app.get(['/api/health', '/api/v1/health'], (req, res) => {
  res.json({
    status: initError ? 'degraded' : 'healthy',
    environment: process.env.NODE_ENV || 'development',
    version: '6.1.0-vercel-fix',
    timestamp: new Date().toISOString(),
    hasDbUrl: !!process.env.DATABASE_URL,
    hasJwtSecret: !!process.env.JWT_SECRET,
    hasSupabaseUrl: !!process.env.SUPABASE_URL,
    hasSupabaseKey: !!process.env.SUPABASE_SERVICE_ROLE_KEY,
    initError: initError ? initError.message : null,
    nodeVersion: process.version,
    isVercel: !!process.env.VERCEL,
  });
});

// Debug endpoint for Vercel diagnostics
app.get(['/api/debug', '/api/v1/debug'], (req, res) => {
  res.json({
    env: {
      DATABASE_URL: process.env.DATABASE_URL ? `${process.env.DATABASE_URL.substring(0, 30)}...` : 'NOT SET',
      JWT_SECRET: process.env.JWT_SECRET ? 'SET' : 'NOT SET (using default)',
      SUPABASE_URL: process.env.SUPABASE_URL || 'NOT SET',
      SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY ? 'SET' : 'NOT SET',
      NODE_ENV: process.env.NODE_ENV || 'not set',
      VERCEL: process.env.VERCEL || 'not set',
    },
    initError: initError ? { message: initError.message, stack: initError.stack } : null,
  });
});

// Now try to import and mount the actual application routes
try {
  // These imports are inline to catch any module-level errors
  const { prisma } = require('./src/utils/prisma');
  const authModule = require('./src/routes/auth');
  const authRoutes = authModule.default || authModule;
  const instrumentModule = require('./src/routes/instruments');
  const instrumentRoutes = instrumentModule.default || instrumentModule;
  const verificationModule = require('./src/routes/verifications');
  const verificationRoutes = verificationModule.default || verificationModule;
  const certificateModule = require('./src/routes/certificates');
  const certificateRoutes = certificateModule.default || certificateModule;
  const notificationModule = require('./src/routes/notifications');
  const notificationRoutes = notificationModule.default || notificationModule;
  const analyticsModule = require('./src/routes/analytics');
  const analyticsRoutes = analyticsModule.default || analyticsModule;
  const auditLogModule = require('./src/routes/auditLogs');
  const auditLogRoutes = auditLogModule.default || auditLogModule;
  const federationModule = require('./src/routes/federation');
  const federationRoutes = federationModule.default || federationModule;
  const { rateLimiter, errorHandler } = require('./src/middleware/securityMiddleware');

  // Rate Limiting
  app.use(rateLimiter(200, 60000));
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

  // 2. Direct Versioned Namespace without /api prefix
  mountRoutes('/v1');

  // 3. Backward-Compatible API Namespace (v0/default)
  mountRoutes('/api');

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

  // Serve static frontend build if present (for Render, Railway, Docker, or unified hosting)
  const candidateFrontendDirs = [
    path.join(__dirname, '..', 'frontend', 'dist'),
    path.join(__dirname, '..', '..', 'frontend', 'dist'),
    path.join(process.cwd(), 'frontend', 'dist'),
    path.join(process.cwd(), 'dist'),
  ];
  const frontendDir = candidateFrontendDirs.find(d => fs.existsSync(d));
  if (frontendDir) {
    console.log(`[e-Maanak Server] Serving frontend static assets from: ${frontendDir}`);
    app.use(express.static(frontendDir));
    app.get('*', (req, res, next) => {
      if (req.path.startsWith('/api') || req.path.startsWith('/v1')) {
        return next();
      }
      res.sendFile(path.join(frontendDir, 'index.html'));
    });
  }

  // Production Error Sanitizer
  app.use(errorHandler);

  console.log('[e-Maanak] All routes mounted successfully');

} catch (err: any) {
  // Capture initialization error but DON'T crash — let health/debug endpoints still respond
  initError = err;
  console.error('[e-Maanak] INIT ERROR — routes failed to load:', err.message);
  console.error(err.stack);

  // Fallback: respond with diagnostic error on any route
  app.use('/api', (req, res) => {
    res.status(500).json({
      error: 'Backend initialization failed',
      message: err.message,
      hint: 'Check that DATABASE_URL, JWT_SECRET, SUPABASE_URL, and SUPABASE_SERVICE_ROLE_KEY are set in Vercel Environment Variables',
    });
  });
}

const PORT = process.env.PORT || 5000;

let server: any = null;
// Always start listener so Vercel Express framework can intercept it
if (process.env.NODE_ENV !== 'test') {
  server = app.listen(PORT, () => {
    console.log(`[e-Maanak Server] Running in ${process.env.NODE_ENV || 'development'} mode on port ${PORT}`);
    console.log(`[e-Maanak Server] API v1 available at http://localhost:${PORT}/api/v1`);
    console.log(`[e-Maanak Server] OpenAPI Documentation available at http://localhost:${PORT}/api/docs`);
  });
}

// Graceful Process Shutdown (local/non-serverless only)
if (!process.env.VERCEL && process.env.NODE_ENV !== 'test') {
  const { prisma: prismaClient } = require('./src/utils/prisma');
  const gracefulShutdown = (signal: string) => {
    console.log(`[e-Maanak Server] Received ${signal}. Starting graceful shutdown...`);
    if (server) {
      server.close(async () => {
        console.log('[e-Maanak Server] Closed pending HTTP connections.');
        await prismaClient.$disconnect();
        console.log('[e-Maanak Server] Disconnected Prisma database client.');
        process.exit(0);
      });
    } else {
      prismaClient.$disconnect().then(() => process.exit(0)).catch(() => process.exit(1));
    }

    setTimeout(() => {
      console.error('[e-Maanak Server] Forcefully shutting down after timeout.');
      process.exit(1);
    }, 10000);
  };

  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
  process.on('SIGINT', () => gracefulShutdown('SIGINT'));
}

(app as any).default = app;
export = app;
