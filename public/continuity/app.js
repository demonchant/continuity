const app = document.querySelector('#app');
const refreshButton = document.querySelector('#refresh-button');
const menuButton = document.querySelector('.menu-button');
const lastUpdated = document.querySelector('#last-updated');
const lockButton = document.querySelector('#lock-button');
const operatorTokenStorageKey = 'continuity.dashboard.operator-token';

const state = {
  overview: null,
  details: new Map(),
  judgeOverview: null,
  judgeDetails: new Map(),
  discovery: new Map(),
  pollTimer: null,
  request: 0,
};

const escapeHtml = (value = '') =>
  String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');

const fmtDate = (value, compact = false) => {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat(
    undefined,
    compact
      ? { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }
      : { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' },
  ).format(date);
};

const relativeTime = (value) => {
  const elapsed = Date.now() - new Date(value).getTime();
  if (!Number.isFinite(elapsed)) return 'Unknown time';
  const minutes = Math.max(0, Math.round(elapsed / 60000));
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
};

const shortId = (value) =>
  value ? `${String(value).slice(0, 10)}…${String(value).slice(-5)}` : '—';
const percent = (value) =>
  value === null || value === undefined ? '—' : `${Math.round(value * 100)}%`;
const statusClass = (value) =>
  String(value || '')
    .toLowerCase()
    .replaceAll('_', '-');

function status(value) {
  return `<span class="status ${statusClass(value)}">${escapeHtml(String(value || 'unknown').replaceAll('_', ' '))}</span>`;
}

function operatorToken() {
  return sessionStorage.getItem(operatorTokenStorageKey)?.trim() || '';
}

async function fetchJson(path, requiresOperatorToken = false, options = {}) {
  const token = requiresOperatorToken ? operatorToken() : '';
  const response = await fetch(path, {
    method: options.method || 'GET',
    headers: {
      accept: 'application/json',
      ...(options.body ? { 'content-type': 'application/json' } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    ...(options.body ? { body: JSON.stringify(options.body) } : {}),
  });
  const body = await response.json().catch(() => null);
  if (requiresOperatorToken && response.status === 401) {
    throw new Error('DASHBOARD_AUTH_REQUIRED');
  }
  if (!response.ok) {
    throw new Error(
      body?.error?.message || body?.message || `Request failed with ${response.status}`,
    );
  }
  return body.data;
}

function protectedRequest(path, options = {}) {
  return fetchJson(path, true, options);
}

function updateLockControl() {
  lockButton.hidden = !operatorToken();
}

async function overview(force = false) {
  if (!state.overview || force)
    state.overview = await fetchJson('/api/v1/dashboard/overview', true);
  return state.overview;
}

async function detail(id, force = false) {
  if (!state.details.has(id) || force) {
    state.details.set(
      id,
      await fetchJson(`/api/v1/dashboard/missions/${encodeURIComponent(id)}`, true),
    );
  }
  return state.details.get(id);
}

async function publicJudgeOverview(force = false) {
  if (!state.judgeOverview || force)
    state.judgeOverview = await fetchJson('/api/v1/judge/overview');
  return state.judgeOverview;
}

async function publicJudgeDetail(id, force = false) {
  if (!state.judgeDetails.has(id) || force) {
    state.judgeDetails.set(id, await fetchJson(`/api/v1/judge/missions/${encodeURIComponent(id)}`));
  }
  return state.judgeDetails.get(id);
}

function loading() {
  app.setAttribute('aria-busy', 'true');
  app.innerHTML = `<div class="loading-grid" aria-label="Loading operations data">
    <div class="skeleton"></div><div class="skeleton"></div><div class="skeleton"></div><div class="skeleton"></div><div class="skeleton"></div>
  </div>`;
}

function empty(title, description, action = '') {
  return `<div class="empty"><div><span class="empty-icon" aria-hidden="true">◇</span><h2>${escapeHtml(title)}</h2><p>${escapeHtml(description)}</p>${action}</div></div>`;
}

function renderError(error) {
  if (error instanceof Error && error.message === 'DASHBOARD_AUTH_REQUIRED') {
    app.innerHTML = `<div class="error-state"><div><span class="empty-icon" aria-hidden="true">!</span><h2>Operator access required</h2><p>Enter the Continuity operator token to unlock mission creation, discovery, execution, approvals, recovery, and protected telemetry. It is kept only for this browser session.</p><form data-operator-token-form><label class="sr-only" for="operator-token">Operator token</label><input class="operator-token-input" id="operator-token" type="password" autocomplete="off" required><button class="button" type="submit">Unlock dashboard</button></form></div></div>`;
    document.querySelector('[data-operator-token-form]')?.addEventListener('submit', (event) => {
      event.preventDefault();
      const input = document.querySelector('#operator-token');
      const token = input instanceof HTMLInputElement ? input.value.trim() : '';
      if (!token) return;
      sessionStorage.setItem(operatorTokenStorageKey, token);
      state.overview = null;
      state.details.clear();
      route(true);
    });
    return;
  }
  app.innerHTML = `<div class="error-state"><div><span class="empty-icon" aria-hidden="true">!</span><h2>Operations unavailable</h2><p>${escapeHtml(error instanceof Error ? error.message : 'The dashboard could not load operational data.')}</p><button class="button" type="button" data-retry>Try again</button></div></div>`;
  document.querySelector('[data-retry]')?.addEventListener('click', () => route(true));
}

function pageHead(eyebrow, title, lede, action = '') {
  return `<header class="page-head"><div><p class="eyebrow">${escapeHtml(eyebrow)}</p><h1>${escapeHtml(title)}</h1><p class="lede">${escapeHtml(lede)}</p></div>${action}</header>`;
}

function missionRows(missions) {
  if (!missions.length)
    return empty(
      'No missions yet',
      'Create a mission to begin a real persisted operation.',
      '<a class="button" href="/dashboard/missions/new">New Mission</a>',
    );
  return `<div class="panel mission-list"><div class="mission-row header"><span>Mission</span><span>Status</span><span>Budget</span><span>Updated</span><span></span></div>${missions
    .map(
      (mission) => `
    <a class="mission-row" href="/dashboard/missions/${encodeURIComponent(mission.id)}">
      <span><strong>${escapeHtml(mission.objective)}</strong><small>${escapeHtml(mission.id)}</small></span>
      <span>${status(mission.status)}</span>
      <span class="mono caption">${escapeHtml(mission.budget)}</span>
      <span class="caption">${escapeHtml(relativeTime(mission.updatedAt))}</span>
      <span class="arrow" aria-hidden="true">→</span>
    </a>`,
    )
    .join('')}</div>`;
}

function memoryCards(records, cited = []) {
  if (!records.length)
    return empty(
      'No relevant Sibyl memory',
      'This mission has no recalled historical records yet. A verified outcome will create useful experience.',
    );
  const citations = new Set(cited);
  return `<div class="memory-list">${records
    .map(
      (memory) => `
    <article class="memory-card ${citations.has(memory.sibylRecordId) ? 'memory-cited' : ''}" data-category="${escapeHtml(memory.category)}">
      <span class="memory-stripe" aria-hidden="true"></span>
      <div><h3>${escapeHtml(memory.category.replaceAll('_', ' '))}${citations.has(memory.sibylRecordId) ? ' · influenced decision' : ''}</h3><p>${escapeHtml(memory.result || memory.failureReason || memory.recommendation || 'Operational memory record')}</p><div class="chips"><span class="chip">${escapeHtml(memory.capability)}</span>${memory.agentId ? `<span class="chip">${escapeHtml(memory.agentId)}</span>` : ''}<span class="chip">${escapeHtml(fmtDate(memory.timestamp, true))}</span></div></div>
      <span class="memory-ref" title="${escapeHtml(memory.sibylRecordId)}">${escapeHtml(memory.sibylRecordId)}</span>
    </article>`,
    )
    .join('')}</div>`;
}

function memoryImpact(trace) {
  const impact = trace?.impact;
  if (!impact) return '';
  const loadBearing = impact.level === 'LOAD_BEARING';
  const label = loadBearing
    ? 'Memory impact · load-bearing'
    : impact.level === 'AWAITING_DECISION'
      ? 'Memory impact · awaiting decision'
      : impact.level === 'NO_HISTORICAL_PREFERENCE'
        ? 'Memory impact · no historical preference'
        : 'Memory impact · citations unresolved';
  return `<aside class="impact ${loadBearing ? 'impact-high' : 'impact-neutral'}" aria-label="Memory impact">
    <span class="impact-orbit" aria-hidden="true"><i></i><i></i><i></i></span>
    <div><p class="eyebrow">${escapeHtml(label)}</p><strong>${impact.resolvedCount} / ${impact.citedCount} citations retrieved now</strong><p>${escapeHtml(impact.summary)}</p></div>
  </aside>`;
}

function compactMemoryItems(records, emptyText) {
  if (!records.length) return `<p class="trace-empty">${escapeHtml(emptyText)}</p>`;
  return `<ol class="trace-items">${records
    .slice(0, 3)
    .map(
      (memory) =>
        `<li><span class="trace-kind">${escapeHtml(memory.category)}</span><strong>${escapeHtml(memory.failureReason || memory.result || memory.recommendation || memory.id)}</strong><small>${escapeHtml(memory.agentId || 'mission-level')} · ${escapeHtml(shortId(memory.sibylRecordId))}</small></li>`,
    )
    .join(
      '',
    )}</ol>${records.length > 3 ? `<p class="caption">+ ${records.length - 3} more real record${records.length - 3 === 1 ? '' : 's'}</p>` : ''}`;
}

function agentCards(agents, selectedAgentId) {
  if (!agents.length)
    return empty(
      'No agent experience recalled',
      'Candidate evidence will appear after Sibyl returns relevant agent outcomes.',
    );
  return `<div class="agent-grid">${agents
    .map(
      (agent) => `
    <article class="agent-card ${agent.agentId === selectedAgentId ? 'selected' : ''}">
      <div class="agent-head"><div><p class="eyebrow">${agent.agentId === selectedAgentId ? 'Selected agent' : 'Considered evidence'}</p><div class="agent-id" title="${escapeHtml(agent.agentId)}">${escapeHtml(agent.agentId)}</div></div>${agent.agentId === selectedAgentId ? status('selected') : ''}</div>
      <div class="agent-stats"><div class="agent-stat"><strong>${agent.successes}</strong><small>Successes</small></div><div class="agent-stat"><strong>${percent(agent.verificationRate)}</strong><small>Verified</small></div><div class="agent-stat"><strong>${agent.failures}</strong><small>Failures</small></div></div>
      <div class="chips">${agent.capabilities.map((capability) => `<span class="chip">${escapeHtml(capability)}</span>`).join('')}${agent.averageCost ? `<span class="chip">avg ${escapeHtml(agent.averageCost.amount)} ${escapeHtml(agent.averageCost.currency)}</span>` : ''}</div>
      ${agent.failurePatterns[0] ? `<p class="caption" style="margin: .8rem 0 0">Failure pattern: ${escapeHtml(agent.failurePatterns[0].reason)} (${agent.failurePatterns[0].count})</p>` : ''}
    </article>`,
    )
    .join('')}</div>`;
}

function activityItems(data) {
  const events = [
    {
      time: data.mission.createdAt,
      title: 'Mission received',
      description: data.mission.objective,
      type: 'mission',
    },
  ];
  for (const memory of data.memory.records)
    events.push({
      time: memory.timestamp,
      title: `Sibyl ${memory.category.replaceAll('_', ' ')}`,
      description: memory.result || memory.recommendation || memory.sibylRecordId,
      type: 'memory',
    });
  for (const job of data.jobs)
    events.push({
      time: job.updatedAt,
      title: `Virtuals job ${job.state.toLowerCase()}`,
      description: `${job.externalJobId} · ${job.agentId}`,
      type: 'job',
    });
  for (const transaction of data.transactions)
    events.push({
      time: transaction.updatedAt,
      title: `Base action ${transaction.status.toLowerCase()}`,
      description: `${transaction.amount} ${transaction.asset} · ${shortId(transaction.transactionHash || transaction.paymentId)}`,
      type: 'base',
    });
  return events.sort((a, b) => new Date(b.time) - new Date(a.time));
}

function activityList(data) {
  const events = activityItems(data);
  if (!events.length)
    return empty('No activity', 'Operational events will appear as the mission progresses.');
  return `<div class="panel panel-pad activity-list">${events.map((event) => `<div class="activity-item"><time class="activity-time" datetime="${escapeHtml(event.time)}">${escapeHtml(fmtDate(event.time, true))}</time><span class="activity-rail"><i class="activity-dot"></i></span><div class="activity-body"><strong>${escapeHtml(event.title)}</strong><p>${escapeHtml(event.description)}</p></div></div>`).join('')}</div>`;
}

async function renderOverview() {
  const data = await overview();
  const latest = data.missions[0];
  const latestDetail = latest ? await detail(latest.id) : null;
  app.innerHTML = `${pageHead('System overview', 'Memory turns outcomes into better operations.', 'Continuity recalls what worked, explains who it trusts, verifies every result, and records what happens next.', '<a class="button" href="/dashboard/missions/new">New Mission</a>')}
    <section class="metrics" aria-label="Mission metrics">
      <article class="metric"><span class="metric-label">Total missions</span><strong class="metric-value">${data.metrics.total}</strong><span class="metric-note">durable operations</span></article>
      <article class="metric"><span class="metric-label">Currently active</span><strong class="metric-value">${data.metrics.active}</strong><span class="metric-note">bounded autonomous runs</span></article>
      <article class="metric"><span class="metric-label">Verified complete</span><strong class="metric-value">${data.metrics.completed}</strong><span class="metric-note">accepted outcomes</span></article>
      <article class="metric"><span class="metric-label">Recorded failures</span><strong class="metric-value">${data.metrics.failed}</strong><span class="metric-note">future decision signals</span></article>
    </section>
    <section class="section split"><div><div class="section-heading"><h2>Recent missions</h2><a href="/dashboard/missions">View all →</a></div>${missionRows(data.missions.slice(0, 5))}</div>
    <aside><div class="section-heading"><h2>Memory pulse</h2><a href="/dashboard/memory">Explore →</a></div><div class="panel panel-pad">${latestDetail ? `<p class="eyebrow">Latest recall</p><strong style="font-size:2rem">${latestDetail.memory.records.length}</strong><p class="caption">Sibyl records retrieved for the latest mission across ${latestDetail.agents.length} experienced agent${latestDetail.agents.length === 1 ? '' : 's'}.</p><div class="chips">${[...new Set(latestDetail.memory.records.map((record) => record.category))].map((category) => `<span class="chip">${escapeHtml(category)}</span>`).join('')}</div>` : `<p class="caption">No mission exists to recall against yet.</p>`}</div></aside></section>
    <section class="section"><div class="section-heading"><h2>Autonomous control loop</h2></div><div class="panel pipeline">${['Mission', 'Recall', 'Evaluate', 'Select', 'Execute', 'Verify', 'Base', 'Remember'].map((step, index) => `<div class="pipeline-step complete"><span class="step-node">${index + 1}</span><span class="step-label">${step}</span></div>`).join('')}</div></section>`;
}

function missionForm() {
  return `<form class="panel panel-pad mission-form" data-new-mission>
    <div class="form-grid">
      <label class="field field-wide"><span>Objective</span><textarea name="objective" rows="4" maxlength="2000" required placeholder="Describe the real outcome the provider must deliver"></textarea></label>
      <label class="field"><span>Budget (USDC)</span><input name="budget" inputmode="decimal" pattern="\\d+(?:\\.\\d{1,8})?" required placeholder="0.50"></label>
      <label class="field"><span>Capabilities</span><input name="capabilities" required placeholder="research, analysis"><small>Comma-separated capabilities used for Virtuals discovery.</small></label>
    </div>
    <details class="advanced"><summary>Advanced controls</summary>
      <div class="form-grid">
        <label class="field"><span>Candidate limit</span><input name="candidateLimit" type="number" min="1" max="20" value="5"></label>
        <label class="field"><span>Timeout (seconds)</span><input name="timeoutSeconds" type="number" min="30" max="3600" value="900"></label>
        <label class="field"><span>Failure threshold</span><input name="failureThreshold" type="number" min="1" max="10" value="1"></label>
        <label class="field"><span>ACP payment authorization</span><input value="One-time, per job" disabled><small>Each exact ACP funding request needs a separate approval. There is no subscription or automatic recurring charge.</small></label>
        <label class="toggle field-wide"><input name="baseEnabled" type="checkbox"><span>Enable separate Base settlement after verified ACP success</span></label>
        <label class="field" data-base-amount hidden><span>Base settlement amount</span><input name="baseAmount" inputmode="decimal" placeholder="0.0001"><small>Must not exceed the configured 0.001 ETH maximum.</small></label>
      </div>
    </details>
    <div class="form-actions"><p class="caption" data-form-status>Nothing is spent when a mission is created.</p><button class="button" type="submit">Create mission</button></div>
  </form>`;
}

async function renderNewMission() {
  app.innerHTML = `${pageHead('Mission control', 'New Mission', 'Create durable mission state first. Discovery is a separate read-only step and all financial actions require later approval.')}${missionForm()}`;
  const form = document.querySelector('[data-new-mission]');
  const baseToggle = form.querySelector('[name="baseEnabled"]');
  const baseAmount = form.querySelector('[data-base-amount]');
  baseToggle.addEventListener('change', () => {
    baseAmount.hidden = !baseToggle.checked;
    baseAmount.querySelector('input').required = baseToggle.checked;
  });
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const submit = form.querySelector('button[type="submit"]');
    const note = form.querySelector('[data-form-status]');
    const values = new FormData(form);
    const capabilities = String(values.get('capabilities') || '')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean);
    const constraints = {
      capabilities,
      budgetCurrency: 'USDC',
      runner: {
        maximumRetries: 0,
        candidateLimit: Number(values.get('candidateLimit')),
        timeoutMs: Number(values.get('timeoutSeconds')) * 1000,
        failureThreshold: Number(values.get('failureThreshold')),
      },
    };
    if (baseToggle.checked) {
      constraints.requireBaseAction = true;
      constraints.baseAction = {
        required: true,
        purpose: 'MISSION_SUCCESS_SETTLEMENT',
        amount: String(values.get('baseAmount')),
        asset: 'ETH',
      };
    }
    submit.disabled = true;
    note.textContent = 'Creating persisted mission...';
    try {
      const mission = await protectedRequest('/api/v1/missions', {
        method: 'POST',
        body: {
          objective: String(values.get('objective')),
          budget: String(values.get('budget')),
          constraints,
        },
      });
      state.overview = null;
      history.pushState({}, '', `/dashboard/missions/${encodeURIComponent(mission.id)}`);
      await route(true);
    } catch (error) {
      note.textContent = error instanceof Error ? error.message : 'Mission could not be created.';
      submit.disabled = false;
    }
  });
}

