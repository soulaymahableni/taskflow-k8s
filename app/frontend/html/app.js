'use strict';
// TaskFlow – application monopage : accueil, inscription, connexion, dashboard.
// Tous les appels passent par /api/ (relayés par nginx vers le Service api-svc).

const API = '/api';
const $app = document.getElementById('app');
const state = { user: null, tasks: [], stats: null, filter: 'all', search: '', sort: 'smart' };

// ---------- Utilitaires ----------
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const token = {
  get: () => { try { return localStorage.getItem('tf_token'); } catch { return null; } },
  set: (t) => { try { localStorage.setItem('tf_token', t); } catch {} },
  clear: () => { try { localStorage.removeItem('tf_token'); } catch {} },
};

async function api(method, path, body) {
  const headers = { 'Content-Type': 'application/json' };
  const t = token.get();
  if (t) headers.Authorization = 'Bearer ' + t;
  const res = await fetch(API + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  if (res.status === 401 && path !== '/auth/login') {
    token.clear(); state.user = null;
    if (location.hash.startsWith('#/dashboard')) location.hash = '#/login';
  }
  if (res.status === 204) return null;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Erreur ' + res.status);
  return data;
}

let toastTimer;
function toast(msg, isErr = false) {
  const el = document.getElementById('toast');
  el.textContent = msg; el.className = 'toast' + (isErr ? ' err' : ''); el.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => (el.hidden = true), 2600);
}

const PRIO = { high: 'Haute', medium: 'Moyenne', low: 'Basse' };
const today = () => new Date().toISOString().slice(0, 10);
function fmtDate(d) {
  if (!d) return '';
  return new Date(d.slice(0, 10) + 'T00:00:00').toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });
}
const initials = (n) => (n || '?').split(/\s+/).map((p) => p[0]).join('').slice(0, 2).toUpperCase();
const brand = () => `<a class="brand" href="#/"><span class="logo">✓</span>TaskFlow</a>`;

// ---------- Routeur ----------
const routes = { '': home, '#/': home, '#/login': login, '#/register': register, '#/dashboard': dashboard };
async function router() {
  const view = routes[location.hash] || home;
  if (view === dashboard && !token.get()) { location.hash = '#/login'; return; }
  if ((view === login || view === register) && token.get()) { location.hash = '#/dashboard'; return; }
  window.scrollTo(0, 0);
  await view();
}
window.addEventListener('hashchange', router);

// ---------- Page d'accueil ----------
function home() {
  const logged = !!token.get();
  $app.innerHTML = `
  <header class="nav">
    ${brand()}
    <nav class="nav-links">
      ${logged
        ? `<a class="btn" href="#/dashboard">Mon dashboard</a>`
        : `<a class="btn ghost" href="#/login">Se connecter</a><a class="btn" href="#/register">Créer un compte</a>`}
    </nav>
  </header>

  <section class="hero">
    <div>
      <span class="pill">🚀 Simple, rapide et gratuit</span>
      <h1>Organisez votre travail, <span>atteignez vos objectifs.</span></h1>
      <p>TaskFlow vous aide à planifier vos tâches, fixer des priorités et suivre votre progression depuis un tableau de bord clair.</p>
      <div class="hero-actions">
        <a class="btn lg" href="#/register">Commencer gratuitement</a>
        <a class="btn ghost lg" href="#/login">J'ai déjà un compte</a>
      </div>
    </div>
    <div class="mock" aria-hidden="true">
      <div class="mock-stats">
        <div class="mock-stat"><b>12</b><small>Tâches</small></div>
        <div class="mock-stat"><b style="color:var(--success)">8</b><small>Terminées</small></div>
        <div class="mock-stat"><b style="color:var(--primary)">67%</b><small>Progression</small></div>
      </div>
      <div class="mock-row ok"><i class="dot"></i><span>Préparer le compte rendu</span><b class="badge low">Basse</b></div>
      <div class="mock-row"><i class="dot"></i><span>Déployer sur Kubernetes</span><b class="badge high">Haute</b></div>
      <div class="mock-row"><i class="dot"></i><span>Configurer les NetworkPolicies</span><b class="badge medium">Moyenne</b></div>
      <div class="mock-row ok"><i class="dot"></i><span>Tester la sauvegarde</span><b class="badge medium">Moyenne</b></div>
    </div>
  </section>

  <section class="section">
    <h2>Tout ce qu'il vous faut</h2>
    <p class="sub">Des outils simples pour rester concentré sur l'essentiel.</p>
    <div class="features">
      <div class="feature"><div class="ico">📋</div><h3>Gestion des tâches</h3><p>Créez, modifiez, terminez ou supprimez vos tâches en un clic, avec description et échéance.</p></div>
      <div class="feature"><div class="ico">🎯</div><h3>Priorités</h3><p>Classez vos tâches en priorité haute, moyenne ou basse pour savoir quoi faire en premier.</p></div>
      <div class="feature"><div class="ico">📊</div><h3>Tableau de bord</h3><p>Suivez votre progression, vos tâches en retard et vos statistiques en temps réel.</p></div>
    </div>
  </section>

  <section class="cta">
    <h2>Prêt à être plus productif ?</h2>
    <p>Créez votre compte en moins d'une minute.</p>
    <a class="btn light lg" href="#/register">Créer mon compte</a>
  </section>
  <footer class="footer">© ${new Date().getFullYear()} TaskFlow – Mini-projet Kubernetes</footer>`;
}

