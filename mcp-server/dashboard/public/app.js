/* Dokpilot Companion Dashboard — frontend (hi-fi-static prototype)
   Backend (Phase E) replaces MOCK_DATA with /api/* calls + SSE streams.
   Routes (hash-based): #/ S1 dashboard · #/app/<id> S2 detail · #/wizard S3
   · #/empty S4 · #/disconnected S5
*/

const MOCK_DATA = {
  meta: {
    version: 'v4.0.0',
    port: 52114,
    launchedAt: '2026-05-24T12:18:43Z',
    token: 'a8f0…c4d1', // masked display only
  },
  servers: [
    {
      name: 'main',
      ip: '77.90.43.8',
      ssh_user: 'root',
      dokploy_url: 'http://77.90.43.8:3000',
      dokploy_version: 'v0.29.5',
      status: 'healthy',
      secret_source: 'keychain',
      is_default: true,
      apps: [
        {
          id: 'app_001',
          name: 'kyzdes-portfolio',
          domain: 'kyzdes.com',
          stack: 'Next.js 15',
          status: 'running',
          last_deploy: '2026-05-24T08:12:00Z',
          last_deploy_rel: '4h ago',
          builds_today: 1,
          env_keys: ['NEXT_PUBLIC_API_URL', 'NEXT_PUBLIC_SENTRY_DSN', 'NODE_ENV', 'NEXTAUTH_SECRET', 'NEXTAUTH_URL', 'STRIPE_PUBLIC_KEY'],
        },
        {
          id: 'app_002',
          name: 'freezer-backend',
          domain: 'api.freezer.app',
          stack: 'Node + Express',
          status: 'running',
          last_deploy: '2026-05-23T21:44:00Z',
          last_deploy_rel: '14h ago',
          builds_today: 0,
          env_keys: ['DATABASE_URL', 'JWT_SECRET', 'PORT', 'REDIS_URL', 'SMTP_HOST', 'SMTP_USER', 'SMTP_PASS', 'NODE_ENV'],
        },
        {
          id: 'app_003',
          name: 'dokpilot-landing',
          domain: 'dokpilot.dev',
          stack: 'Astro 4',
          status: 'building',
          last_deploy: '2026-05-24T11:30:00Z',
          last_deploy_rel: '54m ago',
          builds_today: 3,
          env_keys: ['PUBLIC_PLAUSIBLE_DOMAIN', 'NODE_ENV'],
        },
      ],
    },
    {
      name: 'edge',
      ip: '185.22.64.10',
      ssh_user: 'root',
      dokploy_url: 'http://185.22.64.10:3000',
      dokploy_version: 'v0.28.4',
      status: 'healthy',
      secret_source: 'keychain',
      is_default: false,
      apps: [
        {
          id: 'app_004',
          name: 'logbook-api',
          domain: 'logs.kyzdes.dev',
          stack: 'FastAPI · Python 3.12',
          status: 'running',
          last_deploy: '2026-05-22T14:08:00Z',
          last_deploy_rel: '2d ago',
          builds_today: 0,
          env_keys: ['DATABASE_URL', 'SECRET_KEY', 'ALLOWED_HOSTS', 'SENTRY_DSN'],
        },
        {
          id: 'app_005',
          name: 'metrics-collector',
          domain: null,
          stack: 'Docker compose',
          status: 'error',
          last_deploy: '2026-05-24T03:00:00Z',
          last_deploy_rel: '9h ago',
          builds_today: 4,
          env_keys: ['PROMETHEUS_URL', 'GRAFANA_TOKEN', 'INFLUX_TOKEN'],
        },
      ],
    },
  ],
  active_job: {
    id: 'job_a1b2c3',
    repo: 'github.com/kyzdes/notes-app',
    branch: 'main',
    server: 'main',
    domain: 'notes.kyzdes.dev',
    status: 'awaiting-answers',
    started_at: '2026-05-24T12:34:00Z',
    elapsed_ms: 41000,
    detected_stack: 'Next.js 15 · pnpm · Node 20',
    steps: [
      { id: 'detect',    label: 'Detect stack',    status: 'done',    duration_ms: 4200 },
      { id: 'questions', label: 'Await answers',   status: 'active' },
      { id: 'deploy',    label: 'Deploying',       status: 'pending' },
      { id: 'dns',       label: 'DNS + SSL',       status: 'pending' },
      { id: 'finalize',  label: 'Finalize',        status: 'pending' },
    ],
    questions: [
      {
        id: 'q1',
        label: 'NEXT_PUBLIC_API_URL',
        type: 'text',
        placeholder: 'https://api.notes.kyzdes.dev',
        hint: 'Build-time public API endpoint',
        required: true,
      },
      {
        id: 'q2',
        label: 'Database',
        type: 'select',
        options: [
          { value: 'postgres-15', label: 'postgres 15 (recommended)' },
          { value: 'sqlite',      label: 'sqlite (file-based)' },
          { value: 'none',        label: 'no database' },
        ],
        required: true,
      },
      {
        id: 'q3',
        label: 'Auto-deploy on push',
        type: 'select',
        options: [
          { value: 'true',  label: 'yes — install GitHub App' },
          { value: 'false', label: 'no — manual deploys only' },
        ],
        required: true,
      },
    ],
    log_tail: [
      { t: '12:34:02', kind: 'info',  text: 'Cloning github.com/kyzdes/notes-app (branch: main)…' },
      { t: '12:34:05', kind: 'info',  text: 'Cloned (4.2s · 18 objects · 612 KB)' },
      { t: '12:34:06', kind: 'info',  text: 'Detecting stack…' },
      { t: '12:34:06', kind: 'ok',    text: 'Found package.json' },
      { t: '12:34:06', kind: 'ok',    text: 'Found pnpm-lock.yaml' },
      { t: '12:34:07', kind: 'ok',    text: 'Next.js 15 detected (App Router, server actions)' },
      { t: '12:34:07', kind: 'ok',    text: 'Node version: 20.x (from .nvmrc)' },
      { t: '12:34:08', kind: 'warn',  text: '3 required env vars missing — pausing for input' },
      { t: '12:34:08', kind: 'info',  text: 'Awaiting answers via dashboard…' },
    ],
  },
  recent_deployments: [
    { id: 'd_010', app: 'kyzdes-portfolio',  server: 'main', status: 'success',  rel: '2m ago',   duration: '47s' },
    { id: 'd_009', app: 'dokpilot-landing',  server: 'main', status: 'building', rel: '5m ago',   duration: '…'   },
    { id: 'd_008', app: 'logbook-api',       server: 'edge', status: 'success',  rel: '1h ago',   duration: '1m 12s' },
    { id: 'd_007', app: 'metrics-collector', server: 'edge', status: 'error',    rel: '9h ago',   duration: '6s'  },
    { id: 'd_006', app: 'freezer-backend',   server: 'main', status: 'success',  rel: '14h ago',  duration: '52s' },
    { id: 'd_005', app: 'kyzdes-portfolio',  server: 'main', status: 'success',  rel: '22h ago',  duration: '49s' },
    { id: 'd_004', app: 'dokpilot-landing',  server: 'main', status: 'success',  rel: '1d ago',   duration: '38s' },
  ],
  // Per-app deploy histories for S2 Deploys tab
  app_deploys: {
    app_001: [
      { id: 'd_010', sha: 'a1f4c3e', branch: 'main', status: 'success',  rel: '2m ago',  duration: '47s', msg: 'feat: switch hero copy to neon-green' },
      { id: 'd_005', sha: '7e9b218', branch: 'main', status: 'success',  rel: '22h ago', duration: '49s', msg: 'chore: bump dependencies' },
      { id: 'd_xa1', sha: '3c1d077', branch: 'main', status: 'success',  rel: '3d ago',  duration: '51s', msg: 'fix: image OG fallback'},
      { id: 'd_xa0', sha: 'ff882a4', branch: 'feat/blog', status: 'error', rel: '5d ago', duration: '13s', msg: 'feat(blog): MDX pipeline'},
    ],
    app_002: [
      { id: 'd_006', sha: '5520ee8', branch: 'main', status: 'success',  rel: '14h ago', duration: '52s', msg: 'fix: SMTP timeout on cold start' },
    ],
    app_003: [
      { id: 'd_009', sha: '88b4197', branch: 'main', status: 'building', rel: '5m ago',  duration: '…',   msg: 'wip: dashboard section + brand swap' },
      { id: 'd_004', sha: '2a07ff1', branch: 'main', status: 'success',  rel: '1d ago',  duration: '38s', msg: 'feat: evolution timeline v4 entry' },
    ],
    app_004: [
      { id: 'd_008', sha: 'b71f330', branch: 'main', status: 'success',  rel: '1h ago',  duration: '1m 12s', msg: 'perf: cache log indexing' },
    ],
    app_005: [
      { id: 'd_007', sha: 'cc4ab90', branch: 'main', status: 'error',    rel: '9h ago',  duration: '6s',  msg: 'fix: prometheus scrape config' },
    ],
  },
  app_log_tail: {
    app_003: [
      { t: '11:30:02', kind: 'info', text: 'Build start: 88b4197 on main' },
      { t: '11:30:04', kind: 'info', text: 'pnpm install (frozen-lockfile)…' },
      { t: '11:30:43', kind: 'ok',   text: 'Dependencies resolved (41s · 412 packages)' },
      { t: '11:30:44', kind: 'info', text: 'Running build…' },
      { t: '11:31:14', kind: 'info', text: '[astro] generating static routes (32/64)…' },
    ],
  },
};