async function renderMissions() {
  const data = await overview();
  app.innerHTML = `${pageHead('Mission control', 'Missions', 'Inspect every autonomous operation from intake through verified outcome and memory update.', '<a class="button" href="/dashboard/missions/new">New Mission</a>')}
    <div class="filters"><label><span class="caption">Search missions</span><input id="mission-search" class="search" type="search" placeholder="Objective or mission ID" autocomplete="off" /></label><label><span class="caption">Filter status</span><select id="mission-status" class="search"><option value="">All statuses</option>${[...new Set(data.missions.map(({ status }) => status))].map((value) => `<option>${escapeHtml(value)}</option>`).join('')}</select></label></div><div id="mission-results">${missionRows(data.missions)}</div>`;
  const update = () => {
    const query = document.querySelector('#mission-search').value.trim().toLowerCase();
    const selected = document.querySelector('#mission-status').value;
    const filtered = data.missions.filter(
      (mission) =>
        (!query || `${mission.objective} ${mission.id}`.toLowerCase().includes(query)) &&
        (!selected || mission.status === selected),
    );
    document.querySelector('#mission-results').innerHTML = missionRows(filtered);
  };
  document.querySelector('#mission-search').addEventListener('input', update);
  document.querySelector('#mission-status').addEventListener('change', update);
}

