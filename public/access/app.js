const app = document.querySelector('#app');

async function api(path, options = {}) {
  const response = await fetch(path, {
    method: options.method || 'GET',
    headers: {
      accept: 'application/json',
      ...(options.body ? { 'content-type': 'application/json' } : {}),
    },
    ...(options.body ? { body: JSON.stringify(options.body) } : {}),
  });
  const result = response.status === 204 ? null : await response.json().catch(() => null);
  if (!response.ok) throw new Error(result?.error?.message || 'Request failed');
  return result?.data;
}

const escapeHtml = (value = '') =>
  String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');

function login() {
  app.innerHTML = `<section class="auth panel"><p class="eyebrow">Private beta</p><h1>Sign in</h1><p class="muted">Use the account created from your single-use invitation. Judges may always inspect public Judge Mode without signing in.</p><form class="stack" data-login><label>Email<input name="email" type="email" autocomplete="email" required></label><label>Password<input name="password" type="password" autocomplete="current-password" required></label><button>Sign in</button><p data-status></p></form></section>`;
  document.querySelector('[data-login]').addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const status = form.querySelector('[data-status]');
    const data = new FormData(form);
    try {
      await api('/api/v1/access/login', {
        method: 'POST',
        body: { email: data.get('email'), password: data.get('password') },
      });
      location.href = '/portal';
    } catch (error) {
      status.className = 'error';
      status.textContent = error.message;
    }
  });
}

function invite() {
  const token = new URLSearchParams(location.search).get('token') || '';
  app.innerHTML = `<section class="auth panel"><p class="eyebrow">Invitation</p><h1>Create or join your account</h1><p class="muted">This link is single-use. New users should choose at least 12 characters. Existing users keep their current password.</p><form class="stack" data-invite><label>Name<input name="name" autocomplete="name" minlength="2" required></label><label>Password<input name="password" type="password" autocomplete="new-password" minlength="12" required></label><button>Accept invitation</button><p data-status></p></form></section>`;
  document.querySelector('[data-invite]').addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const status = form.querySelector('[data-status]');
    const data = new FormData(form);
    try {
      await api('/api/v1/access/accept-invitation', {
        method: 'POST',
        body: { token, name: data.get('name'), password: data.get('password') },
      });
      location.href = '/portal';
    } catch (error) {
      status.className = 'error';
      status.textContent = error.message;
    }
  });
}

async function portal() {
  let data;
  try {
    data = await api('/api/v1/portal/overview');
  } catch {
    location.href = '/access';
    return;
  }
  const p = data.principal;
  app.innerHTML = `<div class="toolbar"><div><p class="eyebrow">${escapeHtml(p.organizationMode)} workspace</p><h1>${escapeHtml(p.organizationName)}</h1><p class="muted">Signed in as ${escapeHtml(p.email)} · ${escapeHtml(p.role)}</p></div><button class="secondary" data-logout>Sign out</button></div>
  <div class="grid"><section class="panel"><h2>Workspace policy</h2><div class="receipt"><div><span>Paid execution</span><strong>${p.spendingEnabled ? 'Enabled' : 'Disabled'}</strong></div><div><span>Mission maximum</span><strong>${escapeHtml(p.maximumMissionBudget)} USDC</strong></div><div><span>ACP maximum</span><strong>${escapeHtml(p.maximumAcpJobUsdc)} USDC</strong></div><div><span>Payment approval</span><strong>One-time per job</strong></div></div></section>
  <section class="panel"><h2>New mission</h2><form class="stack" data-mission><label>Objective<textarea name="objective" rows="3" maxlength="10000" required>Create a fresh, sourced crypto news brief on AI agent payments on Base.</textarea></label><label>Capabilities<input name="capabilities" value="crypto news research" required></label><label>ACP offering input (JSON)<textarea name="acpRequirements" rows="4" required>{"topic":"AI agent payments on Base","timeframe":"24h","focus":"analysis"}</textarea></label><label>Budget (USDC)<input name="budget" value="0.10" required></label><button>Create mission</button><p data-status></p></form></section>
  ${p.role === 'OWNER' ? `<section class="panel"><h2>Invite your team</h2><p class="muted">Add operators, finance approvers, and read-only viewers.</p><form class="stack" data-member><label>Email<input name="email" type="email" required></label><label>Role<select name="role"><option value="OPERATOR">Operator</option><option value="FINANCE_APPROVER">Finance approver</option><option value="VIEWER">Viewer</option></select></label><button>Send invitation</button><p data-status></p></form></section>` : ''}</div>
  <section class="panel" style="margin-top:18px"><h2>Missions</h2><div class="missions">${data.missions.length ? data.missions.map((m) => `<article class="mission"><div><strong>${escapeHtml(m.objective)}</strong><span class="mono muted">${escapeHtml(m.id)}</span></div><div><span class="badge">${escapeHtml(m.status)}</span> <button class="secondary" data-open="${m.id}">Open</button></div></article>`).join('') : '<p class="muted">No missions in this workspace yet.</p>'}</div></section><section id="detail" style="margin-top:18px"></section>`;
  document.querySelector('[data-logout]').onclick = async () => {
    await api('/api/v1/access/logout', { method: 'POST' });
    location.href = '/access';
  };
  document.querySelector('[data-mission]')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const d = new FormData(form);
    const status = form.querySelector('[data-status]');
    try {
      const acpRequirements = JSON.parse(String(d.get('acpRequirements')));
      if (!acpRequirements || Array.isArray(acpRequirements) || typeof acpRequirements !== 'object')
        throw new Error('ACP offering input must be a JSON object.');
      await api('/api/v1/portal/missions', {
        method: 'POST',
        body: {
          objective: d.get('objective'),
          budget: d.get('budget'),
          constraints: {
            capabilities: String(d.get('capabilities'))
              .split(',')
              .map((v) => v.trim())
              .filter(Boolean),
            acpRequirements,
            budgetCurrency: 'USDC',
            runner: {
              maximumRetries: 0,
              candidateLimit: 5,
              timeoutMs: 900000,
              failureThreshold: 1,
            },
          },
        },
      });
      await portal();
    } catch (error) {
      status.className = 'error';
      status.textContent = error.message;
    }
  });
  document.querySelector('[data-member]')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const d = new FormData(form);
    const status = form.querySelector('[data-status]');
    try {
      const invitation = await api('/api/v1/portal/members/invite', {
        method: 'POST',
        body: { email: d.get('email'), role: d.get('role') },
      });
      status.className = 'success';
      status.textContent =
        invitation.delivery === 'SENT'
          ? 'Invitation email sent.'
          : `Email is not configured yet. Copy this invitation link: ${invitation.inviteUrl}`;
      form.reset();
    } catch (error) {
      status.className = 'error';
      status.textContent = error.message;
    }
  });
  document
    .querySelectorAll('[data-open]')
    .forEach((button) => (button.onclick = () => missionDetail(button.dataset.open)));
}

