require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { initDb } = require('./db');
const authRoutes = require('./routes/auth');
const projectRoutes = require('./routes/projects');
const releaseRoutes = require('./routes/releases');
const ticketRoutes = require('./routes/tickets');
const app = express();

const allowedOrigins = (process.env.CORS_ORIGIN || '*')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);

app.use(
  cors({
    origin(origin, callback) {
      // No origin (e.g. curl, server-to-server) or a wildcard config: allow.
      if (!origin || allowedOrigins.includes('*') || allowedOrigins.includes(origin)) {
        return callback(null, true);
      }
      return callback(new Error(`Origin ${origin} not allowed by CORS`));
    },
  })
);
app.use(express.json());
app.get('/api/health', (req, res) => res.json({ ok: true }));
app.use('/api/auth', authRoutes);
app.use('/api/projects', projectRoutes);
app.use('/api', releaseRoutes); // exposes /api/projects/:id/releases and /api/releases/*
app.use('/api/tickets', ticketRoutes);
// Central error handler
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
});
const PORT = process.env.PORT || 4000;
initDb()
  .then(() => {
    app.listen(PORT, () => console.log(`Firmware portal API listening on :${PORT}`));
  })
  .catch((err) => {
    console.error('Failed to initialize database:', err);
    process.exit(1);
  });