async function renderAccessAdmin() {
  const data = await protectedRequest('/api/v1/access-admin/requests');
  const requests = data.requests || [];
  app.innerHTML = `${pageHead('Access administration', 'Private-beta requests', 'Review applicants, issue single-use invitations, and keep judge workspaces unable to spend.')}
    <div class="filters"><span class="caption">${requests.length} request${requests.length === 1 ? '' : 's'} · applicant details are operator-only</span><a class="button secondary" href="/dashboard/access">Refresh</a></div>
    <div class="stack">${requests.length ? requests.map((request) => `<article class="panel panel-pad"><div class="section-heading"><div><p class="eyebrow">${escapeHtml(request.role)}</p><h2>${escapeHtml(request.email)}</h2></div>${status(request.status)}</div><p>${escapeHtml(request.workflow || 'No workflow description supplied.')}</p><p class="caption">Requested ${escapeHtml(fmtDate(request.createdAt))}</p>${request.status === 'PENDING' ? `<form class="mission-form" data-access-approve="${request.id}"><div class="form-grid"><label class="field"><span>Workspace name</span><input name="organizationName" value="${escapeHtml(request.email.split('@')[0])} workspace" required></label><label class="field"><span>Access type</span><select name="organizationMode"><option value="CUSTOMER">Customer</option><option value="JUDGE">Judge sandbox (no spending)</option></select></label><label class="field"><span>Role</span><select name="role"><option>OWNER</option><option>OPERATOR</option><option>FINANCE_APPROVER</option><option>VIEWER</option><option>JUDGE</option></select></label><label class="field"><span>Maximum mission budget (USDC)</span><input name="maximumMissionBudget" value="1.00" required></label><label class="field"><span>Maximum ACP job (USDC)</span><input name="maximumAcpJobUsdc" value="1.00" required></label><label class="toggle field-wide"><input name="spendingEnabled" type="checkbox"><span>Permit paid execution (customer workspaces only)</span></label></div><div class="form-actions"><button class="button" type="submit">Approve and send invitation</button><button class="button danger" type="button" data-access-reject="${request.id}">Reject</button><span class="caption" data-access-status></span></div></form>` : request.status === 'APPROVED' ? `<div class="form-actions"><button class="button secondary" type="button" data-access-reissue="${request.id}">Reissue invitation</button><span class="caption" data-access-status></span></div>` : request.reviewNote ? `<p class="caption">Review note: ${escapeHtml(request.reviewNote)}</p>` : ''}</article>`).join('') : empty('No beta requests', 'New consented requests will appear here.')}</div>`;
  document.querySelectorAll('[data-access-approve]').forEach((form) =>
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const statusNote = form.querySelector('[data-access-status]');
      const values = new FormData(form);
      const mode = String(values.get('organizationMode'));
      try {
        const result = await protectedRequest(
          `/api/v1/access-admin/requests/${form.dataset.accessApprove}/approve`,
          {
            method: 'POST',
            body: {
              organizationName: String(values.get('organizationName')),
              organizationMode: mode,
              role: mode === 'JUDGE' ? 'JUDGE' : String(values.get('role')),
              spendingEnabled: mode === 'CUSTOMER' && values.get('spendingEnabled') === 'on',
              maximumMissionBudget: String(values.get('maximumMissionBudget')),
              maximumAcpJobUsdc: String(values.get('maximumAcpJobUsdc')),
            },
          },
        );
        statusNote.className = 'caption success';
        statusNote.textContent =
          result.delivery === 'SENT'
            ? 'Invitation email sent.'
            : `Email not sent (${result.delivery}). Copy the invitation securely: ${result.inviteUrl}`;
      } catch (error) {
        statusNote.className = 'caption error';
        statusNote.textContent = error.message;
      }
    }),
  );
  document.querySelectorAll('[data-access-reject]').forEach((button) =>
    button.addEventListener('click', async () => {
      const note = window.prompt('Optional rejection note') || undefined;
      await protectedRequest(
        `/api/v1/access-admin/requests/${button.dataset.accessReject}/reject`,
        { method: 'POST', body: { reviewNote: note } },
      );
      await renderAccessAdmin();
    }),
  );
  document.querySelectorAll('[data-access-reissue]').forEach((button) =>
    button.addEventListener('click', async () => {
      const statusNote = button.parentElement.querySelector('[data-access-status]');
      try {
        const result = await protectedRequest(
          `/api/v1/access-admin/requests/${button.dataset.accessReissue}/reissue`,
          { method: 'POST' },
        );
        statusNote.textContent =
          result.delivery === 'SENT'
            ? 'New invitation email sent.'
            : `Email not sent (${result.delivery}). Copy securely: ${result.inviteUrl}`;
      } catch (error) {
        statusNote.className = 'caption error';
        statusNote.textContent = error.message;
      }
    }),
  );
}