/* ─── utilities ─────────────────────────────────────────────────────── */
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
const el = (tag, attrs, ...children) => {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'html') node.innerHTML = v;
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'style' && typeof v === 'object') Object.assign(node.style, v);
    else node.setAttribute(k, v);
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    node.appendChild(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return node;
};
const escapeHTML = (s) => String(s).replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

/* ─── tweaks (persisted to localStorage) ───────────────────────────── */
const TWEAKS_KEY = 'dokpilot:tweaks';
const DEFAULT_TWEAKS = {
  theme: 'dark',           // dark | light
  accent: 'neon',          // neon | soft
  density: 'comfortable',  // compact | comfortable | spacious
  secretBadge: 'on',       // on | off
  activityFeed: 'visible', // visible | collapsed
  defaultTab: 'deploys',   // deploys | env | logs
  stepperOrient: 'horizontal', // horizontal | vertical
  autoScrollLog: 'on',     // on | off
  finalCard: 'minimal',    // minimal | celebratory
};
const loadTweaks = () => {
  try { return { ...DEFAULT_TWEAKS, ...JSON.parse(localStorage.getItem(TWEAKS_KEY) || '{}') }; }
  catch { return { ...DEFAULT_TWEAKS }; }
};
const saveTweaks = (t) => localStorage.setItem(TWEAKS_KEY, JSON.stringify(t));
let tweaks = loadTweaks();
const applyTweaks = () => {
  const root = document.documentElement;
  root.dataset.theme = tweaks.theme;
  root.dataset.accent = tweaks.accent;
  root.dataset.density = tweaks.density;
};

