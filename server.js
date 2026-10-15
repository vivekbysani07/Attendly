// Dates ("today", Sunday, future-date checks) follow this time zone. Override with the TZ env var.
process.env.TZ = process.env.TZ || 'Asia/Kolkata';

const express = require('express');
const cookieSession = require('cookie-session');
const path = require('path');
const db = require('./src/db');

const app = express();
const isProd = process.env.NODE_ENV === 'production';
if (isProd && !process.env.SESSION_SECRET) {
  console.error('SESSION_SECRET must be set when NODE_ENV=production.');
  process.exit(1);
}

app.set('trust proxy', 1);            // Render terminates HTTPS in front of the app
app.use(express.json({ limit: '2mb' }));

// Login lives in a signed cookie, so it survives server restarts (7 days).
app.use(cookieSession({
  name: 'attendly',
  keys: [process.env.SESSION_SECRET || 'attendly-dev-secret-change-me'],
  maxAge: 7 * 24 * 60 * 60 * 1000,
  httpOnly: true, sameSite: 'lax', secure: isProd
}));

app.get('/healthz', (req, res) => res.send('ok'));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/api', require('./src/routes/api'));

// Global error guard
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Something went wrong on the server.' });
});

const PORT = process.env.PORT || 3000;
db.init()
  .then(() => app.listen(PORT, '0.0.0.0', () => console.log(`\n  ✅ Attendly running → http://localhost:${PORT}\n`)))
  .catch(e => { console.error('Could not set up the database:', e.message); process.exit(1); });