function pipelineFor(data) {
  const hasVerification = data.jobs.some((job) => job.verification);
  const stages = [
    ['Mission', true],
    ['Memory recalled', data.memory.records.length > 0],
    ['Agents considered', data.agents.length > 0 || data.jobs.length > 0],
    ['Decision', Boolean(data.decision)],
    ['Execution', data.jobs.length > 0],
    ['Verification', hasVerification],
    ['Base action', data.transactions.length > 0 || data.mission.status === 'COMPLETED'],
    [
      'Memory updated',
      data.memory.records.some(({ category }) =>
        ['experience', 'failure', 'outcome'].includes(category),
      ),
    ],
  ];
  const current = stages.findIndex(([, complete]) => !complete);
  return `<div class="panel pipeline" aria-label="Mission lifecycle">${stages.map(([label, complete], index) => `<div class="pipeline-step ${complete ? 'complete' : index === current ? 'current' : ''}"><span class="step-node">${complete ? '✓' : index + 1}</span><span class="step-label">${escapeHtml(label)}</span></div>`).join('')}</div>`;
}

function verificationPanel(data) {
  const job = [...data.jobs].reverse().find((item) => item.verification);
  if (!job)
    return empty(
      'Verification pending',
      'No external result has reached deterministic verification yet.',
    );
  const verification = job.verification;
  const passed = verification.passed === true;
  return `<div class="panel panel-pad"><div class="section-heading"><h2>Verification</h2>${status(passed ? 'PASS' : 'FAIL')}</div><div class="receipt"><div class="receipt-item"><span>Score</span><strong>${verification.score ?? '—'}</strong></div><div class="receipt-item"><span>Verifier</span><strong>${escapeHtml(verification.verifierVersion || 'Continuity')}</strong></div></div><p class="caption" style="margin-top:1rem">${escapeHtml((verification.reasons || []).join(' ') || 'Verification report persisted with the job.')}</p></div>`;
}

function basePanel(data) {
  const transaction = data.transactions.at(-1);
  const configured = data.product?.base;
  const action = data.mission.constraints?.baseAction;
  if (!transaction) {
    if (!action)
      return empty(
        'Base settlement off',
        'This mission does not request a separate Base settlement.',
      );
    const awaiting = data.mission.status === 'AWAITING_BASE_APPROVAL';
    return `<div class="panel panel-pad"><div class="section-heading"><h2>Base settlement</h2>${status(awaiting ? 'AWAITING_APPROVAL' : 'PENDING_VERIFICATION')}</div><p class="caption">Separate from ACP provider funding. No transaction is sent without explicit approval.</p><div class="receipt"><div class="receipt-item"><span>Network</span><strong>${escapeHtml(configured?.network || 'Base Mainnet')}</strong></div><div class="receipt-item"><span>Chain ID</span><strong>${escapeHtml(configured?.chainId || '8453')}</strong></div><div class="receipt-item"><span>Asset</span><strong>${escapeHtml(configured?.asset || action.asset || 'ETH')}</strong></div><div class="receipt-item"><span>Recipient</span><strong title="${escapeHtml(configured?.recipient || '')}">${escapeHtml(shortId(configured?.recipient))}</strong></div><div class="receipt-item"><span>Exact amount</span><strong>${escapeHtml(action.amount || '—')} ${escapeHtml(action.asset || configured?.asset || 'ETH')}</strong></div><div class="receipt-item"><span>Configured maximum</span><strong>${escapeHtml(configured?.maximumAmount || '—')} ${escapeHtml(configured?.asset || 'ETH')}</strong></div></div>${awaiting ? '<button class="button danger" type="button" data-approve-base>Approve Base mainnet transaction</button>' : ''}</div>`;
  }
  const explorer =
    transaction.explorerUrl && /^https:\/\//.test(transaction.explorerUrl)
      ? transaction.explorerUrl
      : null;
  return `<div class="panel panel-pad"><div class="section-heading"><h2>Base action</h2>${status(transaction.status)}</div><p class="caption">${escapeHtml(transaction.purpose || 'Mission-linked onchain action.')}</p><div class="receipt"><div class="receipt-item"><span>Amount</span><strong>${escapeHtml(transaction.amount)} ${escapeHtml(transaction.asset)}</strong></div><div class="receipt-item"><span>Network</span><strong>${escapeHtml(transaction.network)}</strong></div><div class="receipt-item"><span>Recipient</span><strong title="${escapeHtml(transaction.recipient)}">${escapeHtml(shortId(transaction.recipient))}</strong></div><div class="receipt-item"><span>Transaction</span><strong title="${escapeHtml(transaction.transactionHash)}">${escapeHtml(shortId(transaction.transactionHash))}</strong></div><div class="receipt-item"><span>Confirmations</span><strong>${transaction.confirmations ?? '—'}</strong></div><div class="receipt-item"><span>Sibyl link</span><strong title="${escapeHtml(transaction.sibylRecordId)}">${escapeHtml(shortId(transaction.sibylRecordId))}</strong></div></div>${explorer ? `<a class="button secondary" style="margin-top:1rem" href="${escapeHtml(explorer)}" target="_blank" rel="noopener noreferrer">View on explorer ↗</a>` : ''}</div>`;
}

function virtualsPanel(data) {
  const job = data.jobs.at(-1);
  if (!job) return empty('No Virtuals receipt', 'No external ACP job is linked to this mission.');
  const proposed = job.lifecycle?.proposedBudget;
  const awaiting = job.state === 'AWAITING_FUNDING_APPROVAL';
  const selected = data.decision?.candidates?.find((candidate) => candidate.selected);
  return `<div class="panel panel-pad"><div class="section-heading"><h2>Virtuals ACP</h2>${status(job.state)}</div><div class="receipt"><div class="receipt-item"><span>Provider name</span><strong>${escapeHtml(selected?.name || 'Not supplied')}</strong></div><div class="receipt-item"><span>Provider agent ID</span><strong title="${escapeHtml(job.agentId)}">${escapeHtml(job.agentId)}</strong></div><div class="receipt-item"><span>Provider wallet</span><strong title="${escapeHtml(job.providerAddress)}">${escapeHtml(shortId(job.providerAddress))}</strong></div><div class="receipt-item"><span>Offering</span><strong>${escapeHtml(job.offeringName)}</strong></div><div class="receipt-item"><span>Offering ID</span><strong>${escapeHtml(selected?.offeringId || selected?.offeringName || 'Not supplied')}</strong></div><div class="receipt-item"><span>Advertised price</span><strong>${escapeHtml(selected?.price?.amount || 'Not supplied')} ${escapeHtml(selected?.price?.currency || '')}</strong></div><div class="receipt-item"><span>ACP job ID</span><strong title="${escapeHtml(job.externalJobId)}">${escapeHtml(job.externalJobId)}</strong></div><div class="receipt-item"><span>Chain</span><strong>${job.chainId}</strong></div><div class="receipt-item"><span>Budget proposal</span><strong>${escapeHtml(proposed?.amount || '—')} ${escapeHtml(proposed?.currency || '')}</strong></div><div class="receipt-item"><span>Created</span><strong>${escapeHtml(fmtDate(job.createdAt))}</strong></div><div class="receipt-item"><span>Last observed</span><strong>${escapeHtml(fmtDate(job.updatedAt))}</strong></div><div class="receipt-item wide"><span>Observed lifecycle</span><strong>${escapeHtml((job.lifecycle?.observedStates || [job.state]).join(' → '))}</strong></div></div>${awaiting ? `<div class="approval-callout"><strong>One-time approval: ${escapeHtml(proposed?.amount || '—')} ${escapeHtml(proposed?.currency || 'USDC')} for this ACP job</strong><p>Mission budget: ${escapeHtml(data.mission.budget)} USDC · Per-job maximum: ${escapeHtml(data.product?.virtuals?.maxJobUsdc ?? '—')} USDC · Approval scope: this provider job and exact amount only · Automatic recurring charges: disabled</p><button class="button danger" type="button" data-approve-acp>Approve this one-time ACP payment</button></div>` : ''}</div>`;
}

