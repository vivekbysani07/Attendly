/* ================================================================
   Attendly Lite — simplified SPA
   views: dashboard · today · calendar · stats · history · settings
   ================================================================ */

/* ---------- helpers ---------- */
const $  = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt1 = n => (Math.round(n * 10) / 10).toString();
const pctTxt = p => p === null ? '—' : fmt1(p) + '%';
const initials = n => n.trim().split(/\s+/).slice(0, 2).map(w => w[0]).join('').toUpperCase();
const STATUS_COLOR = { safe: 'var(--good)', warn: 'var(--warn)', bad: 'var(--bad)', none: 'var(--muted)' };

function toast(msg, type = 'info') {
  let box = $('.toasts');
  if (!box) { box = document.createElement('div'); box.className = 'toasts'; document.body.appendChild(box); }
  const t = document.createElement('div');
  t.className = 'toast t-' + (type === 'ok' ? 'ok' : type === 'error' ? 'err' : 'info');
  t.textContent = msg;
  box.appendChild(t);
  setTimeout(() => { t.style.opacity = '0'; t.style.transition = 'opacity .3s'; setTimeout(() => t.remove(), 320); }, 3600);
}

/* ---------- dates ---------- */
const pad = n => String(n).padStart(2, '0');
const todayStr = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const parseDate = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const fmtLong = s => parseDate(s).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
const weekdayName = s => parseDate(s).toLocaleDateString('en-US', { weekday: 'short' });
const topDateStr = () => new Date().toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
const monthLabel = key => { const [y, m] = key.split('-'); return new Date(+y, +m - 1, 1).toLocaleDateString('en-US', { month: 'short', year: 'numeric' }); };

/* ---------- state ---------- */
const S = {
  user: null, stats: null, today: null, subjects: [], timetable: [], loaded: false,
  theme: localStorage.getItem('attendly-theme') || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
};
let calCursor = null, _confirmRes = null, ttDraft = null, ttDay = 1;
const CH = {};
const TITLES = { dashboard: 'Dashboard', today: "Today's Attendance", timetable: 'Timetable', calendar: 'Calendar', stats: 'Statistics', history: 'Attendance History', settings: 'Settings' };

function resetState() { Object.assign(S, { user: null, stats: null, today: null, subjects: [], timetable: [], loaded: false }); calCursor = null; }

async function loadCore() {
  const [me, stats, today, subj, tt] = await Promise.all([
    api('/me'), api('/stats'), api('/today'), api('/subjects'), api('/timetable')
  ]);
  S.user = me.user; S.stats = stats; S.today = today; S.subjects = subj.subjects; S.timetable = tt.slots;
  S.loaded = true;
}

/* ---------- modal / confirm ---------- */
function openModal(html, wide = false) {
  closeModal();
  const ov = document.createElement('div');
  ov.className = 'modal-ov';
  ov.innerHTML = `<div class="modal ${wide ? 'wide' : ''}">${html}</div>`;
  ov.addEventListener('mousedown', e => { if (e.target === ov) closeModal(); });
  document.body.appendChild(ov);
  $$('.modal [data-close]', ov).forEach(b => b.onclick = closeModal);
  requestAnimationFrame(() => ov.classList.add('in'));
}
function closeModal() {
  if (_confirmRes) { const r = _confirmRes; _confirmRes = null; r(false); }
  $('.modal-ov')?.remove();
}
function confirmModal(title, body, okLabel = 'Delete') {
  return new Promise(resolve => {
    _confirmRes = resolve;
    openModal(`<h3>${title}</h3><p class="muted" style="font-size:13.5px">${body}</p>
      <div class="modal-actions"><button class="btn btn-ghost" data-close>Cancel</button>
      <button class="btn btn-danger" id="cmYes">${okLabel}</button></div>`);
    $('#cmYes').onclick = () => { _confirmRes = null; closeModal(); resolve(true); };
  });
}

/* ---------- render helpers ---------- */
const loadingHTML = () => `<div class="loading"><div class="spinner"></div>Loading…</div>`;
const emptyHTML = (icon, msg) => `<div class="empty"><b>${icon}</b>${msg}</div>`;
function errBox(c, msg) {
  c.innerHTML = `<div class="card" style="text-align:center;padding:44px">
    <div style="font-size:34px">⚠️</div><h3 style="margin:10px 0 6px">Couldn't load your data</h3>
    <p class="muted sm">${esc(msg)}</p>
    <button class="btn btn-primary" style="margin-top:16px" onclick="location.reload()">Retry</button></div>`;
}
function ringHTML(pct, size = 150) {
  const r = size / 2 - 10, c = 2 * Math.PI * r;
  const off = c * (1 - Math.min(100, Math.max(0, pct ?? 0)) / 100);
  return `<div class="ring" style="--size:${size}px">
    <svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
      <circle class="ring-bg" cx="${size / 2}" cy="${size / 2}" r="${r}"/>
      <circle class="ring-fg" cx="${size / 2}" cy="${size / 2}" r="${r}" stroke-dasharray="${c}" stroke-dashoffset="${off}" transform="rotate(-90 ${size / 2} ${size / 2})"/>
    </svg>
    <div class="ring-txt"><b class="mono count" data-to="${(pct ?? 0).toFixed(2)}">0</b><span>% attendance</span></div></div>`;
}
function countUps(root) {
  $$('.count', root).forEach(el => {
    const to = parseFloat(el.dataset.to || '0'), t0 = performance.now(), dur = 850;
    (function step(t) {
      const k = Math.min(1, (t - t0) / dur), e = 1 - Math.pow(1 - k, 3);
      el.textContent = (to * e).toFixed(2);
      if (k < 1) requestAnimationFrame(step);
    })(t0);
  });
}

/* ---------- notifications ---------- */
function alertsList() {
  const out = [], t = S.today, o = S.stats?.overall;
  if (!S.subjects.some(s => s.active))
    out.push({ icon: '🗓️', text: 'Add your subjects and weekly timetable to start marking attendance.', go: '#/timetable' });
  if (t && !t.isSunday && !t.holiday && !t.day)
    out.push({ icon: '🔔', text: "You haven't entered today's attendance yet.", go: '#/today' });
  if (o && o.held > 0 && o.pct < S.user?.target)
    out.push({ icon: '⚠️', text: `Overall attendance is ${fmt1(o.pct)}% — below your ${S.user.target}% target. ${o.needed ? `Attend the next ${o.needed} classes to recover.` : ''}`, go: '#/dashboard' });
  return out;
}

/* ================================================================
   ROUTER + SHELL
   ================================================================ */
