const app = document.querySelector('#app');
const refreshButton = document.querySelector('#refresh-button');
const menuButton = document.querySelector('.menu-button');
const lastUpdated = document.querySelector('#last-updated');
const operatorTokenStorageKey = 'continuity.dashboard.operator-token';

const state = {
  overview: null,
  details: new Map(),
  judgeOverview: null,
  judgeDetails: new Map(),
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

async function fetchJson(path, requiresOperatorToken = false) {
  const token = requiresOperatorToken ? operatorToken() : '';
  const response = await fetch(path, {
    headers: {
      accept: 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
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
    app.innerHTML = `<div class="error-state"><div><span class="empty-icon" aria-hidden="true">!</span><h2>Operator access required</h2><p>Enter the dashboard operator token to load protected telemetry. It is kept only for this browser session.</p><form data-operator-token-form><label class="sr-only" for="operator-token">Operator token</label><input class="operator-token-input" id="operator-token" type="password" autocomplete="off" required><button class="button" type="submit">Unlock dashboard</button></form></div></div>`;
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
  app.innerHTML = `<div class="error-state"><div><span class="empty-icon" aria-hidden="true">!</span><h2>Telemetry unavailable</h2><p>${escapeHtml(error instanceof Error ? error.message : 'The dashboard could not load operational data.')}</p><button class="button" type="button" data-retry>Try again</button></div></div>`;
  document.querySelector('[data-retry]')?.addEventListener('click', () => route(true));
}

function pageHead(eyebrow, title, lede, action = '') {
  return `<header class="page-head"><div><p class="eyebrow">${escapeHtml(eyebrow)}</p><h1>${escapeHtml(title)}</h1><p class="lede">${escapeHtml(lede)}</p></div>${action}</header>`;
}

function missionRows(missions) {
  if (!missions.length)
    return empty(
      'No missions yet',
      'Create a mission through the API to begin an autonomous operation.',
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
  app.innerHTML = `${pageHead('System overview', 'Memory turns outcomes into better operations.', 'Continuity recalls what worked, explains who it trusts, verifies every result, and records what happens next.')}
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

async function renderMissions() {
  const data = await overview();
  app.innerHTML = `${pageHead('Mission control', 'Missions', 'Inspect every autonomous operation from intake through verified outcome and memory update.')}
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
  if (!transaction)
    return empty(
      'No Base action',
      'This mission has no recorded onchain action. It may not require one or execution has not reached payment.',
    );
  const explorer =
    transaction.explorerUrl && /^https:\/\//.test(transaction.explorerUrl)
      ? transaction.explorerUrl
      : null;
  return `<div class="panel panel-pad"><div class="section-heading"><h2>Base action</h2>${status(transaction.status)}</div><p class="caption">${escapeHtml(transaction.purpose || 'Mission-linked onchain action.')}</p><div class="receipt"><div class="receipt-item"><span>Amount</span><strong>${escapeHtml(transaction.amount)} ${escapeHtml(transaction.asset)}</strong></div><div class="receipt-item"><span>Network</span><strong>${escapeHtml(transaction.network)}</strong></div><div class="receipt-item"><span>Recipient</span><strong title="${escapeHtml(transaction.recipient)}">${escapeHtml(shortId(transaction.recipient))}</strong></div><div class="receipt-item"><span>Transaction</span><strong title="${escapeHtml(transaction.transactionHash)}">${escapeHtml(shortId(transaction.transactionHash))}</strong></div><div class="receipt-item"><span>Confirmations</span><strong>${transaction.confirmations ?? '—'}</strong></div><div class="receipt-item"><span>Sibyl link</span><strong title="${escapeHtml(transaction.sibylRecordId)}">${escapeHtml(shortId(transaction.sibylRecordId))}</strong></div></div>${explorer ? `<a class="button secondary" style="margin-top:1rem" href="${escapeHtml(explorer)}" target="_blank" rel="noopener noreferrer">View on explorer ↗</a>` : ''}</div>`;
}

function virtualsPanel(data) {
  const job = data.jobs.at(-1);
  if (!job) return empty('No Virtuals receipt', 'No external ACP job is linked to this mission.');
  return `<div class="panel panel-pad"><div class="section-heading"><h2>Virtuals ACP</h2>${status(job.state)}</div><div class="receipt"><div class="receipt-item"><span>Provider</span><strong title="${escapeHtml(job.providerAddress)}">${escapeHtml(shortId(job.providerAddress))}</strong></div><div class="receipt-item"><span>Offering</span><strong>${escapeHtml(job.offeringName)}</strong></div><div class="receipt-item"><span>External job ID</span><strong title="${escapeHtml(job.externalJobId)}">${escapeHtml(shortId(job.externalJobId))}</strong></div><div class="receipt-item"><span>Chain</span><strong>${job.chainId}</strong></div></div>${job.result ? `<p class="caption" style="margin-top:1rem">Deliverable persisted with this receipt.</p>` : ''}</div>`;
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
    if (path === '/dashboard/missions') {
      routeName = 'missions';
      await renderMissions();
    } else if (path.startsWith('/dashboard/missions/')) {
      routeName = 'missions';
      await renderMissionDetail(decodeURIComponent(path.split('/').at(-1)));
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
menuButton.addEventListener('click', () => {
  const open = document.body.classList.toggle('nav-open');
  menuButton.setAttribute('aria-expanded', String(open));
});

route();