/* ─── small helpers for UI bits ─────────────────────────────────────── */
const statusDot = (status) => {
  const map = {
    running: 'success', healthy: 'success', success: 'success', done: 'success',
    building: 'info',   active: 'info',     'in-progress': 'info',
    error:    'danger', failed: 'danger',
    stopped:  'muted',  pending: 'muted',
    awaiting: 'warning','asking-question': 'warning', 'awaiting-answers': 'warning',
    warn:     'warning',
  };
  return map[status] || 'muted';
};
const statusLabel = (status) => {
  const map = {
    running: 'Running', healthy: 'Healthy', success: 'Success', done: 'Done',
    building: 'Building', active: 'Active', 'in-progress': 'In progress',
    error: 'Error', failed: 'Failed',
    stopped: 'Stopped', pending: 'Pending',
    'awaiting-answers': 'Awaiting answers', 'asking-question': 'Asking',
  };
  return map[status] || status;
};

const badge = (status) => el('span', { class: `badge badge-${statusDot(status)}` },
  el('span', { class: 'dot' }),
  statusLabel(status),
);

const pill = (text, kind = 'muted') => el('span', { class: `pill pill-${kind}` }, text);

const icon = (name, size = 14) => {
  // Minimal inline SVG icons (24-grid, outlined, 1.5 stroke). Lucide-aligned.
  const paths = {
    server:    '<rect x="3" y="4" width="18" height="7" rx="1.5"/><rect x="3" y="13" width="18" height="7" rx="1.5"/><circle cx="6.5" cy="7.5" r="0.6" fill="currentColor"/><circle cx="6.5" cy="16.5" r="0.6" fill="currentColor"/>',
    cloud:     '<path d="M7 18a4 4 0 0 1-.7-7.93A6 6 0 0 1 18 9.5 4.5 4.5 0 0 1 17.5 18H7Z"/>',
    deploy:    '<path d="M12 4l4 4-4 4"/><path d="M4 12h12"/><path d="M4 20l4-4-4-4"/>',
    plus:      '<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>',
    chevron:   '<polyline points="9 6 15 12 9 18"/>',
    chevdown:  '<polyline points="6 9 12 15 18 9"/>',
    ext:       '<path d="M15 3h6v6"/><path d="M10 14L21 3"/><path d="M18 13v8H3V6h8"/>',
    copy:      '<rect x="9" y="9" width="11" height="11" rx="1.5"/><path d="M5 15V5a1 1 0 0 1 1-1h10"/>',
    key:       '<circle cx="7" cy="14" r="4"/><path d="M11 12l9-9 3 3-3 3 2 2-2 2-2-2-2 2"/>',
    lock:      '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
    settings:  '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 0 1-4 0v-.1a1.7 1.7 0 0 0-1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 0 1 0-4h.1a1.7 1.7 0 0 0 1.5-1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3h0a1.7 1.7 0 0 0 1-1.5V3a2 2 0 0 1 4 0v.1a1.7 1.7 0 0 0 1 1.5h0a1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8v0a1.7 1.7 0 0 0 1.5 1H21a2 2 0 0 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z"/>',
    refresh:   '<polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10"/><path d="M20.49 15a9 9 0 0 1-14.85 3.36L1 14"/>',
    play:      '<polygon points="6 4 20 12 6 20 6 4"/>',
    pause:     '<rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/>',
    check:     '<polyline points="20 6 9 17 4 12"/>',
    x:         '<line x1="6" y1="6" x2="18" y2="18"/><line x1="18" y1="6" x2="6" y2="18"/>',
    warn:      '<path d="M12 2L2 22h20L12 2z"/><line x1="12" y1="9" x2="12" y2="14"/><line x1="12" y1="17" x2="12" y2="17.5"/>',
    wifioff:   '<line x1="1" y1="1" x2="23" y2="23"/><path d="M16.72 11.06A10.94 10.94 0 0 1 19 12.55"/><path d="M5 12.55a10.94 10.94 0 0 1 5.17-2.39"/><path d="M10.71 5.05A16 16 0 0 1 22.58 9"/><path d="M1.42 9a15.91 15.91 0 0 1 4.7-2.88"/><path d="M8.53 16.11a6 6 0 0 1 6.95 0"/><line x1="12" y1="20" x2="12" y2="20.01"/>',
    branch:    '<line x1="6" y1="3" x2="6" y2="15"/><circle cx="18" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M18 9a9 9 0 0 1-9 9"/>',
    activity:  '<polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>',
    box:       '<rect x="3" y="3" width="18" height="18" rx="2"/>',
    eye:       '<path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12z"/><circle cx="12" cy="12" r="3"/>',
  };
  const path = paths[name];
  return el('span', {
    class: 'icon',
    'aria-hidden': 'true',
    html: `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${path || ''}</svg>`,
  });
};

/* ─── header (persistent) ─────────────────────────────────────────── */
const renderHeader = (activeRoute) => {
  const isWizard = activeRoute === '#/wizard';
  return el('header', { class: 'app-header' },
    el('div', { class: 'brand' },
      el('span', { class: 'brand-glyph' }, 'd'),
      el('span', { class: 'brand-wordmark mono' }, 'dokpilot'),
      el('span', { class: 'brand-version mono' }, MOCK_DATA.meta.version),
    ),
    el('nav', { class: 'top-nav' },
      el('a', { href: '#/',       class: 'top-nav-item' + (activeRoute === '#/' || activeRoute.startsWith('#/app') ? ' active' : '') },
        icon('server', 13), 'Dashboard'),
      el('a', { href: '#/wizard', class: 'top-nav-item' + (isWizard ? ' active' : '') },
        icon('deploy', 13), 'Wizard',
        el('span', { class: 'top-nav-dot' })),
    ),
    el('div', { class: 'header-meta' },
      el('span', { class: 'meta-chip mono', title: 'Local listen address' },
        icon('lock', 11),
        '127.0.0.1:' + MOCK_DATA.meta.port,
      ),
      el('span', { class: 'meta-chip meta-chip-token mono', title: 'Per-launch bearer token (rotated each start)' },
        icon('key', 11),
        MOCK_DATA.meta.token,
      ),
      el('button', { class: 'icon-btn', title: 'Settings (tweaks)', onclick: () => toggleTweakPanel() },
        icon('settings', 14)),
    ),
  );
};