// ---------- Inscription / Connexion ----------
function authLayout(inner) {
  return `
  <div class="auth-wrap">
    <aside class="auth-side">
      ${brand()}
      <div>
        <h2>Vos tâches, vos priorités, votre rythme.</h2>
        <p>Rejoignez TaskFlow et gardez une vue claire sur tout ce que vous avez à faire.</p>
      </div>
      <small style="opacity:.7">© ${new Date().getFullYear()} TaskFlow</small>
    </aside>
    <main class="auth-main"><div class="auth-card">${inner}</div></main>
  </div>`;
}

function register() {
  $app.innerHTML = authLayout(`
    <h1>Créer un compte</h1>
    <p class="sub">Commencez à organiser vos tâches dès aujourd'hui.</p>
    <div id="err" class="error-box" hidden></div>
    <form id="f">
      <div class="field"><label for="name">Nom complet</label><input id="name" required placeholder="Ex. Soulayma Ben Ali" autocomplete="name"></div>
      <div class="field"><label for="email">Email</label><input id="email" type="email" required placeholder="vous@exemple.com" autocomplete="email"></div>
      <div class="field"><label for="pw">Mot de passe</label><input id="pw" type="password" required minlength="6" placeholder="6 caractères minimum" autocomplete="new-password"></div>
      <div class="field"><label for="pw2">Confirmer le mot de passe</label><input id="pw2" type="password" required minlength="6" autocomplete="new-password"></div>
      <button class="btn block lg" id="sub">Créer mon compte</button>
    </form>
    <p class="switch">Déjà inscrit ? <a href="#/login">Se connecter</a></p>`);
  document.getElementById('f').onsubmit = (e) => submitAuth(e, async () => {
    const pw = val('pw');
    if (pw !== val('pw2')) throw new Error('Les mots de passe ne correspondent pas');
    return api('POST', '/auth/register', { name: val('name'), email: val('email'), password: pw });
  }, 'Bienvenue sur TaskFlow 🎉');
}

function login() {
  $app.innerHTML = authLayout(`
    <h1>Bon retour 👋</h1>
    <p class="sub">Connectez-vous pour accéder à votre tableau de bord.</p>
    <div id="err" class="error-box" hidden></div>
    <form id="f">
      <div class="field"><label for="email">Email</label><input id="email" type="email" required placeholder="vous@exemple.com" autocomplete="email"></div>
      <div class="field"><label for="pw">Mot de passe</label><input id="pw" type="password" required autocomplete="current-password"></div>
      <button class="btn block lg" id="sub">Se connecter</button>
    </form>
    <p class="switch">Pas encore de compte ? <a href="#/register">Créer un compte</a></p>`);
  document.getElementById('f').onsubmit = (e) => submitAuth(e,
    () => api('POST', '/auth/login', { email: val('email'), password: val('pw') }), 'Connexion réussie');
}

