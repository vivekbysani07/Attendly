const bcrypt = require('bcryptjs');
const db = require('./src/db');

function mulberry32(a) { return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
const dstr = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

(async () => {
  await db.init();
  const EMAIL = 'demo@campus.edu';
  if (await db.one('SELECT id FROM users WHERE email=$1', [EMAIL])) {
    console.log('Demo account already exists → demo@campus.edu / demo1234');
    return;
  }
  const rng = mulberry32(42);
  const { id: uid } = await db.one(
    `INSERT INTO users(name,email,password_hash,college,department,semester,prev_held,prev_attended,target,created_at)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
    ['Devaraj', EMAIL, bcrypt.hashSync('demo1234', 10), 'Sunrise Institute of Technology',
      'Computer Science & Engineering', 'Semester 4', 120, 95, 75, dstr(new Date())]);

  const names = ['Mathematics', 'Physics', 'Data Structures', 'DBMS', 'Operating Systems', 'English'];
  const sid = [];
  for (const n of names) sid.push((await db.one('INSERT INTO subjects(user_id,name) VALUES($1,$2) RETURNING id', [uid, n])).id);
  const tw = [], tp = [], ts = [];
  for (let wd = 1; wd <= 6; wd++) for (let p = 1; p <= 6; p++) { tw.push(wd); tp.push(p); ts.push(sid[(p - 1 + wd - 1) % 6]); }
  await db.run(`INSERT INTO timetable(user_id,weekday,period,subject_id)
                SELECT $1::int, x.w, x.p, x.s FROM unnest($2::int[], $3::int[], $4::int[]) AS x(w, p, s)`, [uid, tw, tp, ts]);

  const reasons = ['College Holiday', 'Festival', 'Exam', 'Event'];
  const end = new Date(); end.setDate(end.getDate() - 1);
  const start = new Date(end); start.setDate(start.getDate() - 56);
  const ad = [], ap = [], as = [], asid = [], hd = [], hr = [];
  for (const d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    if (d.getDay() === 0) continue;
    const ds = dstr(d);
    if (rng() < 0.06) { hd.push(ds); hr.push(reasons[Math.floor(rng() * reasons.length)]); continue; }
    for (let p = 1; p <= 6; p++) {
      ad.push(ds); ap.push(p); as.push(rng() < 0.82 ? 'PRESENT' : 'ABSENT'); asid.push(sid[(p - 1 + d.getDay() - 1) % 6]);
    }
  }
  await db.run(`INSERT INTO attendance(user_id,date,period,status,subject_id)
                SELECT $1::int, x.d, x.p, x.s, x.sid FROM unnest($2::text[], $3::int[], $4::text[], $5::int[]) AS x(d, p, s, sid)`, [uid, ad, ap, as, asid]);
  if (hd.length) await db.run(`INSERT INTO holidays(user_id,date,reason)
                SELECT $1::int, x.d, x.r FROM unnest($2::text[], $3::text[]) AS x(d, r)`, [uid, hd, hr]);

  console.log(`✅ Demo account created:  ${EMAIL} / demo1234`);
  console.log(`   Attendance records: ${ad.length} · Holidays: ${hd.length}`);
})().catch(e => { console.error(e); process.exitCode = 1; }).finally(() => db.end());