/* ─── tweak panel (right-drawer) ──────────────────────────────────── */
const tweakOptions = [
  { key: 'theme',          label: 'Theme',          dim: 'GLOBAL · DIM 4', options: ['dark', 'light'] },
  { key: 'accent',         label: 'Accent tone',    dim: 'GLOBAL',         options: ['neon', 'soft'] },
  { key: 'density',        label: 'Density',        dim: 'GLOBAL',         options: ['compact', 'comfortable', 'spacious'] },
  { key: 'secretBadge',    label: 'Secret-source badge', dim: 'S1',        options: ['on', 'off'] },
  { key: 'activityFeed',   label: 'Recent activity',     dim: 'S1',        options: ['visible', 'collapsed'] },
  { key: 'defaultTab',     label: 'Default tab',         dim: 'S2',        options: ['deploys', 'env', 'logs'] },
  { key: 'stepperOrient',  label: 'Stepper orientation', dim: 'S3',        options: ['horizontal', 'vertical'] },
  { key: 'autoScrollLog',  label: 'Auto-scroll log',     dim: 'S3',        options: ['on', 'off'] },
  { key: 'finalCard',      label: 'Final card style',    dim: 'S3',        options: ['minimal', 'celebratory'] },
];
const toggleTweakPanel = () => {
  const panel = $('#tweak-panel');
  panel.classList.toggle('open');
};
const renderTweakPanel = () => {
  const panel = el('aside', { id: 'tweak-panel', class: 'tweak-panel' },
    el('header', { class: 'tweak-head' },
      el('div', { class: 'tweak-head-title' },
        el('span', { class: 'mono', style: { fontSize: '11px', letterSpacing: '0.1em', color: 'var(--text-3)' } }, 'TWEAKS · §8.5'),
        el('div', { class: 'tweak-head-name' }, 'Personalize'),
      ),
      el('button', { class: 'icon-btn', onclick: toggleTweakPanel }, icon('x', 14)),
    ),
    el('div', { class: 'tweak-body' },
      tweakOptions.map(opt => el('div', { class: 'tweak' },
        el('div', { class: 'tweak-label' },
          el('span', null, opt.label),
          el('span', { class: 'tweak-dim mono' }, opt.dim),
        ),
        el('div', { class: 'tweak-toggles' },
          ...opt.options.map(v => el('button', {
            class: 'tweak-toggle mono' + (tweaks[opt.key] === v ? ' active' : ''),
            onclick: () => {
              tweaks[opt.key] = v;
              saveTweaks(tweaks);
              applyTweaks();
              renderTweakPanel(); // re-render to update active state
              render(); // re-render current screen (may depend on tweak)
            },
          }, v)),
        ),
      )),
    ),
    el('footer', { class: 'tweak-foot mono' },
      'Persisted to localStorage. Backend (Phase E) treats these as session-only.',
    ),
  );
  const existing = $('#tweak-panel');
  const wasOpen = existing?.classList.contains('open');
  existing?.replaceWith(panel);
  if (wasOpen) panel.classList.add('open');
  return panel;
};

/* ─── S1 Dashboard ────────────────────────────────────────────────── */
const renderS1 = () => {
  const stage = el('main', { class: 'main-stage' });

  // Toolbar with server count + last refresh
  const totalApps = MOCK_DATA.servers.reduce((n, s) => n + s.apps.length, 0);
  const buildingNow = MOCK_DATA.servers.reduce((n, s) => n + s.apps.filter(a => a.status === 'building').length, 0);
  stage.appendChild(el('div', { class: 'stage-toolbar' },
    el('div', { class: 'stage-toolbar-left' },
      el('h1', { class: 'stage-title' }, 'Servers'),
      el('span', { class: 'stage-summary mono' },
        `${MOCK_DATA.servers.length} servers · ${totalApps} apps · ${buildingNow} building`,
      ),
    ),
    el('div', { class: 'stage-toolbar-right' },
      el('div', { class: 'search-input' },
        el('span', { class: 'magnifier' }, '⌕'),
        el('input', { type: 'text', placeholder: 'Filter apps or servers…', class: 'mono' }),
      ),
      el('button', { class: 'btn btn-ghost btn-sm mono', title: 'Refresh inventory' },
        icon('refresh', 12), 'Refresh'),
    ),
  ));

  // Server cards
  for (const s of MOCK_DATA.servers) {
    stage.appendChild(renderServerCard(s));
  }

  // Footer breadcrumb
  stage.appendChild(el('div', { class: 'stage-foot mono' },
    `config/servers.json · re-read every request · no caching beyond a request`,
  ));

  return stage;
};