const ROUTES = {};
function render() {
  closeModal();
  const hash = location.hash || '#/dashboard';
  if (!S.user) { renderAuth(hash.startsWith('#/register') ? 'register' : 'login'); return; }
  if (hash.startsWith('#/login') || hash.startsWith('#/register')) { location.hash = '#/dashboard'; return; }
  const m = hash.match(/^#\/([a-z]+)/);
  const route = m && ROUTES[m[1]] ? m[1] : 'dashboard';
  shell(route);
}
window.addEventListener('hashchange', render);

function shell(route) {
  if (route !== 'timetable') ttDraft = null;
  const NAV = [['dashboard', '🏠', 'Dashboard'], ['today', '📝', 'Today'], ['timetable', '🗓️', 'Timetable'],
    ['calendar', '📅', 'Calendar'], ['stats', '📊', 'Statistics'],
    ['history', '📜', 'History'], ['settings', '⚙️', 'Settings']];
  const alerts = alertsList();
  $('#app').innerHTML = `
  <div class="shell">
    <aside class="sidebar">
      <div class="side-brand"><span class="logo">✓</span><div><b>Attendly</b><small>daily attendance</small></div></div>
      <nav class="side-nav">${NAV.map(([r, i, l]) => `<a class="nav-item ${r === route ? 'active' : ''}" href="#/${r}"><span class="ni-ic">${i}</span>${l}</a>`).join('')}</nav>
      <div class="side-foot">
        <div class="side-user"><span class="avatar">${esc(initials(S.user.name))}</span>
          <div><b>${esc(S.user.name.split(' ')[0])}</b><small>${esc(S.user.semester || S.user.department || 'Student')}</small></div></div>
        <button class="btn btn-ghost sm full" id="logoutBtn">🚪 Log out</button>
      </div>
    </aside>
    <div class="main">
      <header class="topbar">
        <div class="tb-title">${TITLES[route]}</div>
        <div class="tb-right">
          <span class="date-chip mono">${topDateStr()}</span>
          <div class="bell-wrap">
            <button class="icon-btn" id="bellBtn" title="Notifications">🔔${alerts.length ? `<span class="bell-badge">${alerts.length}</span>` : ''}</button>
            <div class="notif-panel" id="notifPanel">${alerts.length
              ? alerts.map(a => `<div class="notif-item" data-go="${a.go}"><span>${a.icon}</span><span>${esc(a.text)}</span></div>`).join('')
              : '<div class="notif-item">✅ All clear — no warnings.</div>'}</div>
          </div>
          <button class="icon-btn" id="themeBtn" title="Toggle theme">${S.theme === 'dark' ? '☀️' : '🌙'}</button>
        </div>
      </header>
      <main class="content" id="content"></main>
    </div>
    <nav class="bottomnav">
      ${[['dashboard', '🏠', 'Home'], ['today', '📝', 'Today'], ['calendar', '📅', 'Calendar'], ['stats', '📊', 'Stats']]
        .map(([r, i, l]) => `<a class="bn-item ${r === route ? 'active' : ''}" href="#/${r}">${i}<small>${l}</small></a>`).join('')}
      <button class="bn-item" id="moreBtn">➕<small>More</small></button>
    </nav>
  </div>`;

  $('#logoutBtn').onclick = doLogout;
  $('#themeBtn').onclick = () => {
    S.theme = S.theme === 'dark' ? 'light' : 'dark';
    localStorage.setItem('attendly-theme', S.theme);
    document.documentElement.dataset.theme = S.theme;
    render();
  };
  const panel = $('#notifPanel');
  $('#bellBtn').onclick = e => { e.stopPropagation(); panel.classList.toggle('open'); };
  document.addEventListener('click', () => panel.classList.remove('open'), { once: true });
  $$('.notif-item[data-go]', panel).forEach(n => n.onclick = () => { location.hash = n.dataset.go; });
  $('#moreBtn').onclick = () => openModal(`<h3>More</h3><div class="more-sheet">
      <a href="#/timetable">🗓️ Timetable</a><a href="#/history">📜 History</a><a href="#/settings">⚙️ Settings</a>
      <button id="moreLogout">🚪 Log out</button></div>`);
  $('#moreLogout') && ($('#moreLogout').onclick = () => { closeModal(); doLogout(); });
  ROUTES[route]();
}

async function doLogout() {
  try { await api('/auth/logout', { method: 'POST' }); } catch (e) {}
  resetState(); location.hash = '#/login'; render();
}

async function withData(fn) {
  const c = $('#content'); if (!c) return;
  if (!S.loaded) { c.innerHTML = loadingHTML(); try { await loadCore(); } catch (e) { return errBox(c, e.message); } }
  try { await fn(c); } catch (e) { errBox(c, e.message); }
}

/* ================================================================
   DAY EDITOR (simplified — just periods + present/absent)
   ================================================================ */
function subjOptions(selected) {
  const list = S.subjects.filter(s => s.active || s.id === selected);
  return `<option value="" ${selected ? '' : 'selected'} disabled>Choose subject…</option>` +
    list.map(s => `<option value="${s.id}" ${s.id === selected ? 'selected' : ''}>${esc(s.name)}</option>`).join('');
}
function rowHTML(p, ex, pl, skip) {
  const sel = ex ? ex.subject_id : pl ? pl.subject_id : null;
  const st = skip ? 'NONE' : ex ? ex.status : 'PRESENT';
  const tag = pl && sel && sel !== pl.subject_id ? `Changed from ${esc(pl.subject)}` : '';
  return `<div class="p-row${skip ? ' skipped' : ''}" data-period="${p}" data-planned="${pl ? pl.subject_id : ''}" data-plannedname="${esc(pl ? pl.subject : '')}">
    <span class="p-num">P${p}</span>
    <div class="p-main"><select class="subj" aria-label="Subject for period ${p}">${subjOptions(sel)}</select><small class="sub-tag">${tag}</small></div>
    <div class="seg">
      <button type="button" data-st="PRESENT" class="${st === 'PRESENT' ? 'on-p' : ''}">✓ Present</button>
      <button type="button" data-st="ABSENT" class="${st === 'ABSENT' ? 'on-a' : ''}">✗ Absent</button>
      <button type="button" data-st="NONE" class="${st === 'NONE' ? 'on-n' : ''}">No class</button>
    </div></div>`;
}
// Rows = the day's timetable plus any periods already saved. If the day was saved before,
// timetable periods that were left out stay marked "No class".
function dayEditorRows(date, existing, planned) {
  planned = planned || [];
  const periods = [...new Set([...planned.map(x => x.period), ...existing.map(x => x.period)])].sort((a, b) => a - b);
  const free = [1, 2, 3, 4, 5, 6].filter(p => !periods.includes(p));
  const rows = periods.map(p => {
    const ex = existing.find(e => e.period === p);
    return rowHTML(p, ex, planned.find(x => x.period === p), existing.length > 0 && !ex);
  }).join('');
  const empty = periods.length ? '' : `<p class="muted sm no-classes">No classes on this day's timetable. ${
    S.subjects.some(s => s.active) ? 'Add a period below, or <a class="linkish" href="#/timetable">edit your timetable</a>.'
      : '<a class="linkish" href="#/timetable">Set up your subjects and timetable →</a>'}</p>`;
  return `<div class="rows">${rows}</div>${empty}
    <label class="add-p ${free.length && S.subjects.some(s => s.active) ? '' : 'hide'}"><span class="muted sm">Extra or swapped class?</span>
      <select><option value="">＋ Add a period…</option>${free.map(p => `<option value="${p}">Period ${p}</option>`).join('')}</select></label>`;
}
function tagRow(row) {
  const v = row.querySelector('.subj').value, pl = row.dataset.planned;
  row.querySelector('.sub-tag').textContent = pl && v && v !== pl ? `Changed from ${row.dataset.plannedname}` : '';
}
function bindSeg(rootSel) {
  $$(rootSel + ' .dayform').forEach(f => {
    f.addEventListener('click', e => {
      const b = e.target.closest('.seg button'); if (!b) return;
      b.closest('.seg').querySelectorAll('button').forEach(x => x.classList.remove('on-p', 'on-a', 'on-n'));
      b.classList.add({ PRESENT: 'on-p', ABSENT: 'on-a', NONE: 'on-n' }[b.dataset.st]);
      b.closest('.p-row').classList.toggle('skipped', b.dataset.st === 'NONE');
    });
    f.addEventListener('change', e => {
      if (e.target.matches('.subj')) return tagRow(e.target.closest('.p-row'));
      if (!e.target.closest('.add-p')) return;
      const p = +e.target.value; if (!p) return;
      const tmp = document.createElement('div'); tmp.innerHTML = rowHTML(p, null, null, false);
      const rows = $('.rows', f), next = $$('.p-row', rows).find(r => +r.dataset.period > p);
      rows.insertBefore(tmp.firstElementChild, next || null);
      f.querySelector('.no-classes')?.remove();
      e.target.querySelector(`option[value="${p}"]`).remove();
      e.target.value = '';
      if (e.target.options.length === 1) e.target.closest('.add-p').classList.add('hide');
    });
  });
}
function collectEntries(rootSel) {
  const entries = []; let error = null;
  $$(rootSel + ' .p-row').forEach(row => {
    if ($('.seg .on-n', row)) return;
    const p = +row.dataset.period, sid = Number($('.subj', row).value);
    if (!sid) { error = error || `Choose a subject for period ${p}.`; return; }
    entries.push({ period: p, status: $('.seg .on-a', row) ? 'ABSENT' : 'PRESENT', subject_id: sid });
  });
  return { entries, error };
}
async function saveDay(date, rootSel, btn) {
  const { entries, error } = collectEntries(rootSel);
  if (error) return toast(error, 'error');
  if (!entries.length) return toast('Mark at least one class.', 'error');
  btn.disabled = true; btn.textContent = 'Saving…';
  try {
    await api('/days', { method: 'POST', body: { date, entries } });
    toast('✅ Attendance saved successfully!', 'ok');
    await loadCore(); render();
  } catch (e) { toast(e.message, 'error'); btn.disabled = false; btn.textContent = '💾 Save attendance'; }
}

function openHoliday(date) {
  openModal(`<h3>🏖️ Mark ${fmtLong(date)} as a holiday?</h3>
    <p class="muted sm" style="margin-bottom:14px">No attendance will be counted for this day. Any attendance already saved for it will be removed.</p>
    <div class="field"><span>Reason</span>
      <select id="holReason">${['College Holiday', 'Festival', 'Exam', 'Event', 'Personal Holiday', 'Other'].map(x => `<option>${x}</option>`).join('')}</select></div>
    <div class="field"><span>Custom reason (optional)</span><input id="holCustom" maxlength="80" placeholder="e.g. Tech fest"></div>
    <div class="modal-actions"><button class="btn btn-ghost" data-close>Cancel</button>
    <button class="btn btn-holiday" id="holGo">🏖️ Mark holiday</button></div>`);
  $('#holGo').onclick = async () => {
    const reason = $('#holCustom').value.trim() || $('#holReason').value;
    try {
      await api('/holidays', { method: 'POST', body: { date, reason } });
      closeModal(); toast('🏖️ Marked as holiday', 'ok'); await loadCore(); render();
    } catch (e) { toast(e.message, 'error'); }
  };
}

function openEditorModal(date, entries, planned) {
  openModal(`<h3>✏️ ${fmtLong(date)}</h3>
    <div class="dayform">${dayEditorRows(date, entries, planned)}</div>
    <div class="modal-actions"><button class="btn btn-ghost" data-close>Cancel</button>
    <button class="btn btn-primary save-day">💾 Save attendance</button></div>`, true);
  bindSeg('.modal');
  $('.modal .save-day').onclick = async e => {
    const btn = e.currentTarget, { entries: ents, error } = collectEntries('.modal');
    if (error) return toast(error, 'error');
    if (!ents.length) return toast('Mark at least one class.', 'error');
    btn.disabled = true;
    try {
      await api('/days', { method: 'POST', body: { date, entries: ents } });
      closeModal(); toast('✅ Attendance saved successfully!', 'ok'); await loadCore(); render();
    } catch (err) { toast(err.message, 'error'); btn.disabled = false; }
  };
}

async function openDay(date) {
  let d; try { d = await api('/days/' + date); } catch (e) { return toast(e.message, 'error'); }
  let body = `<h3>${fmtLong(date)} <span class="chip mono">${weekdayName(date)}</span></h3>`;
  if (d.isSunday) {
    body += `<div class="sun-panel"><div class="sun-ic">🌞</div><b>Sunday</b><p class="muted sm">Weekly off — attendance is never counted on Sundays.</p></div>
      <div class="modal-actions"><button class="btn btn-ghost" data-close>Close</button></div>`;
  } else if (d.holiday) {
    body += `<div class="banner b-info">🏖️ Holiday${d.holiday.reason ? ' — ' + esc(d.holiday.reason) : ''}</div>
      <div class="modal-actions"><button class="btn btn-ghost" data-close>Close</button>
      <button class="btn btn-ghost" id="odUnhol">Unmark</button>
      <button class="btn btn-primary" id="odAdd">Enter attendance</button></div>`;
  } else if (d.entries.length) {
    body += d.entries.map(e => `<div class="dayline"><span class="mono">P${e.period}</span><b>${esc(e.subject || 'Period ' + e.period)}</b>
      <span class="pill ${e.status === 'PRESENT' ? 'p-present' : 'p-absent'}">${e.status === 'PRESENT' ? '✓ Present' : '✗ Absent'}</span></div>`).join('') +
      `<div class="modal-actions"><button class="btn btn-ghost" data-close>Close</button>
      <button class="btn btn-danger sm" id="odDel">🗑 Delete day</button>
      <button class="btn btn-primary" id="odEdit">✏️ Edit</button></div>`;
  } else if (date > todayStr()) {
    body += `<p class="muted sm">This day hasn't come yet — attendance can't be recorded for future dates.</p>
      <div class="modal-actions"><button class="btn btn-ghost" data-close>Close</button></div>`;
  } else {
    body += `<p class="muted sm">No attendance recorded for this day.</p>
      <div class="modal-actions"><button class="btn btn-ghost" data-close>Close</button>
      <button class="btn btn-holiday" id="odHol">🏖️ Mark holiday</button>
      <button class="btn btn-primary" id="odAdd">➕ Add attendance</button></div>`;
  }
  openModal(body, true);
  if ($('#odEdit')) $('#odEdit').onclick = () => { closeModal(); openEditorModal(date, d.entries, d.planned); };
  if ($('#odAdd')) $('#odAdd').onclick = () => { closeModal(); openEditorModal(date, d.entries, d.planned); };
  if ($('#odHol')) $('#odHol').onclick = () => { closeModal(); openHoliday(date); };
  if ($('#odUnhol')) $('#odUnhol').onclick = async () => {
    await api('/holidays/' + date, { method: 'DELETE' }); closeModal(); toast('Holiday removed', 'ok'); await loadCore(); render();
  };
  if ($('#odDel')) $('#odDel').onclick = async () => {
    if (!await confirmModal('Delete this day?', `All attendance saved for ${fmtLong(date)} will be removed and your percentage recalculated.`)) return;
    closeModal();
    await api('/days/' + date, { method: 'DELETE' });
    toast('Day deleted — everything recalculated', 'ok'); await loadCore(); render();
  };
}

/* ================================================================
   VIEW: DASHBOARD
   ================================================================ */
ROUTES.dashboard = () => withData(c => {
  const u = S.user, st = S.stats, t = S.today, o = st.overall;
  const hour = new Date().getHours();
  const greet = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  const safe = o.pct !== null && o.pct >= u.target;

  c.innerHTML = `<div class="fade-up">
    <div class="welcome">
      <div><h2 class="xl">${greet}, ${esc(u.name.split(' ')[0])} 👋</h2>
        <p class="muted sm">${fmtLong(t.date)} · ${esc(u.department || 'Student')}${u.semester ? ' · ' + esc(u.semester) : ''}</p></div>
      <a class="btn btn-soft" href="#/history">📜 History</a>
    </div>
    <div class="dash-grid">
      <section class="card lift">
        <header class="card-h"><h3>Overall attendance</h3>
          <span class="chip ${o.pct === null ? '' : safe ? 'st-safe' : 'st-bad'} mono">${o.pct === null ? 'NO DATA' : safe ? 'SAFE' : 'BELOW TARGET'}</span></header>
        <div class="hero">${ringHTML(o.pct, 150)}
          <div class="hero-side">
            <div class="hcount"><span>Classes held</span><b class="mono">${o.held}</b></div>
            <div class="hcount"><span>Classes attended</span><b class="mono ok">${o.attended}</b></div>
            <div class="hcount"><span>Absent</span><b class="mono bad">${o.absent}</b></div>
            <p class="muted sm">${o.pct === null ? 'Save your first day of attendance to get started.'
              : safe ? `You're ${fmt1(o.pct - u.target)} pts above your ${u.target}% target.`
              : `You need ${fmt1(u.target - o.pct)} more pts to reach your ${u.target}% target.`}</p>
          </div></div>
      </section>
      <section class="card lift" id="todayCard">${todayCardInner()}</section>
    </div>
    ${warningsHTML()}
    <div class="tiles">
      ${tile('Total classes', o.held)}${tile('Presents', o.attended, 't-ok')}${tile('Absences', o.absent, 't-bad')}
      ${tile('Holidays', st.totals.holidays)}${tile('Working days', st.totals.workingDays)}${tile('Not recorded', st.totals.missedDays, 't-warn')}
    </div></div>`;

  bindTodayCard();
  countUps(c);
});

const tile = (label, val, cls = '') => `<div class="tile ${cls}"><b class="mono">${val}</b><span>${label}</span></div>`;

function todayCardInner() {
  const t = S.today;
  if (t.isSunday) return `<header class="card-h"><h3>Today</h3><span class="chip mono">Sunday</span></header>
    <div class="sun-panel"><div class="sun-ic">🌞</div><b>Sunday</b>
    <p class="muted sm">No attendance required today.<br>Attendance will not be calculated for today.</p></div>`;
  if (t.holiday) return `<header class="card-h"><h3>Today</h3><span class="chip st-hol">🏖️ Holiday</span></header>
    <div class="hol-panel"><b>🏖️ Marked as holiday</b>${t.holiday.reason ? `<p class="muted sm">${esc(t.holiday.reason)}</p>` : ''}
    <div class="row-actions" style="justify-content:center">
      <button class="btn btn-ghost unhol-btn">Unmark holiday</button>
      <a class="btn btn-primary" href="#/today">Open Today page →</a></div></div>`;
  if (t.day) {
    const p = t.day.entries.filter(e => e.status === 'PRESENT').length;
    return `<header class="card-h"><h3>Today's attendance</h3><span class="chip st-safe">✓ Recorded</span></header>
      ${t.day.entries.map(e => `<div class="dayline"><span class="mono">P${e.period}</span><b>${esc(e.subject || 'Period ' + e.period)}</b>
        <span class="pill ${e.status === 'PRESENT' ? 'p-present' : 'p-absent'}">${e.status === 'PRESENT' ? '✓' : '✗'}</span></div>`).join('')}
      <p class="muted sm" style="margin-top:10px">${p} of ${t.day.entries.length} periods present · <a class="linkish" href="#/today">Edit today →</a></p>`;
  }
  return `<header class="card-h"><h3>Today's attendance</h3><span class="chip mono">${t.planned.length} classes</span></header>
    <div class="dayform">${dayEditorRows(t.date, [], t.planned)}</div>
    <div class="row-actions"><button class="btn btn-primary save-day">💾 Save attendance</button>
    <button class="btn btn-holiday hol-btn">🏖️ Mark as Holiday</button></div>`;
}
function bindTodayCard() {
  const card = $('#todayCard'); if (!card) return;
  bindSeg('#todayCard');
  $('.save-day', card) && ($('.save-day', card).onclick = e => saveDay(S.today.date, '#todayCard', e.currentTarget));
  $('.hol-btn', card) && ($('.hol-btn', card).onclick = () => openHoliday(S.today.date));
  $('.unhol-btn', card) && ($('.unhol-btn', card).onclick = async () => {
    await api('/holidays/' + S.today.date, { method: 'DELETE' });
    toast('Holiday removed', 'ok'); await loadCore(); render();
  });
}
function warningsHTML() {
  const out = [], t = S.today, o = S.stats.overall;
  if (!S.subjects.some(s => s.active))
    out.push(`<div class="banner b-info">🗓️ <b>Set up your timetable:</b>&nbsp;add your subjects and weekly schedule so each day asks about the right classes. <a class="linkish" href="#/timetable">Open timetable →</a></div>`);
  if (t && !t.isSunday && !t.holiday && !t.day)
    out.push(`<div class="banner b-info">🔔 <b>Attendance reminder:</b>&nbsp;you haven't entered today's attendance yet. <a class="linkish" href="#/today">Do it now →</a></div>`);
  if (o.held > 0 && o.pct < S.user.target)
    out.push(`<div class="banner b-warn">⚠️ <b>Overall attendance</b> is ${fmt1(o.pct)}% — below the required ${S.user.target}%. ${
      o.needed === null ? 'Reaching the target is no longer possible.' :
      `You need to attend the next <b>${o.needed}</b> class${o.needed === 1 ? '' : 'es'} without missing any to reach ${S.user.target}%.`}</div>`);
  else if (o.held > 0) {
    out.push(`<div class="banner b-ok">✅ Your attendance is safe. You can miss up to <b>${o.canMiss}</b> more class${o.canMiss === 1 ? '' : 'es'} and stay at or above ${S.user.target}%.</div>`);
  }
  return out.join('');
}

/* ================================================================
   VIEW: TODAY
   ================================================================ */
ROUTES.today = () => withData(c => {
  const t = S.today;
  let body;
  if (t.isSunday) {
    body = `<section class="card"><div class="sun-panel"><div class="sun-ic">🌞</div><b>Sunday</b>
      <p class="muted">No attendance required today.<br>Attendance will not be calculated for today.</p></div></section>`;
  } else if (t.holiday) {
    body = `<section class="card"><div class="hol-panel"><b>🏖️ Today is marked as a holiday</b>
      ${t.holiday.reason ? `<p class="muted sm">${esc(t.holiday.reason)}</p>` : ''}
      <p class="muted sm">Today’s classes are not counted. It will appear in history as “Holiday”.</p>
      <div class="row-actions" style="justify-content:center"><button class="btn btn-ghost unhol-btn">Unmark holiday</button></div></div></section>`;
  } else {
    body = `<section class="card">
      <header class="card-h"><h3>${t.day ? '✏️ Edit today’s classes' : '📝 Mark today’s classes'}</h3>
        <span class="chip mono">${fmtLong(t.date)}</span></header>
      ${t.day ? '<div class="banner b-ok">✅ Attendance recorded — edit below if anything is wrong.</div>' :
        '<div class="banner b-info">💡 These are today’s classes from your timetable. Mark each Present or Absent — and change the subject if another faculty took the period.</div>'}
      <div class="dayform">${dayEditorRows(t.date, t.day?.entries || [], t.planned)}</div>
      <div class="row-actions">
        <button class="btn btn-primary save-day">💾 Save attendance</button>
        <button class="btn btn-holiday hol-btn">🏖️ Mark as Holiday</button>
      </div></section>`;
  }
  c.innerHTML = `<div class="fade-up">${body}</div>`;
  bindSeg('.content');
  $('.save-day') && ($('.save-day').onclick = e => saveDay(t.date, '.content', e.currentTarget));
  $('.hol-btn') && ($('.hol-btn').onclick = () => openHoliday(t.date));
  $('.unhol-btn') && ($('.unhol-btn').onclick = async () => {
    await api('/holidays/' + t.date, { method: 'DELETE' });
    toast('Holiday removed', 'ok'); await loadCore(); render();
  });
});

/* ================================================================
   VIEW: TIMETABLE
   ================================================================ */
const WEEKDAYS = ['', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
ROUTES.timetable = () => withData(c => {
  const active = S.subjects.filter(s => s.active);
  if (!ttDraft) { ttDraft = {}; S.timetable.forEach(s => { ttDraft[s.weekday + '-' + s.period] = s.subject_id; }); }
  for (const k of Object.keys(ttDraft)) if (!active.some(s => s.id === ttDraft[k])) delete ttDraft[k];
  const opts = sel => `<option value="">— Free —</option>` +
    active.map(s => `<option value="${s.id}" ${s.id === sel ? 'selected' : ''}>${esc(s.name)}</option>`).join('');
  c.innerHTML = `<div class="fade-up set-grid">
    <section class="card"><header class="card-h"><h3>📚 Subjects</h3></header>
      <div class="subj-list">${active.length ? active.map(s => `<span class="subj-chip"><b>${esc(s.name)}</b>
        <button class="icon-btn s-ren" data-id="${s.id}" title="Rename">✏️</button>
        <button class="icon-btn s-del" data-id="${s.id}" title="Remove">🗑</button></span>`).join('')
        : '<p class="muted sm">No subjects yet — add your first one below.</p>'}</div>
      <div class="field-row"><div class="field"><span>New subject</span><input id="subjName" maxlength="60" placeholder="e.g. Data Structures"></div>
        <div class="field"><span>&nbsp;</span><button class="btn btn-primary full" id="subjAdd">Add subject</button></div></div></section>
    <section class="card"><header class="card-h"><h3>🗓️ Weekly timetable</h3></header>
      <div class="target-chips">${[1, 2, 3, 4, 5, 6].map(d => `<button class="tchip ${d === ttDay ? 'active' : ''}" data-d="${d}">${WEEKDAYS[d]}</button>`).join('')}</div>
      <div class="tt-rows">${[1, 2, 3, 4, 5, 6].map(p => `<div class="p-row"><span class="p-num">P${p}</span>
        <div class="p-main"><select class="tt-sel" data-p="${p}" aria-label="Period ${p}">${opts(ttDraft[ttDay + '-' + p])}</select></div></div>`).join('')}</div>
      <div class="row-actions"><button class="btn btn-primary" id="ttSave">💾 Save timetable</button></div>
      <p class="muted sm">Pick a day, set its subjects, then save once for all days. Sunday is always off. Changes apply from now on — days you've already recorded keep their original subjects. Leave a period as “Free” when there's no class.</p></section></div>`;

  $$('.tchip', c).forEach(b => b.onclick = () => { ttDay = +b.dataset.d; ROUTES.timetable(); });
  $$('.tt-sel', c).forEach(s => s.onchange = () => {
    const k = ttDay + '-' + s.dataset.p;
    if (s.value) ttDraft[k] = +s.value; else delete ttDraft[k];
  });
  $('#ttSave').onclick = async () => {
    const slots = Object.entries(ttDraft).map(([k, sid]) => { const [weekday, period] = k.split('-').map(Number); return { weekday, period, subject_id: sid }; });
    try { await api('/timetable', { method: 'PUT', body: { slots } }); ttDraft = null; await loadCore(); toast('✅ Timetable saved', 'ok'); render(); }
    catch (e) { toast(e.message, 'error'); }
  };
  const addSubj = async () => {
    const name = $('#subjName').value.trim(); if (!name) return;
    try { await api('/subjects', { method: 'POST', body: { name } }); await loadCore(); ROUTES.timetable(); }
    catch (e) { toast(e.message, 'error'); }
  };
  $('#subjAdd').onclick = addSubj;
  $('#subjName').onkeydown = e => { if (e.key === 'Enter') addSubj(); };
  $$('.s-ren', c).forEach(b => b.onclick = () => {
    const s = S.subjects.find(x => x.id === +b.dataset.id);
    openModal(`<h3>Rename subject</h3><div class="field"><span>Name</span><input id="renName" maxlength="60" value="${esc(s.name)}"></div>
      <div class="modal-actions"><button class="btn btn-ghost" data-close>Cancel</button><button class="btn btn-primary" id="renGo">Save</button></div>`);
    $('#renGo').onclick = async () => {
      try { await api('/subjects/' + s.id, { method: 'PUT', body: { name: $('#renName').value } }); closeModal(); await loadCore(); ROUTES.timetable(); toast('Subject renamed', 'ok'); }
      catch (e) { toast(e.message, 'error'); }
    };
  });
  $$('.s-del', c).forEach(b => b.onclick = async () => {
    const s = S.subjects.find(x => x.id === +b.dataset.id);
    if (!await confirmModal(`Remove ${esc(s.name)}?`, 'It will be taken off your timetable. Attendance already recorded for it stays in your history and totals.', 'Remove')) return;
    try { await api('/subjects/' + s.id, { method: 'DELETE' }); await loadCore(); ROUTES.timetable(); toast('Subject removed', 'ok'); }
    catch (e) { toast(e.message, 'error'); }
  });
});

/* ================================================================
   VIEW: CALENDAR
   ================================================================ */
ROUTES.calendar = () => withData(async c => {
  c.innerHTML = loadingHTML();
  if (!calCursor) { const t = new Date(); calCursor = { y: t.getFullYear(), m: t.getMonth() + 1 }; }
  const { y, m } = calCursor, key = `${y}-${pad(m)}`;
  const data = await api('/calendar?month=' + key);
  const first = new Date(y, m - 1, 1), offset = (first.getDay() + 6) % 7, dim = new Date(y, m, 0).getDate();
  const tstr = todayStr();
  let cells = '';
  for (let i = 0; i < offset; i++) cells += '<div class="cal-cell blank"></div>';
  for (let d = 1; d <= dim; d++) {
    const ds = `${key}-${pad(d)}`, info = data.days[ds], sun = new Date(y, m - 1, d).getDay() === 0;
    let cls = 'cal-cell', tag = '';
    if (info?.t === 'a') { cls += ' rec'; tag = `<span class="cal-tag mono">${info.p}/${info.n}✓</span>`; }
    else if (info?.t === 'h') { cls += ' hol'; tag = '<span class="cal-tag">🏖</span>'; }
    else if (sun) cls += ' sun';
    else if (ds < tstr) { cls += ' miss'; tag = '<span class="cal-dot"></span>'; }
    else cls += ' fut';
    if (ds === tstr) cls += ' is-today';
    cells += `<button class="${cls}" data-date="${ds}"><span class="cal-d">${d}</span>${tag}</button>`;
  }
  c.innerHTML = `<div class="fade-up"><section class="card">
    <header class="card-h cal-nav">
      <button class="icon-btn" id="calPrev">←</button>
      <h2 class="mono">${first.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}</h2>
      <button class="icon-btn" id="calNext">→</button></header>
    <div class="cal-days">${['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(d => `<span>${d}</span>`).join('')}</div>
    <div class="cal-grid">${cells}</div>
    <div class="cal-legend">
      <span><i class="lg" style="background:var(--good-soft);border:1px solid var(--good)"></i>Recorded</span>
      <span><i class="lg" style="background:var(--hol-soft);border:1px solid var(--hol)"></i>Holiday</span>
      <span><i class="lg" style="background:var(--surface2);border:1px solid var(--line)"></i>Sunday</span>
      <span><i class="lg" style="background:var(--bad)"></i>Not recorded (past)</span></div>
  </section></div>`;
  $('#calPrev').onclick = () => { calCursor = m === 1 ? { y: y - 1, m: 12 } : { y, m: m - 1 }; ROUTES.calendar(); };
  $('#calNext').onclick = () => { calCursor = m === 12 ? { y: y + 1, m: 1 } : { y, m: m + 1 }; ROUTES.calendar(); };
  $$('.cal-cell[data-date]', c).forEach(el => el.onclick = () => openDay(el.dataset.date));
});

/* ================================================================
   VIEW: STATISTICS
   ================================================================ */
ROUTES.stats = () => withData(c => {
  const st = S.stats, o = st.overall;
  c.innerHTML = `<div class="fade-up">
    <div class="tiles">
      ${tile('Overall', pctTxt(o.pct), o.pct !== null && o.pct >= st.target ? 't-ok' : 't-bad')}
      ${tile('Total classes', o.held)}${tile('Presents', o.attended, 't-ok')}${tile('Absences', o.absent, 't-bad')}
      ${tile('Holidays', st.totals.holidays)}${tile('Working days', st.totals.workingDays)}
      ${tile('Days recorded', st.totals.recordedDays)}${tile('Not recorded', st.totals.missedDays, 't-warn')}
      ${tile('Can miss', o.canMiss || 0)}${tile('Needed', o.needed || 0)}
    </div>
    <section class="card"><header class="card-h"><h3>📈 Monthly attendance</h3></header>
      <div class="chart-box"><canvas id="chMonth"></canvas></div></section>
    ${subjectTable(st)}
    <section class="card"><header class="card-h"><h3>Month by month</h3></header>
      ${st.monthly.length ? `<table class="tbl"><thead><tr><th>Month</th><th>Held</th><th>Present</th><th>Absent</th><th>%</th></tr></thead><tbody>
      ${st.monthly.map(m => `<tr><td>${monthLabel(m.month)}</td><td class="mono">${m.held}</td><td class="mono">${m.attended}</td>
        <td class="mono">${m.held - m.attended}</td><td class="mono"><b>${pctTxt(m.pct)}</b></td></tr>`).join('')}</tbody></table>`
      : emptyHTML('📊', 'No attendance recorded yet.')}</section></div>`;
  initCharts();
});

function subjectTable(st) {
  if (!st.bySubject.length) return '';
  return `<section class="card"><header class="card-h"><h3>📚 By subject</h3></header>
    <table class="tbl"><thead><tr><th>Subject</th><th>Held</th><th>Present</th><th>%</th><th>Next</th></tr></thead><tbody>
    ${st.bySubject.map(s => `<tr><td>${esc(s.name)}${s.active ? '' : ' <span class="muted sm">(removed)</span>'}</td>
      <td class="mono">${s.held}</td><td class="mono">${s.attended}</td>
      <td class="mono"><b style="color:${STATUS_COLOR[s.status]}">${pctTxt(s.pct)}</b></td>
      <td class="mono">${s.pct >= st.target ? 'can miss ' + s.canMiss : 'attend ' + (s.needed === null ? '—' : s.needed)}</td></tr>`).join('')}</tbody></table>
    <p class="muted sm" style="margin-top:8px">Counts only classes saved in this app, not your starting totals.</p></section>`;
}

function initCharts() {
  CH.month?.destroy();
  if (typeof Chart === 'undefined') {
    $$('.chart-box').forEach(b => b.innerHTML = '<p class="muted sm" style="padding:20px">Charts need an internet connection (Chart.js CDN).</p>');
    return;
  }
  const cssv = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
  Chart.defaults.font.family = "'Instrument Sans', sans-serif";
  Chart.defaults.color = cssv('--muted');
  const grid = cssv('--line');
  const st = S.stats;
  CH.month = new Chart($('#chMonth'), {
    type: 'bar',
    data: { labels: st.monthly.map(m => monthLabel(m.month)),
      datasets: [{
        data: st.monthly.map(m => m.pct === null ? 0 : +m.pct.toFixed(2)),
        backgroundColor: cssv('--brand'), borderRadius: 6, maxBarThickness: 40,
        label: 'Attendance %'
      }, {
        type: 'line',
        data: st.monthly.map(() => st.target),
        borderColor: cssv('--ink'), borderDash: [6, 5],
        borderWidth: 1.5, pointRadius: 0, label: 'Target'
      }]
    },
    options: { responsive: true, maintainAspectRatio: false,
      scales: { y: { min: 0, max: 100, grid: { color: grid } }, x: { grid: { display: false } } },
      plugins: { legend: { display: true, position: 'bottom' },
        tooltip: { callbacks: { label: ctx => ctx.dataset.label + ': ' + ctx.parsed.y + '%' } } } }
  });
}

/* ================================================================
   VIEW: HISTORY
   ================================================================ */
ROUTES.history = () => withData(async c => {
  c.innerHTML = loadingHTML();
  const { days } = await api('/history');
  if (!days.length) { c.innerHTML = emptyHTML('📜', 'No records yet. Save your first day from the Today page.'); return; }
  c.innerHTML = `<div class="fade-up hist-list">${days.map(d => d.kind === 'holiday'
    ? `<article class="card hist-card hol"><header><b>${fmtLong(d.date)}</b><span class="chip mono">${weekdayName(d.date)}</span>
        <span class="chip st-hol">🏖️ Holiday</span><span class="spacer"></span>
        <button class="btn sm btn-ghost h-unhol" data-date="${d.date}">Unmark</button>
        <button class="btn sm btn-danger h-del" data-date="${d.date}">🗑</button></header>
        <p class="muted sm">${d.reason ? esc(d.reason) : 'No reason given'}</p></article>`
    : `<article class="card hist-card"><header><b>${fmtLong(d.date)}</b><span class="chip mono">${weekdayName(d.date)}</span>
        <span class="chip st-safe mono">${d.present}✓</span><span class="chip st-bad mono">${d.absent}✗</span><span class="spacer"></span>
        <button class="btn sm btn-ghost h-edit" data-date="${d.date}">✏️ Edit</button>
        <button class="btn sm btn-danger h-del" data-date="${d.date}">🗑</button></header>
        ${d.entries.map(e => `<div class="dayline"><span class="mono">P${e.period}</span><b>${esc(e.subject || 'Period ' + e.period)}</b>
          <span class="pill ${e.status === 'PRESENT' ? 'p-present' : 'p-absent'}">${e.status === 'PRESENT' ? '✓ Present' : '✗ Absent'}</span></div>`).join('')}</article>`
  ).join('')}</div>`;

  $$('.h-edit').forEach(b => b.onclick = async () => {
    const d = await api('/days/' + b.dataset.date); openEditorModal(d.date, d.entries, d.planned);
  });
  $$('.h-del').forEach(b => b.onclick = async () => {
    if (!await confirmModal('Delete this day?', `Everything recorded on ${fmtLong(b.dataset.date)} will be removed and your percentage recalculated.`)) return;
    await api('/days/' + b.dataset.date, { method: 'DELETE' });
    toast('Day deleted — recalculated', 'ok'); await loadCore(); ROUTES.history();
  });
  $$('.h-unhol').forEach(b => b.onclick = async () => {
    await api('/holidays/' + b.dataset.date, { method: 'DELETE' });
    toast('Holiday removed', 'ok'); await loadCore(); ROUTES.history();
  });
});

/* ================================================================
   VIEW: SETTINGS
   ================================================================ */
ROUTES.settings = () => withData(c => {
  const u = S.user;
  c.innerHTML = `<div class="fade-up set-grid">
    <section class="card"><header class="card-h"><h3>🎯 Required attendance</h3></header>
      <div class="target-chips">${[65, 70, 75, 80, 85].map(t =>
        `<button class="tchip ${u.target === t ? 'active' : ''}" data-t="${t}">${t}%</button>`).join('')}</div>
      <div class="field-row"><div class="field"><span>Custom (1–100)</span>
        <input type="number" id="targetCustom" min="1" max="100" value="${u.target}" class="mono"></div>
        <div class="field"><span>&nbsp;</span><button class="btn btn-primary full" id="saveTarget">Save target</button></div></div>
      <p class="muted sm">The target drives every prediction, warning and color in the app.</p></section>

    <section class="card"><header class="card-h"><h3>👤 Profile</h3></header>
      <div class="field"><span>Full name</span><input id="pfName" value="${esc(u.name)}" maxlength="80"></div>
      <div class="field"><span>Email (login)</span><input value="${esc(u.email)}" disabled></div>
      <div class="field"><span>College</span><input id="pfCollege" value="${esc(u.college)}" maxlength="90"></div>
      <div class="field-row">
        <div class="field"><span>Branch / Dept</span><input id="pfDept" value="${esc(u.department)}" maxlength="60"></div>
        <div class="field"><span>Year / Semester</span><input id="pfSem" value="${esc(u.semester)}" maxlength="30"></div></div>
      <button class="btn btn-primary" id="saveProfile">Save profile</button></section>

    <section class="card"><header class="card-h"><h3>📤 Export & backup</h3></header>
      <div class="row-actions" style="margin:0 0 14px">
        <a class="btn btn-soft" href="/api/export/csv">⬇️ Export CSV</a>
        <button class="btn btn-soft" id="pdfBtn">📄 Export PDF report</button>
        <a class="btn btn-soft" href="/api/export/backup">💾 Download backup (JSON)</a></div>
      <label class="file-drop">📥 Restore from backup — click to choose a .json file
        <input type="file" id="importFile" accept=".json,application/json" hidden></label></section>

    <section class="card"><header class="card-h"><h3>🔐 Session</h3></header>
      <p class="muted sm" style="margin-bottom:12px">Signed in as <b>${esc(u.email)}</b> since ${fmtLong(S.stats.totals.since)}.
      Your password is stored as a bcrypt hash — never in plain text.</p>
      <button class="btn btn-danger" id="setLogout">🚪 Log out</button></section>
  </div>`;

  $$('.tchip').forEach(ch => ch.onclick = () => { $$('.tchip').forEach(x => x.classList.remove('active')); ch.classList.add('active'); $('#targetCustom').value = ch.dataset.t; });
  $('#saveTarget').onclick = async () => {
    const t = Number($('#targetCustom').value);
    try { await api('/settings', { method: 'PUT', body: { target: t } }); await loadCore(); toast(`🎯 Target set to ${S.user.target}% — predictions updated`, 'ok'); render(); }
    catch (e) { toast(e.message, 'error'); }
  };
  $('#saveProfile').onclick = async () => {
    try {
      await api('/settings', { method: 'PUT', body: { name: $('#pfName').value, college: $('#pfCollege').value, department: $('#pfDept').value, semester: $('#pfSem').value } });
      toast('Profile saved', 'ok'); await loadCore(); render();
    } catch (e) { toast(e.message, 'error'); }
  };
  $('#pdfBtn').onclick = exportPDF;
  $('#setLogout').onclick = doLogout;
  $('#importFile').onchange = async e => {
    const f = e.target.files[0]; if (!f) return;
    try {
      const data = JSON.parse(await f.text());
      if (!await confirmModal('Restore this backup?', 'It will replace your current attendance and holidays.')) return;
      await api('/import/backup', { method: 'POST', body: data });
      toast('✅ Backup restored', 'ok'); await loadCore(); render();
    } catch (err) { toast(err instanceof SyntaxError ? 'That file is not valid JSON.' : err.message, 'error'); }
  };
});

function exportPDF() {
  const u = S.user, st = S.stats;
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>Attendance Report — ${esc(u.name)}</title>
  <style>body{font-family:Georgia,serif;color:#1a2620;max-width:720px;margin:36px auto;padding:0 20px}
  h1{font-size:26px;margin:0 0 4px} h2{font-size:17px;margin:26px 0 8px;border-bottom:2px solid #1c6b4d;padding-bottom:4px}
  p{margin:4px 0;font-size:14px} table{width:100%;border-collapse:collapse;font-size:13.5px;margin-top:8px}
  th,td{border:1px solid #cfd8cf;padding:7px 10px;text-align:left} th{background:#eef4ee}
  .big{font-size:20px;font-weight:bold;color:#1c6b4d} footer{margin-top:30px;font-size:11px;color:#778}</style></head><body>
  <h1>Attendance Report</h1>
  <p><b>${esc(u.name)}</b> · ${esc(u.college || '')}<br>${esc(u.department || '')} · ${esc(u.semester || '')}<br>
  Generated ${fmtLong(todayStr())} · Required attendance ${u.target}%</p>
  <h2>Overall</h2>
  <p>Held: ${st.overall.held} · Attended: ${st.overall.attended} · Absent: ${st.overall.absent} ·
  <span class="big">${pctTxt(st.overall.pct)}</span></p>
  <h2>Prediction</h2>
  <p>${st.overall.pct >= u.target ? `You can miss up to ${st.overall.canMiss} more classes and stay at or above ${u.target}%.`
    : `You need to attend the next ${st.overall.needed} classes without missing any to reach ${u.target}%.`}</p>
  <h2>Monthly breakdown</h2>
  <table><thead><tr><th>Month</th><th>Held</th><th>Present</th><th>Absent</th><th>%</th></tr></thead>
  <tbody>${st.monthly.map(m => `<tr><td>${monthLabel(m.month)}</td><td>${m.held}</td><td>${m.attended}</td>
    <td>${m.held - m.attended}</td><td>${pctTxt(m.pct)}</td></tr>`).join('')}</tbody></table>
  <footer>Generated by Attendly — daily attendance calculator</footer>
  <script>window.onload=function(){setTimeout(function(){window.print()},250)}<\/script></body></html>`;
  const w = window.open('', '_blank');
  if (!w) return toast('Please allow pop-ups to export the PDF.', 'error');
  w.document.write(html); w.document.close();
}

/* ================================================================
   AUTH SCREENS (simplified — 2 steps)
   ================================================================ */
const REG = { step: 1, name: '', email: '', password: '', college: '', department: '', semester: '', hasPrev: false, prevHeld: 0, prevAttended: 0, target: 75 };
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function mockCard() {
  return `<div class="mock-card">
    <div class="mock-top mono"><span>TODAY · TIMETABLE</span><span class="chip st-safe mono" style="border:none">ON TRACK</span></div>
    <div class="mock-row"><i>P1</i><b>Mathematics</b><em class="ok">✓</em></div>
    <div class="mock-row"><i>P2</i><b>Physics</b><em class="ok">✓</em></div>
    <div class="mock-row"><i>P3</i><b>DBMS</b><em class="no">✕</em></div>
    <div class="mock-row"><i>P4</i><b>English</b><em class="ok">✓</em></div>
    <div class="mock-foot">${ringHTML(83.33, 74)}
      <div><b class="mono">83.33%</b><span>overall · “you can miss 4 more classes”</span></div></div></div>`;
}

function renderAuth(mode) {
  const side = `<aside class="auth-side">
    <div class="brand"><span class="logo">✓</span>Attendly</div>
    <h1>Track every period. Survive the 75% rule.</h1>
    <p>Mark each subject on your daily timetable, skip Sundays, mark holidays, and always know exactly how many classes you can safely miss.</p>
    ${mockCard()}</aside>`;
  $('#app').innerHTML = `<div class="auth">${side}<section class="auth-main"><div class="auth-card" id="authBox"></div></section></div>`;
  if (mode === 'register') regRender(); else loginRender();
  countUps(document);
}

function loginRender() {
  $('#authBox').innerHTML = `<h2>Welcome back 👋</h2><p class="muted sm">Log in to your dashboard</p>
    <form id="loginForm">
      <div class="field"><span>Email</span><input id="liEmail" type="email" placeholder="you@college.edu" required></div>
      <div class="field"><span>Password</span><input id="liPass" type="password" placeholder="••••••••" required></div>
      <button class="btn btn-primary full" style="margin-top:6px">Log in →</button></form>
    <p class="switch">New here? <a href="#/register">Create an account</a></p>
    <div class="demo-hint">Try the demo account → <b class="mono">demo@campus.edu</b> / <b class="mono">demo1234</b>
      <button class="linkish" id="fillDemo" style="display:block;margin:4px auto 0">fill it in for me</button></div>`;
  $('#fillDemo').onclick = () => { $('#liEmail').value = 'demo@campus.edu'; $('#liPass').value = 'demo1234'; };
  $('#loginForm').onsubmit = async e => {
    e.preventDefault();
    try {
      const { user } = await api('/auth/login', { method: 'POST', body: { email: $('#liEmail').value, password: $('#liPass').value } });
      S.user = user; await loadCore(); location.hash = '#/dashboard'; render();
      toast(`Welcome back, ${user.name.split(' ')[0]}! 👋`, 'ok');
    } catch (err) { toast(err.message, 'error'); }
  };
}

function stepsHTML() {
  const labels = ['Profile', 'Attendance data'];
  return `<div class="steps">${labels.map((l, i) =>
    `<div class="step ${REG.step === i + 1 ? 'on' : REG.step > i + 1 ? 'done' : ''}">${i + 1}. ${l}</div>`).join('')}</div>`;
}

function regRender() {
  const box = $('#authBox');
  if (REG.step === 1) {
    box.innerHTML = `<h2>Create your account</h2><p class="muted sm">Step 1 — the basics</p>${stepsHTML()}
      <div class="field"><span>Full name</span><input id="rgName" value="${esc(REG.name)}" placeholder="e.g. Devaraj Kumar"></div>
      <div class="field"><span>Email</span><input id="rgEmail" type="email" value="${esc(REG.email)}" placeholder="you@college.edu"></div>
      <div class="field"><span>Password</span><input id="rgPass" type="password" placeholder="at least 6 characters"></div>
      <div class="field"><span>College name</span><input id="rgCollege" value="${esc(REG.college)}" placeholder="e.g. Sunrise Institute of Technology"></div>
      <div class="field-row">
        <div class="field"><span>Branch / Dept</span><input id="rgDept" value="${esc(REG.department)}" placeholder="CSE"></div>
        <div class="field"><span>Year / Semester</span><input id="rgSem" value="${esc(REG.semester)}" placeholder="Semester 4"></div></div>
      <div class="auth-foot"><a class="btn btn-ghost" href="#/login">← Log in</a><button class="btn btn-primary" id="rgNext">Continue →</button></div>`;
    $('#rgNext').onclick = () => {
      REG.name = $('#rgName').value.trim(); REG.email = $('#rgEmail').value.trim(); REG.password = $('#rgPass').value;
      REG.college = $('#rgCollege').value.trim(); REG.department = $('#rgDept').value.trim(); REG.semester = $('#rgSem').value.trim();
      if (REG.name.length < 2) return toast('Please enter your full name.', 'error');
      if (!EMAIL_RE.test(REG.email)) return toast('Please enter a valid email.', 'error');
      if (REG.password.length < 6) return toast('Password must be at least 6 characters.', 'error');
      REG.step = 2; regRender();
    };
  } else {
    const livePct = REG.hasPrev && REG.prevHeld > 0 ? (REG.prevAttended / REG.prevHeld * 100).toFixed(1) + '%' : '—';
    box.innerHTML = `<h2>Starting point</h2><p class="muted sm">Step 2 — import old numbers or start fresh, and pick your target</p>${stepsHTML()}
      <div class="rcards">
        <div class="rcard ${REG.hasPrev ? 'on' : ''}" data-v="1"><b>📖 I have previous data</b>Import held / attended totals</div>
        <div class="rcard ${!REG.hasPrev ? 'on' : ''}" data-v="0"><b>🌱 Start from zero</b>Track everything from today</div></div>
      ${REG.hasPrev ? `<div class="prev-row" style="margin-top:10px">
        <b>Overall</b>
        <input type="number" id="regPH" min="0" placeholder="Classes held" value="${REG.prevHeld}" class="mono">
        <input type="number" id="regPA" min="0" placeholder="Attended" value="${REG.prevAttended}" class="mono">
        <span class="pc mono" id="regPC">${livePct}</span></div>` : ''}
      <div class="field" style="margin-top:16px"><span>Required attendance %</span>
        <div class="target-chips">${[65, 70, 75, 80, 85].map(t => `<button class="tchip ${REG.target === t ? 'active' : ''}" data-t="${t}">${t}%</button>`).join('')}
        <input type="number" id="rgTarget" min="1" max="100" value="${REG.target}" style="width:86px" class="mono"></div></div>
      <div class="auth-foot"><button class="btn btn-ghost" id="rgBack">← Back</button><button class="btn btn-primary" id="rgGo">🚀 Create account</button></div>`;

    $$('.rcard').forEach(rc => rc.onclick = () => { REG.hasPrev = rc.dataset.v === '1'; regRender(); });
    $$('.tchip').forEach(ch => ch.onclick = () => { REG.target = +ch.dataset.t; $('#rgTarget').value = ch.dataset.t; $$('.tchip').forEach(x => x.classList.toggle('active', x === ch)); });
    $('#rgTarget').oninput = e => { REG.target = +e.target.value || 75; $$('.tchip').forEach(x => x.classList.toggle('active', +x.dataset.t === REG.target)); };
    if (REG.hasPrev) {
      const updateLive = () => {
        REG.prevHeld = +$('#regPH').value || 0;
        REG.prevAttended = +$('#regPA').value || 0;
        const pc = $('#regPC');
        pc.textContent = REG.prevHeld > 0 ? (REG.prevAttended / REG.prevHeld * 100).toFixed(1) + '%' : '—';
        pc.style.color = REG.prevAttended > REG.prevHeld ? 'var(--bad)' : '';
      };
      $('#regPH').oninput = updateLive;
      $('#regPA').oninput = updateLive;
    }
    $('#rgBack').onclick = () => { REG.step = 1; regRender(); };
    $('#rgGo').onclick = async () => {
      const ph = REG.hasPrev ? REG.prevHeld : 0, pa = REG.hasPrev ? REG.prevAttended : 0;
      if (pa > ph) return toast('Classes attended can\'t exceed classes held.', 'error');
      if (ph < 0 || pa < 0) return toast('Numbers can\'t be negative.', 'error');
      try {
        const { user } = await api('/auth/register', { method: 'POST', body: {
          name: REG.name, email: REG.email, password: REG.password,
          college: REG.college, department: REG.department, semester: REG.semester,
          prevHeld: ph, prevAttended: pa, target: REG.target
        }});
        S.user = user; await loadCore(); location.hash = '#/dashboard'; render();
        toast(`Welcome to Attendly, ${user.name.split(' ')[0]}! 🎉`, 'ok');
      } catch (err) { toast(err.message, 'error'); }
    };
  }
}

/* ================================================================
   BOOT
   ================================================================ */
(async function boot() {
  document.documentElement.dataset.theme = S.theme;
  try { await loadCore(); } catch (e) { resetState(); }
  if (!location.hash) location.hash = S.loaded ? '#/dashboard' : '#/login';
  render();
})();