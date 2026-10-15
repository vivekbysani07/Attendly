const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db');
const { pct, classesNeeded, classesCanMiss, statusOf } = require('../calc');

const r = express.Router();
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

const bad = (res, msg, code = 400) => res.status(code).json({ error: msg });
// Express 4 does not catch async errors, so every handler goes through h().
const h = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

const todayStr = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const isSunday = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d).getDay() === 0; };
const weekdayOf = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d).getDay(); };
const cleanName = v => String(v ?? '').trim().replace(/\s+/g, ' ');
function validDate(s) {
  if (!DATE_RE.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d;
}
function requireAuth(req, res, next) {
  if (req.session && req.session.userId) return next();
  res.status(401).json({ error: 'Please log in first.' });
}
const getUser = id => db.one(
  'SELECT id,name,email,college,department,semester,prev_held,prev_attended,target,created_at FROM users WHERE id=$1', [id]);

async function getTotals(u) {
  const agg = await db.one(
    `SELECT COUNT(*) AS held, COALESCE(SUM(CASE WHEN status='PRESENT' THEN 1 ELSE 0 END), 0) AS att
     FROM attendance WHERE user_id=$1`, [u.id]);
  const held = (u.prev_held || 0) + agg.held;
  const attended = (u.prev_attended || 0) + agg.att;
  return { held, attended, absent: held - attended, p: pct(attended, held) };
}
const entriesFor = (userId, date) => db.all(
  `SELECT a.period, a.status, a.subject_id, s.name AS subject
   FROM attendance a LEFT JOIN subjects s ON s.id = a.subject_id
   WHERE a.user_id=$1 AND a.date=$2 ORDER BY a.period`, [userId, date]);
// Classes the timetable expects on a given date (Sunday is always off).
async function plannedFor(userId, date) {
  const wd = weekdayOf(date);
  if (wd === 0) return [];
  return db.all(
    `SELECT t.period, t.subject_id, s.name AS subject
     FROM timetable t JOIN subjects s ON s.id = t.subject_id
     WHERE t.user_id=$1 AND t.weekday=$2 ORDER BY t.period`, [userId, wd]);
}
const holidayOn = (userId, date) => db.one('SELECT reason FROM holidays WHERE user_id=$1 AND date=$2', [userId, date]);

/* ========== PUBLIC ========== */

r.post('/auth/register', h(async (req, res) => {
  const b = req.body || {};
  const name = String(b.name || '').trim(), email = String(b.email || '').trim().toLowerCase();
  if (name.length < 2) return bad(res, 'Please enter your full name.');
  if (!EMAIL_RE.test(email)) return bad(res, 'Please enter a valid email address.');
  if (!b.password || String(b.password).length < 6) return bad(res, 'Password must be at least 6 characters.');
  const T = Number(b.target ?? 75);
  if (!(T >= 1 && T <= 100)) return bad(res, 'Target must be between 1 and 100.');
  const ph = Number(b.prevHeld || 0), pa = Number(b.prevAttended || 0);
  if (!Number.isInteger(ph) || ph < 0 || ph > 100000) return bad(res, 'Invalid classes held.');
  if (!Number.isInteger(pa) || pa < 0) return bad(res, 'Invalid classes attended.');
  if (pa > ph) return bad(res, 'Classes attended cannot exceed classes held.');
  if (await db.one('SELECT id FROM users WHERE email=$1', [email]))
    return bad(res, 'An account with this email already exists.', 409);
  const hash = await bcrypt.hash(String(b.password), 10);
  let row;
  try {
    row = await db.one(
      `INSERT INTO users(name,email,password_hash,college,department,semester,prev_held,prev_attended,target,created_at)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
      [name, email, hash, String(b.college || '').trim(), String(b.department || '').trim(),
        String(b.semester || '').trim(), ph, pa, T, todayStr()]);
  } catch (e) {
    if (e.code === '23505') return bad(res, 'An account with this email already exists.', 409);
    throw e;
  }
  req.session.userId = row.id;
  res.json({ user: await getUser(row.id) });
}));

r.post('/auth/login', h(async (req, res) => {
  const { email, password } = req.body || {};
  const row = await db.one('SELECT id, password_hash FROM users WHERE email=$1', [String(email || '').trim().toLowerCase()]);
  if (!row || !(await bcrypt.compare(String(password || ''), row.password_hash)))
    return bad(res, 'Invalid email or password.', 401);
  req.session.userId = row.id;
  res.json({ user: await getUser(row.id) });
}));

r.post('/auth/logout', (req, res) => { req.session = null; res.json({ ok: true }); });

/* ========== AUTHENTICATED ========== */
r.use(requireAuth);
const uid = req => req.session.userId;

r.get('/me', h(async (req, res) => {
  const user = await getUser(uid(req));
  if (!user) { req.session = null; return bad(res, 'Please log in first.', 401); }
  res.json({ user });
}));

r.get('/today', h(async (req, res) => {
  const date = todayStr(), id = uid(req);
  const [holiday, entries, planned] = await Promise.all([holidayOn(id, date), entriesFor(id, date), plannedFor(id, date)]);
  res.json({ date, isSunday: isSunday(date), holiday, planned, day: entries.length ? { entries } : null });
}));

r.post('/days', h(async (req, res) => {
  const { date, entries } = req.body || {};
  const id = uid(req);
  if (!validDate(date)) return bad(res, 'Invalid date.');
  if (isSunday(date)) return bad(res, 'Sunday is a weekly off — no attendance is counted.');
  if (date > todayStr()) return bad(res, 'You cannot record attendance for a future date.');
  if (!Array.isArray(entries) || entries.length === 0) return bad(res, 'Add at least one period.');
  const owned = new Set((await db.all('SELECT id FROM subjects WHERE user_id=$1', [id])).map(s => s.id));
  const periods = new Set(), clean = [];
  for (const e of entries) {
    const p = Number(e.period);
    if (!Number.isInteger(p) || p < 1 || p > 6) return bad(res, 'Period must be between 1 and 6.');
    if (periods.has(p)) return bad(res, `Period ${p} appears twice.`);
    periods.add(p);
    const st = e.status === 'ABSENT' ? 'ABSENT' : e.status === 'PRESENT' ? 'PRESENT' : null;
    if (!st) return bad(res, 'Status must be PRESENT or ABSENT.');
    const sid = Number(e.subject_id);
    if (!Number.isInteger(sid) || !owned.has(sid)) return bad(res, `Choose a subject for period ${p}.`);
    clean.push({ p, st, sid });
  }
  await db.tx(async t => {
    await t.run('DELETE FROM attendance WHERE user_id=$1 AND date=$2', [id, date]);
    await t.run('DELETE FROM holidays WHERE user_id=$1 AND date=$2', [id, date]);
    await t.run(
      `INSERT INTO attendance(user_id,date,period,status,subject_id)
       SELECT $1::int, $2::text, x.p, x.s, x.sid FROM unnest($3::int[], $4::text[], $5::int[]) AS x(p, s, sid)`,
      [id, date, clean.map(c => c.p), clean.map(c => c.st), clean.map(c => c.sid)]);
  });
  res.json({ ok: true, date, saved: clean.length });
}));

r.get('/days/:date', h(async (req, res) => {
  const date = req.params.date, id = uid(req);
  if (!validDate(date)) return bad(res, 'Invalid date.');
  const [holiday, entries, planned] = await Promise.all([holidayOn(id, date), entriesFor(id, date), plannedFor(id, date)]);
  res.json({ date, isSunday: isSunday(date), holiday, planned, entries });
}));

r.delete('/days/:date', h(async (req, res) => {
  if (!validDate(req.params.date)) return bad(res, 'Invalid date.');
  await db.tx(async t => {
    await t.run('DELETE FROM attendance WHERE user_id=$1 AND date=$2', [uid(req), req.params.date]);
    await t.run('DELETE FROM holidays WHERE user_id=$1 AND date=$2', [uid(req), req.params.date]);
  });
  res.json({ ok: true });
}));

r.post('/holidays', h(async (req, res) => {
  const { date } = req.body || {};
  const reason = String((req.body || {}).reason || '').trim().slice(0, 80);
  if (!validDate(date)) return bad(res, 'Invalid date.');
  if (isSunday(date)) return bad(res, 'Sunday is already a weekly off.');
  if (date > todayStr()) return bad(res, 'You can only mark today or past days as holidays.');
  await db.tx(async t => {
    await t.run('DELETE FROM attendance WHERE user_id=$1 AND date=$2', [uid(req), date]);
    await t.run(`INSERT INTO holidays(user_id,date,reason) VALUES($1,$2,$3)
                 ON CONFLICT(user_id,date) DO UPDATE SET reason=EXCLUDED.reason`, [uid(req), date, reason]);
  });
  res.json({ ok: true });
}));

r.delete('/holidays/:date', h(async (req, res) => {
  if (!validDate(req.params.date)) return bad(res, 'Invalid date.');
  await db.run('DELETE FROM holidays WHERE user_id=$1 AND date=$2', [uid(req), req.params.date]);
  res.json({ ok: true });
}));

/* ---------- subjects & timetable ---------- */
r.get('/subjects', h(async (req, res) => {
  const rows = await db.all('SELECT id, name, active FROM subjects WHERE user_id=$1 ORDER BY lower(name)', [uid(req)]);
  res.json({ subjects: rows.map(s => ({ id: s.id, name: s.name, active: !!s.active })) });
}));

r.post('/subjects', h(async (req, res) => {
  const name = cleanName(req.body?.name), id = uid(req);
  if (name.length < 1 || name.length > 60) return bad(res, 'Subject name must be 1–60 characters.');
  const ex = await db.one('SELECT id, active FROM subjects WHERE user_id=$1 AND lower(name)=lower($2)', [id, name]);
  if (ex && ex.active) return bad(res, 'You already have a subject with that name.', 409);
  if (ex) { await db.run('UPDATE subjects SET active=1 WHERE id=$1', [ex.id]); return res.json({ id: ex.id }); }
  const row = await db.one('INSERT INTO subjects(user_id,name) VALUES($1,$2) RETURNING id', [id, name]);
  res.json({ id: row.id });
}));

r.put('/subjects/:id', h(async (req, res) => {
  const sid = Number(req.params.id), name = cleanName(req.body?.name), id = uid(req);
  if (!Number.isInteger(sid) || !(await db.one('SELECT 1 AS x FROM subjects WHERE id=$1 AND user_id=$2', [sid, id])))
    return bad(res, 'Subject not found.', 404);
  if (name.length < 1 || name.length > 60) return bad(res, 'Subject name must be 1–60 characters.');
  if (await db.one('SELECT 1 AS x FROM subjects WHERE user_id=$1 AND lower(name)=lower($2) AND id<>$3', [id, name, sid]))
    return bad(res, 'You already have a subject with that name.', 409);
  await db.run('UPDATE subjects SET name=$1 WHERE id=$2', [name, sid]);
  res.json({ ok: true });
}));

// Subjects with saved attendance are archived (history keeps the name); unused ones are deleted.
r.delete('/subjects/:id', h(async (req, res) => {
  const sid = Number(req.params.id);
  if (!Number.isInteger(sid) || !(await db.one('SELECT 1 AS x FROM subjects WHERE id=$1 AND user_id=$2', [sid, uid(req)])))
    return bad(res, 'Subject not found.', 404);
  const used = (await db.one('SELECT COUNT(*) AS c FROM attendance WHERE subject_id=$1', [sid])).c;
  await db.tx(async t => {
    await t.run('DELETE FROM timetable WHERE subject_id=$1', [sid]);
    if (used) await t.run('UPDATE subjects SET active=0 WHERE id=$1', [sid]);
    else await t.run('DELETE FROM subjects WHERE id=$1', [sid]);
  });
  res.json({ ok: true, archived: used > 0 });
}));

r.get('/timetable', h(async (req, res) => {
  res.json({ slots: await db.all('SELECT weekday, period, subject_id FROM timetable WHERE user_id=$1 ORDER BY weekday, period', [uid(req)]) });
}));

// Replaces the whole weekly timetable. Past attendance is untouched.
r.put('/timetable', h(async (req, res) => {
  const slots = req.body?.slots, id = uid(req);
  if (!Array.isArray(slots) || slots.length > 36) return bad(res, 'Invalid timetable.');
  const active = new Set((await db.all('SELECT id FROM subjects WHERE user_id=$1 AND active=1', [id])).map(s => s.id));
  const seen = new Set(), clean = [];
  for (const s of slots) {
    const wd = Number(s?.weekday), p = Number(s?.period), sid = Number(s?.subject_id);
    if (!Number.isInteger(wd) || wd < 1 || wd > 6) return bad(res, 'Weekday must be Monday to Saturday.');
    if (!Number.isInteger(p) || p < 1 || p > 6) return bad(res, 'Period must be between 1 and 6.');
    if (seen.has(wd + '-' + p)) return bad(res, 'A period appears twice in one day.');
    seen.add(wd + '-' + p);
    if (!active.has(sid)) return bad(res, 'Unknown subject in timetable.');
    clean.push({ wd, p, sid });
  }
  await db.tx(async t => {
    await t.run('DELETE FROM timetable WHERE user_id=$1', [id]);
    if (clean.length) await t.run(
      `INSERT INTO timetable(user_id,weekday,period,subject_id)
       SELECT $1::int, x.w, x.p, x.s FROM unnest($2::int[], $3::int[], $4::int[]) AS x(w, p, s)`,
      [id, clean.map(c => c.wd), clean.map(c => c.p), clean.map(c => c.sid)]);
  });
  res.json({ ok: true });
}));

r.get('/history', h(async (req, res) => {
  const id = uid(req);
  const [rows, hols] = await Promise.all([
    db.all(`SELECT a.date, a.period, a.status, s.name AS subject
            FROM attendance a LEFT JOIN subjects s ON s.id = a.subject_id
            WHERE a.user_id=$1 ORDER BY a.date DESC, a.period`, [id]),
    db.all('SELECT date, reason FROM holidays WHERE user_id=$1', [id])]);
  const days = new Map();
  for (const row of rows) {
    if (!days.has(row.date)) days.set(row.date, { date: row.date, kind: 'attendance', entries: [], present: 0, absent: 0 });
    const d = days.get(row.date);
    d.entries.push({ period: row.period, status: row.status, subject: row.subject });
    row.status === 'PRESENT' ? d.present++ : d.absent++;
  }
  for (const x of hols) days.set(x.date, { date: x.date, kind: 'holiday', reason: x.reason });
  res.json({ days: [...days.values()].sort((a, b) => b.date.localeCompare(a.date)) });
}));

r.get('/calendar', h(async (req, res) => {
  const month = req.query.month, id = uid(req);
  if (!MONTH_RE.test(month || '')) return bad(res, 'Invalid month (use YYYY-MM).');
  const [att, hols] = await Promise.all([
    db.all(`SELECT date, COUNT(*) AS n, SUM(CASE WHEN status='PRESENT' THEN 1 ELSE 0 END) AS p
            FROM attendance WHERE user_id=$1 AND substr(date,1,7)=$2 GROUP BY date`, [id, month]),
    db.all('SELECT date FROM holidays WHERE user_id=$1 AND substr(date,1,7)=$2', [id, month])]);
  const out = {};
  for (const a of att) out[a.date] = { t: 'a', n: a.n, p: a.p };
  for (const x of hols) out[x.date] = { t: 'h' };
  res.json({ month, days: out });
}));

r.get('/stats', h(async (req, res) => {
  const id = uid(req);
  const u = await getUser(id);
  const [totals, monthlyRows, subjRows, holidays, firstRow, rec] = await Promise.all([
    getTotals(u),
    db.all(`SELECT substr(date,1,7) AS m, COUNT(*) AS held, SUM(CASE WHEN status='PRESENT' THEN 1 ELSE 0 END) AS att
            FROM attendance WHERE user_id=$1 GROUP BY 1 ORDER BY 1`, [id]),
    db.all(`SELECT s.id, s.name, s.active, COUNT(*) AS held, SUM(CASE WHEN a.status='PRESENT' THEN 1 ELSE 0 END) AS att
            FROM attendance a JOIN subjects s ON s.id = a.subject_id
            WHERE a.user_id=$1 GROUP BY s.id ORDER BY lower(s.name)`, [id]),
    db.all('SELECT date FROM holidays WHERE user_id=$1', [id]),
    db.one(`SELECT MIN(d) AS d FROM (
              SELECT MIN(date) AS d FROM attendance WHERE user_id=$1
              UNION ALL SELECT MIN(date) FROM holidays WHERE user_id=$1
              UNION ALL SELECT created_at FROM users WHERE id=$1) AS t`, [id]),
    db.one('SELECT COUNT(DISTINCT date) AS c FROM attendance WHERE user_id=$1', [id])]);
  const monthly = monthlyRows.map(x => ({ month: x.m, held: x.held, attended: x.att, pct: pct(x.att, x.held) }));
  const bySubject = subjRows.map(x => {
    const p = pct(x.att, x.held);
    return { id: x.id, name: x.name, active: !!x.active, held: x.held, attended: x.att, pct: p,
      status: statusOf(p, u.target), canMiss: classesCanMiss(x.att, x.held, u.target), needed: classesNeeded(x.att, x.held, u.target) };
  });
  const first = firstRow.d, recordedDays = rec.c;
  let workingDays = 0;
  const holSet = new Set(holidays.map(x => x.date));
  if (first) {
    const start = new Date(first), end = new Date(todayStr());
    const cap = new Date(end); cap.setDate(cap.getDate() - 3650);
    if (start < cap) start.setTime(cap.getTime());
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      const ds = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      if (d.getDay() !== 0 && !holSet.has(ds)) workingDays++;
    }
  }
  const T = u.target;
  res.json({
    target: T,
    overall: {
      held: totals.held, attended: totals.attended, absent: totals.absent,
      pct: totals.p, status: statusOf(totals.p, T),
      prevHeld: u.prev_held, prevAttended: u.prev_attended,
      canMiss: totals.p === null ? 0 : classesCanMiss(totals.attended, totals.held, T),
      needed: totals.p === null ? 0 : classesNeeded(totals.attended, totals.held, T)
    },
    monthly,
    bySubject,
    totals: {
      holidays: holidays.length, recordedDays, workingDays,
      missedDays: Math.max(0, workingDays - recordedDays), since: u.created_at
    }
  });
}));

r.put('/settings', h(async (req, res) => {
  const b = req.body || {}, u = await getUser(uid(req));
  const name = b.name !== undefined ? String(b.name).trim() : u.name;
  if (name.length < 2) return bad(res, 'Name is too short.');
  const target = b.target !== undefined ? Number(b.target) : u.target;
  if (!(target >= 1 && target <= 100)) return bad(res, 'Target must be between 1 and 100.');
  await db.run('UPDATE users SET name=$1, college=$2, department=$3, semester=$4, target=$5 WHERE id=$6', [
    name,
    b.college !== undefined ? String(b.college).trim() : u.college,
    b.department !== undefined ? String(b.department).trim() : u.department,
    b.semester !== undefined ? String(b.semester).trim() : u.semester,
    target, uid(req)]);
  res.json({ user: await getUser(uid(req)) });
}));

r.get('/export/csv', h(async (req, res) => {
  const id = uid(req);
  const [rows, hols] = await Promise.all([
    db.all(`SELECT a.date, a.period, a.status, s.name AS subject FROM attendance a
            LEFT JOIN subjects s ON s.id=a.subject_id WHERE a.user_id=$1 ORDER BY a.date, a.period`, [id]),
    db.all('SELECT date, reason FROM holidays WHERE user_id=$1 ORDER BY date', [id])]);
  const q = s => `"${String(s ?? '').replace(/"/g, '""')}"`;
  let csv = '\uFEFFDate,Type,Period,Subject,Status\n';
  for (const x of rows) csv += `${x.date},Class,${x.period},${q(x.subject)},${x.status}\n`;
  for (const x of hols) csv += `${x.date},Holiday,,,${q(x.reason || 'Holiday')}\n`;
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="attendly-export.csv"');
  res.send(csv);
}));

r.get('/export/backup', h(async (req, res) => {
  const id = uid(req), u = await getUser(id);
  const [subjects, timetable, attendance, holidays] = await Promise.all([
    db.all('SELECT name, active FROM subjects WHERE user_id=$1 ORDER BY lower(name)', [id]),
    db.all(`SELECT t.weekday, t.period, s.name AS subject FROM timetable t
            JOIN subjects s ON s.id=t.subject_id WHERE t.user_id=$1 ORDER BY t.weekday, t.period`, [id]),
    db.all(`SELECT a.date, a.period, a.status, s.name AS subject FROM attendance a
            LEFT JOIN subjects s ON s.id=a.subject_id WHERE a.user_id=$1 ORDER BY a.date, a.period`, [id]),
    db.all('SELECT date, reason FROM holidays WHERE user_id=$1 ORDER BY date', [id])]);
  res.setHeader('Content-Disposition', 'attachment; filename="attendly-backup.json"');
  res.json({
    app: 'attendly-backup', version: 3, exportedAt: new Date().toISOString(),
    profile: {
      name: u.name, college: u.college, department: u.department,
      semester: u.semester, target: u.target,
      prevHeld: u.prev_held, prevAttended: u.prev_attended
    },
    subjects: subjects.map(s => ({ name: s.name, active: !!s.active })),
    timetable, attendance, holidays
  });
}));

r.post('/import/backup', h(async (req, res) => {
  const b = req.body;
  if (!b || b.app !== 'attendly-backup' || ![2, 3].includes(b.version))
    return bad(res, 'This is not a valid Attendly backup file.');
  if (!Array.isArray(b.attendance) || !Array.isArray(b.holidays))
    return bad(res, 'Backup is missing data sections.');
  if (b.attendance.length > 200000) return bad(res, 'Backup is too large.');

  const subjects = new Map();   // lower-case name -> { name, active }
  const addSubject = (n, active = 1) => {
    const name = cleanName(n).slice(0, 60);
    if (!name) return null;
    const k = name.toLowerCase();
    if (!subjects.has(k)) subjects.set(k, { name, active });
    return k;
  };
  for (const s of Array.isArray(b.subjects) ? b.subjects : [])
    addSubject(typeof s === 'string' ? s : s?.name, s?.active === false || s?.active === 0 ? 0 : 1);

  const seen = new Set(), seenHol = new Set(), seenTT = new Set(), att = [], tt = [];
  for (const a of b.attendance) {
    if (!validDate(a?.date) || isSunday(a.date)) return bad(res, `Backup: invalid date ${a?.date}.`);
    const p = Number(a.period);
    if (!Number.isInteger(p) || p < 1 || p > 6) return bad(res, 'Backup: invalid period.');
    if (a.status !== 'PRESENT' && a.status !== 'ABSENT') return bad(res, 'Backup: bad status.');
    const key = a.date + '-' + p;
    if (seen.has(key)) return bad(res, `Backup: duplicate period on ${a.date}.`);
    seen.add(key);
    att.push({ date: a.date, p, status: a.status, k: a.subject ? addSubject(a.subject) : null });
  }
  for (const s of Array.isArray(b.timetable) ? b.timetable : []) {
    const wd = Number(s?.weekday), p = Number(s?.period);
    if (!Number.isInteger(wd) || wd < 1 || wd > 6 || !Number.isInteger(p) || p < 1 || p > 6)
      return bad(res, 'Backup: invalid timetable slot.');
    const k = addSubject(s.subject);
    if (!k) return bad(res, 'Backup: timetable slot without a subject.');
    if (seenTT.has(wd + '-' + p)) return bad(res, 'Backup: duplicate timetable slot.');
    seenTT.add(wd + '-' + p);
    tt.push({ wd, p, k });
  }
  for (const x of b.holidays) {
    if (!validDate(x?.date)) return bad(res, 'Backup: invalid holiday date.');
    if (seenHol.has(x.date)) return bad(res, 'Backup: duplicate holiday.');
    seenHol.add(x.date);
  }
  const prof = b.profile || {};
  const target = Number(prof.target ?? 75);
  if (!(target >= 1 && target <= 100)) return bad(res, 'Backup: invalid target.');
  const ph = Number(prof.prevHeld || 0), pa = Number(prof.prevAttended || 0);
  if (!Number.isInteger(ph) || ph < 0 || !Number.isInteger(pa) || pa < 0 || pa > ph)
    return bad(res, 'Backup: invalid previous attendance.');

  const id = uid(req);
  await db.tx(async t => {
    await t.run('DELETE FROM attendance WHERE user_id=$1', [id]);
    await t.run('DELETE FROM holidays WHERE user_id=$1', [id]);
    await t.run('DELETE FROM timetable WHERE user_id=$1', [id]);
    await t.run('DELETE FROM subjects WHERE user_id=$1', [id]);
    await t.run('UPDATE users SET name=$1, college=$2, department=$3, semester=$4, target=$5, prev_held=$6, prev_attended=$7 WHERE id=$8', [
      String(prof.name || 'Student').trim().slice(0, 80),
      String(prof.college || ''), String(prof.department || ''),
      String(prof.semester || ''), target, ph, pa, id]);
    const ids = new Map();
    for (const [k, s] of subjects)
      ids.set(k, (await t.one('INSERT INTO subjects(user_id,name,active) VALUES($1,$2,$3) RETURNING id', [id, s.name, s.active])).id);
    if (tt.length) await t.run(
      `INSERT INTO timetable(user_id,weekday,period,subject_id)
       SELECT $1::int, x.w, x.p, x.s FROM unnest($2::int[], $3::int[], $4::int[]) AS x(w, p, s)`,
      [id, tt.map(s => s.wd), tt.map(s => s.p), tt.map(s => ids.get(s.k))]);
    if (att.length) await t.run(
      `INSERT INTO attendance(user_id,date,period,status,subject_id)
       SELECT $1::int, x.d, x.p, x.st, x.s FROM unnest($2::text[], $3::int[], $4::text[], $5::int[]) AS x(d, p, st, s)`,
      [id, att.map(a => a.date), att.map(a => a.p), att.map(a => a.status), att.map(a => (a.k ? ids.get(a.k) : null))]);
    if (b.holidays.length) await t.run(
      `INSERT INTO holidays(user_id,date,reason)
       SELECT $1::int, x.d, x.r FROM unnest($2::text[], $3::text[]) AS x(d, r)`,
      [id, b.holidays.map(x => x.date), b.holidays.map(x => String(x.reason || '').slice(0, 80))]);
  });
  res.json({ ok: true });
}));

module.exports = r;