const renderServerCard = (s) => {
  return el('section', { class: 'card server-card' },
    el('header', { class: 'server-head' },
      el('div', { class: 'server-head-id' },
        el('span', { class: 'server-icon' }, icon('server', 16)),
        el('div', { class: 'server-name-block' },
          el('div', { class: 'server-name mono' },
            s.name,
            s.is_default ? el('span', { class: 'tag-mini mono', title: 'Default server' }, 'default') : null,
          ),
          el('div', { class: 'server-sub mono' },
            s.ip,
            el('span', { class: 'dim-sep' }, '·'),
            'dokploy ', s.dokploy_version,
            el('span', { class: 'dim-sep' }, '·'),
            el('a', { href: s.dokploy_url, target: '_blank', class: 'sub-link mono' },
              'admin ', icon('ext', 10),
            ),
          ),
        ),
      ),
      el('div', { class: 'server-head-right' },
        tweaks.secretBadge === 'on'
          ? el('span', { class: `pill pill-key`, title: 'Where this server\'s API key is stored' },
              icon('lock', 10),
              s.secret_source,
            )
          : null,
        badge(s.status),
      ),
    ),
    el('div', { class: 'app-table' },
      el('div', { class: 'app-table-head mono' },
        el('div', null, 'App'),
        el('div', null, 'Domain'),
        el('div', null, 'Stack'),
        el('div', null, 'Last deploy'),
        el('div', null, 'Status'),
        el('div', null, ''),
      ),
      ...s.apps.map(app => el('a', {
          class: 'app-row',
          href: `#/app/${app.id}`,
        },
        el('div', { class: 'app-cell app-name-cell' },
          el('span', { class: 'app-name mono' }, app.name),
          app.builds_today > 0
            ? el('span', { class: 'tag-mini mono' }, `${app.builds_today}× today`)
            : null,
        ),
        el('div', { class: 'app-cell mono app-domain' },
          app.domain || el('span', { class: 'muted-dash' }, '— no domain —'),
        ),
        el('div', { class: 'app-cell mono dim-small' }, app.stack),
        el('div', { class: 'app-cell mono dim-small' }, app.last_deploy_rel),
        el('div', { class: 'app-cell' }, badge(app.status)),
        el('div', { class: 'app-cell app-cell-actions' },
          el('span', { class: 'app-chev' }, icon('chevron', 12)),
        ),
      )),
    ),
  );
};

/* ─── Right rail (S1 + companion to other screens) ───────────────── */
const renderRightRail = (activeRoute) => {
  const collapsed = tweaks.activityFeed === 'collapsed' && activeRoute === '#/';
  const rail = el('aside', { class: 'right-rail' + (collapsed ? ' collapsed' : '') },
    el('a', { href: '#/wizard', class: 'rail-cta btn btn-primary mono' },
      icon('plus', 13),
      'New deploy',
    ),
    el('div', { class: 'rail-block' },
      el('div', { class: 'rail-block-title mono' },
        'In flight',
        el('span', { class: 'rail-block-count mono' }, '1'),
      ),
      el('a', { href: '#/wizard', class: 'inflight-card' },
        el('div', { class: 'inflight-row mono' },
          el('span', { class: 'mono' }, MOCK_DATA.active_job.repo.replace('github.com/', '')),
          badge('awaiting-answers'),
        ),
        el('div', { class: 'inflight-meta mono' },
          '→ ', MOCK_DATA.active_job.server,
          el('span', { class: 'dim-sep' }, '·'),
          MOCK_DATA.active_job.detected_stack,
        ),
        el('div', { class: 'inflight-prog mono' }, '2 of 5 steps · awaiting 3 answers'),
      ),
    ),
    el('div', { class: 'rail-block' },
      el('div', { class: 'rail-block-title mono' },
        'Recent activity',
        el('span', { class: 'rail-block-count mono' }, MOCK_DATA.recent_deployments.length),
      ),
      el('ul', { class: 'activity-list' },
        ...MOCK_DATA.recent_deployments.map(d => el('li', { class: 'activity-item' },
          el('span', { class: `activity-dot dot dot-${statusDot(d.status)}` }),
          el('div', { class: 'activity-meta' },
            el('div', { class: 'activity-line mono' },
              el('span', { class: 'activity-app' }, d.app),
              el('span', { class: 'dim-sep' }, '·'),
              el('span', null, statusLabel(d.status).toLowerCase()),
            ),
            el('div', { class: 'activity-sub mono' },
              d.rel, el('span', { class: 'dim-sep' }, '·'), d.server, el('span', { class: 'dim-sep' }, '·'), d.duration,
            ),
          ),
        )),
      ),
    ),
  );
  return rail;
};