function discoveryPanel(data) {
  const preview = state.discovery.get(data.mission.id);
  if (!preview)
    return `<div class="panel panel-pad"><div class="section-heading"><h2>Discover agents</h2>${status('READ_ONLY')}</div><p>Query the real Virtuals marketplace and Sibyl history before creating an ACP job. Discovery cannot fund a job or send a Base transaction.</p><button class="button" type="button" data-discover>${data.mission.status === 'COMPLETED' ? 'Preview routing again' : 'Discover Agents'}</button></div>`;
  const evidence = new Map((preview.decision?.evidence || []).map((item) => [item.agentId, item]));
  return `<div class="panel panel-pad"><div class="section-heading"><h2>Real Virtuals candidates</h2>${status('NO_SPEND')}</div><p class="decision-quote">${escapeHtml(preview.decision?.reason || 'Sibyl routing preview returned no explanation.')}</p><div class="candidate-grid">${preview.candidates
    .map((candidate) => {
      const score = evidence.get(candidate.agent.id);
      const selected = preview.decision?.selectedAgent?.id === candidate.agent.id;
      return `<article class="candidate ${selected ? 'selected' : ''}"><div class="section-heading"><h3>${escapeHtml(candidate.agent.name)}</h3>${selected ? status('SELECTED') : ''}</div><p class="mono caption">${escapeHtml(candidate.agent.id)}</p><div class="receipt"><div class="receipt-item"><span>Offering</span><strong>${escapeHtml(candidate.offeringName)}</strong></div><div class="receipt-item"><span>Offering ID</span><strong>${escapeHtml(candidate.offeringId || 'Not supplied')}</strong></div><div class="receipt-item"><span>Current price</span><strong>${escapeHtml(candidate.agent.cost?.amount || 'Not supplied')} ${escapeHtml(candidate.agent.cost?.currency || '')}</strong></div><div class="receipt-item"><span>SLA</span><strong>${escapeHtml(candidate.agent.metadata?.offering?.slaMinutes ?? 'Not supplied')}${candidate.agent.metadata?.offering?.slaMinutes !== undefined ? ' min' : ''}</strong></div><div class="receipt-item"><span>Compatibility</span><strong>${escapeHtml(candidate.compatibility?.compatible === false ? 'Not compatible' : 'Compatible')}</strong></div><div class="receipt-item"><span>Sibyl score</span><strong>${score?.finalScore ?? '—'}</strong></div><div class="receipt-item"><span>Historical observations</span><strong>${score?.metrics?.observationCount ?? 0}</strong></div></div></article>`;
    })
    .join(
      '',
    )}</div><div class="form-actions"><p class="caption">Preview only. No ACP job, funding, or Base transaction was created.</p><button class="button secondary" type="button" data-discover>Refresh preview</button></div></div>`;
}

function persistedRoutingPanel(decision) {
  if (!decision?.candidates?.length)
    return empty(
      'Persisted routing evidence pending',
      'Candidate scores and citations will be stored when execution makes its decision.',
    );
  return `<div class="panel panel-pad"><div class="section-heading"><h2>Persisted routing evidence</h2><span class="caption">Exact scores and Sibyl citations used</span></div><div class="candidate-grid">${decision.candidates.map((candidate) => `<article class="candidate ${candidate.selected ? 'selected' : ''}"><div class="section-heading"><h3>${escapeHtml(candidate.name || candidate.agentId)}</h3>${candidate.selected ? status('SELECTED') : ''}</div><div class="receipt"><div class="receipt-item"><span>Final score</span><strong>${candidate.finalScore ?? '—'}</strong></div><div class="receipt-item"><span>Historical score</span><strong>${candidate.historicalScore ?? '—'}</strong></div><div class="receipt-item"><span>Success rate</span><strong>${percent(candidate.successRate)}</strong></div><div class="receipt-item"><span>Compatibility</span><strong>${candidate.compatibilityScore ?? 'Not supplied'}</strong></div><div class="receipt-item"><span>Price</span><strong>${escapeHtml(candidate.price?.amount || 'Not supplied')} ${escapeHtml(candidate.price?.currency || '')}</strong></div><div class="receipt-item"><span>Offering</span><strong>${escapeHtml(candidate.offeringName || 'Not supplied')}</strong></div></div><p class="caption">Citations: ${(candidate.memoryReferences || []).length ? candidate.memoryReferences.map((ref) => `<span class="mono wrap">${escapeHtml(ref)}</span>`).join('<br>') : 'None'}</p></article>`).join('')}</div></div>`;
}

function resultAndEvidence(data) {
  const job = [...data.jobs].reverse().find((item) => item.result || item.evidenceHash);
  if (!job)
    return empty(
      'Result and evidence pending',
      'The real provider deliverable and SHA-256 evidence receipt will appear after submission and verification.',
    );
  const deliverable = job.result?.output ?? job.result?.value ?? job.result;
  const text = typeof deliverable === 'string' ? deliverable : JSON.stringify(deliverable, null, 2);
  return `<div class="stack"><div class="panel panel-pad"><div class="section-heading"><h2>Provider deliverable</h2>${status('PERSISTED')}</div><pre class="deliverable">${escapeHtml(text || 'No deliverable content persisted.')}</pre></div><div class="panel panel-pad"><div class="section-heading"><h2>SHA-256 evidence</h2>${status(job.evidenceHash ? 'PERSISTED' : 'PENDING')}</div><div class="receipt"><div class="receipt-item wide"><span>Evidence hash</span><strong class="mono wrap">${escapeHtml(job.evidenceHash || 'Pending')}</strong></div><div class="receipt-item"><span>ACP provider</span><strong>${escapeHtml(job.provenance?.providerId || job.agentId)}</strong></div><div class="receipt-item"><span>Offering</span><strong>${escapeHtml(job.provenance?.offeringId || job.offeringName)}</strong></div><div class="receipt-item"><span>Captured</span><strong>${escapeHtml(fmtDate(job.provenance?.evidenceCapturedAt || job.updatedAt))}</strong></div></div></div></div>`;
}

function recoveryPanel(data) {
  const mission = data.mission;
  const ambiguous =
    mission.recoveryState === 'BLOCKED' ||
    data.jobs.some((job) => job.state === 'UNCERTAIN') ||
    data.transactions.some((tx) => tx.status === 'UNCERTAIN');
  const resumable =
    ['CREATED', 'AWAITING_FUNDING_APPROVAL', 'AWAITING_BASE_APPROVAL'].includes(mission.status) &&
    !ambiguous;
  return `<div class="panel panel-pad"><div class="section-heading"><h2>Recovery</h2>${status(ambiguous ? 'BLOCKED' : resumable ? 'SAFE' : mission.recoveryState || 'OBSERVING')}</div><div class="receipt"><div class="receipt-item"><span>Recovery state</span><strong>${escapeHtml(mission.recoveryState || 'No intervention')}</strong></div><div class="receipt-item"><span>Last reconciliation</span><strong>${escapeHtml(fmtDate(mission.lastReconciliation))}</strong></div><div class="receipt-item"><span>Safe to resume</span><strong>${resumable ? 'YES' : 'NO'}</strong></div><div class="receipt-item"><span>Ambiguous side effect</span><strong>${ambiguous ? 'BLOCKS RETRY' : 'NONE'}</strong></div></div>${mission.recoveryFailureReason ? `<p class="caption">${escapeHtml(mission.recoveryFailureReason)}</p>` : ''}${mission.status === 'RECOVERING' ? '<button class="button secondary" type="button" data-reconcile>Reconcile and resume if safe</button>' : ''}</div>`;
}

async function renderMissionDetail(id) {
  const data = await detail(id);
  const decision = data.decision;
  app.innerHTML = `<p class="eyebrow"><a href="/dashboard/missions" style="text-decoration:none">Missions</a> / ${escapeHtml(shortId(data.mission.id))}</p>
    ${pageHead('Mission detail', data.mission.objective, `Mission ${data.mission.id}`, status(data.mission.status))}
    ${pipelineFor(data)}
    <section class="section">${memoryImpact(data.memory.trace)}</section>
    <section class="section split"><div class="why"><p class="eyebrow">Decision explanation</p><h2>WHY THIS AGENT?</h2>${decision ? `<ul>${(decision.why.length ? decision.why : ['Selected using available capability, cost, and Sibyl evidence.']).map((reason) => `<li>${escapeHtml(reason)}</li>`).join('')}</ul>` : `<p class="caption" style="color:#a8bbb1">Selection has not been recorded yet.</p>`}</div><div class="panel panel-pad"><div class="section-heading"><h2>Decision</h2>${decision?.confidence !== undefined ? `<span class="mono caption">${percent(decision.confidence)} confidence</span>` : ''}</div>${decision ? `<p class="eyebrow">Selected agent</p><h3 class="mono">${escapeHtml(decision.selectedAgentId || 'Unknown')}</h3><div class="decision-quote">${escapeHtml(decision.reason || 'Decision stored without an explanation.')}</div>` : `<p class="caption">Awaiting candidate evaluation.</p>`}</div></section>
    <section class="section"><div class="section-heading"><h2>Agents considered</h2><span class="caption">Evidence aggregated from relevant Sibyl outcomes</span></div>${agentCards(data.agents, decision?.selectedAgentId)}</section>
    <section class="section split"><div><div class="section-heading"><h2>Memory that affected this decision</h2><a href="/dashboard/memory?mission=${encodeURIComponent(id)}">Open explorer →</a></div>${memoryCards(
      data.memory.records.filter((record) =>
        decision?.memoryReferences.includes(record.sibylRecordId),
      ),
      decision?.memoryReferences,
    )}</div><aside class="stack">${verificationPanel(data)}${basePanel(data)}</aside></section>
    <section class="section"><div class="section-heading"><h2>Execution & activity</h2><a href="/dashboard/activity?mission=${encodeURIComponent(id)}">Full activity →</a></div>${activityList(data)}</section>
    <section class="section"><div class="section-heading"><h2>Memory updated</h2><span class="caption">New operational knowledge available to future decisions</span></div>${memoryCards(
      data.memory.records.filter(
        ({ category, missionId }) =>
          missionId === data.mission.id &&
          ['experience', 'failure', 'outcome', 'recovery_checkpoint'].includes(category),
      ),
      decision?.memoryReferences,
    )}</section>`;
}