const val = (id) => document.getElementById(id).value;
async function submitAuth(e, fn, okMsg) {
  e.preventDefault();
  const btn = document.getElementById('sub'), err = document.getElementById('err');
  btn.disabled = true; err.hidden = true;
  try {
    const data = await fn();
    token.set(data.token); state.user = data.user;
    toast(okMsg);
    location.hash = '#/dashboard';
  } catch (ex) {
    err.textContent = ex.message; err.hidden = false;
  } finally { btn.disabled = false; }
}

function logout() {
  token.clear(); state.user = null; state.tasks = [];
  toast('Vous êtes déconnecté');
  location.hash = '#/';
}

// ---------- Dashboard ----------
async function dashboard() {
  $app.innerHTML = `<div class="empty" style="padding-top:120px">Chargement…</div>`;
  try {
    if (!state.user) state.user = await api('GET', '/auth/me');
    await refresh(false);
  } catch (e) {
    if (!token.get()) return;
    $app.innerHTML = `<div class="empty" style="padding-top:120px"><div class="big">⚠️</div>Impossible de joindre l'API : ${esc(e.message)}<br><br><button class="btn" onclick="router()">Réessayer</button></div>`;
    return;
  }
  renderDashboard();
}

async function refresh(render = true) {
  const [tasks, stats] = await Promise.all([api('GET', '/tasks'), api('GET', '/stats')]);
  state.tasks = tasks; state.stats = stats;
  if (render) renderDashboard();
}

function filteredTasks() {
  const t = today(), q = state.search.toLowerCase();
  let list = state.tasks.filter((x) => {
    if (state.filter === 'pending' && x.done) return false;
    if (state.filter === 'done' && !x.done) return false;
    if (state.filter === 'overdue' && (x.done || !x.due_date || x.due_date.slice(0, 10) >= t)) return false;
    if (state.filter === 'high' && (x.done || x.priority !== 'high')) return false;
    return !q || x.title.toLowerCase().includes(q) || x.description.toLowerCase().includes(q);
  });
  if (state.sort === 'date') list = [...list].sort((a, b) => (a.due_date || '9999').localeCompare(b.due_date || '9999'));
  if (state.sort === 'recent') list = [...list].sort((a, b) => b.id - a.id);
  return list;
}