async function missionDetail(id) {
  const detail = document.querySelector('#detail');
  detail.innerHTML = '<section class="panel">Loading mission evidence…</section>';
  try {
    const data = await api(`/api/v1/portal/missions/${encodeURIComponent(id)}`);
    const p = (await api('/api/v1/portal/overview')).principal;
    const job = data.jobs.at(-1);
    detail.innerHTML = `<section class="panel"><div class="toolbar"><div><p class="eyebrow">Mission evidence</p><h2>${escapeHtml(data.mission.objective)}</h2></div><span class="badge">${escapeHtml(data.mission.status)}</span></div><div class="receipt"><div><span>Mission ID</span><strong class="mono">${escapeHtml(id)}</strong></div><div><span>Memory records</span><strong>${data.memory.records.length}</strong></div><div><span>ACP job</span><strong class="mono">${escapeHtml(job?.externalJobId || 'Not created')}</strong></div><div><span>Verification</span><strong>${escapeHtml(job?.verification?.passed === true ? 'PASS' : job?.verification?.passed === false ? 'FAIL' : 'Pending')}</strong></div></div><div class="actions" style="margin-top:16px"><button data-discover>Discover agents (no spend)</button>${['OWNER', 'OPERATOR'].includes(p.role) && data.mission.status === 'CREATED' ? '<button data-run>Run mission</button>' : ''}${['OWNER', 'FINANCE_APPROVER'].includes(p.role) && data.mission.status === 'AWAITING_FUNDING_APPROVAL' ? '<button class="danger" data-approve>Approve one-time ACP payment</button>' : ''}${['OWNER', 'FINANCE_APPROVER'].includes(p.role) && data.mission.status === 'AWAITING_BASE_APPROVAL' ? '<button class="danger" data-approve-base>Approve one-time Base settlement</button>' : ''}</div><p data-action-status></p><pre>${escapeHtml(JSON.stringify({ decision: data.decision, jobs: data.jobs, memoryImpact: data.memory.trace?.impact }, null, 2))}</pre></section>`;
    const status = detail.querySelector('[data-action-status]');
    detail.querySelector('[data-discover]')?.addEventListener('click', async () => {
      try {
        const preview = await api(`/api/v1/portal/missions/${id}/discover`, {
          method: 'POST',
          body: { candidateLimit: 5 },
        });
        status.className = 'success';
        status.textContent = 'Read-only discovery completed. No funds were spent.';
        detail.querySelector('pre').textContent = JSON.stringify(preview, null, 2);
      } catch (error) {
        status.className = 'error';
        status.textContent = error.message;
      }
    });
    detail.querySelector('[data-run]')?.addEventListener('click', async () => {
      try {
        await api(`/api/v1/portal/missions/${id}/run`, { method: 'POST' });
        await missionDetail(id);
      } catch (error) {
        status.className = 'error';
        status.textContent = error.message;
      }
    });
    detail.querySelector('[data-approve]')?.addEventListener('click', async () => {
      try {
        await api(`/api/v1/portal/missions/${id}/approve-acp-spend`, {
          method: 'POST',
          body: { approved: true },
        });
        await missionDetail(id);
      } catch (error) {
        status.className = 'error';
        status.textContent = error.message;
      }
    });
    detail.querySelector('[data-approve-base]')?.addEventListener('click', async () => {
      try {
        await api(`/api/v1/portal/missions/${id}/approve-base-settlement`, {
          method: 'POST',
          body: { approved: true },
        });
        await missionDetail(id);
      } catch (error) {
        status.className = 'error';
        status.textContent = error.message;
      }
    });
  } catch (error) {
    detail.innerHTML = `<section class="panel error">${escapeHtml(error.message)}</section>`;
  }
}

if (location.pathname === '/access/invite') invite();
else if (location.pathname === '/portal') portal();
else login();