/* ─── S2 App Detail ───────────────────────────────────────────────── */
const renderS2 = (appId) => {
  // Find the app across servers
  let app = null, server = null;
  for (const s of MOCK_DATA.servers) {
    const a = s.apps.find(x => x.id === appId);
    if (a) { app = a; server = s; break; }
  }
  if (!app) return el('main', { class: 'main-stage' }, el('div', { class: 'empty-card' },
    el('h2', null, 'App not found'),
    el('p', null, 'The app id ', el('code', null, appId), ' isn\'t in the current inventory.'),
    el('a', { href: '#/', class: 'btn btn-primary mono' }, '← back to dashboard'),
  ));

  const initialTab = tweaks.defaultTab; // deploys | env | logs
  let activeTab = initialTab;

  const stage = el('main', { class: 'main-stage app-detail' });

  // Breadcrumb + header
  stage.appendChild(el('div', { class: 'detail-breadcrumb mono' },
    el('a', { href: '#/' }, 'dashboard'),
    el('span', { class: 'crumb-sep' }, '/'),
    el('a', { href: '#/' }, server.name),
    el('span', { class: 'crumb-sep' }, '/'),
    el('span', { class: 'crumb-current' }, app.name),
  ));

  stage.appendChild(el('header', { class: 'detail-head' },
    el('div', { class: 'detail-head-left' },
      el('div', { class: 'detail-name-row' },
        el('h1', { class: 'detail-name mono' }, app.name),
        badge(app.status),
      ),
      el('div', { class: 'detail-sub mono' },
        app.domain ? el('a', { href: `https://${app.domain}`, target: '_blank', class: 'sub-link' },
          'https://' + app.domain, ' ', icon('ext', 10),
        ) : el('span', { class: 'muted-dash' }, '— no domain assigned —'),
        el('span', { class: 'dim-sep' }, '·'),
        app.stack,
        el('span', { class: 'dim-sep' }, '·'),
        'on ', el('a', { href: '#/' }, server.name),
      ),
    ),
    el('div', { class: 'detail-head-right' },
      el('button', { class: 'btn mono' }, icon('refresh', 12), 'Refresh'),
      app.domain
        ? el('a', { class: 'btn btn-primary mono', href: `https://${app.domain}`, target: '_blank' },
            'Open', icon('ext', 11))
        : null,
    ),
  ));

  // Tabs
  const tabs = el('nav', { class: 'tab-strip mono' },
    ...['deploys', 'env', 'logs'].map(t => el('button', {
      class: 'tab' + (t === activeTab ? ' active' : ''),
      'data-tab': t,
      onclick: (e) => {
        activeTab = t;
        $$('.tab', tabs).forEach(b => b.classList.toggle('active', b.dataset.tab === t));
        $$('.tab-panel', stage).forEach(p => p.classList.toggle('active', p.dataset.tab === t));
      },
    },
      el('span', null, t),
      el('span', { class: 'tab-count mono' },
        t === 'deploys' ? (MOCK_DATA.app_deploys[appId]?.length || 0) :
        t === 'env'     ? app.env_keys.length :
        '·'),
    )),
  );
  stage.appendChild(tabs);

  // Deploys panel
  const deploys = MOCK_DATA.app_deploys[appId] || [];
  stage.appendChild(el('section', { class: 'tab-panel' + (activeTab === 'deploys' ? ' active' : ''), 'data-tab': 'deploys' },
    deploys.length === 0
      ? el('div', { class: 'panel-empty mono' },
          el('p', null, 'No deployments yet.'),
          el('code', null, '/dokpilot deploy ' + (app.domain ? app.domain : app.name)),
        )
      : el('div', { class: 'deploys-table' },
          el('div', { class: 'deploys-head mono' },
            el('div', null, 'Status'),
            el('div', null, 'SHA'),
            el('div', null, 'Branch'),
            el('div', null, 'Message'),
            el('div', null, 'Duration'),
            el('div', null, 'When'),
          ),
          ...deploys.map(d => el('div', { class: 'deploy-row' },
            el('div', { class: 'deploy-cell' }, badge(d.status)),
            el('div', { class: 'deploy-cell mono sha' }, d.sha),
            el('div', { class: 'deploy-cell mono dim-small' },
              icon('branch', 10), ' ', d.branch),
            el('div', { class: 'deploy-cell deploy-msg' }, d.msg),
            el('div', { class: 'deploy-cell mono dim-small' }, d.duration),
            el('div', { class: 'deploy-cell mono dim-small' }, d.rel),
          )),
        ),
  ));

  // Env panel
  stage.appendChild(el('section', { class: 'tab-panel' + (activeTab === 'env' ? ' active' : ''), 'data-tab': 'env' },
    el('div', { class: 'env-notice mono' },
      icon('lock', 12),
      'Values are masked — dashboard never displays secrets. Use CLI to rotate.',
    ),
    el('ul', { class: 'env-list' },
      ...app.env_keys.map(k => el('li', { class: 'env-row' },
        el('span', { class: 'env-key mono' }, k),
        el('span', { class: 'env-value mono pill pill-muted' }, '••••••••'),
        el('button', { class: 'icon-btn', title: 'Copy key' }, icon('copy', 12)),
      )),
    ),
  ));

  // Logs panel (live tail from most recent deploy)
  const logLines = MOCK_DATA.app_log_tail[appId] || [
    { t: '—', kind: 'info', text: 'No live log stream — open a deployment to view its log.' },
  ];
  stage.appendChild(el('section', { class: 'tab-panel' + (activeTab === 'logs' ? ' active' : ''), 'data-tab': 'logs' },
    el('div', { class: 'log-bar mono' },
      el('span', { class: 'log-bar-title' },
        el('span', { class: 'dot dot-info' }), 'Streaming · last deploy',
      ),
      el('span', { class: 'log-bar-fps mono' }, '20fps · throttled'),
    ),
    el('pre', { class: 'log-viewer mono', tabindex: '0', 'aria-live': 'polite' },
      ...logLines.map(l => renderLogLine(l)),
    ),
  ));

  return stage;
};

const renderLogLine = (l) => {
  const cls = `log-kind-${l.kind || 'info'}`;
  return el('div', { class: 'log-line ' + cls },
    el('span', { class: 'log-t mono' }, l.t),
    el('span', { class: 'log-text mono' }, l.text),
  );
};

