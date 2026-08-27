const form = document.querySelector('#beta-form');
const status = document.querySelector('#form-status');
const attributionConsent = document.querySelector('#attribution-consent');
const attributionField = document.querySelector('#attribution-field');
const attributionName = document.querySelector('#attribution-name');

attributionConsent?.addEventListener('change', () => {
  const enabled = attributionConsent.checked;
  attributionField.hidden = !enabled;
  attributionName.required = enabled;
  if (!enabled) attributionName.value = '';
});

form?.addEventListener('submit', async (event) => {
  event.preventDefault();
  status.className = 'form-status';
  if (!form.reportValidity()) return;

  const button = form.querySelector('button[type="submit"]');
  const data = new FormData(form);
  const payload = {
    email: String(data.get('email') ?? ''),
    role: String(data.get('role') ?? ''),
    workflow: String(data.get('workflow') ?? '') || undefined,
    companyWebsite: String(data.get('companyWebsite') ?? '') || undefined,
    consentToContact: data.get('consentToContact') === 'on',
    publicAttributionConsent: data.get('publicAttributionConsent') === 'on',
    attributionName: String(data.get('attributionName') ?? '') || undefined,
  };

  button.disabled = true;
  button.textContent = 'Recording request…';
  status.textContent = '';
  try {
    const response = await fetch('/api/v1/beta-signups', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const result = await response.json().catch(() => null);
    if (!response.ok) throw new Error(result?.error?.message ?? 'Request could not be recorded.');
    form.reset();
    attributionField.hidden = true;
    attributionName.required = false;
    status.className = 'form-status success';
    status.textContent = 'Request recorded. Thank you — we will follow up about the private beta.';
  } catch (error) {
    status.className = 'form-status error';
    status.textContent = `${error instanceof Error ? error.message : 'Request failed.'} Please try again.`;
  } finally {
    button.disabled = false;
    button.textContent = 'Request access';
  }
});