function renderDashboard() {
  const s = state.stats || { total: 0, done: 0, pending: 0, overdue: 0, high: 0 };
  const pct = s.total ? Math.round((s.done / s.total) * 100) : 0;
  const u = state.user || {};
  const hour = new Date().getHours();
  const hello = hour < 18 ? 'Bonjour' : 'Bonsoir';
  const views = [
    ['all', '🗂️', 'Toutes les tâches', s.total],
    ['pending', '⏳', 'En cours', s.pending],
    ['done', '✅', 'Terminées', s.done],
    ['overdue', '⚠️', 'En retard', s.overdue],
    ['high', '🔥', 'Priorité haute', s.high],
  ];
  const titles = Object.fromEntries(views.map((v) => [v[0], v[2]]));
  const list = filteredTasks();

  $app.innerHTML = `
  <div class="layout">
    <aside class="sidebar">
      ${brand()}
      ${views.map(([k, ico, label, n]) => `
        <button class="side-link ${state.filter === k ? 'active' : ''}" data-filter="${k}">
          <span>${ico}</span>${label}<span class="count">${n}</span>
        </button>`).join('')}
      <div class="spacer"></div>
      <div class="user-box">
        <div class="avatar">${esc(initials(u.name))}</div>
        <div class="who"><b>${esc(u.name)}</b><small>${esc(u.email)}</small></div>
      </div>
      <button class="side-link" id="logout"><span>🚪</span>Se déconnecter</button>
    </aside>

    <div>
      <div class="mobile-top">
        ${brand()}
        <button class="btn ghost" id="logout-m">Déconnexion</button>
      </div>
      <main class="main">
        <div class="topbar">
          <div>
            <h1>${hello}, ${esc((u.name || '').split(' ')[0])} 👋</h1>
            <p>${s.pending ? `Vous avez ${s.pending} tâche${s.pending > 1 ? 's' : ''} en cours${s.overdue ? `, dont ${s.overdue} en retard` : ''}.` : 'Tout est à jour, bravo !'}</p>
          </div>
          <button class="btn" id="new">＋ Nouvelle tâche</button>
        </div>

        <div class="stats">
          <div class="stat"><div class="label"><i style="background:var(--primary)"></i>Total</div><div class="value">${s.total}</div></div>
          <div class="stat"><div class="label"><i style="background:var(--warning)"></i>En cours</div><div class="value">${s.pending}</div></div>
          <div class="stat"><div class="label"><i style="background:var(--success)"></i>Terminées</div><div class="value">${s.done}</div></div>
          <div class="stat"><div class="label"><i style="background:var(--danger)"></i>En retard</div><div class="value">${s.overdue}</div></div>
        </div>

        <div class="progress-card">
          <div class="progress-head"><span>Progression globale</span><span>${pct}%</span></div>
          <div class="bar"><div style="width:${pct}%"></div></div>
        </div>

        <div class="panel">
          <div class="toolbar">
            <input id="search" placeholder="🔍 Rechercher une tâche…" value="${esc(state.search)}">
            <select id="filter-m" aria-label="Filtre">
              ${views.map(([k, , label]) => `<option value="${k}" ${state.filter === k ? 'selected' : ''}>${label}</option>`).join('')}
            </select>
            <select id="sort" aria-label="Tri">
              <option value="smart" ${state.sort === 'smart' ? 'selected' : ''}>Tri : priorité</option>
              <option value="date" ${state.sort === 'date' ? 'selected' : ''}>Tri : échéance</option>
              <option value="recent" ${state.sort === 'recent' ? 'selected' : ''}>Tri : plus récentes</option>
            </select>
          </div>
          <h3 style="margin:0 0 12px">${titles[state.filter]} <span style="color:var(--muted);font-weight:500">(${list.length})</span></h3>
          <div id="list">${list.length ? list.map(taskHtml).join('') : emptyHtml()}</div>
        </div>
      </main>
    </div>
  </div>`;

  document.querySelectorAll('[data-filter]').forEach((b) => (b.onclick = () => { state.filter = b.dataset.filter; renderDashboard(); }));
  document.getElementById('filter-m').onchange = (e) => { state.filter = e.target.value; renderDashboard(); };
  document.getElementById('sort').onchange = (e) => { state.sort = e.target.value; renderDashboard(); };
  const search = document.getElementById('search');
  search.oninput = (e) => {
    state.search = e.target.value;
    const l = filteredTasks();
    document.getElementById('list').innerHTML = l.length ? l.map(taskHtml).join('') : emptyHtml();
    bindTasks();
  };
  document.getElementById('new').onclick = () => openModal();
  document.getElementById('logout').onclick = logout;
  document.getElementById('logout-m').onclick = logout;
  bindTasks();
}

function emptyHtml() {
  return state.tasks.length
    ? `<div class="empty"><div class="big">🔎</div>Aucune tâche ne correspond à ce filtre.</div>`
    : `<div class="empty"><div class="big">📝</div><b>Aucune tâche pour l'instant</b><br>Cliquez sur « Nouvelle tâche » pour commencer.</div>`;
}

function taskHtml(t) {
  const late = !t.done && t.due_date && t.due_date.slice(0, 10) < today();
  return `
  <div class="task ${t.done ? 'done' : ''}" data-id="${t.id}">
    <button class="check" data-act="toggle" title="${t.done ? 'Marquer en cours' : 'Marquer terminée'}">${t.done ? '✓' : ''}</button>
    <div class="body">
      <div class="title">${esc(t.title)}</div>
      ${t.description ? `<div class="desc">${esc(t.description)}</div>` : ''}
      <div class="meta">
        <span class="badge ${t.priority}">${PRIO[t.priority]}</span>
        ${t.due_date ? `<span class="badge ${late ? 'late' : 'date'}">📅 ${fmtDate(t.due_date)}${late ? ' · en retard' : ''}</span>` : ''}
      </div>
    </div>
    <div class="actions">
      <button class="icon-btn" data-act="edit" title="Modifier">✏️</button>
      <button class="icon-btn del" data-act="delete" title="Supprimer">🗑️</button>
    </div>
  </div>`;
}