async function renderMissionWorkspace(id) {
  const data = await detail(id);
  const decision = data.decision;
  const canCancel = [
    'CREATED',
    'AWAITING_FUNDING_APPROVAL',
    'AWAITING_BASE_APPROVAL',
    'RECOVERING',
  ].includes(data.mission.status);
  const canRun = data.mission.status === 'CREATED';
  const hasPreview = state.discovery.has(id);
  app.innerHTML = `<p class="eyebrow"><a href="/dashboard/missions">Missions</a> / ${escapeHtml(shortId(id))}</p>
    ${pageHead('Mission workspace', data.mission.objective, `Mission ${data.mission.id}`, `<div class="workspace-actions">${status(data.mission.status)}${canRun ? `<button class="button" type="button" data-run ${hasPreview ? '' : 'disabled'}>Run Mission</button>` : ''}${canCancel ? '<button class="button secondary" type="button" data-cancel>Cancel</button>' : ''}</div>`)}
    <section class="mission-summary panel panel-pad"><div class="receipt"><div class="receipt-item wide"><span>Mission ID</span><strong class="mono wrap">${escapeHtml(data.mission.id)}</strong></div><div class="receipt-item"><span>Status</span><strong>${escapeHtml(data.mission.status)}</strong></div><div class="receipt-item"><span>Budget</span><strong>${escapeHtml(data.mission.budget)} ${escapeHtml(data.mission.constraints?.budgetCurrency || 'USDC')}</strong></div><div class="receipt-item"><span>Created</span><strong>${escapeHtml(fmtDate(data.mission.createdAt))}</strong></div><div class="receipt-item"><span>Updated</span><strong>${escapeHtml(fmtDate(data.mission.updatedAt))}</strong></div><div class="receipt-item wide"><span>Capabilities</span><strong>${escapeHtml((data.mission.constraints?.capabilities || data.capabilities || []).join(', ') || 'Inferred from objective')}</strong></div></div><details class="advanced"><summary>Mission constraints</summary><pre class="technical-detail">${escapeHtml(JSON.stringify(data.mission.constraints || {}, null, 2))}</pre></details>${canRun && !hasPreview ? '<p class="notice">Discover real candidates before starting the paid workflow.</p>' : ''}<p class="caption" data-action-status></p></section>
    ${pipelineFor(data)}
    <section class="section">${discoveryPanel(data)}</section>
    <section class="section">${memoryImpact(data.memory.trace)}</section>
    <section class="section split"><div class="why"><p class="eyebrow">Sibyl-informed routing</p><h2>WHY THIS AGENT?</h2>${decision ? `<ul>${(decision.why.length ? decision.why : ['Selected using available capability, cost, and Sibyl evidence.']).map((reason) => `<li>${escapeHtml(reason)}</li>`).join('')}</ul>` : '<p class="caption">No execution decision has been persisted yet. Use discovery for a read-only preview.</p>'}</div><div class="panel panel-pad"><div class="section-heading"><h2>Routing decision</h2>${decision?.confidence !== undefined ? `<span class="mono caption">${percent(decision.confidence)} confidence</span>` : ''}</div>${decision ? `<p class="eyebrow">Selected provider</p><h3 class="mono">${escapeHtml(decision.selectedAgentId || 'Unknown')}</h3><div class="decision-quote">${escapeHtml(decision.reason || 'Decision stored without an explanation.')}</div>` : '<p class="caption">Awaiting execution routing.</p>'}</div></section>
    <section class="section">${persistedRoutingPanel(decision)}</section>
    <section class="section"><div class="section-heading"><h2>Historical performance</h2><span class="caption">Real Sibyl outcomes relevant to this mission</span></div>${agentCards(data.agents, decision?.selectedAgentId)}</section>
    <section class="section split"><div><div class="section-heading"><h2>Memory read before decision</h2><a href="/dashboard/memory?mission=${encodeURIComponent(id)}">Open explorer</a></div><p class="caption">Recall query: ${escapeHtml(data.memory.query || 'No query recorded')}</p>${memoryCards(
      data.memory.records.filter((record) =>
        decision?.memoryReferences.includes(record.sibylRecordId),
      ),
      decision?.memoryReferences,
    )}</div><aside class="stack">${virtualsPanel(data)}${verificationPanel(data)}</aside></section>
    <section class="section split"><div>${resultAndEvidence(data)}</div><aside class="stack">${basePanel(data)}${recoveryPanel(data)}</aside></section>
    <section class="section"><div class="section-heading"><h2>Lifecycle timeline</h2><a href="/dashboard/activity?mission=${encodeURIComponent(id)}">Full activity</a></div>${activityList(data)}</section>
    <section class="section"><div class="section-heading"><h2>Memory written afterward</h2><span class="caption">New real evidence available to future routing</span></div>${memoryCards(data.memory.trace?.writtenAfterward || [], decision?.memoryReferences)}</section>`;

  const note = document.querySelector('[data-action-status]');
  const act = async (button, message, request) => {
    button.disabled = true;
    note.textContent = message;
    try {
      await request();
      state.overview = null;
      state.details.delete(id);
      await route(true);
    } catch (error) {
      note.textContent = error instanceof Error ? error.message : 'The operation failed.';
      button.disabled = false;
    }
  };
  document.querySelectorAll('[data-discover]').forEach((button) =>
    button.addEventListener('click', () =>
      act(button, 'Reading Virtuals discovery and Sibyl memory...', async () => {
        const capabilities = data.mission.constraints?.capabilities || data.capabilities;
        const preview = await protectedRequest('/api/v1/virtuals/discovery', {
          method: 'POST',
          body: {
            missionId: id,
            objective: data.mission.objective,
            capabilities,
            candidateLimit: data.mission.constraints?.runner?.candidateLimit || 5,
          },
        });
        state.discovery.set(id, preview);
      }),
    ),
  );
  document
    .querySelector('[data-run]')
    ?.addEventListener('click', (event) =>
      act(event.currentTarget, 'Queuing mission. Funding still requires approval.', () =>
        protectedRequest(`/api/v1/missions/${encodeURIComponent(id)}/run`, { method: 'POST' }),
      ),
    );
  document
    .querySelector('[data-cancel]')
    ?.addEventListener('click', (event) =>
      act(event.currentTarget, 'Cancelling mission...', () =>
        protectedRequest(`/api/v1/missions/${encodeURIComponent(id)}/cancel`, { method: 'POST' }),
      ),
    );
  document.querySelector('[data-approve-acp]')?.addEventListener('click', (event) =>
    act(event.currentTarget, 'Persisting exact ACP approval and resuming...', () =>
      protectedRequest(`/api/v1/missions/${encodeURIComponent(id)}/approve-acp-spend`, {
        method: 'POST',
        body: { approved: true },
      }),
    ),
  );
  document.querySelector('[data-approve-base]')?.addEventListener('click', (event) =>
    act(event.currentTarget, 'Persisting separate Base approval and resuming...', () =>
      protectedRequest(`/api/v1/missions/${encodeURIComponent(id)}/approve-base-settlement`, {
        method: 'POST',
        body: { approved: true },
      }),
    ),
  );
  document.querySelector('[data-reconcile]')?.addEventListener('click', (event) =>
    act(event.currentTarget, 'Starting durable reconciliation...', () =>
      protectedRequest(`/api/v1/missions/${encodeURIComponent(id)}/reconcile`, {
        method: 'POST',
      }),
    ),
  );
  if (
    ['QUEUED', 'PLANNING', 'SELECTING_AGENT', 'EXECUTING', 'VERIFYING', 'RECOVERING'].includes(
      data.mission.status,
    )
  ) {
    state.pollTimer = window.setTimeout(() => {
      state.overview = null;
      state.details.delete(id);
      route(true);
    }, 3000);
  }
}