/* ─── S3 Deploy Wizard ────────────────────────────────────────────── */
const renderS3 = () => {
  const job = MOCK_DATA.active_job;
  const stage = el('main', { class: 'main-stage wizard-stage' });

  // Top: job summary card
  stage.appendChild(el('header', { class: 'wizard-head' },
    el('div', { class: 'wizard-head-title' },
      el('h1', { class: 'detail-name mono' }, 'Deploy wizard'),
      badge(job.status),
    ),
    el('div', { class: 'wizard-head-meta mono' },
      el('span', { class: 'job-id' }, job.id),
      el('span', { class: 'dim-sep' }, '·'),
      'started ', new Date(job.started_at).toLocaleTimeString('en-GB', { hour12: false }),
      el('span', { class: 'dim-sep' }, '·'),
      'elapsed ', Math.round(job.elapsed_ms / 1000), 's',
    ),
  ));

  // Stepper
  stage.appendChild(renderStepper(job));

  // Submission card (top — repo + server)
  stage.appendChild(el('section', { class: 'card wizard-input' },
    el('div', { class: 'wizard-input-row' },
      el('div', { class: 'wizard-input-field' },
        el('label', { class: 'mono', for: 'wz-repo' }, 'Repository'),
        el('input', { id: 'wz-repo', class: 'mono', type: 'text', value: job.repo, disabled: 'true' }),
      ),
      el('div', { class: 'wizard-input-field' },
        el('label', { class: 'mono', for: 'wz-server' }, 'Server'),
        el('input', { id: 'wz-server', class: 'mono', type: 'text', value: job.server, disabled: 'true' }),
      ),
      el('div', { class: 'wizard-input-field' },
        el('label', { class: 'mono', for: 'wz-domain' }, 'Domain (optional)'),
        el('input', { id: 'wz-domain', class: 'mono', type: 'text', value: job.domain, disabled: 'true' }),
      ),
      el('div', { class: 'wizard-input-field' },
        el('label', { class: 'mono', for: 'wz-branch' }, 'Branch'),
        el('input', { id: 'wz-branch', class: 'mono', type: 'text', value: job.branch, disabled: 'true' }),
      ),
    ),
    el('div', { class: 'wizard-input-hint mono' },
      icon('check', 11),
      'Job submitted. Disabled while in flight — cancel to edit.',
    ),
  ));

  // Two columns: Q&A on left, live log on right
  const cols = el('div', { class: 'wizard-cols' });

  // Q&A panel
  cols.appendChild(el('section', { class: 'card wizard-qa' },
    el('header', { class: 'card-head' },
      el('div', { class: 'card-head-title mono' },
        el('span', { class: 'dot dot-warning' }),
        'Awaiting answers',
      ),
      el('span', { class: 'card-head-count mono' }, `${job.questions.length} fields`),
    ),
    el('div', { class: 'detected-stack-banner mono' },
      icon('check', 11), 'Detected: ', el('strong', null, job.detected_stack),
    ),
    el('div', { class: 'qa-fields' },
      ...job.questions.map((q, i) => renderQuestion(q, i === 0)),
    ),
    el('footer', { class: 'qa-foot' },
      el('button', { class: 'btn btn-ghost mono' }, 'Cancel deploy'),
      el('button', { class: 'btn btn-primary mono' },
        'Submit answers', icon('chevron', 11)),
    ),
  ));

  // Log panel
  cols.appendChild(el('section', { class: 'card wizard-log' },
    el('header', { class: 'card-head' },
      el('div', { class: 'card-head-title mono' },
        el('span', { class: 'dot dot-info' }),
        'Live log',
      ),
      el('div', { class: 'card-head-actions' },
        el('button', { class: 'btn btn-ghost btn-sm mono', title: 'Pause stream' }, icon('pause', 11), 'Pause'),
        el('button', { class: 'btn btn-ghost btn-sm mono', title: 'Open in fullscreen' }, icon('ext', 11), 'Full'),
      ),
    ),
    el('pre', { class: 'log-viewer mono', tabindex: '0', 'aria-live': 'polite' },
      ...job.log_tail.map(renderLogLine),
      el('div', { class: 'log-line log-cursor mono' },
        el('span', { class: 'log-t' }, '—'),
        el('span', { class: 'log-text' }, '▮ awaiting input…'),
      ),
    ),
  ));

  stage.appendChild(cols);
  return stage;
};

const renderStepper = (job) => {
  const orient = tweaks.stepperOrient;
  const wrap = el('div', { class: 'stepper stepper-' + orient });
  job.steps.forEach((s, i) => {
    wrap.appendChild(el('div', { class: 'step step-' + s.status },
      el('span', { class: 'step-num mono' },
        s.status === 'done' ? icon('check', 12) :
        s.status === 'active' ? (String(i + 1)) :
        (String(i + 1))),
      el('div', { class: 'step-body' },
        el('div', { class: 'step-label mono' }, s.label),
        el('div', { class: 'step-meta mono' },
          s.status === 'done' && s.duration_ms ? Math.round(s.duration_ms / 1000) + 's' :
          s.status === 'active' ? 'in flight…' :
          s.status === 'pending' ? 'pending' :
          ''),
      ),
    ));
    if (i < job.steps.length - 1) {
      wrap.appendChild(el('div', {
        class: 'step-connector step-connector-' + (job.steps[i].status === 'done' ? 'done' : 'pending'),
      }));
    }
  });
  return wrap;
};

const renderQuestion = (q, focused) => {
  let input;
  if (q.type === 'select') {
    input = el('select', { id: 'q-' + q.id, class: 'mono', required: q.required ? 'true' : null },
      el('option', { value: '', disabled: 'true', selected: 'true' }, 'choose one…'),
      ...q.options.map(o => el('option', { value: o.value }, o.label)),
    );
  } else {
    input = el('input', {
      id: 'q-' + q.id, class: 'mono', type: q.type || 'text',
      placeholder: q.placeholder || '',
      autofocus: focused ? 'true' : null,
      required: q.required ? 'true' : null,
    });
  }
  return el('div', { class: 'qa-field' + (focused ? ' qa-field-focused' : '') },
    el('label', { class: 'qa-field-label mono', for: 'q-' + q.id },
      q.label,
      q.required ? el('span', { class: 'qa-req' }, '*') : null,
    ),
    input,
    q.hint ? el('div', { class: 'qa-field-hint mono' }, q.hint) : null,
  );
};

