import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import apiRouter from './routes/api.js';

const app = express();

/* ---------- MIDDLEWARE ---------- */
/* ---------- MIDDLEWARE ---------- */
app.use(cors());                                   // allow all origins (adjust if needed)
app.use(express.json({
  type: ["application/json", "application/*+json"],
  verify: (req, res, buf) => { req.rawBody = buf; },
}));

app.use(helmet());  

/* ---------- HEALTH CHECK (must come before 404) ---------- */
app.get('/health', (_req, res) => {
  // Keep this super simple; no DB calls or external checks
  res.status(200).json({ status: 'OK' });
});

/* ---------- ROUTES ---------- */
app.use('/api', apiRouter);

/* ---------- 404 & ERROR HANDLERS ---------- */
app.use((req, res) => {
  res.status(404).json({
    code: 1,
    message: 'Not Found'
  });
});

app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({
    code: 1,
    message: 'Internal server error'
  });
});

export default app;