async function contextualDetail() {
  const queryId = new URLSearchParams(location.search).get('mission');
  const data = await overview();
  const id = queryId || data.missions[0]?.id;
  return id ? detail(id) : null;
}

async function renderAgents() {
  const data = await contextualDetail();
  app.innerHTML = `${pageHead('Capability-specific trust', 'Agent experience', 'Success is not universal. Continuity evaluates each agent against recalled capability, verification, cost, and failure evidence.')}${data ? `<div class="section-heading"><h2>Relevant to: ${escapeHtml(data.mission.objective)}</h2><a href="/dashboard/missions/${encodeURIComponent(data.mission.id)}">Mission detail →</a></div>${agentCards(data.agents, data.decision?.selectedAgentId)}` : empty('No agent evidence', 'Run a mission to generate and recall capability-specific experience.')}`;
}

async function renderMemory() {
  const data = await contextualDetail();
  if (!data) {
    app.innerHTML = `${pageHead('Sibyl evidence', 'Memory explorer', 'Inspect the historical experience that makes Continuity decisions adaptive.')}${empty('No memory context', 'Create a mission before exploring relevant Sibyl memory.')}`;
    return;
  }
  const records = data.memory.records;
  const scopes = {
    all: records,
    retrieved: data.memory.trace.retrieved,
    affected: data.memory.trace.affectedDecision,
    writes: data.memory.trace.missionWrites,
    afterward: data.memory.trace.writtenAfterward,
  };
  app.innerHTML = `${pageHead('Sibyl evidence', 'Memory explorer', 'Every record shown here came through the production MemoryService read boundary. Decision citations are highlighted.')}
    ${memoryImpact(data.memory.trace)}
    <div class="panel panel-pad" style="margin-bottom:1rem"><p class="eyebrow">Active recall query</p><p class="mono caption" style="margin:0">${escapeHtml(data.memory.query)}</p></div>
    <div class="filters"><label><span class="caption">Memory boundary</span><select id="memory-scope" class="search"><option value="all">All remembered</option><option value="retrieved">Retrieved for decision</option><option value="affected">Affected decision</option><option value="writes">Written for mission</option><option value="afterward">Written afterward</option></select></label><label><span class="caption">Search memory</span><input id="memory-search" class="search" type="search" placeholder="Agent, result, reference…" /></label><label><span class="caption">Category</span><select id="memory-category" class="search"><option value="">All categories</option>${[...new Set(records.map(({ category }) => category))].map((value) => `<option>${escapeHtml(value)}</option>`).join('')}</select></label></div><div id="memory-results">${memoryCards(records, data.decision?.memoryReferences)}</div>`;
  const update = () => {
    const scope = document.querySelector('#memory-scope').value;
    const query = document.querySelector('#memory-search').value.trim().toLowerCase();
    const category = document.querySelector('#memory-category').value;
    const filtered = scopes[scope].filter(
      (record) =>
        (!category || record.category === category) &&
        (!query || JSON.stringify(record).toLowerCase().includes(query)),
    );
    document.querySelector('#memory-results').innerHTML = memoryCards(
      filtered,
      data.decision?.memoryReferences,
    );
  };
  document.querySelector('#memory-scope').addEventListener('change', update);
  document.querySelector('#memory-search').addEventListener('input', update);
  document.querySelector('#memory-category').addEventListener('change', update);
}

function judgeCandidateEvidence(decision) {
  const candidates = decision?.candidates || [];
  if (!candidates.length)
    return empty(
      'Candidate evidence unavailable',
      'This decision predates structured candidate receipts. Run a new mission with the final backend.',
    );
  return `<div class="decision-grid panel"><div class="decision-grid-row header"><span>Candidate / offering</span><span>Price</span><span>Compatibility</span><span>History</span><span>Score</span></div>${candidates
    .map(
      (candidate) =>
        `<div class="decision-grid-row ${candidate.selected ? 'selected' : ''}"><span><strong>${escapeHtml(candidate.name)}</strong><small>${escapeHtml(candidate.offeringName || 'Offering not reported')}</small></span><span>${candidate.price ? `${escapeHtml(candidate.price.amount)} ${escapeHtml(candidate.price.currency)}` : '—'}</span><span>${candidate.compatible === false ? 'INCOMPATIBLE' : candidate.compatibilityScore === undefined ? 'Not reported' : `${Math.round(candidate.compatibilityScore * 100)}% match`}</span><span>${candidate.observationCount} observations · ${candidate.failurePatterns.reduce((sum, item) => sum + item.count, 0)} failures</span><span><strong>${candidate.finalScore}</strong>${candidate.selected ? '<small>SELECTED</small>' : ''}</span></div>`,
    )
    .join('')}</div>`;
}

function judgeExecutionTimeline(data) {
  const job = data.jobs.at(-1);
  const transaction = data.transactions.at(-1);
  const outcome = data.memory.trace.outcome;
  const stages = [
    ['Mission created', true, data.mission.id],
    [
      'Sibyl history recalled',
      data.memory.trace.retrieved.length > 0,
      `${data.memory.trace.retrieved.length} records`,
    ],
    [
      'Candidates discovered',
      (data.decision?.candidates?.length || 0) > 0,
      `${data.decision?.candidates?.length || 0} candidates`,
    ],
    [
      'Historical evidence evaluated',
      Boolean(data.decision),
      `${data.decision?.memoryReferences?.length || 0} citations`,
    ],
    ['Decision made', Boolean(data.decision), data.decision?.reason || 'Not recorded'],
    [
      'Agent selected',
      Boolean(data.decision?.selectedAgentId),
      data.decision?.selectedAgentId || 'Not recorded',
    ],
    ['Virtuals ACP job created', Boolean(job?.externalJobId), job?.externalJobId || 'Not recorded'],
    [
      'ACP funding',
      Boolean(job && ['FUNDED', 'SUBMITTED', 'COMPLETED', 'REJECTED'].includes(job.state)),
      job ? `Latest durable state: ${job.state}` : 'Not recorded',
    ],
    [
      'Deliverable received',
      Boolean(job?.result),
      job?.result ? 'Persisted deliverable' : 'Not recorded',
    ],
    [
      'Deterministic verification',
      Boolean(job?.verification),
      job?.verification ? (job.verification.passed ? 'PASS' : 'FAIL') : 'Not recorded',
    ],
    [
      'ACP settlement',
      Boolean(job && ['COMPLETED', 'REJECTED'].includes(job.state)),
      job?.state || 'Not recorded',
    ],
    [
      'Distinct Base action',
      Boolean(transaction),
      transaction
        ? `${transaction.status} · ${transaction.transactionHash || transaction.id}`
        : 'Not required or not recorded',
    ],
    ['Sibyl outcome written', Boolean(outcome), outcome?.sibylRecordId || 'Not recorded'],
    ['Mission completed', data.mission.status === 'COMPLETED', data.mission.status],
  ];
  return `<div class="judge-timeline panel">${stages.map(([label, complete, evidence], index) => `<div class="judge-timeline-row ${complete ? 'complete' : ''}"><span>${String(index + 1).padStart(2, '0')}</span><strong>${escapeHtml(label)}</strong><small>${escapeHtml(evidence)}</small></div>`).join('')}</div>`;
}