/* ─── S4 Empty State ──────────────────────────────────────────────── */
const renderS4 = () => {
  const stage = el('main', { class: 'main-stage stage-hero' });
  stage.appendChild(el('section', { class: 'empty-card' },
    el('div', { class: 'empty-glyph' }, icon('server', 40)),
    el('h2', { class: 'empty-title' }, 'No servers configured'),
    el('p', { class: 'empty-body' },
      'Dokpilot needs at least one Dokploy server in your ',
      el('code', { class: 'mono' }, 'config/servers.json'),
      ' to do anything useful. Add one in the CLI — the dashboard auto-detects new servers within 5s.',
    ),
    el('div', { class: 'empty-cli' },
      el('pre', { class: 'empty-cli-code mono' },
        '$ /dokpilot config server add main 1.2.3.4',
      ),
      el('button', { class: 'btn btn-ghost btn-sm mono', title: 'Copy command' },
        icon('copy', 11), 'Copy'),
    ),
    el('div', { class: 'empty-tip mono' },
      icon('check', 11),
      'After ',
      el('code', null, '/dokpilot config server add'),
      ', this page auto-transitions to the dashboard.',
    ),
  ));
  return stage;
};

/* ─── S5 Connection Lost ──────────────────────────────────────────── */
const renderS5Banner = () => {
  return el('div', { class: 'conn-banner', role: 'alert' },
    el('span', { class: 'conn-glyph' }, icon('wifioff', 14)),
    el('div', { class: 'conn-meta' },
      el('div', { class: 'conn-line mono' },
        el('strong', null, 'Connection to dashboard server lost'),
        ' — retrying in ',
        el('span', { class: 'conn-countdown mono', id: 'conn-cd' }, '3s'),
        '…',
      ),
      el('div', { class: 'conn-sub mono' },
        'Exponential backoff · 3s → 6s → 12s · log tail buffered locally until reconnect',
      ),
    ),
    el('button', { class: 'btn btn-ghost btn-sm mono' }, icon('refresh', 11), 'Retry now'),
  );
};

/* ─── router ──────────────────────────────────────────────────────── */
const SCREENS = {
  '#/':            'S1',
  '#/wizard':      'S3',
  '#/empty':       'S4',
  '#/disconnected':'S5',
};

const render = () => {
  applyTweaks();
  const route = location.hash || '#/';
  const root = $('#app');
  root.innerHTML = '';

  // Persistent header
  root.appendChild(renderHeader(route));

  // S5 disconnected banner sits at top when route active
  if (route === '#/disconnected') {
    root.appendChild(renderS5Banner());
  }

  // Body: main + rail
  const body = el('div', { class: 'app-body' });

  let main;
  if (route === '#/' || route === '') main = renderS1();
  else if (route === '#/wizard') main = renderS3();
  else if (route === '#/empty') main = renderS4();
  else if (route.startsWith('#/app/')) main = renderS2(route.slice('#/app/'.length));
  else if (route === '#/disconnected') main = renderS1(); // background view
  else main = renderS1();

  body.appendChild(main);

  // Right rail visible on all but S4 empty (S4 is hero / full-bleed)
  if (route !== '#/empty') {
    body.appendChild(renderRightRail(route));
  }

  root.appendChild(body);

  // Tweak panel (always in DOM, hidden until opened)
  document.body.appendChild(renderTweakPanel());

  // Update current screen indicator (bottom-left of header)
  updateScreenChip(route);
};

const updateScreenChip = (route) => {
  // Add or update a small breadcrumb showing current screen id (S1..S5)
  const map = {
    '#/':             ['S1', 'Dashboard'],
    '#/wizard':       ['S3', 'Wizard'],
    '#/empty':        ['S4', 'Empty state'],
    '#/disconnected': ['S5', 'Connection lost'],
  };
  let pair = map[route];
  if (!pair && route.startsWith('#/app/')) pair = ['S2', 'App detail'];
  if (!pair) pair = ['S1', 'Dashboard'];
  const chip = $('#screen-chip');
  if (chip) {
    chip.querySelector('.sc-id').textContent = pair[0];
    chip.querySelector('.sc-name').textContent = pair[1];
  }
};

/* ─── boot ────────────────────────────────────────────────────────── */
window.addEventListener('hashchange', render);
document.addEventListener('DOMContentLoaded', () => {
  applyTweaks();
  render();
  // Provide a quick screen switcher in the dev/static prototype context
  // (visible as a small chip bottom-left; backend Phase E removes this).
  const switcher = el('nav', { id: 'screen-switcher', class: 'screen-switcher mono', 'aria-label': 'Screen navigator (prototype-only)' },
    el('span', { class: 'ss-title' }, 'PROTOTYPE'),
    el('a', { href: '#/',             'data-route': '#/' }, 'S1'),
    el('a', { href: '#/app/app_001', 'data-route': '#/app/' }, 'S2'),
    el('a', { href: '#/wizard',       'data-route': '#/wizard' }, 'S3'),
    el('a', { href: '#/empty',        'data-route': '#/empty' }, 'S4'),
    el('a', { href: '#/disconnected', 'data-route': '#/disconnected' }, 'S5'),
  );
  document.body.appendChild(switcher);
  const refreshSwitcher = () => {
    const route = location.hash || '#/';
    $$('#screen-switcher a').forEach(a => {
      const r = a.dataset.route;
      a.classList.toggle('active', route === r || route.startsWith(r) && r !== '#/');
      if (r === '#/' && route === '#/') a.classList.add('active');
    });
  };
  window.addEventListener('hashchange', refreshSwitcher);
  refreshSwitcher();
});
