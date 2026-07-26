import { providerById } from '../../../packages/core/src/providers.js';
import { sendRuntimeMessage as message } from './runtime-message.js';

const model = document.getElementById('model');
const status = document.getElementById('status');
const site = document.getElementById('site');
const siteToggle = document.getElementById('site-toggle');
let activeSite = null;

function siteStatusText({ enabled, mode }) {
  if (mode === 'allowlist') {
    return enabled ? 'This website is now whitelisted.' : 'This website was removed from the whitelist.';
  }
  return enabled ? 'Scholia is enabled here.' : 'Scholia will stay hidden on this website.';
}

function siteToggleLabel({ enabled, mode }) {
  if (mode === 'allowlist') return enabled ? 'Remove from whitelist' : 'Whitelist this website';
  return enabled ? 'Disable Scholia on this site' : 'Enable Scholia on this site';
}

async function command(type) {
  status.textContent = '';
  try {
    await message({ type: 'SCHOLIA_PANEL_COMMAND', command: type });
    status.textContent = type === 'SCHOLIA_START_CAPTURE' ? 'Draw over the region in the page.' : 'Opening the explanation in the page.';
  } catch (error) {
    status.textContent = `${error.message} Open a regular web page and try again.`;
  }
}

document.getElementById('explain').addEventListener('click', () => command('SCHOLIA_EXPLAIN_CURRENT'));
document.getElementById('capture').addEventListener('click', () => command('SCHOLIA_START_CAPTURE'));
document.getElementById('settings').addEventListener('click', () => chrome.runtime.openOptionsPage());
siteToggle.addEventListener('click', async () => {
  if (!activeSite) return;
  siteToggle.disabled = true;
  try {
    activeSite = await message({ type: 'SCHOLIA_SET_ACTIVE_SITE_ENABLED', enabled: !activeSite.enabled });
    renderSite();
    status.textContent = siteStatusText(activeSite);
  } catch (error) {
    status.textContent = error.message;
  } finally {
    siteToggle.disabled = false;
  }
});

function renderSite() {
  if (!activeSite) return;
  site.textContent = activeSite.site;
  siteToggle.textContent = siteToggleLabel(activeSite);
  siteToggle.classList.toggle('enable', !activeSite.enabled);
}

message({ type: 'SCHOLIA_GET_PUBLIC_SETTINGS' }).then((settings) => {
  const provider = providerById(settings.provider);
  model.textContent = `${provider.name} · ${settings.models[provider.id]}`;
}).catch((error) => { model.textContent = error.message; });

message({ type: 'SCHOLIA_GET_ACTIVE_SITE' }).then((value) => {
  activeSite = value;
  renderSite();
}).catch((error) => {
  site.textContent = 'Unavailable';
  siteToggle.hidden = true;
  status.textContent = error.message;
});