async function renderJudgeMode() {
  const overviewData = await publicJudgeOverview();
  const queryId = new URLSearchParams(location.search).get('mission');
  const missionId = queryId || overviewData.missions[0]?.id;
  const data = missionId ? await publicJudgeDetail(missionId) : null;
  if (!data) {
    app.innerHTML = `${pageHead('Judge mode', 'The load-bearing proof', 'A concise view of what Sibyl remembered, what Continuity retrieved, and what changed afterward.')}${empty('No mission proof yet', 'Run a mission to produce a real memory-to-decision trace.')}`;
    return;
  }
  const trace = data.memory.trace;
  const outcome = trace.outcome;
  const missionOptions = overviewData.missions
    .map(
      (mission) =>
        `<option value="${escapeHtml(mission.id)}" ${mission.id === data.mission.id ? 'selected' : ''}>${escapeHtml(mission.objective.slice(0, 68))}</option>`,
    )
    .join('');
  const priorFailure = trace.affectedDecision.find(
    (record) => record.category === 'failure' || record.success === false,
  );
  app.innerHTML = `${pageHead('Judge mode · 60-second proof', 'See memory change an autonomous decision.', 'Every evidence card below comes from the public, read-only runtime receipt API.')}
    <div class="judge-toolbar panel panel-pad"><label><span class="caption">Mission proof</span><select id="judge-mission" class="search">${missionOptions}</select></label><div>${status(data.mission.status)}</div></div>
    <section class="causal-banner panel panel-pad"><strong>${priorFailure ? `${escapeHtml(priorFailure.agentId || 'Agent A')} PREVIOUS FAILURE` : 'PREVIOUS FAILURE NOT RECALLED'}</strong><span>→</span><strong>SIBYL ${priorFailure ? escapeHtml(shortId(priorFailure.sibylRecordId)) : 'NO CITATION'}</strong><span>→</span><strong>${priorFailure ? `${escapeHtml(priorFailure.agentId || 'Agent A')} PENALIZED` : 'NO PENALTY PROVEN'}</strong><span>→</span><strong>${data.decision?.selectedAgentId ? `${escapeHtml(data.decision.selectedAgentId)} SELECTED` : 'NO SELECTION'}</strong></section>
    ${memoryImpact(trace)}
    <section class="judge-proof" aria-label="Sibyl memory causal proof">
      <article class="trace-card"><span class="trace-number">01</span><p class="eyebrow">What was remembered</p><h2>Sibyl held relevant experience</h2>${compactMemoryItems(trace.remembered, 'No relevant Sibyl records were returned.')}</article>
      <span class="trace-arrow" aria-hidden="true">→</span>
      <article class="trace-card"><span class="trace-number">02</span><p class="eyebrow">What was retrieved</p><h2>Continuity recalled ${trace.retrieved.length} record${trace.retrieved.length === 1 ? '' : 's'}</h2>${compactMemoryItems(trace.retrieved, 'The recall returned no records.')}</article>
      <span class="trace-arrow" aria-hidden="true">→</span>
      <article class="trace-card trace-decision"><span class="trace-number">03</span><p class="eyebrow">How it affected the decision</p><h2>${data.decision?.selectedAgentId ? `${escapeHtml(data.decision.selectedAgentId)} selected` : 'No decision stored'}</h2>${data.decision?.reason ? `<blockquote>${escapeHtml(data.decision.reason)}</blockquote>` : '<p class="trace-empty">Awaiting a stored decision.</p>'}${compactMemoryItems(trace.affectedDecision, 'The stored decision cites no currently retrieved records.')}</article>
      <span class="trace-arrow" aria-hidden="true">→</span>
      <article class="trace-card"><span class="trace-number">04</span><p class="eyebrow">What was written afterward</p><h2>${trace.writtenAfterward.length} new mission record${trace.writtenAfterward.length === 1 ? '' : 's'}</h2>${compactMemoryItems(trace.writtenAfterward, 'No post-decision memory write was retrieved yet.')}</article>
    </section>
    <section class="section"><div class="section-heading"><h2>Decision evidence</h2><span class="caption">Offering, price, compatibility, history, citations, and score</span></div>${judgeCandidateEvidence(data.decision)}</section>
    <section class="section"><div class="section-heading"><h2>Autonomous mission timeline</h2><span class="caption">Missing runtime evidence remains visibly incomplete</span></div>${judgeExecutionTimeline(data)}</section>
    <section class="section split"><div>${virtualsPanel(data)}</div><div>${basePanel(data)}</div></section>
    <section class="judge-outcome panel panel-pad"><div><p class="eyebrow">Observed outcome</p><h2>${outcome ? (outcome.success === true || outcome.verification?.status === 'PASS' ? 'Success' : outcome.success === false || outcome.category === 'failure' ? 'Failure' : 'Recorded') : 'Not yet recorded'}</h2><p>${escapeHtml(outcome?.result || outcome?.failureReason || 'No mission outcome memory was returned.')}</p></div><div class="judge-receipt"><span>Sibyl provider</span><strong>${escapeHtml(data.memory.provider)}</strong><span>Selected agent</span><strong>${escapeHtml(data.decision?.selectedAgentId || '—')}</strong><span>Decision citations</span><strong>${trace.impact.citedCount}</strong><span>Current matches</span><strong>${trace.impact.resolvedCount}</strong></div></section>
    <aside class="deletion-note"><strong>Deletion-test meaning</strong><p>This view does not reconstruct history locally. The evidence cards come from <span class="mono">MemoryService.recall</span>, and the impact indicator requires exact IDs cited by the stored decision. When Sibyl retrieval is removed, these historical evidence and current-match counts disappear.</p></aside>`;
  document.querySelector('#judge-mission').addEventListener('change', (event) => {
    const url = new URL(location.href);
    url.searchParams.set('mission', event.target.value);
    history.pushState({}, '', url);
    route();
  });
}

async function renderActivity() {
  const data = await contextualDetail();
  app.innerHTML = `${pageHead('Durable telemetry', 'Transaction & activity', 'Follow memory reads and writes, Virtuals execution states, verification, and Base confirmations without exposing credentials.')}${data ? `<div class="section-heading"><h2>${escapeHtml(data.mission.objective)}</h2>${status(data.mission.status)}</div>${activityList(data)}` : empty('No activity yet', 'Mission operations will appear here in chronological order.')}`;
}

function activeNavigation(routeName) {
  document
    .querySelectorAll('[data-nav]')
    .forEach((link) => link.classList.toggle('active', link.dataset.nav === routeName));
}

async function route(force = false) {
  if (state.pollTimer) window.clearTimeout(state.pollTimer);
  state.pollTimer = null;
  updateLockControl();
  const request = ++state.request;
  if (force) {
    state.overview = null;
    state.details.clear();
    state.judgeOverview = null;
    state.judgeDetails.clear();
  }
  loading();
  const path = location.pathname.replace(/\/$/, '') || '/dashboard';
  let routeName = 'overview';
  try {
    if (path === '/dashboard/missions/new') {
      routeName = 'missions';
      await renderNewMission();
    } else if (path === '/dashboard/missions') {
      routeName = 'missions';
      await renderMissions();
    } else if (path.startsWith('/dashboard/missions/')) {
      routeName = 'missions';
      await renderMissionWorkspace(decodeURIComponent(path.split('/').at(-1)));
    } else if (path === '/dashboard/agents') {
      routeName = 'agents';
      await renderAgents();
    } else if (path === '/dashboard/memory') {
      routeName = 'memory';
      await renderMemory();
    } else if (path === '/dashboard/activity') {
      routeName = 'activity';
      await renderActivity();
    } else if (path === '/dashboard/judge') {
      routeName = 'judge';
      await renderJudgeMode();
    } else if (path === '/dashboard/access') {
      routeName = 'access';
      await renderAccessAdmin();
    } else await renderOverview();
    if (request !== state.request) return;
    activeNavigation(routeName);
    app.setAttribute('aria-busy', 'false');
    lastUpdated.textContent = `Updated ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
    document.title = `${routeName[0].toUpperCase()}${routeName.slice(1)} — Continuity`;
  } catch (error) {
    if (request === state.request) renderError(error);
  }
}

document.addEventListener('click', (event) => {
  const link = event.target.closest('a');
  if (
    !link ||
    link.target ||
    link.origin !== location.origin ||
    !link.pathname.startsWith('/dashboard')
  )
    return;
  event.preventDefault();
  history.pushState({}, '', link.href);
  document.body.classList.remove('nav-open');
  menuButton.setAttribute('aria-expanded', 'false');
  route();
});

window.addEventListener('popstate', () => route());
refreshButton.addEventListener('click', () => route(true));
lockButton.addEventListener('click', () => {
  sessionStorage.removeItem(operatorTokenStorageKey);
  state.overview = null;
  state.details.clear();
  state.discovery.clear();
  route(true);
});
menuButton.addEventListener('click', () => {
  const open = document.body.classList.toggle('nav-open');
  menuButton.setAttribute('aria-expanded', String(open));
});

updateLockControl();
route();