function bindTasks() {
  document.querySelectorAll('.task').forEach((el) => {
    const id = Number(el.dataset.id);
    const t = state.tasks.find((x) => x.id === id);
    el.querySelectorAll('[data-act]').forEach((b) => (b.onclick = async () => {
      try {
        if (b.dataset.act === 'toggle') {
          await api('PUT', '/tasks/' + id, { done: !t.done });
          toast(t.done ? 'Tâche remise en cours' : 'Tâche terminée ✅');
          await refresh();
        } else if (b.dataset.act === 'edit') {
          openModal(t);
        } else if (b.dataset.act === 'delete') {
          openConfirm(t);
        }
      } catch (e) { toast(e.message, true); }
    }));
  });
}

// ---------- Fenêtres modales ----------
function closeModal() { document.querySelector('.modal-bg')?.remove(); }

function openModal(t = null) {
  closeModal();
  const bg = document.createElement('div');
  bg.className = 'modal-bg';
  bg.innerHTML = `
    <form class="modal" id="mf">
      <h2>${t ? 'Modifier la tâche' : 'Nouvelle tâche'}</h2>
      <div class="field"><label for="m-title">Titre *</label><input id="m-title" required maxlength="200" value="${esc(t?.title)}" placeholder="Ex. Préparer la démonstration"></div>
      <div class="field"><label for="m-desc">Description</label><textarea id="m-desc" placeholder="Détails (facultatif)">${esc(t?.description)}</textarea></div>
      <div class="row2">
        <div class="field"><label for="m-prio">Priorité</label>
          <select id="m-prio">${Object.entries(PRIO).map(([k, v]) => `<option value="${k}" ${(t?.priority || 'medium') === k ? 'selected' : ''}>${v}</option>`).join('')}</select>
        </div>
        <div class="field"><label for="m-date">Échéance</label><input id="m-date" type="date" value="${t?.due_date ? t.due_date.slice(0, 10) : ''}"></div>
      </div>
      <div class="modal-actions">
        <button type="button" class="btn ghost" id="m-cancel">Annuler</button>
        <button class="btn" id="m-save">${t ? 'Enregistrer' : 'Ajouter la tâche'}</button>
      </div>
    </form>`;
  document.body.appendChild(bg);
  bg.onclick = (e) => { if (e.target === bg) closeModal(); };
  document.getElementById('m-cancel').onclick = closeModal;
  document.getElementById('m-title').focus();
  document.getElementById('mf').onsubmit = async (e) => {
    e.preventDefault();
    const body = {
      title: val('m-title'), description: val('m-desc'),
      priority: val('m-prio'), due_date: val('m-date') || null,
    };
    const btn = document.getElementById('m-save'); btn.disabled = true;
    try {
      if (t) { await api('PUT', '/tasks/' + t.id, body); toast('Tâche modifiée'); }
      else { await api('POST', '/tasks', body); toast('Tâche ajoutée'); }
      closeModal(); await refresh();
    } catch (ex) { toast(ex.message, true); btn.disabled = false; }
  };
}

function openConfirm(t) {
  closeModal();
  const bg = document.createElement('div');
  bg.className = 'modal-bg';
  bg.innerHTML = `
    <div class="modal">
      <h2>Supprimer la tâche ?</h2>
      <p style="color:var(--muted);margin-top:-6px">« ${esc(t.title)} » sera définitivement supprimée.</p>
      <div class="modal-actions">
        <button class="btn ghost" id="c-no">Annuler</button>
        <button class="btn danger" id="c-yes">Supprimer</button>
      </div>
    </div>`;
  document.body.appendChild(bg);
  bg.onclick = (e) => { if (e.target === bg) closeModal(); };
  document.getElementById('c-no').onclick = closeModal;
  document.getElementById('c-yes').onclick = async () => {
    try { await api('DELETE', '/tasks/' + t.id); toast('Tâche supprimée'); closeModal(); await refresh(); }
    catch (e) { toast(e.message, true); }
  };
}

document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeModal(); });

router();
