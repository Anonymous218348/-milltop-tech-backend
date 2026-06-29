const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');

const { errorHandler, notFoundHandler } = require('./middleware/error');
const authRoutes = require('./routes/auth.routes');
const scannerRoutes = require('./routes/scanner.routes');
const finderRoutes = require('./routes/finder.routes');
const contactsRoutes = require('./routes/contacts.routes');
const templatesRoutes = require('./routes/templates.routes');
const campaignsRoutes = require('./routes/campaigns.routes');
const emailRoutes = require('./routes/email.routes');
const analyticsRoutes = require('./routes/analytics.routes');
const crmRoutes = require('./routes/crm.routes');
const trackerRoutes = require('./routes/tracker.routes');
const aiRoutes = require('./routes/ai.routes');
const settingsRoutes = require('./routes/settings.routes');
const telegramRoutes = require('./routes/telegram.routes');

const app = express();

const corsOrigins = (process.env.CORS_ORIGIN || '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

app.use(helmet());
app.use(cors({
  origin(origin, callback) {
    if (!origin || corsOrigins.length === 0 || corsOrigins.includes(origin)) {
      callback(null, true);
      return;
    }
    callback(new Error('CORS origin not allowed'));
  },
  credentials: true
}));
app.use(express.json({ limit: '1mb' }));
app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));
app.set('trust proxy', 1);
app.use(rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 500,
  standardHeaders: true,
  legacyHeaders: false
}));

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'MILLTOP TECH API' });
});

app.use('/api/auth', authRoutes);
app.use('/api/scanner', scannerRoutes);
app.use('/api/finder', finderRoutes);
app.use('/api/contacts', contactsRoutes);
app.use('/api/templates', templatesRoutes);
app.use('/api/campaigns', campaignsRoutes);
app.use('/api/email', emailRoutes);
app.use('/api/analytics', analyticsRoutes);
app.use('/api/crm', crmRoutes);
app.use('/api/tracker', trackerRoutes);
app.use('/api/ai', aiRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/telegram', telegramRoutes);

app.use(notFoundHandler);
app.use(errorHandler);

module.exports = app;
