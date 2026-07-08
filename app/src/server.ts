import express, { Request, Response } from 'express';
import path from 'path';
import cors from 'cors';
import helmet from 'helmet';
import dotenv from 'dotenv';

// Import routes
import tenantRoutes from './routes/tenant.routes';
import productRoutes from './routes/product.routes';
import planRoutes from './routes/plan.routes';
import adminRoutes from './routes/admin.routes';
import settingsRoutes from './routes/settings.routes';
import billingRoutes from './routes/billing.routes';
import hostingRoutes from './routes/hosting.routes';
import moduleRoutes from './routes/module.routes';
import { ensureHostingTables } from './services/hosting.service';
import { ensureModuleTables } from './services/modules.service';
import { ensureAccountColumns, startTrialEmailScheduler } from './services/account.service';

// Load environment variables
dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// Behind a reverse proxy in production — needed for correct client IPs (rate limiting)
if (process.env.NODE_ENV === 'production') {
  app.set('trust proxy', 1);
}

// Middleware
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'", "https://checkout.razorpay.com"], // unsafe-eval needed for some dev tools
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:", "https:", "http:"], // Allow images from any HTTP/HTTPS source
      connectSrc: ["'self'", "https:", "http:"],
      fontSrc: ["'self'", "https:", "data:"],
      frameSrc: ["'self'", "https://api.razorpay.com", "https://checkout.razorpay.com"], // Razorpay Checkout modal
      objectSrc: ["'none'"],
      upgradeInsecureRequests: [],
    },
  },
}));
app.use(cors({
  origin: true, // Allow any origin (required for public search widget on merchant sites)
  credentials: true
}));

// Special handling for payment webhooks (signature check needs raw body)
app.use('/api/plans/webhook', express.raw({ type: 'application/json' }));
app.use('/api/billing/razorpay/webhook', express.raw({ type: 'application/json' }));

// JSON body parser for other routes
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Request logging middleware
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
  next();
});

// Health check endpoint (moved below /api for consistency)
app.get('/api/health', (req: Request, res: Response) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development'
  });
});

app.get('/health', (req: Request, res: Response) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString()
  });
});

// Host separation: when SUPERADMIN_HOST is set, the admin API only answers on that host
const superAdminHost = process.env.SUPERADMIN_HOST;
if (superAdminHost) {
  app.use('/api/admin', (req: Request, res: Response, next: any) => {
    if (req.hostname !== superAdminHost) {
      return res.status(403).json({ error: 'Not available on this host' });
    }
    next();
  });
}

// API Routes
app.use('/api/tenants', tenantRoutes);
app.use('/api/tenants', settingsRoutes);
app.use('/api/products', productRoutes);
app.use('/api/plans', planRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/billing', billingRoutes);
app.use('/api/hosting', hostingRoutes);
app.use('/api/modules', moduleRoutes);

// The super-admin subdomain (e.g. console.cataseek.com) lands on the admin area
if (superAdminHost) {
  app.use((req: Request, res: Response, next: any) => {
    if (req.hostname === superAdminHost && req.path === '/') {
      return res.redirect('/admin');
    }
    next();
  });
}

// Serve static files from the React app build
const dashboardPath = path.join(__dirname, '../dashboard/dist');
app.use(express.static(dashboardPath));

// All remaining requests should return the React app (SPA fallback)
app.get('*', (req: Request, res: Response) => {
  res.sendFile(path.join(dashboardPath, 'index.html'));
});

// 404 handler (moved below static files for SPA)
app.use((req: Request, res: Response) => {
  res.status(404).json({ error: 'Endpoint not found' });
});

// Global error handler
app.use((err: Error, req: Request, res: Response, next: any) => {
  console.error('Global error handler:', err);
  res.status(500).json({
    error: 'Internal server error',
    message: process.env.NODE_ENV === 'development' ? err.message : undefined
  });
});

// Run product-flag migrations up front so auth queries can rely on the columns
ensureHostingTables().catch((e) => console.error('Hosting migration error:', e));
ensureModuleTables().catch((e) => console.error('Module migration error:', e));
ensureAccountColumns()
    .then(() => startTrialEmailScheduler())
    .catch((e) => console.error('Account migration error:', e));

// Start server
app.listen(PORT, () => {
  console.log(`
╔════════════════════════════════════════════════════════════╗
║  E-Commerce Search SaaS Platform                           ║
║  Server running on port ${PORT}                            ║
║  Environment: ${process.env.NODE_ENV || 'development'}                              ║
║  Meilisearch: ${process.env.MEILISEARCH_HOST || 'http://localhost:7700'}         ║
╚════════════════════════════════════════════════════════════╝
  `);
});

export default app;