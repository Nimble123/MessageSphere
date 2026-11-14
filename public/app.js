// MessageSphere Enterprise SaaS Engine v2.0
console.log("MessageSphere Enterprise SaaS Engine v2.0 Loaded.");

// API Configuration
const API_BASE = '/api';

function getAuthToken() {
  return localStorage.getItem('messagesphere_token');
}

function setAuthToken(token) {
  if (token) {
    localStorage.setItem('messagesphere_token', token);
  } else {
    localStorage.removeItem('messagesphere_token');
  }
}

async function apiFetch(endpoint, options = {}) {
  const token = getAuthToken();
  const headers = options.headers || {};
  
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  if (!(options.body instanceof FormData) && !headers['Content-Type']) {
    headers['Content-Type'] = 'application/json';
  }

  let response;
  try {
    response = await fetch(`${API_BASE}${endpoint}`, {
      ...options,
      headers
    });
  } catch (error) {
    if (window.location.protocol === 'file:') {
      throw new Error('Open the portal from http://localhost:3000 after running npm start. Do not open public/index.html directly.');
    }
    throw new Error('The portal server is unavailable. Check that the MessageSphere server is running.');
  }

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || `Request failed with status ${response.status}`);
  }
  return data;
}

// --- TOAST NOTIFICATION SYSTEM ---
function showToast(type, title, message) {
  const container = document.getElementById('toast-container');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = `toast ${type}`;

  let iconHtml = '<i data-lucide="info" style="width:18px;height:18px;color:#0ea5e9;"></i>';
  if (type === 'success') iconHtml = '<i data-lucide="check-circle-2" style="width:18px;height:18px;color:#10b981;"></i>';
  else if (type === 'error') iconHtml = '<i data-lucide="alert-circle" style="width:18px;height:18px;color:#ef4444;"></i>';
  else if (type === 'warning') iconHtml = '<i data-lucide="alert-triangle" style="width:18px;height:18px;color:#f59e0b;"></i>';

  toast.innerHTML = `
    <div class="toast-icon">${iconHtml}</div>
    <div class="toast-content">
      <div class="toast-title">${escapeHtml(title)}</div>
      <div class="toast-msg">${escapeHtml(message)}</div>
    </div>
  `;

  container.appendChild(toast);
  if (window.lucide) {
    lucide.createIcons({ root: toast });
  }

  setTimeout(() => {
    toast.style.animation = 'toastOut 0.25s forwards cubic-bezier(0.16, 1, 0.3, 1)';
    setTimeout(() => toast.remove(), 250);
  }, 4000);
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function sanitizeUrl(url) {
  if (!url || typeof url !== 'string') return '#';
  const clean = url.trim();
  if (/^(https?:\/\/|\/api\/resellers\/logo\/|\/api\/campaigns\/files\/|\/uploads\/|data:image\/)/i.test(clean)) {
    return escapeHtml(clean);
  }
  return '#';
}

async function downloadApiFile(endpoint, filename) {
  if (!endpoint) throw new Error('Invalid download request');
  // External or cloud URL: trigger direct browser download
  if (endpoint.startsWith('http://') || endpoint.startsWith('https://')) {
    const anchor = document.createElement('a');
    anchor.href = endpoint;
    anchor.download = filename || 'download';
    anchor.target = '_blank';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    return;
  }
  let pathOnly = endpoint.startsWith('/api') ? endpoint.replace(/^\/api/, '') : endpoint;
  if ((!pathOnly.startsWith('/campaigns/') && !pathOnly.startsWith('/credits/')) || endpoint.includes('?token=')) {
    throw new Error('Invalid download request');
  }
  const token = getAuthToken();
  const response = await fetch(`${API_BASE}${pathOnly}`, { headers: { Authorization: `Bearer ${token}` } });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error || 'Download failed');
  }
  const url = URL.createObjectURL(await response.blob());
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

async function viewOrDownloadCampaignAsset(assetUrl, filename) {
  try {
    let cleanUrl = assetUrl;
    if (cleanUrl.startsWith('/uploads/')) {
      cleanUrl = `/campaigns/files/${encodeURIComponent(cleanUrl.replace('/uploads/', ''))}`;
    }
    const safeName = filename || cleanUrl.split('/').pop() || 'asset';
    await downloadApiFile(cleanUrl, safeName);
  } catch (err) {
    showToast('error', 'Asset Access Error', err.message || 'Cannot access protected asset');
  }
}

// Global XSS-safe event delegation for data-action elements (replaces vulnerable inline JS string interpolation)
document.addEventListener('click', (e) => {
  const target = e.target.closest('[data-action]');
  if (!target) return;
  const action = target.getAttribute('data-action');
  const d = target.dataset;

  if (action === 'quick-allot') {
    if (typeof window.quickAllotToClient === 'function') {
      window.quickAllotToClient(Number(d.userId), d.email, d.mode);
    }
  } else if (action === 'open-allot-credits') {
    if (typeof window.closeAllDropdowns === 'function') window.closeAllDropdowns();
    if (typeof window.openAllotCreditsModal === 'function') {
      window.openAllotCreditsModal(Number(d.userId), d.email);
    }
  } else if (action === 'impersonate-user') {
    if (typeof window.closeAllDropdowns === 'function') window.closeAllDropdowns();
    if (typeof window.impersonateUserAccount === 'function') {
      window.impersonateUserAccount(Number(d.userId), d.email);
    }
  } else if (action === 'open-reset-password') {
    if (typeof window.closeAllDropdowns === 'function') window.closeAllDropdowns();
    if (typeof window.openResetPasswordModal === 'function') {
      window.openResetPasswordModal(Number(d.userId), d.email);
    }
  } else if (action === 'toggle-tax-mode') {
    if (typeof window.closeAllDropdowns === 'function') window.closeAllDropdowns();
    if (typeof window.quickToggleTaxModeForUser === 'function') {
      window.quickToggleTaxModeForUser(Number(d.userId), d.taxMode || 'non_gst', d.email);
    }
  } else if (action === 'toggle-user-refund') {
    if (typeof window.closeAllDropdowns === 'function') window.closeAllDropdowns();
    if (typeof window.toggleUserRefundRouting === 'function') {
      window.toggleUserRefundRouting(Number(d.userId), d.email, d.dest || 'user');
    }
  } else if (action === 'delete-user') {
    if (typeof window.closeAllDropdowns === 'function') window.closeAllDropdowns();
    if (typeof window.deleteUserAccount === 'function') {
      window.deleteUserAccount(Number(d.userId), d.email);
    }
  } else if (action === 'open-group-contacts') {
    if (typeof window.openGroupContactsDrawer === 'function') {
      window.openGroupContactsDrawer(Number(d.groupId), d.groupName);
    }
  } else if (action === 'export-group-csv') {
    if (typeof window.exportGroupCsvDirect === 'function') {
      window.exportGroupCsvDirect(Number(d.groupId), d.groupName);
    }
  } else if (action === 'remove-blacklist') {
    if (typeof window.confirmRemoveBlacklist === 'function') {
      window.confirmRemoveBlacklist(d.phone);
    }
  }
});

// --- STATE MANAGEMENT ---
let currentUser = null;
let allCampaigns = [];
let allUsers = [];
let allTransactions = [];
let campaignFilter = 'all';
let pollInterval = null;
let selectedAttachmentFile = null;
let uploadedDP = null;
let uploadedImages = [null, null, null, null];
let uploadedVideo = null;
let uploadedPDF = null;
let uploadedCtaMedia = null;
let selectedCtaMediaType = 'none';
let currentDetailCampaignId = null;

// --- DOM ELEMENTS ---
const authScreen = document.getElementById('auth-screen');
const appShell = document.getElementById('app-shell');
const authForm = document.getElementById('auth-form');
const loginEmailInput = document.getElementById('login-email');
const loginPasswordInput = document.getElementById('login-password');
const authErrorBox = document.getElementById('auth-error-box');
const btnAutoFillAdmin = document.getElementById('btn-auto-fill-admin');
const btnSubmitLogin = document.getElementById('btn-submit-login');
const btnShellLogout = document.getElementById('btn-shell-logout');
const btnOpenForgotPassword = document.getElementById('btn-open-forgot-password');
const modalForgotPassword = document.getElementById('modal-forgot-password');
const forgotPasswordEmail = document.getElementById('forgot-password-email');
const btnSubmitForgotPassword = document.getElementById('btn-submit-forgot-password');

// Topbar Elements
const topbarPageTitle = document.getElementById('topbar-page-title');
const topbarBreadcrumb = document.getElementById('topbar-breadcrumb');
const topbarDomVal = document.getElementById('topbar-dom-val');
const topbarIntlVal = document.getElementById('topbar-intl-val');
const btnNavCreateCampaign = document.getElementById('btn-nav-create-campaign');

// Sidebar user
const sidebarUserAvatar = document.getElementById('sidebar-user-avatar');
const sidebarUserEmail = document.getElementById('sidebar-user-email');
const sidebarUserRole = document.getElementById('sidebar-user-role');

// Settings Elements
const settingsUserAvatar = document.getElementById('settings-user-avatar');
const settingsUserEmail = document.getElementById('settings-user-email');
const settingsUserRole = document.getElementById('settings-user-role');

// --- SMART PHONE NUMBER SANITIZER ---
function sanitizePhoneNumber(raw, destination = 'domestic') {
  if (raw === null || raw === undefined) return null;
  let str = String(raw).trim();
  if (!str) return null;

  // Auto-expand Excel scientific notation (e.g. 9.1987654321E+11 or 9.87654321E+09)
  if (/^[0-9.]+[eE][+-]?[0-9]+$/.test(str)) {
    try {
      const numVal = Number(str);
      if (!isNaN(numVal) && isFinite(numVal)) {
        str = BigInt(Math.round(numVal)).toString();
      }
    } catch(e) {}
  }

  // Remove spaces, dashes, brackets, plus, quotes
  let cleaned = str.replace(/[\s\-\(\)\+\'\"\.]/g, '').trim();
  
  if (destination === 'domestic') {
    // If starts with 0, strip leading 0
    if (cleaned.startsWith('0')) {
      cleaned = cleaned.substring(1);
    }
    // If standard 10 digit Indian number starting with 6,7,8,9
    if (/^[6-9]\d{9}$/.test(cleaned)) {
      return '91' + cleaned;
    }
    // If already has 91 prefix and 12 digits
    if (/^91[6-9]\d{9}$/.test(cleaned)) {
      return cleaned;
    }
    return null; // Invalid domestic number
  } else {
    // International: must be digits, between 7 and 15 digits
    if (/^\d{7,15}$/.test(cleaned)) {
      return cleaned;
    }
    return null;
  }
}

let cachedBlacklistSet = new Set();
async function ensureBlacklistLoaded() {
  try {
    // Only load latest 500 DND numbers for instant UI typing warning; full 200k+ DND list is strictly enforced on submission by backend
    const list = await apiFetch('/contacts/blacklist?limit=500');
    cachedBlacklistSet = new Set((Array.isArray(list) ? list : (list.data || [])).map(r => r.phone_number));
  } catch (e) {
    cachedBlacklistSet = new Set();
  }
}

const MAX_CAMPAIGN_CONTACTS = 50000;

function processContactInput(rawText, destination = 'domestic') {
  const lines = rawText.split(/\r?\n|,/);
  const seenSet = new Set();
  const validSet = new Set();
  let duplicateCount = 0;
  let invalidCount = 0;
  let dndCount = 0;
  let isCapped = false;

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (!trimmed) continue;
    const sanitized = sanitizePhoneNumber(trimmed, destination);
    if (sanitized) {
      if (seenSet.has(sanitized)) {
        duplicateCount++;
      } else {
        seenSet.add(sanitized);
        if (cachedBlacklistSet && cachedBlacklistSet.has(sanitized)) {
          dndCount++;
        } else {
          if (validSet.size < MAX_CAMPAIGN_CONTACTS) {
            validSet.add(sanitized);
          } else {
            isCapped = true;
          }
        }
      }
    } else {
      invalidCount++;
    }
  }

  return {
    validNumbers: Array.from(validSet),
    duplicateCount,
    invalidCount,
    dndCount,
    isCapped,
    totalRawValid: seenSet.size - dndCount
  };
}

function formatLiveMessagePreview(text) {
  if (!text) return 'Your message will appear here in real-time as you compose it...';
  let preview = text
    .replace(/\{name\}/gi, 'Rahul Sharma')
    .replace(/\{phone\}/gi, '+91 98765 43210')
    .replace(/\{company\}/gi, 'Acme Enterprises')
    .replace(/\{var1\}/gi, 'PREVIEW-1')
    .replace(/\{var2\}/gi, 'PREVIEW-2')
    .replace(/\{coupon\}/gi, 'FESTIVE50')
    .replace(/\{code\}/gi, '849201')
    .replace(/\{amount\}/gi, '₹1,499')
    .replace(/\{date\}/gi, '05-Nov-2026');

  // Securely escape HTML characters first
  preview = escapeHtml(preview);

  // WhatsApp markdown formatting
  preview = preview.replace(/```([^`]+)```/g, '<code style="background:#f1f5f9;padding:2px 4px;border-radius:3px;font-family:monospace;font-size:0.85em;">$1</code>');
  preview = preview.replace(/(^|[^\w*])\*([^*\n]+)\*([^\w*]|$)/g, '$1<strong style="font-weight:700;">$2</strong>$3');
  preview = preview.replace(/(^|[^\w_])_([^_\n]+)_([^\w_]|$)/g, '$1<em style="font-style:italic;">$2</em>$3');
  preview = preview.replace(/(^|[^\w~])~([^~\n]+)~([^\w~]|$)/g, '$1<del style="text-decoration:line-through;opacity:0.8;">$2</del>$3');

  return preview.replace(/\n/g, '<br>');
}

// --- NAVIGATION & ROUTER WITH VIEW TRANSITIONS API ---
const navItems = document.querySelectorAll('.nav-item');
const views = document.querySelectorAll('.app-view');

// High-performance smooth Count-Up animation for KPIs & Fintech metrics
window.animateCountUp = function(element, target, duration = 500, isCurrency = false) {
  if (!element) return;
  const targetNum = Number(target) || 0;
  if (targetNum === 0) {
    element.textContent = isCurrency ? '₹0.00' : '0';
    return;
  }
  const startTime = performance.now();
  const startNum = 0;

  function step(currentTime) {
    const elapsed = currentTime - startTime;
    const progress = Math.min(elapsed / duration, 1);
    // Cubic ease-out curve
    const ease = 1 - Math.pow(1 - progress, 3);
    const current = Math.round(startNum + (targetNum - startNum) * ease);

    if (isCurrency) {
      element.textContent = `₹${current.toLocaleString('en-IN')}`;
    } else {
      element.textContent = current.toLocaleString('en-IN');
    }

    if (progress < 1) {
      requestAnimationFrame(step);
    } else {
      element.textContent = isCurrency 
        ? `₹${targetNum.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
        : targetNum.toLocaleString('en-IN');
    }
  }

  requestAnimationFrame(step);
};

// Shimmer Skeleton Table Loader Helper
window.renderTableSkeleton = function(tbodyId, colCount = 8, rowCount = 4) {
  const tbody = typeof tbodyId === 'string' ? document.getElementById(tbodyId) : tbodyId;
  if (!tbody) return;
  const rows = [];
  for (let i = 0; i < rowCount; i++) {
    const cols = [];
    for (let j = 0; j < colCount; j++) {
      const widthPct = j === 0 ? '70%' : (j === colCount - 1 ? '40%' : `${50 + (j * 7) % 35}%`);
      cols.push(`<td style="padding:14px 16px;"><div class="skeleton-shimmer" style="height:14px;width:${widthPct};border-radius:4px;"></div></td>`);
    }
    rows.push(`<tr>${cols.join('')}</tr>`);
  }
  tbody.innerHTML = rows.join('');
};

window.switchView = function(viewId) {
  const executeSwitch = () => {
    views.forEach(v => v.classList.remove('active'));
    navItems.forEach(n => n.classList.remove('active'));

    const targetView = document.getElementById(viewId);
    if (targetView) targetView.classList.add('active');

    const activeNav = document.querySelector(`.nav-item[data-view="${viewId}"]`);
    if (activeNav) activeNav.classList.add('active');

    const appMain = document.querySelector('.app-main');
    if (appMain) appMain.scrollTop = 0;
    window.scrollTo(0, 0);

    const titles = {
      'view-dashboard': { title: 'Dashboard Overview', breadcrumb: 'MessageSphere / Overview' },
      'view-new-campaign': { title: 'Create WhatsApp Campaign', breadcrumb: 'MessageSphere / WhatsApp / New' },
      'view-campaigns': { title: 'WhatsApp Campaigns & Reports', breadcrumb: 'MessageSphere / WhatsApp / Campaigns' },
      'view-contacts': { title: 'Phonebook & DND Blacklist', breadcrumb: 'MessageSphere / Audience / Phonebook' },
      'view-templates': { title: 'Message Templates', breadcrumb: 'MessageSphere / Content / Templates' },
      'view-wallet': { title: 'Credit Wallets & Ledger Statement', breadcrumb: 'MessageSphere / Billing / Passbook' },
      'view-billing': { title: 'Top-up Requests & Orders', breadcrumb: 'MessageSphere / Billing / Orders' },
      'view-plans': { title: 'Credit Plans & Pricing Packages', breadcrumb: 'MessageSphere / Billing / Plans' },
      'view-users': { title: 'User & Reseller Management', breadcrumb: 'MessageSphere / Administration / Users' },
      'view-operations': { title: 'Operations Audit & Controls', breadcrumb: 'MessageSphere / Administration / Operations Audit' },
      'view-resellers': { title: 'Reseller Network', breadcrumb: 'MessageSphere / Administration / Resellers' },
      'view-branding': { title: 'White-label Brand', breadcrumb: 'MessageSphere / Reseller / Brand' },
      'view-settings': { title: 'Account Settings', breadcrumb: 'MessageSphere / Settings / Profile' },
      'view-sms-new': { title: 'Create GSM Bulk SMS Campaign', breadcrumb: 'MessageSphere / GSM SMS / New Broadcast' },
      'view-sms': { title: 'GSM Bulk SMS Broadcasts', breadcrumb: 'MessageSphere / GSM SMS / Broadcasts' },
      'view-team': { title: 'Team Members & Staff RBAC', breadcrumb: 'MessageSphere / Organization / Team RBAC' }
    };

    if (titles[viewId]) {
      topbarPageTitle.textContent = titles[viewId].title;
      topbarBreadcrumb.textContent = titles[viewId].breadcrumb;
    }
  };

  // Single-Page View Transitions API (Fallback to executeSwitch if not supported)
  if (document.startViewTransition) {
    document.startViewTransition(() => executeSwitch());
  } else {
    executeSwitch();
  }

  // Trigger view data loaders
  if (viewId === 'view-dashboard') refreshDashboardMetrics();
  if (viewId === 'view-campaigns') {
    campaignChannelScope = 'whatsapp';
    renderCampaignsTable();
    updateCampaignTabBadges();
  }
  if (viewId === 'view-users') loadUsers();
  if (viewId === 'view-wallet') { updateWalletView(); loadLedgerTransactions(); }
  if (viewId === 'view-new-campaign') {
    const compWrapper = document.getElementById('composer-layout-wrapper');
    if (compWrapper) compWrapper.style.display = 'grid';
    setupComposerTargetSelector();
    ensureBlacklistLoaded().then(() => updateCostCalculator()).catch(() => {});
    populateComposerSelectors();
  }
  if (viewId === 'view-settings') updateSettingsView();
  if (viewId === 'view-contacts') { loadContactGroups(); loadBlacklist(); }
  if (viewId === 'view-templates') loadTemplates();
  if (viewId === 'view-billing') loadBillingOrders();
  if (viewId === 'view-plans') loadCreditPlans();
  if (viewId === 'view-operations') loadOperationsAudit();
  if (viewId === 'view-resellers') loadResellerNetwork();
  if (viewId === 'view-branding') loadMyBrandProfile();
  if (viewId === 'view-sms-new') {
    if (typeof initSmsComposerView === 'function') initSmsComposerView();
  }
  if (viewId === 'view-sms') loadSmsCampaigns();
  if (viewId === 'view-team') loadTeamMembers();

  if (window.lucide) {
    setTimeout(() => lucide.createIcons(), 50);
  }
};
const switchView = window.switchView;

navItems.forEach(item => {
  item.addEventListener('click', () => {
    const viewId = item.dataset.view;
    if (viewId) switchView(viewId);
  });
});

if (btnNavCreateCampaign) {
  btnNavCreateCampaign.addEventListener('click', () => {
    const activeView = document.querySelector('.app-view.active');
    if (activeView && (activeView.id === 'view-sms' || activeView.id === 'view-sms-new')) {
      switchView('view-sms-new');
    } else {
      switchView('view-new-campaign');
    }
  });
}

const btnDashViewAll = document.getElementById('btn-dash-view-all');
if (btnDashViewAll) {
  btnDashViewAll.addEventListener('click', () => switchView('view-campaigns'));
}

// --- AUTHENTICATION FLOW ---
if (btnAutoFillAdmin) {
  btnAutoFillAdmin.addEventListener('click', () => {
    loginEmailInput.value = 'admin@messagesphere.com';
    loginPasswordInput.value = 'admin123';
    if (authErrorBox) authErrorBox.style.display = 'none';
  });
}

authForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const email = loginEmailInput.value.trim();
  const password = loginPasswordInput.value;

  if (!email || !password) {
    showAuthError("Please fill in both email and password.");
    return;
  }

  btnSubmitLogin.disabled = true;
  btnSubmitLogin.textContent = "Signing In...";
  hideAuthError();

  try {
    const res = await apiFetch('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password })
    });

    setAuthToken(res.token);
    showToast('success', 'Welcome back!', `Logged in successfully as ${res.user.email}`);
    handleLoginSuccess(res.user);
  } catch (err) {
    showAuthError(err.message);
  } finally {
    btnSubmitLogin.disabled = false;
    btnSubmitLogin.textContent = "Sign In to Dashboard →";
  }
});

// --- AUTH MODE SWITCHER (LOGIN vs CREATE ACCOUNT) ---
window.switchAuthMode = function(mode) {
  const formLogin = document.getElementById('auth-form');
  const formReg = document.getElementById('auth-form-register');
  const tabLogin = document.getElementById('tab-auth-login');
  const tabReg = document.getElementById('tab-auth-register');
  const heading = document.getElementById('auth-heading');
  const subheading = document.getElementById('auth-subheading');
  const currentBrand = window.currentBrandName || 'MessageSphere';

  hideAuthError();
  const regErrBox = document.getElementById('reg-error-box');
  if (regErrBox) regErrBox.style.display = 'none';

  if (mode === 'register') {
    if (formLogin) formLogin.style.display = 'none';
    if (formReg) formReg.style.display = 'block';
    if (tabLogin) tabLogin.classList.remove('active');
    if (tabReg) tabReg.classList.add('active');
    if (heading) heading.innerHTML = `Create Your Account`;
    if (subheading) subheading.textContent = `Get started with high-throughput WhatsApp & GSM SMS broadcasts with carrier-grade reliability.`;
  } else {
    if (formLogin) formLogin.style.display = 'block';
    if (formReg) formReg.style.display = 'none';
    if (tabLogin) tabLogin.classList.add('active');
    if (tabReg) tabReg.classList.remove('active');
    if (heading) heading.innerHTML = `Sign in to <span class="brand-title">${escapeHtml(currentBrand)}</span>`;
    if (subheading) subheading.textContent = `Enter your credentials to access your enterprise campaign console.`;
  }
};

// --- ACCOUNT TYPE TOGGLE & PRICING ESTIMATION ---
window.setRegAccountType = function(type) {
  const hiddenInput = document.getElementById('reg-account-type');
  if (hiddenInput) hiddenInput.value = type;

  const cardUser = document.getElementById('reg-type-card-user');
  const cardReseller = document.getElementById('reg-type-card-reseller');
  const checkUser = document.getElementById('reg-user-check');
  const checkReseller = document.getElementById('reg-reseller-check');
  const labelUser = document.getElementById('reg-user-label');
  const labelReseller = document.getElementById('reg-reseller-label');
  const resellerSection = document.getElementById('reg-reseller-commitment-section');
  const btnSubmit = document.getElementById('btn-submit-register');

  if (type === 'reseller') {
    if (cardUser) {
      cardUser.style.border = '1px solid #cbd5e1';
      cardUser.style.background = '#ffffff';
    }
    if (cardReseller) {
      cardReseller.style.border = '2px solid #4f46e5';
      cardReseller.style.background = 'rgba(79,70,229,0.06)';
    }
    if (checkUser) checkUser.style.display = 'none';
    if (checkReseller) checkReseller.style.display = 'inline-block';
    if (labelUser) labelUser.style.color = '#334155';
    if (labelReseller) labelReseller.style.color = '#4f46e5';
    if (resellerSection) resellerSection.style.display = 'block';
    if (btnSubmit) btnSubmit.textContent = 'Register Partner Account & Book Order →';
    if (typeof window.updateResellerOrderEstimate === 'function') {
      window.updateResellerOrderEstimate();
    }
  } else {
    if (cardUser) {
      cardUser.style.border = '2px solid #4f46e5';
      cardUser.style.background = 'rgba(79,70,229,0.06)';
    }
    if (cardReseller) {
      cardReseller.style.border = '1px solid #cbd5e1';
      cardReseller.style.background = '#ffffff';
    }
    if (checkUser) checkUser.style.display = 'inline-block';
    if (checkReseller) checkReseller.style.display = 'none';
    if (labelUser) labelUser.style.color = '#4f46e5';
    if (labelReseller) labelReseller.style.color = '#334155';
    if (resellerSection) resellerSection.style.display = 'none';
    if (btnSubmit) btnSubmit.textContent = 'Create Account & Get Started →';
  }
  if (window.lucide && typeof lucide.createIcons === 'function') {
    try { lucide.createIcons(); } catch (_) {}
  }
};

window.updateResellerOrderEstimate = function() {
  const channelEl = document.getElementById('reg-reseller-channel');
  const qtyEl = document.getElementById('reg-reseller-qty');
  const gstinEl = document.getElementById('reg-reseller-gstin');
  const estQtyEl = document.getElementById('reseller-est-qty');
  const estRateEl = document.getElementById('reseller-est-rate');
  const estTotalEl = document.getElementById('reseller-est-total');

  if (!channelEl || !qtyEl) return;
  const opt = channelEl.options[channelEl.selectedIndex];
  const rate = parseFloat(opt?.getAttribute('data-rate') || '0.1200');
  let qty = parseInt(qtyEl.value, 10);
  if (isNaN(qty) || qty < 1) qty = 100000;

  const base = qty * rate;
  const hasGstin = Boolean(gstinEl?.value && gstinEl.value.trim().length >= 10);
  const gst = hasGstin ? (base * 0.18) : 0;
  const total = base + gst;

  if (estQtyEl) estQtyEl.textContent = qty.toLocaleString();
  if (estRateEl) estRateEl.textContent = `₹${rate.toFixed(4)}`;
  if (estTotalEl) {
    estTotalEl.textContent = hasGstin ? `₹${Math.round(total).toLocaleString()} (incl. GST)` : `₹${Math.round(total).toLocaleString()}`;
  }
};

// --- CLIENT & RESELLER SELF-REGISTRATION FORM SUBMIT ---
const authFormRegister = document.getElementById('auth-form-register');
const btnSubmitRegister = document.getElementById('btn-submit-register');

if (authFormRegister) {
  authFormRegister.addEventListener('submit', async (e) => {
    e.preventDefault();
    const accountType = document.getElementById('reg-account-type')?.value || 'user';
    const isReseller = accountType === 'reseller';

    const fullName = document.getElementById('reg-fullname')?.value.trim();
    const email = document.getElementById('reg-email')?.value.trim();
    const phone = document.getElementById('reg-phone')?.value.trim();
    const companyName = document.getElementById('reg-company')?.value.trim();
    const password = document.getElementById('reg-password')?.value;
    const confirmPassword = document.getElementById('reg-confirm-password')?.value;
    const inviteCode = document.getElementById('reg-invite-code')?.value.trim();
    const errBox = document.getElementById('reg-error-box');

    const showRegError = (msg) => {
      if (errBox) {
        errBox.textContent = msg;
        errBox.style.display = 'block';
      }
    };

    if (errBox) errBox.style.display = 'none';

    if (!fullName) return showRegError('Full Name is required.');
    if (!email) return showRegError('A valid Email Address is required.');
    if (!phone || phone.replace(/\D/g, '').length < 10) return showRegError('A valid 10-digit mobile number is required.');
    if (!password || password.length < 8) return showRegError('Password must be at least 8 characters long.');
    if (password !== confirmPassword) return showRegError('Passwords do not match. Please re-enter.');

    let commitmentQty = 0;
    let commitmentChannel = '';
    let brandName = '';
    let gstin = '';
    let businessAddress = '';

    if (isReseller) {
      commitmentQty = parseInt(document.getElementById('reg-reseller-qty')?.value, 10);
      if (isNaN(commitmentQty) || commitmentQty < 100000) {
        return showRegError('Reseller partner onboarding requires an initial minimum commitment order of 1,00,000 (1 Lakh) credits.');
      }
      commitmentChannel = document.getElementById('reg-reseller-channel')?.value || 'gsm_sms_domestic';
      brandName = document.getElementById('reg-reseller-brand')?.value.trim();
      gstin = document.getElementById('reg-reseller-gstin')?.value.trim();
      businessAddress = document.getElementById('reg-reseller-address')?.value.trim();
    }

    if (btnSubmitRegister) {
      btnSubmitRegister.disabled = true;
      btnSubmitRegister.textContent = isReseller ? 'Registering Partner & Generating Order...' : 'Creating Account...';
    }

    try {
      const res = await apiFetch('/auth/register', {
        method: 'POST',
        body: JSON.stringify({
          full_name: fullName,
          email,
          phone,
          company_name: companyName,
          password,
          account_type: accountType,
          commitment_quantity: isReseller ? commitmentQty : undefined,
          commitment_channel: isReseller ? commitmentChannel : undefined,
          brand_name: isReseller ? brandName : undefined,
          gstin: isReseller ? gstin : undefined,
          business_address: isReseller ? businessAddress : undefined,
          invite_code: !isReseller ? (inviteCode || undefined) : undefined
        })
      });

      setAuthToken(res.token);
      if (isReseller) {
        showToast('success', 'Partner Account Created!', `Welcome to MessageSphere Reseller Network, ${res.user.fullName || res.user.email}! Your 1 Lakh credit onboarding order is awaiting verification.`);
      } else {
        showToast('success', 'Account Created!', `Welcome to MessageSphere, ${res.user.fullName || res.user.email}!`);
      }
      handleLoginSuccess(res.user);
    } catch (err) {
      showRegError(err.message || 'Registration failed.');
    } finally {
      if (btnSubmitRegister) {
        btnSubmitRegister.disabled = false;
        btnSubmitRegister.textContent = isReseller ? 'Register Partner Account & Book Order →' : 'Create Account & Get Started →';
      }
    }
  });
}

if (btnOpenForgotPassword) {
  btnOpenForgotPassword.addEventListener('click', () => {
    forgotPasswordEmail.value = loginEmailInput.value.trim();
    modalForgotPassword.style.display = 'flex';
    forgotPasswordEmail.focus();
  });
}

if (btnSubmitForgotPassword) {
  btnSubmitForgotPassword.addEventListener('click', async () => {
    const email = forgotPasswordEmail.value.trim();
    if (!email) {
      showToast('error', 'Email required', 'Enter the email address associated with your account.');
      return;
    }
    btnSubmitForgotPassword.disabled = true;
    btnSubmitForgotPassword.textContent = 'Submitting...';
    try {
      const result = await apiFetch('/auth/forgot-password', { method: 'POST', body: JSON.stringify({ email }) });
      showToast('success', 'Request submitted', result.message);
      modalForgotPassword.style.display = 'none';
    } catch (err) {
      showToast('error', 'Request failed', err.message);
    } finally {
      btnSubmitForgotPassword.disabled = false;
      btnSubmitForgotPassword.textContent = 'Request reset';
    }
  });
}

btnShellLogout.addEventListener('click', async () => {
  const token = getAuthToken();
  if (token) {
    try {
      await fetch('/api/auth/logout', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` }
      });
    } catch (_) {}
  }
  sessionStorage.removeItem('ms_impersonator_token');
  sessionStorage.removeItem('ms_impersonator_info');
  setAuthToken(null);
  currentUser = null;
  if (pollInterval) clearInterval(pollInterval);
  showToast('info', 'Signed Out', 'You have been safely signed out.');
  showAuthView();
});

function showAuthError(msg) {
  if (authErrorBox) {
    authErrorBox.textContent = msg;
    authErrorBox.style.display = 'block';
  }
}

function hideAuthError() {
  if (authErrorBox) authErrorBox.style.display = 'none';
}

function showAuthView() {
  document.body.classList.remove('app-active');
  authScreen.style.display = 'flex';
  appShell.style.display = 'none';
  loginEmailInput.value = '';
  loginPasswordInput.value = '';
  if (window.lucide) {
    setTimeout(() => lucide.createIcons(), 50);
  }
}

function handleLoginSuccess(user) {
  currentUser = user;
  document.body.classList.add('app-active');
  authScreen.style.display = 'none';
  appShell.style.display = 'flex';

  // Sidebar profile
  sidebarUserEmail.textContent = user.email;
  sidebarUserAvatar.textContent = user.email.charAt(0).toUpperCase();

  const isSubAdmin = Boolean(user.is_team_member && user.parent_role === 'admin');
  if (isSubAdmin) {
    sidebarUserRole.textContent = user.team_role ? user.team_role.toUpperCase().replace(/_/g, ' ') : 'SUB-ADMIN';
    sidebarUserRole.className = 'role-badge';
    sidebarUserRole.style.cssText = 'background:#7c3aed;color:#fff;font-weight:700;padding:2px 8px;border-radius:12px;font-size:0.7rem;letter-spacing:0.5px;';
  } else {
    sidebarUserRole.textContent = user.role.toUpperCase();
    sidebarUserRole.className = `role-badge role-${user.role}`;
    sidebarUserRole.style.cssText = '';
  }

  // Settings profile
  updateSettingsView();

  const p = user.permissions || {};
  const effectiveRole = (user.is_team_member && user.parent_role) ? user.parent_role : user.role;

  // Role permissions: Show admin-only items if admin or reseller or permitted sub-admin
  const adminElements = document.querySelectorAll('.admin-only');
  adminElements.forEach(el => {
    if (isSubAdmin) {
      el.style.display = (p.can_manage_users !== false) ? 'flex' : 'none';
    } else {
      el.style.display = (user.role === 'admin' || user.role === 'reseller') ? 'flex' : 'none';
    }
  });

  // Operations Audit
  const opsAuditNav = document.querySelector('.nav-item[data-view="view-operations"]');
  if (opsAuditNav) {
    opsAuditNav.style.display = (user.role === 'admin' || (isSubAdmin && p.can_view_operations_audit !== false)) ? 'flex' : 'none';
  }

  // Reseller Network
  const resellerNav = document.querySelector('.nav-item[data-view="view-resellers"]');
  if (resellerNav) {
    resellerNav.style.display = (user.role === 'admin' || (isSubAdmin && p.can_manage_resellers !== false)) ? 'flex' : 'none';
  }

  document.querySelectorAll('.reseller-branding').forEach(el => {
    el.style.display = user.role === 'reseller' ? 'flex' : 'none';
  });

  // Super Admin does not compose campaigns; campaigns are created by Resellers & Clients
  const navNewCamp = document.querySelector('.nav-item[data-view="view-new-campaign"]');
  if (navNewCamp) navNewCamp.style.display = (user.role === 'admin') ? 'none' : 'flex';
  if (btnNavCreateCampaign) btnNavCreateCampaign.style.display = (user.role === 'admin') ? 'none' : 'inline-flex';

  // Team Management & RBAC section in sidebar
  const navTeam = document.getElementById('nav-item-team');
  const navCatTeam = document.getElementById('nav-category-team');
  const canManageStaff = user.role === 'admin' || user.role === 'reseller' || (!user.is_team_member) || (user.is_team_member && p.can_manage_team);
  if (navTeam) navTeam.style.display = canManageStaff ? 'flex' : 'none';
  if (navCatTeam) navCatTeam.style.display = canManageStaff ? 'block' : 'none';

  // Sub-User Team Member Granular Role Boundaries:
  if (user.isTeamMember && user.permissions) {
    const p = user.permissions;
    if (!p.can_send_campaigns) {
      const campCreate = document.querySelector('.nav-item[data-view="view-new-campaign"]');
      const smsCreate = document.querySelector('.nav-item[data-view="view-sms-new"]');
      if (campCreate) campCreate.style.display = 'none';
      if (smsCreate) smsCreate.style.display = 'none';
      if (btnNavCreateCampaign) btnNavCreateCampaign.style.display = 'none';
    }
    if (!p.can_view_campaigns) {
      const campList = document.querySelector('.nav-item[data-view="view-campaigns"]');
      const smsList = document.querySelector('.nav-item[data-view="view-sms"]');
      if (campList) campList.style.display = 'none';
      if (smsList) smsList.style.display = 'none';
    }
    if (!p.can_manage_contacts) {
      const contNav = document.querySelector('.nav-item[data-view="view-contacts"]');
      if (contNav) contNav.style.display = 'none';
    }
    if (!p.can_manage_templates) {
      const tplNav = document.querySelector('.nav-item[data-view="view-templates"]');
      if (tplNav) tplNav.style.display = 'none';
    }
    if (!p.can_view_billing) {
      const walletNav = document.querySelector('.nav-item[data-view="view-wallet"]');
      const billNav = document.querySelector('.nav-item[data-view="view-billing"]');
      const planNav = document.querySelector('.nav-item[data-view="view-plans"]');
      if (walletNav) walletNav.style.display = 'none';
      if (billNav) billNav.style.display = 'none';
      if (planNav) planNav.style.display = 'none';
    }
  }

  // Display team role in sidebar profile
  if (user.isTeamMember) {
    if (sidebarUserRole) {
      const roleMap = {
        campaign_manager: 'Staff • Campaign Mgr',
        support_agent: 'Staff • Chat Agent',
        accountant: 'Staff • Accountant',
        viewer: 'Staff • Auditor',
        team_admin: 'Staff • Admin'
      };
      sidebarUserRole.textContent = roleMap[user.teamRole] || `Staff • ${user.teamRole}`;
      sidebarUserRole.className = 'role-badge';
      sidebarUserRole.style.background = '#f3e8ff';
      sidebarUserRole.style.color = '#7e22ce';
      sidebarUserRole.style.border = '1px solid #d8b4fe';
    }
    if (sidebarUserEmail && user.parentEmail) {
      sidebarUserEmail.innerHTML = `${escapeHtml(user.email)}<br><span style="font-size:0.72rem;color:#94a3b8;">Org: ${escapeHtml(user.parentEmail)}</span>`;
    }
  }

  applyWhiteLabel().catch(() => {});

  updateCreditDisplays();
  loadCampaigns();
  if (user.role === 'admin' || user.role === 'reseller') {
    loadUsers().then(() => refreshDashboardMetrics()).catch(() => {});
  }
  if (typeof window.checkImpersonationStatus === 'function') {
    window.checkImpersonationStatus();
  }
  switchView('view-dashboard');

  if (window.lucide) {
    setTimeout(() => lucide.createIcons(), 50);
  }

  if (pollInterval) clearInterval(pollInterval);
  pollInterval = setInterval(loadCampaigns, 5000);
}

function updateSettingsView() {
  if (!currentUser) return;
  if (settingsUserAvatar) settingsUserAvatar.textContent = currentUser.email.charAt(0).toUpperCase();
  if (settingsUserEmail) settingsUserEmail.textContent = currentUser.email;
  if (settingsUserRole) {
    settingsUserRole.textContent = currentUser.role;
    settingsUserRole.className = `role-badge role-${currentUser.role}`;
  }
  const profileFields = {
    'profile-full-name': currentUser.fullName || '',
    'profile-company-name': currentUser.companyName || '',
    'profile-phone': currentUser.phone || '',
    'profile-gstin': currentUser.gstin || '',
    'profile-business-address': currentUser.businessAddress || ''
  };
  Object.entries(profileFields).forEach(([id, value]) => {
    const field = document.getElementById(id);
    if (field) field.value = value;
  });

  // Team member isolation: lock down company legal & tax fields
  const isTeam = Boolean(currentUser.isTeamMember);
  ['profile-company-name', 'profile-gstin', 'profile-business-address'].forEach(id => {
    const el = document.getElementById(id);
    if (el) {
      el.disabled = isTeam;
      el.readOnly = isTeam;
      if (isTeam) {
        el.style.backgroundColor = 'var(--slate-100)';
        el.style.cursor = 'not-allowed';
      } else {
        el.style.backgroundColor = '';
        el.style.cursor = '';
      }
    }
  });

  const teamNotice = document.getElementById('team-settings-notice');
  if (isTeam) {
    if (!teamNotice) {
      const form = document.getElementById('account-profile-form');
      if (form) {
        const noticeDiv = document.createElement('div');
        noticeDiv.id = 'team-settings-notice';
        noticeDiv.style.cssText = 'background: #eff6ff; border: 1px solid #bfdbfe; color: #1e40af; padding: 10px 14px; border-radius: 8px; margin-bottom: 14px; font-size: 0.85rem; display: flex; align-items: center; gap: 8px;';
        noticeDiv.innerHTML = '<i data-lucide="shield" style="width:16px;height:16px;flex-shrink:0;"></i> <span><strong>Team Account Mode:</strong> Company legal & tax profile is managed by your organization administrator. You can update your personal contact info and login password.</span>';
        form.insertBefore(noticeDiv, form.firstChild);
        if (window.lucide) lucide.createIcons();
      }
    }
  } else if (teamNotice) {
    teamNotice.remove();
  }

  // Dedicated Managing Partner Card for client users
  const partnerCard = document.getElementById('settings-partner-card');
  if (partnerCard) {
    if (currentUser.role === 'user' && currentUser.reseller_id) {
      apiFetch('/resellers/me').then(partner => {
        if (!partner) {
          partnerCard.style.display = 'none';
          return;
        }
        partnerCard.style.display = 'block';
        const brandNameEl = document.getElementById('partner-card-brand-name');
        const legalEl = document.getElementById('partner-card-legal-entity');
        const logoImg = document.getElementById('partner-card-logo-img');
        const avatarEl = document.getElementById('partner-card-avatar');
        const emailLink = document.getElementById('partner-card-email-link');
        const emailTxt = document.getElementById('partner-card-email-txt');
        const phoneLink = document.getElementById('partner-card-phone-link');
        const phoneTxt = document.getElementById('partner-card-phone-txt');
        const waLink = document.getElementById('partner-card-wa-link');

        if (brandNameEl) brandNameEl.textContent = partner.brand_name || 'Managing Partner';
        if (legalEl) legalEl.textContent = partner.company_legal_name || 'Authorized Reseller Partner';
        if (partner.logo_url) {
          const safeLogo = sanitizeUrl(partner.logo_url);
          if (safeLogo !== '#') {
            if (logoImg) { logoImg.src = safeLogo; logoImg.style.display = 'block'; }
            if (avatarEl) avatarEl.style.display = 'none';
          }
        } else {
          if (logoImg) logoImg.style.display = 'none';
          if (avatarEl) {
            avatarEl.style.display = 'block';
            avatarEl.textContent = (partner.brand_name || 'P').charAt(0).toUpperCase();
          }
        }

        const supportEmail = partner.support_email || 'support@partner.com';
        if (emailLink) emailLink.href = `mailto:${encodeURIComponent(supportEmail)}`;
        if (emailTxt) emailTxt.textContent = supportEmail;

        const supportPhone = partner.support_phone || '';
        if (phoneLink) {
          if (supportPhone) {
            phoneLink.href = `tel:${encodeURIComponent(supportPhone.replace(/[^0-9+]/g, ''))}`;
            if (phoneTxt) phoneTxt.textContent = supportPhone;
            phoneLink.style.display = 'flex';
          } else {
            phoneLink.style.display = 'none';
          }
        }

        const waPhone = partner.support_whatsapp || supportPhone;
        if (waLink) {
          if (waPhone) {
            const cleanDigits = waPhone.replace(/[^0-9]/g, '');
            waLink.href = `https://wa.me/${cleanDigits}?text=${encodeURIComponent('Hello, I am contacting you regarding my messaging portal account balance and service.')}`;
            waLink.style.display = 'flex';
          } else {
            waLink.style.display = 'none';
          }
        }
        if (window.lucide) setTimeout(() => lucide.createIcons(), 30);
      }).catch(() => {
        partnerCard.style.display = 'none';
      });
    } else {
      partnerCard.style.display = 'none';
    }
  }
}

const accountProfileForm = document.getElementById('account-profile-form');
if (accountProfileForm) {
  accountProfileForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const isTeam = Boolean(currentUser && currentUser.isTeamMember);
    const payload = {
      full_name: document.getElementById('profile-full-name').value.trim(),
      phone: document.getElementById('profile-phone').value.trim()
    };
    if (!isTeam) {
      payload.company_name = document.getElementById('profile-company-name').value.trim();
      payload.gstin = document.getElementById('profile-gstin').value.trim();
      payload.business_address = document.getElementById('profile-business-address').value.trim();
    }
    try {
      const saved = await apiFetch('/auth/profile', { method: 'PATCH', body: JSON.stringify(payload) });
      Object.assign(currentUser, { 
        fullName: saved.full_name, 
        phone: saved.phone,
        companyName: saved.company_name, 
        gstin: saved.gstin, 
        businessAddress: saved.business_address 
      });
      updateSettingsView();
      showToast('success', 'Profile saved', isTeam ? 'Your personal details are updated.' : 'Your account and business contact details are updated.');
    } catch (err) { showToast('error', 'Profile update failed', err.message); }
  });
}

// Change Password Handler
const changePassForm = document.getElementById('change-pass-form');
if (changePassForm) {
  changePassForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const currPass = document.getElementById('input-curr-pass').value;
    const newPass = document.getElementById('input-new-pass').value;
    const confPass = document.getElementById('input-conf-pass').value;

    if (newPass.length < 8) {
      showToast('error', 'Password too short', 'Use at least 8 characters for your new password.');
      return;
    }
    if (newPass !== confPass) {
      showToast('error', 'Mismatch', 'New password and confirm password do not match.');
      return;
    }

    try {
      const res = await apiFetch('/auth/change-password', {
        method: 'PATCH',
        body: JSON.stringify({ currentPassword: currPass, newPassword: newPass })
      });
      showToast('success', 'Password Changed', res.message);
      changePassForm.reset();
    } catch (err) {
      showToast('error', 'Error', err.message);
    }
  });
}

async function handleInviteUrlState() {
  try {
    const params = new URLSearchParams(window.location.search);
    const refCode = params.get('ref') || params.get('invite');
    const isSignup = window.location.pathname.includes('/signup') || window.location.pathname.includes('/register') || params.has('signup') || params.has('register');

    const refBanner = document.getElementById('auth-referral-banner');
    const accTypeGroup = document.getElementById('reg-account-type-group');

    if (refCode) {
      const inviteRes = await fetch(`/api/auth/invite/${encodeURIComponent(refCode)}`);
      if (inviteRes.ok) {
        const inviteData = await inviteRes.json();
        if (inviteData && inviteData.valid) {
          if (inviteData.reseller) {
            applyBrandProfile(inviteData.reseller);
          }
          const inviteInput = document.getElementById('reg-invite-code');
          if (inviteInput) inviteInput.value = inviteData.invite_code || refCode;

          const partnerNameEl = document.getElementById('auth-partner-name');
          if (refBanner && partnerNameEl) {
            partnerNameEl.textContent = inviteData.reseller?.brand_name || 'Partner';
            refBanner.style.display = 'flex';
          }

          // If invited by a reseller, register strictly as a client under that reseller
          if (accTypeGroup) accTypeGroup.style.display = 'none';
          if (window.setRegAccountType) window.setRegAccountType('user');

          if (inviteData.allow_self_registration === false) {
            const errBox = document.getElementById('reg-error-box');
            if (errBox) {
              errBox.textContent = 'Notice: Public self-registration is currently paused by this partner. Please contact partner support.';
              errBox.style.display = 'block';
            }
          } else {
            window.switchAuthMode('register');
          }
          return;
        }
      }
    }

    // Default: on platform domain with no referral code, strictly hide partner banner and show account type selector
    if (refBanner) refBanner.style.display = 'none';
    if (accTypeGroup) accTypeGroup.style.display = 'block';

    if (isSignup) {
      window.switchAuthMode('register');
    }
  } catch (err) {
    console.error('Error handling invite URL state:', err);
  }
}

async function checkSession() {
  resolveHostBranding();
  handleInviteUrlState();
  if (window.location.protocol === 'file:') {
    showAuthView();
    showAuthError('This portal needs its secure backend. Run “npm start” in the project folder, then open http://localhost:3000 — do not open public/index.html directly.');
    return;
  }
  const token = getAuthToken();
  if (!token) {
    showAuthView();
    return;
  }

  try {
    const user = await apiFetch('/auth/me');
    handleLoginSuccess(user);
  } catch (e) {
    setAuthToken(null);
    showAuthView();
  }
}

function updateCreditDisplays() {
  if (!currentUser) return;
  window.currentUser = currentUser;

  const smsBalEl = document.getElementById('sms-kpi-balance');
  if (smsBalEl) {
    smsBalEl.textContent = Number(currentUser.credits_gsm_sms_domestic || 0).toLocaleString();
  }

  const domTotal = (currentUser.credits_gsm_sms_domestic || 0) + (currentUser.credits_normal_domestic || 0) + (currentUser.credits_dp_domestic || 0) + (currentUser.credits_cta_domestic || 0) + (currentUser.credits_dp_cta_domestic || 0) + (currentUser.credits_own_number_domestic || 0);
  const intlTotal = (currentUser.credits_gsm_sms_international || 0) + (currentUser.credits_normal_international || 0) + (currentUser.credits_dp_international || 0) + (currentUser.credits_cta_international || 0) + (currentUser.credits_dp_cta_international || 0) + (currentUser.credits_own_number_international || 0);

  const domPill = document.getElementById('topbar-domestic-credits');
  const intlPill = document.getElementById('topbar-intl-credits');

  if (currentUser.role === 'admin') {
    if (domPill) {
      domPill.style.display = 'inline-flex';
      domPill.style.background = '#eef2ff';
      domPill.style.borderColor = '#c7d2fe';
      domPill.innerHTML = '<i data-lucide="shield-check" style="width:14px;height:14px;color:#4f46e5;"></i> Root Issuer <strong style="color:#4f46e5;margin-left:4px;">Master Wallet</strong>';
    }
    if (intlPill) {
      intlPill.style.display = 'inline-flex';
      intlPill.style.cursor = 'pointer';
      intlPill.style.background = '#ecfdf5';
      intlPill.style.borderColor = '#a7f3d0';
      intlPill.onclick = () => openOperatorDispatchModal();
      intlPill.title = 'Click to open Operator Dispatch Queue';
      intlPill.innerHTML = '<i data-lucide="send" style="width:14px;height:14px;color:#059669;"></i> Queue: <strong id="topbar-queue-val" style="color:#059669;margin-left:3px;">0</strong>';
    }
  } else if (currentUser.role === 'reseller') {
    if (domPill) {
      domPill.style.display = 'inline-flex';
      domPill.style.background = '#f0fdf4';
      domPill.style.borderColor = '#bbf7d0';
      domPill.innerHTML = `<i data-lucide="coins" style="width:14px;height:14px;color:#059669;"></i> Stock Dom: <strong id="topbar-dom-val" style="margin-left:4px;">${domTotal.toLocaleString()}</strong>`;
    }
    if (intlPill) {
      intlPill.style.display = 'inline-flex';
      intlPill.style.background = '#f0fdf4';
      intlPill.style.borderColor = '#bbf7d0';
      intlPill.innerHTML = `<i data-lucide="globe" style="width:14px;height:14px;color:#059669;"></i> Stock Intl: <strong id="topbar-intl-val" style="margin-left:4px;">${intlTotal.toLocaleString()}</strong>`;
    }
  } else {
    if (domPill) {
      domPill.style.display = 'inline-flex';
      domPill.style.background = '';
      domPill.style.borderColor = '';
      domPill.innerHTML = `<i data-lucide="wallet" style="width:14px;height:14px;color:#4f46e5;"></i> Dom: <strong id="topbar-dom-val" style="margin-left:4px;">${domTotal.toLocaleString()}</strong>`;
    }
    if (intlPill) {
      intlPill.style.display = 'inline-flex';
      intlPill.style.background = '';
      intlPill.style.borderColor = '';
      intlPill.innerHTML = `<i data-lucide="globe" style="width:14px;height:14px;color:#0ea5e9;"></i> Intl: <strong id="topbar-intl-val" style="margin-left:4px;">${intlTotal.toLocaleString()}</strong>`;
    }
  }

  if (window.lucide) lucide.createIcons();
  refreshDashboardMetrics();
  updateWalletView();
}

let walletActiveRoute = 'domestic';
let ledgerDatePreset = 'all';

window.switchVaultRoute = function(route) {
  walletActiveRoute = route === 'international' ? 'international' : 'domestic';
  
  const tabDom = document.getElementById('vault-tab-domestic');
  const tabIntl = document.getElementById('vault-tab-intl');
  if (tabDom && tabIntl) {
    if (walletActiveRoute === 'domestic') {
      tabDom.style.background = '#4f46e5';
      tabDom.style.color = '#fff';
      tabDom.style.fontWeight = '700';
      tabIntl.style.background = 'transparent';
      tabIntl.style.color = '#94a3b8';
      tabIntl.style.fontWeight = '600';
    } else {
      tabIntl.style.background = '#0ea5e9';
      tabIntl.style.color = '#fff';
      tabIntl.style.fontWeight = '700';
      tabDom.style.background = 'transparent';
      tabDom.style.color = '#94a3b8';
      tabDom.style.fontWeight = '600';
    }
  }

  const titleEl = document.getElementById('wallet-hero-route-title');
  if (titleEl) {
    titleEl.textContent = walletActiveRoute === 'domestic' 
      ? 'Domestic Telecom Route (India +91)' 
      : 'International Telecom Route (Global)';
  }

  updateWalletView();
};

function updateWalletView() {
  if (!currentUser) return;
  const setEl = (id, val) => {
    const el = document.getElementById(id);
    if (el) el.textContent = (val || 0).toLocaleString();
  };

  const route = walletActiveRoute || 'domestic';

  const domSms = Number(currentUser.credits_gsm_sms_domestic || 0);
  const domNormal = Number(currentUser.credits_normal_domestic || 0);
  const domDp = Number(currentUser.credits_dp_domestic || 0);
  const domCta = Number(currentUser.credits_cta_domestic || 0);
  const domDpCta = Number(currentUser.credits_dp_cta_domestic || 0);
  const domOwn = Number(currentUser.credits_own_number_domestic || 0);
  const domTotal = domSms + domNormal + domDp + domCta + domDpCta + domOwn;

  const intlSms = Number(currentUser.credits_gsm_sms_international || 0);
  const intlNormal = Number(currentUser.credits_normal_international || 0);
  const intlDp = Number(currentUser.credits_dp_international || 0);
  const intlCta = Number(currentUser.credits_cta_international || 0);
  const intlDpCta = Number(currentUser.credits_dp_cta_international || 0);
  const intlOwn = Number(currentUser.credits_own_number_international || 0);
  const intlTotal = intlSms + intlNormal + intlDp + intlCta + intlDpCta + intlOwn;

  // Active route numbers
  const activeSms = route === 'domestic' ? domSms : intlSms;
  const activeNormal = route === 'domestic' ? domNormal : intlNormal;
  const activeDp = route === 'domestic' ? domDp : intlDp;
  const activeCta = route === 'domestic' ? domCta : intlCta;
  const activeDpCta = route === 'domestic' ? domDpCta : intlDpCta;
  const activeOwn = route === 'domestic' ? domOwn : intlOwn;
  const activeTotal = route === 'domestic' ? domTotal : intlTotal;

  // Master Hero Total Balance
  setEl('wallet-hero-total-balance', activeTotal);

  // Dynamic Role Badge & Route Title
  const roleBadge = document.getElementById('wallet-hero-role-badge');
  const roleIcon = document.getElementById('wallet-hero-role-icon');
  const routeTitle = document.getElementById('wallet-hero-route-title');
  if (roleBadge) {
    if (currentUser?.role === 'admin') {
      roleBadge.textContent = 'MASTER TELECOM VAULT';
      if (roleIcon) roleIcon.setAttribute('data-lucide', 'shield-check');
      if (routeTitle) routeTitle.textContent = `${route === 'domestic' ? 'Domestic Telecom Route (India +91)' : 'International Telecom Route (Global)'} • 6 Channels Active`;
    } else if (currentUser?.role === 'reseller') {
      roleBadge.textContent = 'RESELLER MASTER INVENTORY';
      if (roleIcon) roleIcon.setAttribute('data-lucide', 'store');
      if (routeTitle) routeTitle.textContent = `${route === 'domestic' ? 'Reseller Domestic Inventory (India +91)' : 'Reseller International Inventory (Global)'} • Wholesale Pool`;
    } else {
      roleBadge.textContent = 'BUSINESS CREDIT WALLET';
      if (roleIcon) roleIcon.setAttribute('data-lucide', 'wallet');
      if (routeTitle) routeTitle.textContent = `${route === 'domestic' ? 'Domestic Credits (India +91)' : 'International Credits (Global)'} • Multi-Channel Balance`;
    }
  }

  // Smart Health Badge
  const healthBadge = document.getElementById('wallet-hero-health-badge');
  if (healthBadge) {
    if (activeTotal >= 10000) {
      healthBadge.style.background = '#ecfdf5';
      healthBadge.style.color = '#15803d';
      healthBadge.style.borderColor = '#bbf7d0';
      healthBadge.innerHTML = '<i data-lucide="check-circle" style="width:13px;height:13px;display:inline-block;vertical-align:-1px;margin-right:4px;"></i> Healthy Stock';
    } else if (activeTotal >= 1000) {
      healthBadge.style.background = '#fefce8';
      healthBadge.style.color = '#a16207';
      healthBadge.style.borderColor = '#fef08a';
      healthBadge.innerHTML = '<i data-lucide="alert-circle" style="width:13px;height:13px;display:inline-block;vertical-align:-1px;margin-right:4px;"></i> Refill Recommended';
    } else {
      healthBadge.style.background = '#fef2f2';
      healthBadge.style.color = '#b91c1c';
      healthBadge.style.borderColor = '#fecaca';
      healthBadge.innerHTML = '<i data-lucide="alert-triangle" style="width:13px;height:13px;display:inline-block;vertical-align:-1px;margin-right:4px;"></i> Low Balance Alert';
    }
    if (window.lucide) setTimeout(() => lucide.createIcons(), 20);
  }

  // Channel Grid Cards
  setEl('card-val-sms', activeSms);
  setEl('card-val-normal', activeNormal);
  setEl('card-val-dp', activeDp);
  setEl('card-val-cta', activeCta);
  setEl('card-val-dpcta', activeDpCta);
  setEl('card-val-own', activeOwn);

  // Distribution legend values
  setEl('dist-val-sms', activeSms);
  setEl('dist-val-normal', activeNormal);
  setEl('dist-val-dp', activeDp);
  setEl('dist-val-cta', activeCta);
  setEl('dist-val-dpcta', activeDpCta);
  setEl('dist-val-own', activeOwn);

  // Distribution progress bars
  const setBarWidth = (id, val) => {
    const el = document.getElementById(id);
    if (!el) return;
    if (activeTotal > 0) {
      const pct = Math.max(0.5, (val / activeTotal) * 100).toFixed(1);
      el.style.width = pct + '%';
    } else {
      el.style.width = '16.6%';
    }
  };
  setBarWidth('dist-bar-sms', activeSms);
  setBarWidth('dist-bar-normal', activeNormal);
  setBarWidth('dist-bar-dp', activeDp);
  setBarWidth('dist-bar-cta', activeCta);
  setBarWidth('dist-bar-dpcta', activeDpCta);
  setBarWidth('dist-bar-own', activeOwn);

  const distSummary = document.getElementById('wallet-dist-summary-text');
  if (distSummary) {
    distSummary.textContent = `${activeTotal.toLocaleString()} usable credits (${route === 'domestic' ? 'India' : 'Intl'})`;
  }

  // Backward compatibility with previous breakdown elements if present
  setEl('wallet-dom-normal', domNormal);
  setEl('wallet-dom-dp', domDp);
  setEl('wallet-dom-cta', domCta);
  setEl('wallet-dom-dpcta', domDpCta);
  setEl('wallet-dom-own', domOwn);
  setEl('wallet-intl-normal', intlNormal);
  setEl('wallet-intl-dp', intlDp);
  setEl('wallet-intl-cta', intlCta);
  setEl('wallet-intl-dpcta', intlDpCta);
  setEl('wallet-intl-own', intlOwn);
  setEl('wallet-summary-dom-total', domTotal);
  setEl('wallet-summary-intl-total', intlTotal);
  setEl('wallet-summary-sms-total', domNormal);

  // Reseller Master Stock Command Center
  const resellerStockCard = document.getElementById('wallet-reseller-stock-card');
  if (resellerStockCard) {
    if (currentUser.role === 'reseller') {
      resellerStockCard.style.display = 'block';
      loadResellerWalletData();
    } else {
      resellerStockCard.style.display = 'none';
    }
  }

  // Request Top-Up is ONLY for Resellers and Clients; Super Admin is Root Issuer
  const btnTopup = document.getElementById('btn-wallet-request-topup');
  if (btnTopup) {
    if (currentUser.role === 'admin') {
      btnTopup.style.display = 'none'; // Super admin does not request credits from anyone
    } else {
      btnTopup.style.display = 'inline-flex';
    }
  }

  // Show Allot / Transfer button for Admin & Reseller
  const btnAllot = document.getElementById('btn-wallet-allot-credits');
  if (btnAllot) {
    if (currentUser.role === 'admin') {
      btnAllot.style.display = 'inline-flex';
      btnAllot.style.background = 'linear-gradient(135deg, #4f46e5 0%, #3730a3 100%)';
      btnAllot.style.boxShadow = '0 4px 12px rgba(79, 70, 229, 0.4)';
      btnAllot.style.fontWeight = '700';
    } else if (currentUser.role === 'reseller') {
      btnAllot.style.display = 'inline-flex';
      btnAllot.style.background = 'rgba(255, 255, 255, 0.12)';
      btnAllot.style.boxShadow = 'none';
      btnAllot.style.fontWeight = '600';
    } else {
      btnAllot.style.display = 'none';
    }
  }

  if (window.lucide) setTimeout(() => lucide.createIcons(), 50);
}

// --- RESELLER WALLET & CLIENT NETWORK MANAGEMENT ---
let resellerCachedClients = [];

async function loadResellerWalletData() {
  if (currentUser?.role !== 'reseller') return;
  try {
    const uData = await apiFetch('/users?limit=300');
    const clients = Array.isArray(uData) ? uData : (uData.users || []);
    resellerCachedClients = clients;

    let totalClientCredits = 0;
    clients.forEach(c => {
      totalClientCredits += (
        Number(c.credits_gsm_sms_domestic || 0) +
        Number(c.credits_normal_domestic || 0) +
        Number(c.credits_dp_domestic || 0) +
        Number(c.credits_cta_domestic || 0) +
        Number(c.credits_dp_cta_domestic || 0) +
        Number(c.credits_own_number_domestic || 0) +
        Number(c.credits_gsm_sms_international || 0) +
        Number(c.credits_normal_international || 0) +
        Number(c.credits_dp_international || 0) +
        Number(c.credits_cta_international || 0) +
        Number(c.credits_dp_cta_international || 0) +
        Number(c.credits_own_number_international || 0)
      );
    });

    const myDom = Number(currentUser.credits_gsm_sms_domestic || 0) + Number(currentUser.credits_normal_domestic || 0) + Number(currentUser.credits_dp_domestic || 0) + Number(currentUser.credits_cta_domestic || 0) + Number(currentUser.credits_dp_cta_domestic || 0) + Number(currentUser.credits_own_number_domestic || 0);
    const myIntl = Number(currentUser.credits_gsm_sms_international || 0) + Number(currentUser.credits_normal_international || 0) + Number(currentUser.credits_dp_international || 0) + Number(currentUser.credits_cta_international || 0) + Number(currentUser.credits_dp_cta_international || 0) + Number(currentUser.credits_own_number_international || 0);
    const myTotal = myDom + myIntl;

    const vaultStockEl = document.getElementById('reseller-stat-vault-stock');
    const clientStockEl = document.getElementById('reseller-stat-client-stock');
    const networkTotalEl = document.getElementById('reseller-stat-network-total');
    const clientCountEl = document.getElementById('reseller-stat-client-count');
    const btnClientCountEl = document.getElementById('reseller-btn-client-count');

    if (vaultStockEl) vaultStockEl.textContent = myTotal.toLocaleString();
    if (clientStockEl) clientStockEl.textContent = totalClientCredits.toLocaleString();
    if (networkTotalEl) networkTotalEl.textContent = (myTotal + totalClientCredits).toLocaleString();
    if (clientCountEl) clientCountEl.textContent = clients.length.toLocaleString();
    if (btnClientCountEl) btnClientCountEl.textContent = clients.length.toLocaleString();
  } catch (err) {
    console.error('Error loading reseller wallet data:', err);
  }
}

// --- RESELLER PROFIT & MARGINS COMMERCIAL ANALYTICS ---
let currentResellerMarginRange = 'this_month';

window.setResellerMarginRange = function(range) {
  currentResellerMarginRange = range;
  document.querySelectorAll('.btn-rpm-filter').forEach(btn => {
    btn.style.background = 'transparent';
    btn.style.color = '#64748b';
  });
  const activeBtn = document.getElementById(
    range === 'this_month' ? 'rpm-filter-this-month' : (range === 'last_30_days' ? 'rpm-filter-last-30' : 'rpm-filter-all-time')
  );
  if (activeBtn) {
    activeBtn.style.background = '#059669';
    activeBtn.style.color = '#ffffff';
  }
  loadResellerProfitAnalytics(range);
};

window.loadResellerProfitAnalytics = async function(range) {
  if (!currentUser || currentUser.role !== 'reseller') return;
  const filterRange = range || currentResellerMarginRange || 'this_month';

  try {
    const data = await apiFetch(`/resellers/analytics/margins?range=${encodeURIComponent(filterRange)}`);
    if (!data || !data.summary) return;

    const s = data.summary;
    const formatInr = (val) => '₹' + Number(val || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const formatPaisa = (rate) => (Number(rate || 0) * 100).toFixed(2) + 'p';

    // 1. Top 4 KPI values
    const netProfitEl = document.getElementById('rpm-net-profit');
    const marginBadgeEl = document.getElementById('rpm-margin-badge');
    const grossRevEl = document.getElementById('rpm-gross-revenue');
    const creditsSoldEl = document.getElementById('rpm-credits-sold');
    const sellingRateBadgeEl = document.getElementById('rpm-selling-rate-badge');
    const wholesaleCogsEl = document.getElementById('rpm-wholesale-cogs');
    const wholesaleCostBadgeEl = document.getElementById('rpm-wholesale-cost-badge');
    const cashCollectedEl = document.getElementById('rpm-cash-collected');
    const balanceDueEl = document.getElementById('rpm-balance-due');
    const collectionBadgeEl = document.getElementById('rpm-collection-badge');

    if (netProfitEl) netProfitEl.textContent = formatInr(s.net_profit);
    if (marginBadgeEl) marginBadgeEl.textContent = `${s.profit_margin_pct}% Margin`;
    if (grossRevEl) grossRevEl.textContent = formatInr(s.gross_revenue);
    if (creditsSoldEl) creditsSoldEl.textContent = Number(s.total_credits_sold || 0).toLocaleString('en-IN');
    if (sellingRateBadgeEl) sellingRateBadgeEl.textContent = `${formatPaisa(s.avg_selling_rate)} / cr`;
    if (wholesaleCogsEl) wholesaleCogsEl.textContent = formatInr(s.wholesale_cogs);
    if (wholesaleCostBadgeEl) wholesaleCostBadgeEl.textContent = `${formatPaisa(s.avg_wholesale_rate)} / cr`;
    if (cashCollectedEl) cashCollectedEl.textContent = formatInr(s.cash_collected);
    if (balanceDueEl) balanceDueEl.textContent = formatInr(s.balance_due);
    if (collectionBadgeEl) collectionBadgeEl.textContent = `${s.collection_rate_pct}% Settled`;

    // 2. Channel Summary Strip
    const wa = data.channel_summary?.whatsapp || {};
    const gsm = data.channel_summary?.gsm_sms || {};

    const waProfitEl = document.getElementById('rpm-wa-profit');
    const waMarginEl = document.getElementById('rpm-wa-margin');
    const waCreditsEl = document.getElementById('rpm-wa-credits');
    const waRevEl = document.getElementById('rpm-wa-revenue');

    if (waProfitEl) waProfitEl.textContent = formatInr(wa.net_profit);
    if (waMarginEl) waMarginEl.textContent = `${wa.margin_pct || 0}% Margin`;
    if (waCreditsEl) waCreditsEl.textContent = Number(wa.credits_sold || 0).toLocaleString('en-IN');
    if (waRevEl) waRevEl.textContent = formatInr(wa.revenue);

    const gsmProfitEl = document.getElementById('rpm-gsm-profit');
    const gsmMarginEl = document.getElementById('rpm-gsm-margin');
    const gsmCreditsEl = document.getElementById('rpm-gsm-credits');
    const gsmRevEl = document.getElementById('rpm-gsm-revenue');

    if (gsmProfitEl) gsmProfitEl.textContent = formatInr(gsm.net_profit);
    if (gsmMarginEl) gsmMarginEl.textContent = `${gsm.margin_pct || 0}% Margin`;
    if (gsmCreditsEl) gsmCreditsEl.textContent = Number(gsm.credits_sold || 0).toLocaleString('en-IN');
    if (gsmRevEl) gsmRevEl.textContent = formatInr(gsm.revenue);

    // 3. Channel Breakdown Table
    const channelsTbody = document.getElementById('rpm-channels-tbody');
    if (channelsTbody) {
      const activeChannels = (data.channels || []).filter(c => c.credits_sold > 0 || c.wholesale_rate > 0);
      if (activeChannels.length === 0) {
        channelsTbody.innerHTML = `<tr><td colspan="6" style="text-align:center;padding:16px;color:#94a3b8;">No credits allotted in this period.</td></tr>`;
      } else {
        channelsTbody.innerHTML = activeChannels.map(ch => {
          const isGsm = ch.category === 'GSM SMS';
          const badgeClass = isGsm ? 'background:#e0e7ff;color:#3730a3;' : 'background:#dcfce7;color:#166534;';
          return `
            <tr style="border-bottom:1px solid #f1f5f9;">
              <td style="padding:8px 8px;">
                <div style="font-weight:600;color:#0f172a;display:flex;align-items:center;gap:6px;">
                  <span style="${badgeClass}font-size:0.65rem;font-weight:700;padding:1px 5px;border-radius:4px;">${isGsm ? 'GSM' : 'WA'}</span>
                  <span>${escapeHtml(ch.label)}</span>
                </div>
              </td>
              <td style="padding:8px 8px;text-align:right;font-family:monospace;color:#64748b;">${formatPaisa(ch.wholesale_rate)}</td>
              <td style="padding:8px 8px;text-align:right;font-family:monospace;color:#0f172a;font-weight:600;">${ch.selling_rate > 0 ? formatPaisa(ch.selling_rate) : '—'}</td>
              <td style="padding:8px 8px;text-align:right;font-weight:600;color:#334155;">${Number(ch.credits_sold || 0).toLocaleString('en-IN')}</td>
              <td style="padding:8px 8px;text-align:right;font-weight:700;color:${ch.net_profit >= 0 ? '#15803d' : '#b91c1c'};">${formatInr(ch.net_profit)}</td>
              <td style="padding:8px 8px;text-align:right;">
                <span style="background:${ch.margin_pct >= 25 ? '#dcfce7;color:#15803d' : '#f1f5f9;color:#475569'};font-size:0.72rem;font-weight:700;padding:2px 6px;border-radius:4px;">
                  ${ch.margin_pct}%
                </span>
              </td>
            </tr>
          `;
        }).join('');
      }
    }

    // 4. Top Profitable Clients Table
    const clientsTbody = document.getElementById('rpm-clients-tbody');
    if (clientsTbody) {
      const topClients = data.top_clients || [];
      if (topClients.length === 0) {
        clientsTbody.innerHTML = `<tr><td colspan="5" style="text-align:center;padding:16px;color:#94a3b8;">No client transactions yet. Allot credits to see earnings.</td></tr>`;
      } else {
        clientsTbody.innerHTML = topClients.slice(0, 8).map(cl => {
          const isFullyPaid = cl.balance_due <= 0;
          const statusBadge = isFullyPaid
            ? `<span style="background:#dcfce7;color:#15803d;font-size:0.68rem;font-weight:700;padding:2px 6px;border-radius:4px;">Paid</span>`
            : `<span style="background:#fef3c7;color:#b45309;font-size:0.68rem;font-weight:700;padding:2px 6px;border-radius:4px;" title="Due: ${formatInr(cl.balance_due)}">Due ${formatInr(cl.balance_due)}</span>`;
          return `
            <tr style="border-bottom:1px solid #f1f5f9;">
              <td style="padding:8px 8px;">
                <div style="font-weight:600;color:#0f172a;">${escapeHtml(cl.name || cl.company || 'Client')}</div>
                <div style="font-size:0.7rem;color:#64748b;">${escapeHtml(cl.email)}</div>
              </td>
              <td style="padding:8px 8px;text-align:right;font-weight:600;color:#334155;">${Number(cl.credits_bought || 0).toLocaleString('en-IN')}</td>
              <td style="padding:8px 8px;text-align:right;font-weight:600;color:#0f172a;">${formatInr(cl.revenue)}</td>
              <td style="padding:8px 8px;text-align:right;font-weight:700;color:#15803d;">${formatInr(cl.net_profit)}</td>
              <td style="padding:8px 8px;text-align:center;">${statusBadge}</td>
            </tr>
          `;
        }).join('');
      }
    }

    if (window.lucide) {
      try { lucide.createIcons({ root: document.getElementById('reseller-profit-margins-section') }); } catch(_) {}
    }
  } catch (err) {
    console.error('Failed to load reseller profit analytics:', err);
  }
};

window.openResellerClientBalancesModal = function() {
  const modal = document.getElementById('modal-reseller-clients');
  if (!modal) return;
  modal.style.display = 'flex';
  renderResellerClientsTable(resellerCachedClients);
  if (window.lucide) setTimeout(() => lucide.createIcons(), 50);
};

window.renderResellerClientsTable = function(clients) {
  const tbody = document.getElementById('reseller-clients-tbody');
  if (!tbody) return;
  if (!clients || clients.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" style="text-align: center; padding: 24px; color: #94a3b8;">No client accounts found under your reseller account.</td></tr>`;
    return;
  }
  tbody.innerHTML = clients.map(c => {
    const sms = Number(c.credits_gsm_sms_domestic || 0);
    const normal = Number(c.credits_normal_domestic || 0);
    const dp = Number(c.credits_dp_domestic || 0);
    const cta = Number(c.credits_cta_domestic || 0);
    const dpcta = Number(c.credits_dp_cta_domestic || 0);
    const own = Number(c.credits_own_number_domestic || 0);
    const total = sms + normal + dp + cta + dpcta + own;
    return `
      <tr style="border-bottom: 1px solid #f1f5f9;">
        <td style="padding: 9px 12px;">
          <div style="font-weight: 700; color: #1e293b;">${escapeHtml(c.email)}</div>
          <div style="font-size: 0.72rem; color: #64748b;">${escapeHtml(c.company_name || c.full_name || 'Standard Client')}</div>
        </td>
        <td style="padding: 9px 10px; text-align: right; font-family: monospace; font-weight: 700; color: #2563eb;">${sms.toLocaleString()}</td>
        <td style="padding: 9px 10px; text-align: right; font-family: monospace; font-weight: 700; color: #10b981;">${normal.toLocaleString()}</td>
        <td style="padding: 9px 10px; text-align: right; font-family: monospace; font-weight: 700; color: #0284c7;">${dp.toLocaleString()}</td>
        <td style="padding: 9px 10px; text-align: right; font-family: monospace; font-weight: 700; color: #d97706;">${cta.toLocaleString()}</td>
        <td style="padding: 9px 10px; text-align: right; font-family: monospace; font-weight: 800; color: #0f172a;">${total.toLocaleString()}</td>
        <td style="padding: 9px 12px; text-align: center;">
          <div style="display: inline-flex; gap: 4px;">
            <button type="button" class="btn-action btn-action-primary" data-action="quick-allot" data-user-id="${c.id}" data-email="${escapeHtml(c.email)}" data-mode="credit" style="padding: 3px 8px; font-size: 0.72rem; border-radius: 5px;">
              + Allot
            </button>
            <button type="button" class="btn-action btn-action-secondary" data-action="quick-allot" data-user-id="${c.id}" data-email="${escapeHtml(c.email)}" data-mode="debit" style="padding: 3px 8px; font-size: 0.72rem; border-radius: 5px; color: #b91c1c;">
              - Deduct
            </button>
          </div>
        </td>
      </tr>
    `;
  }).join('');
  if (window.lucide) setTimeout(() => lucide.createIcons(), 50);
};

window.quickAllotToClient = function(userId, email, mode) {
  const rModal = document.getElementById('modal-reseller-clients');
  if (rModal) rModal.style.display = 'none';
  window.openAllotCreditsModal(userId, email);
  window.setAllocMode(mode);
};

window.filterResellerClientsTable = function() {
  const query = (document.getElementById('reseller-client-search')?.value || '').toLowerCase();
  const filtered = resellerCachedClients.filter(c => 
    (c.email || '').toLowerCase().includes(query) ||
    (c.company_name || '').toLowerCase().includes(query) ||
    (c.full_name || '').toLowerCase().includes(query)
  );
  renderResellerClientsTable(filtered);
};

// --- CREDIT LEDGER STATEMENT & PASSBOOK ---
let ledgerDebounceTimer = null;

let ledgerCurrentPage = 1;
let ledgerPageSize = 50;
let ledgerTotalCount = 0;

window.setLedgerFlowPill = function(flowVal, btn) {
  const container = document.getElementById('ledger-flow-pills');
  if (container) {
    container.querySelectorAll('.tab-pill').forEach(b => b.classList.remove('active'));
    if (btn) btn.classList.add('active');
  }
  const flowSelect = document.getElementById('ledger-filter-flow');
  if (flowSelect) flowSelect.value = flowVal;
  ledgerCurrentPage = 1;
  loadLedgerTransactions();
};

window.onLedgerFlowSelectChange = function() {
  const flowSelect = document.getElementById('ledger-filter-flow');
  const flowVal = flowSelect ? flowSelect.value : 'all';
  const container = document.getElementById('ledger-flow-pills');
  if (container) {
    container.querySelectorAll('.tab-pill').forEach(b => {
      const onclickAttr = b.getAttribute('onclick') || '';
      const match = onclickAttr.match(/'([^']+)'/);
      if (match && match[1] === flowVal) {
        b.classList.add('active');
      } else {
        b.classList.remove('active');
      }
    });
  }
  onLedgerFilterChange();
};

window.setLedgerDatePreset = function(preset, btn) {
  ledgerDatePreset = preset;
  const container = document.getElementById('ledger-date-presets');
  if (container) {
    container.querySelectorAll('.tab-pill').forEach(b => b.classList.remove('active'));
    if (btn) btn.classList.add('active');
  }
  const fEl = document.getElementById('ledger-from-date');
  const tEl = document.getElementById('ledger-to-date');
  if (fEl) fEl.value = '';
  if (tEl) tEl.value = '';
  ledgerCurrentPage = 1;
  loadLedgerTransactions();
};

window.onLedgerCustomDateChange = function() {
  const fVal = document.getElementById('ledger-from-date')?.value;
  const tVal = document.getElementById('ledger-to-date')?.value;
  if (fVal || tVal) {
    document.querySelectorAll('#ledger-date-presets .tab-pill').forEach(b => b.classList.remove('active'));
    ledgerDatePreset = 'custom';
  }
  ledgerCurrentPage = 1;
  loadLedgerTransactions();
};

window.clearLedgerCustomDate = function() {
  const fEl = document.getElementById('ledger-from-date');
  const tEl = document.getElementById('ledger-to-date');
  if (fEl) fEl.value = '';
  if (tEl) tEl.value = '';
  const firstPill = document.querySelector('#ledger-date-presets .tab-pill');
  if (firstPill) {
    window.setLedgerDatePreset('all', firstPill);
  } else {
    ledgerDatePreset = 'all';
    ledgerCurrentPage = 1;
    loadLedgerTransactions();
  }
};

window.onLedgerPageSizeChange = function() {
  const sizeSelect = document.getElementById('ledger-page-size');
  if (sizeSelect) {
    ledgerPageSize = parseInt(sizeSelect.value, 10) || 50;
  }
  ledgerCurrentPage = 1;
  loadLedgerTransactions();
};

window.changeLedgerPage = function(delta) {
  const totalPages = Math.max(1, Math.ceil(ledgerTotalCount / ledgerPageSize));
  const newPage = ledgerCurrentPage + delta;
  if (newPage >= 1 && newPage <= totalPages) {
    ledgerCurrentPage = newPage;
    loadLedgerTransactions();
  }
};

window.onLedgerFilterChange = function() {
  clearTimeout(ledgerDebounceTimer);
  ledgerDebounceTimer = setTimeout(() => {
    ledgerCurrentPage = 1;
    loadLedgerTransactions();
  }, 200);
};

window.exportLedgerCsv = async function() {
  const search = (document.getElementById('ledger-search-input')?.value || '').trim();
  const channel = document.getElementById('ledger-filter-channel')?.value || 'all';
  const dest = document.getElementById('ledger-filter-dest')?.value || 'all';
  const flow = document.getElementById('ledger-filter-flow')?.value || 'all';
  const user = document.getElementById('ledger-filter-user')?.value || '';
  const fromDate = document.getElementById('ledger-from-date')?.value || '';
  const toDate = document.getElementById('ledger-to-date')?.value || '';

  const params = new URLSearchParams();
  if (search) params.append('search', search);
  if (channel && channel !== 'all') params.append('credit_type', channel);
  if (dest && dest !== 'all') params.append('destination', dest);
  if (flow && flow !== 'all') params.append('direction', flow);
  if (user) params.append('userId', user);
  if (fromDate) params.append('from_date', fromDate);
  if (toDate) params.append('to_date', toDate);

  showToast('info', 'Exporting Statement', 'Generating ledger statement CSV...');
  try {
    const filename = `MessageSphere_Passbook_Statement_${new Date().toISOString().slice(0, 10)}.csv`;
    await downloadApiFile(`/credits/transactions/export?${params.toString()}`, filename);
    showToast('success', 'Download Complete', 'Passbook statement downloaded successfully.');
  } catch (err) {
    showToast('error', 'Export Failed', err.message);
  }
};

async function loadLedgerTransactions() {
  const tbody = document.getElementById('ledger-table-tbody');
  if (!tbody) return;
  window.renderTableSkeleton(tbody, 10, 4);

  const search = (document.getElementById('ledger-search-input')?.value || '').trim();
  const channel = document.getElementById('ledger-filter-channel')?.value || 'all';
  const dest = document.getElementById('ledger-filter-dest')?.value || 'all';
  const flow = document.getElementById('ledger-filter-flow')?.value || 'all';
  const user = document.getElementById('ledger-filter-user')?.value || '';
  const fromDate = document.getElementById('ledger-from-date')?.value || '';
  const toDate = document.getElementById('ledger-to-date')?.value || '';

  const params = new URLSearchParams();
  if (search) params.append('search', search);
  if (channel && channel !== 'all') params.append('credit_type', channel);
  if (dest && dest !== 'all') params.append('destination', dest);
  if (flow && flow !== 'all') params.append('direction', flow);
  if (user) params.append('userId', user);
  if (fromDate) params.append('from_date', fromDate);
  if (toDate) params.append('to_date', toDate);

  params.append('paginate', 'true');
  params.append('limit', String(ledgerPageSize));
  params.append('offset', String((ledgerCurrentPage - 1) * ledgerPageSize));

  try {
    const res = await apiFetch(`/credits/transactions?${params.toString()}`);
    let displayedTxs = [];
    if (Array.isArray(res)) {
      displayedTxs = res;
      ledgerTotalCount = res.length;
    } else {
      displayedTxs = res.transactions || [];
      ledgerTotalCount = Number(res.total) || 0;
    }
    allTransactions = displayedTxs;
    
    // Populate user filter for Admin & Reseller if not already populated
    const userFilterEl = document.getElementById('ledger-filter-user');
    if (userFilterEl && (currentUser?.role === 'admin' || currentUser?.role === 'reseller')) {
      userFilterEl.style.display = 'inline-block';
      if (userFilterEl.options.length <= 1) {
        try {
          const uData = await apiFetch('/users?limit=200');
          const uList = Array.isArray(uData) ? uData : (uData.users || []);
          uList.forEach(u => {
            const opt = document.createElement('option');
            opt.value = u.id;
            opt.textContent = `${u.email} (${u.role})`;
            userFilterEl.appendChild(opt);
          });
        } catch (e) { /* ignore */ }
      }
    }

    // Client-side quick preset filtering if not already filtered on server
    const now = new Date();
    if (ledgerDatePreset === 'today' && !fromDate && !toDate) {
      const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
      displayedTxs = displayedTxs.filter(tx => new Date(tx.created_at).getTime() >= startOfToday);
    } else if (ledgerDatePreset === '7days' && !fromDate && !toDate) {
      const sevenDaysAgo = now.getTime() - (7 * 24 * 60 * 60 * 1000);
      displayedTxs = displayedTxs.filter(tx => new Date(tx.created_at).getTime() >= sevenDaysAgo);
    } else if (ledgerDatePreset === 'month' && !fromDate && !toDate) {
      const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
      displayedTxs = displayedTxs.filter(tx => new Date(tx.created_at).getTime() >= startOfMonth);
    }

    // Calculate Summary Strip Totals (Separating Sales/Allotments, Campaign Debits & Carrier Refunds)
    let totalIn = 0;
    let totalOut = 0;
    let totalRefund = 0;
    displayedTxs.forEach(tx => {
      const amt = Math.abs(Number(tx.amount) || 0);
      const isRef = tx.category === 'refund' || tx.direction === 'refund' || Boolean(tx.refund_campaign_id) || String(tx.reason || '').toLowerCase().includes('refund');
      if (isRef) {
        totalRefund += amt;
      } else if (tx.is_credit) {
        totalIn += amt;
      } else {
        totalOut += amt;
      }
    });

    const statCountEl = document.getElementById('ledger-stat-count');
    const statInEl = document.getElementById('ledger-stat-in');
    const statOutEl = document.getElementById('ledger-stat-out');
    const statRefundEl = document.getElementById('ledger-stat-refund');
    if (statCountEl) statCountEl.textContent = (ledgerTotalCount || displayedTxs.length).toLocaleString();
    if (statInEl) statInEl.textContent = `+${totalIn.toLocaleString()} Credits`;
    if (statOutEl) statOutEl.textContent = `-${totalOut.toLocaleString()} Credits`;
    if (statRefundEl) statRefundEl.textContent = `+${totalRefund.toLocaleString()} Credits`;

    // Update KPI count if present
    const txCountEl = document.getElementById('wallet-summary-tx-count');
    if (txCountEl) txCountEl.textContent = (ledgerTotalCount || displayedTxs.length).toLocaleString();

    // Update Bank-grade Pagination controls
    const totalPages = Math.max(1, Math.ceil((ledgerTotalCount || displayedTxs.length) / ledgerPageSize));
    const pageShowingEl = document.getElementById('ledger-pagination-showing');
    const pageTotalEl = document.getElementById('ledger-pagination-total');
    const pageNumEl = document.getElementById('ledger-pagination-page');
    const prevBtn = document.getElementById('btn-ledger-prev');
    const nextBtn = document.getElementById('btn-ledger-next');

    const startRecord = (ledgerTotalCount || displayedTxs.length) > 0 ? (ledgerCurrentPage - 1) * ledgerPageSize + 1 : 0;
    const endRecord = Math.min(ledgerTotalCount || displayedTxs.length, ledgerCurrentPage * ledgerPageSize);

    if (pageShowingEl) pageShowingEl.textContent = `${startRecord}–${endRecord}`;
    if (pageTotalEl) pageTotalEl.textContent = (ledgerTotalCount || displayedTxs.length).toLocaleString();
    if (pageNumEl) pageNumEl.textContent = `Page ${ledgerCurrentPage} of ${totalPages}`;
    if (prevBtn) prevBtn.disabled = ledgerCurrentPage <= 1;
    if (nextBtn) nextBtn.disabled = ledgerCurrentPage >= totalPages;

    if (displayedTxs.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="10" style="text-align: center; padding: 48px 20px;">
            <div style="display: inline-flex; flex-direction: column; align-items: center; justify-content: center; max-width: 320px;">
              <div style="width: 52px; height: 52px; border-radius: 50%; background: #f1f5f9; color: #94a3b8; display: flex; align-items: center; justify-content: center; margin-bottom: 12px;">
                <i data-lucide="receipt-text" style="width: 24px; height: 24px;"></i>
              </div>
              <div style="font-size: 0.95rem; font-weight: 700; color: #1e293b; margin-bottom: 4px;">No Transactions Found</div>
              <div style="font-size: 0.78rem; color: #64748b; line-height: 1.4;">There are no ledger entries matching your current filters or date range.</div>
            </div>
          </td>
        </tr>
      `;
      if (window.lucide) setTimeout(() => lucide.createIcons(), 50);
      return;
    }

    tbody.innerHTML = displayedTxs.map(tx => {
      const reasonLower = String(tx.reason || '').toLowerCase();
      const isRefund = tx.category === 'refund' || tx.direction === 'refund' || Boolean(tx.refund_campaign_id) || reasonLower.includes('refund') || reasonLower.includes('auto-refund');
      const isDeduction = !isRefund && (tx.category === 'campaign_deduction' || !tx.is_credit || reasonLower.includes('deduction') || reasonLower.includes('debit') || reasonLower.includes('burn') || reasonLower.includes('cost'));

      let amountColor = '#15803d';
      let amountBg = '#ecfdf5';
      let amountBorder = '#bbf7d0';
      let amountSign = '+';
      let flowBadgeHtml = '';

      if (isRefund) {
        amountColor = '#0284c7';
        amountBg = '#f0f9ff';
        amountBorder = '#bae6fd';
        amountSign = '+';
        flowBadgeHtml = `
          <span class="status-badge" style="background:#f0f9ff;color:#0284c7;border:1px solid #bae6fd;font-size:0.73rem;font-weight:700;display:inline-flex;align-items:center;gap:4px;white-space:nowrap;">
            <i data-lucide="rotate-ccw" style="width:13px;height:13px;"></i> Carrier Refund (+)
          </span>
        `;
      } else if (isDeduction) {
        amountColor = '#b91c1c';
        amountBg = '#fef2f2';
        amountBorder = '#fecaca';
        amountSign = '-';
        flowBadgeHtml = `
          <span class="status-badge" style="background:#fef2f2;color:#b91c1c;border:1px solid #fecaca;font-size:0.73rem;font-weight:700;display:inline-flex;align-items:center;gap:4px;white-space:nowrap;">
            <i data-lucide="arrow-up-right" style="width:13px;height:13px;"></i> Campaign Debit (-)
          </span>
        `;
      } else {
        amountColor = '#15803d';
        amountBg = '#ecfdf5';
        amountBorder = '#bbf7d0';
        amountSign = '+';
        flowBadgeHtml = `
          <span class="status-badge" style="background:#ecfdf5;color:#15803d;border:1px solid #bbf7d0;font-size:0.73rem;font-weight:700;display:inline-flex;align-items:center;gap:4px;white-space:nowrap;">
            <i data-lucide="arrow-down-left" style="width:13px;height:13px;"></i> Allotment (+)
          </span>
        `;
      }

      const rawType = (tx.credit_type || 'normal').toLowerCase();
      let cleanReason = String(tx.reason || 'Manual Adjustment');
      if (!currentUser || currentUser.role !== 'admin') {
        cleanReason = cleanReason
          .replace(/Allotted by (?:reseller|admin)\s*(?:\([^)]*\))?\s*:\s*/gi, 'Telecom Balance Allotment: ')
          .replace(/Deduction by (?:reseller|admin)\s*(?:\([^)]*\))?\s*:\s*/gi, 'Balance Adjustment: ')
          .replace(/\bby reseller\b/gi, 'via Telecom Gateway')
          .replace(/\[Created by [^\]]+ on behalf of account\]/gi, '');
      }
      const rawReason = cleanReason;
      let channelLabel = 'Normal WhatsApp Text';
      let channelIcon = 'message-square';
      if (rawType === 'gsm_sms') {
        channelLabel = 'GSM Bulk SMS';
        channelIcon = 'radio';
      } else if (rawType === 'normal') {
        if (/sms\b/i.test(rawReason)) {
          channelLabel = 'GSM Bulk SMS';
          channelIcon = 'radio';
        } else {
          channelLabel = 'Normal WhatsApp Text';
          channelIcon = 'message-square';
        }
      } else if (rawType === 'dp') {
        channelLabel = 'WhatsApp DP (Media)';
        channelIcon = 'image';
      } else if (rawType === 'cta') {
        channelLabel = 'WhatsApp CTA (Buttons)';
        channelIcon = 'mouse-pointer-click';
      } else if (rawType === 'dp_cta') {
        channelLabel = 'WhatsApp DP + CTA Combo';
        channelIcon = 'layers';
      } else if (rawType === 'own_number') {
        channelLabel = 'WhatsApp Own SIM';
        channelIcon = 'smartphone';
      } else {
        channelLabel = rawType.toUpperCase();
        channelIcon = 'credit-card';
      }

      const isIntl = tx.destination === 'international';
      const destLabel = isIntl ? 'International' : 'Domestic';
      const destIcon = isIntl ? 'globe-2' : 'map-pin';

      // Parse campaign #ID in reason to make it clickable
      const escapedReason = escapeHtml(rawReason);
      const linkedReason = escapedReason.replace(/(?:Campaign\s*)?#(\d+)/gi, (match, p1) => {
        return `<a href="javascript:void(0)" onclick="openCampaignDetailModal(${p1})" style="color:#4f46e5;font-weight:700;text-decoration:underline;" title="View Campaign Details">#${p1}</a>`;
      });

      const creditsQty = Math.abs(parseInt(tx.credits_qty !== undefined ? tx.credits_qty : tx.amount, 10) || 0);
      const rateNum = parseFloat(tx.rate_per_credit !== undefined ? tx.rate_per_credit : (tx.rate_inr || (tx.destination === 'international' ? 2.50 : 0.15)));
      const hasExplicitBase = parseFloat(tx.base_amount || 0) > 0;
      const billedInr = (tx.billed_amount_inr !== undefined && tx.billed_amount_inr !== null)
        ? parseFloat(tx.billed_amount_inr)
        : (hasExplicitBase 
            ? Math.round((parseFloat(tx.base_amount) + parseFloat(tx.gst_amount || 0)) * 100) / 100 
            : Math.round(creditsQty * rateNum * 100) / 100);

      // Voucher Slip Button for credits/allotments & refunds
      const voucherAction = (isRefund || !isDeduction) ? `
        <button type="button" class="btn-action btn-action-secondary" onclick="openRechargeReceiptModal(${tx.id})" title="View & Print Voucher Slip" style="padding: 3px 8px; font-size: 0.72rem; display: inline-flex; align-items: center; gap: 4px; border-radius: 6px;">
          <i data-lucide="receipt" style="width: 12px; height: 12px; color: ${isRefund ? '#0284c7' : '#10b981'};"></i> Slip
        </button>
      ` : `<span style="color:#94a3b8;font-size:0.75rem;">—</span>`;

      return `
        <tr>
          <td><span style="font-family:monospace;font-size:0.78rem;font-weight:700;color:#64748b;">#${tx.id}</span></td>
          <td><span style="font-size:0.8rem;color:var(--slate-600);white-space:nowrap;">${new Date(tx.created_at).toLocaleString('en-IN', { dateStyle: 'short', timeStyle: 'short' })}</span></td>
          <td>
            ${flowBadgeHtml}
          </td>
          <td><strong style="font-size:0.82rem;color:#1e293b;display:inline-flex;align-items:center;gap:5px;"><i data-lucide="${channelIcon}" style="width:13px;height:13px;color:#4f46e5;"></i> ${escapeHtml(channelLabel)}</strong></td>
          <td><span style="font-size:0.78rem;color:var(--slate-600);display:inline-flex;align-items:center;gap:4px;"><i data-lucide="${destIcon}" style="width:12px;height:12px;color:#64748b;"></i> ${destLabel}</span></td>
          <td style="text-align:right;white-space:nowrap;">
            <strong style="color:${amountColor};font-size:0.92rem;font-family:monospace;">${amountSign}${creditsQty.toLocaleString()}</strong>
            <div style="font-size:0.67rem;color:#64748b;font-weight:700;text-transform:uppercase;letter-spacing:0.02em;">Credits</div>
          </td>
          <td style="text-align:right;white-space:nowrap;">
            <strong style="color:#0f172a;font-size:0.88rem;font-family:monospace;">${amountSign}₹${billedInr.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong>
            <div style="font-size:0.67rem;color:#64748b;" title="Channel Billing Rate">@ ₹${rateNum.toFixed(4)}/cr</div>
          </td>
          <td>
            <div style="font-size:0.83rem;color:#334155;max-width:320px;line-height:1.4;" title="${escapedReason}">
              ${linkedReason}
            </div>
          </td>
          <td>
            <span style="font-size:0.8rem;font-weight:600;color:var(--slate-700);">${escapeHtml((!currentUser || currentUser.role !== 'admin') ? (amountSign === '+' ? 'Direct Telecom Platform' : 'Campaign Dispatcher') : (tx.counterparty_email || 'System'))}</span>
          </td>
          <td style="text-align:center;">
            ${voucherAction}
          </td>
        </tr>
      `;
    }).join('');

    if (window.lucide) setTimeout(() => lucide.createIcons(), 50);
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="10" style="text-align:center;color:red;padding:24px;">Failed to load statement: ${escapeHtml(err.message)}</td></tr>`;
  }
}

const btnRefreshLedger = document.getElementById('btn-refresh-ledger');
if (btnRefreshLedger) {
  btnRefreshLedger.addEventListener('click', () => {
    loadLedgerTransactions();
    showToast('info', 'Statement Refreshed', 'Latest passbook transactions loaded.');
  });
}

// --- LIVE SMARTPHONE COMPOSER & PREVIEW ---
const composerTitle = document.getElementById('composer-title');
const composerText = document.getElementById('composer-text');
const composerNumbers = document.getElementById('composer-numbers');
const composerCtaToggle = document.getElementById('composer-cta-toggle');
const composerCtaBox = document.getElementById('composer-cta-box');
const ctaCallText = document.getElementById('cta-call-text');
const ctaCallNumber = document.getElementById('cta-call-number');
const ctaUrlText = document.getElementById('cta-url-text');
const ctaUrlLink = document.getElementById('cta-url-link');

// Modular Media Upload Elements
const inputDpFile = document.getElementById('input-dp-file');
const dropzoneDp = document.getElementById('dropzone-dp');
const dpPlaceholder = document.getElementById('dp-placeholder');
const dpPreviewInfo = document.getElementById('dp-preview-info');
const dpThumbImg = document.getElementById('dp-thumb-img');
const dpFileName = document.getElementById('dp-file-name');
const dpFileSize = document.getElementById('dp-file-size');
const btnRemoveDp = document.getElementById('btn-remove-dp');

const inputVideoFile = document.getElementById('input-video-file');
const dropzoneVideo = document.getElementById('dropzone-video');
const videoPlaceholder = document.getElementById('video-placeholder');
const videoPreviewInfo = document.getElementById('video-preview-info');
const videoFileName = document.getElementById('video-file-name');
const videoFileSize = document.getElementById('video-file-size');
const btnRemoveVideo = document.getElementById('btn-remove-video');

const inputPdfFile = document.getElementById('input-pdf-file');
const dropzonePdf = document.getElementById('dropzone-pdf');
const pdfPlaceholder = document.getElementById('pdf-placeholder');
const pdfPreviewInfo = document.getElementById('pdf-preview-info');
const pdfFileName = document.getElementById('pdf-file-name');
const pdfFileSize = document.getElementById('pdf-file-size');
const btnRemovePdf = document.getElementById('btn-remove-pdf');

// CTA Single Media Attachment Elements
const ctaMediaTypePills = document.querySelectorAll('.cta-media-type-btn');
const ctaMediaLimitBadge = document.getElementById('cta-media-limit-badge');
const inputCtaMediaFile = document.getElementById('input-cta-media-file');
const ctaMediaDropzone = document.getElementById('cta-media-dropzone');
const ctaMediaPlaceholder = document.getElementById('cta-media-placeholder');
const ctaMediaPlaceholderText = document.getElementById('cta-media-placeholder-text');
const ctaMediaPreviewInfo = document.getElementById('cta-media-preview-info');
const ctaMediaThumbImg = document.getElementById('cta-media-thumb-img');
const ctaMediaIconBox = document.getElementById('cta-media-icon-box');
const ctaMediaTypeIcon = document.getElementById('cta-media-type-icon');
const ctaMediaFileName = document.getElementById('cta-media-file-name');
const ctaMediaFileSize = document.getElementById('cta-media-file-size');
const btnRemoveCtaMedia = document.getElementById('btn-remove-cta-media');

// Numbers File Drop
const numbersFileDropzone = document.getElementById('numbers-file-dropzone');
const numbersFileInput = document.getElementById('numbers-file-input');

// Phone Preview Elements
const previewHeaderAvatar = document.getElementById('preview-header-avatar');
const previewBubbleText = document.getElementById('preview-bubble-text');
const previewBubbleImg = document.getElementById('preview-bubble-img');
const previewBubbleGallery = document.getElementById('preview-bubble-gallery');
const previewBubbleVideo = document.getElementById('preview-bubble-video');
const previewBubbleVideoName = document.getElementById('preview-bubble-video-name');
const previewBubbleDoc = document.getElementById('preview-bubble-doc');
const previewBubbleDocName = document.getElementById('preview-bubble-doc-name');
const previewBubbleCtaMedia = document.getElementById('preview-bubble-cta-media');
const previewBubbleCta = document.getElementById('preview-bubble-cta');
const previewCtaCall = document.getElementById('preview-cta-call');
const previewCtaUrl = document.getElementById('preview-cta-url');
const messageCharCount = document.getElementById('message-char-count');
const recipientCountBadge = document.getElementById('recipient-count-badge');
const recipientInvalidBadge = document.getElementById('recipient-invalid-badge');

// Destination & WhatsApp Campaign Type Options
const destOptionDomestic = document.getElementById('dest-label-domestic');
const destOptionIntl = document.getElementById('dest-label-intl');
const composerScheduleTime = document.getElementById('composer-schedule-time');
const composerAttachmentGroup = document.getElementById('composer-attachment-group');
const composerCtaGroup = document.getElementById('composer-cta-group');

let selectedDestination = 'domestic';
let selectedCampaignType = 'normal'; // 'normal' | 'dp' | 'cta' | 'dp_cta' | 'own_number'
let selectedChannelType = 'shared_gateway';

// Strict WhatsApp CTA Validation Helper (1,024 Char Message, 20 Char Button Text, HTTPS & No Direct wa.me)
function validateCtaRules({ text, callText = '', urlText = '', urlLink = '', isCta = true }) {
  if (!isCta) return null;

  // 1. Message character limit - 1,024 characters
  if (text && text.trim().length > 1024) {
    return `WhatsApp CTA campaigns allow a maximum of 1,024 characters for message text. Currently: ${text.trim().length} characters.`;
  }

  // 2. CTA button text - 20 Characters
  if (callText && callText.length > 20) {
    return `CTA Call button text cannot exceed 20 characters (currently ${callText.length} characters).`;
  }
  if (urlText && urlText.length > 20) {
    return `CTA Web Link button text cannot exceed 20 characters (currently ${urlText.length} characters).`;
  }

  // 3. Website URL validation: Must start with https:// and No Direct WhatsApp links
  if (urlLink) {
    if (!/^https:\/\//i.test(urlLink)) {
      return 'CTA Website URL must strictly start with https:// (e.g. https://yourwebsite.com). Links without https:// or with http:// are not supported.';
    }
    const lower = urlLink.toLowerCase();
    if (
      lower.includes('wa.me') ||
      lower.includes('api.whatsapp.com') ||
      lower.includes('chat.whatsapp.com') ||
      lower.includes('web.whatsapp.com') ||
      lower.includes('whatsapp.com/send') ||
      lower.includes('whatsapp.com/dl')
    ) {
      return 'Direct WhatsApp links (wa.me, api.whatsapp.com, chat.whatsapp.com) are not supported in CTA buttons. Please provide a standard website or landing page URL.';
    }
  }

  return null;
}

function updateComposerCharLimit() {
  if (!composerText) return;
  const isCtaActive = (selectedCampaignType === 'cta' || selectedCampaignType === 'dp_cta' || (composerCtaToggle && composerCtaToggle.checked));

  if (isCtaActive) {
    composerText.maxLength = 1024;
    if (composerText.value.length > 1024) {
      composerText.value = composerText.value.slice(0, 1024);
    }
    const charLen = composerText.value.length;
    if (messageCharCount) {
      messageCharCount.innerHTML = `<strong>${charLen}</strong> / 1,024 characters &bull; <span style="color:#d97706;font-weight:700;">WhatsApp CTA Limit</span> &bull; (1 Credit per recipient)`;
    }
  } else {
    composerText.removeAttribute('maxLength');
    const charLen = composerText.value.length;
    if (messageCharCount) {
      messageCharCount.textContent = `${charLen} characters • (WhatsApp: 1 Credit per recipient)`;
    }
  }
}

// All 5 Campaign Type Picker Options
const campaignTypeCards = document.querySelectorAll('.channel-option[data-type]');

function setCampaignType(type) {
  selectedCampaignType = type;
  selectedChannelType = (type === 'own_number') ? 'own_number' : 'shared_gateway';

  campaignTypeCards.forEach(card => {
    if (card.dataset.type === type) {
      card.classList.add('active');
      const radio = card.querySelector('input[type="radio"]');
      if (radio) radio.checked = true;
    } else {
      card.classList.remove('active');
    }
  });

  // Dynamically configure media attachment and CTA builder based on chosen type
  if (type === 'normal') {
    if (composerAttachmentGroup) composerAttachmentGroup.style.display = 'none';
    if (composerCtaGroup) composerCtaGroup.style.display = 'none';
    if (composerCtaToggle) { composerCtaToggle.checked = false; composerCtaBox.style.display = 'none'; }
    resetAllMediaUploads();
    window.composerTemplateAttachmentUrl = null;
    previewBubbleCta.style.display = 'none';
  } else if (type === 'dp') {
    if (composerAttachmentGroup) composerAttachmentGroup.style.display = 'block';
    if (composerCtaGroup) composerCtaGroup.style.display = 'none';
    if (composerCtaToggle) { composerCtaToggle.checked = false; composerCtaBox.style.display = 'none'; }
    previewBubbleCta.style.display = 'none';
    updatePreviewMedia();
  } else if (type === 'cta') {
    if (composerAttachmentGroup) composerAttachmentGroup.style.display = 'none';
    if (composerCtaGroup) composerCtaGroup.style.display = 'block';
    if (composerCtaToggle) { composerCtaToggle.checked = true; composerCtaBox.style.display = 'block'; }
    updateCtaPreview();
    updatePreviewMedia();
  } else if (type === 'dp_cta') {
    if (composerAttachmentGroup) composerAttachmentGroup.style.display = 'block';
    if (composerCtaGroup) composerCtaGroup.style.display = 'block';
    if (composerCtaToggle) { composerCtaToggle.checked = true; composerCtaBox.style.display = 'block'; }
    updateCtaPreview();
    updatePreviewMedia();
  } else if (type === 'own_number') {
    // Dedicated SIM route can optionally include attachment or CTA
    if (composerAttachmentGroup) composerAttachmentGroup.style.display = 'block';
    if (composerCtaGroup) composerCtaGroup.style.display = 'block';
    if (composerCtaToggle) { composerCtaToggle.checked = true; composerCtaBox.style.display = 'block'; }
    updateCtaPreview();
    updatePreviewMedia();
  }

  updateComposerCharLimit();
  updateCostCalculator();
  if (window.lucide) lucide.createIcons();
}

campaignTypeCards.forEach(card => {
  card.addEventListener('click', () => {
    const type = card.dataset.type;
    if (type) setCampaignType(type);
  });
});

if (destOptionDomestic && destOptionIntl) {
  destOptionDomestic.addEventListener('click', () => {
    destOptionDomestic.classList.add('active');
    destOptionIntl.classList.remove('active');
    const radio = destOptionDomestic.querySelector('input[type="radio"]');
    if (radio) radio.checked = true;
    selectedDestination = 'domestic';
    updateCostCalculator();
  });
  destOptionIntl.addEventListener('click', () => {
    destOptionIntl.classList.add('active');
    destOptionDomestic.classList.remove('active');
    const radio = destOptionIntl.querySelector('input[type="radio"]');
    if (radio) radio.checked = true;
    selectedDestination = 'international';
    updateCostCalculator();
  });
}

// Scheduling radio toggles
const timingRadios = document.querySelectorAll('input[name="dispatch-timing"]');
timingRadios.forEach(radio => {
  radio.addEventListener('change', () => {
    const isLater = (radio.value === 'later');
    composerScheduleTime.style.display = isLater ? 'block' : 'none';
    if (isLater) {
      const now = new Date();
      now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
      composerScheduleTime.min = now.toISOString().slice(0, 16);
    }
  });
});

// Numbers File Upload & Drag-and-Drop (Supports Excel .XLSX / .XLS, .CSV, and .TXT up to 50,000 numbers)
function handleNumbersFileUpload(file) {
  if (!file) return;
  const isExcel = /\.(xlsx|xls)$/i.test(file.name);

  if (isExcel) {
    if (typeof XLSX === 'undefined') {
      showToast('warning', 'Loading Parser', 'Excel parser library is initializing. Please wait a moment or use .CSV/.TXT.');
      return;
    }
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target.result);
        const workbook = XLSX.read(data, { type: 'array' });
        const cellValues = [];
        workbook.SheetNames.forEach(sheetName => {
          const sheet = workbook.Sheets[sheetName];
          const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false });
          rows.forEach(row => {
            if (Array.isArray(row)) {
              row.forEach(val => {
                if (val !== null && val !== undefined) cellValues.push(String(val));
              });
            }
          });
        });
        applyExtractedNumbers(cellValues.join('\n'), file.name);
      } catch (err) {
        showToast('error', 'Excel Error', 'Failed to read Excel workbook: ' + err.message);
      }
    };
    reader.readAsArrayBuffer(file);
  } else {
    const reader = new FileReader();
    reader.onload = (ev) => {
      const rawContent = ev.target.result || '';
      applyExtractedNumbers(rawContent, file.name);
    };
    reader.readAsText(file);
  }
}

function applyExtractedNumbers(rawContent, filename) {
  const { validNumbers, invalidCount, duplicateCount, dndCount, isCapped } = processContactInput(rawContent, selectedDestination);
  if (validNumbers.length === 0) {
    showToast('warning', 'No Valid Numbers', `No valid phone numbers found in ${filename}`);
    return;
  }
  const cleanNumbersText = validNumbers.join('\n');
  composerNumbers.value = cleanNumbersText;
  
  let msg = `Extracted ${validNumbers.length.toLocaleString()} valid numbers from ${filename}.`;
  if (isCapped) {
    msg += ` (Capped at 50,000 maximum campaign limit).`;
  }
  if (duplicateCount > 0) {
    msg += ` ${duplicateCount} duplicates removed.`;
  }
  if (dndCount > 0) {
    msg += ` ${dndCount} DND numbers excluded.`;
  }
  showToast('success', 'Contacts Loaded', msg);
  updateCostCalculator();
}

if (numbersFileDropzone) {
  numbersFileDropzone.addEventListener('click', () => numbersFileInput.click());
  numbersFileDropzone.addEventListener('dragover', (e) => {
    e.preventDefault();
    numbersFileDropzone.style.borderColor = 'var(--primary)';
    numbersFileDropzone.style.background = '#eef2ff';
  });
  numbersFileDropzone.addEventListener('dragleave', (e) => {
    e.preventDefault();
    numbersFileDropzone.style.borderColor = '';
    numbersFileDropzone.style.background = '';
  });
  numbersFileDropzone.addEventListener('drop', (e) => {
    e.preventDefault();
    numbersFileDropzone.style.borderColor = '';
    numbersFileDropzone.style.background = '';
    const file = e.dataTransfer.files[0];
    if (file) handleNumbersFileUpload(file);
  });
  numbersFileInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) handleNumbersFileUpload(file);
    numbersFileInput.value = '';
  });
}

// Update Phone Screen as User Types
composerText.addEventListener('input', () => {
  const text = composerText.value;
  previewBubbleText.innerHTML = formatLiveMessagePreview(text.trim());
  updateComposerCharLimit();
  updateCostCalculator();
});

// Update Recipients on Input
composerNumbers.addEventListener('input', () => {
  updateCostCalculator();
});

// CTA Toggle
composerCtaToggle.addEventListener('change', () => {
  const enabled = composerCtaToggle.checked;
  composerCtaBox.style.display = enabled ? 'block' : 'none';
  previewBubbleCta.style.display = enabled ? 'flex' : 'none';
  updateComposerCharLimit();
  updateCtaPreview();
  updateCostCalculator();
});

function updateCtaPreview() {
  const callCountEl = document.getElementById('cta-call-char-count');
  const urlCountEl = document.getElementById('cta-url-char-count');
  if (callCountEl && ctaCallText) callCountEl.textContent = `${ctaCallText.value.length}/20`;
  if (urlCountEl && ctaUrlText) urlCountEl.textContent = `${ctaUrlText.value.length}/20`;

  if (!composerCtaToggle.checked) {
    previewBubbleCta.style.display = 'none';
    return;
  }
  const callTitle = ctaCallText.value.trim();
  const urlTitle = ctaUrlText.value.trim();

  let hasBtn = false;
  if (callTitle) {
    previewCtaCall.innerHTML = `<i data-lucide="phone" style="width:13px;height:13px;"></i> ${escapeHtml(callTitle)}`;
    previewCtaCall.style.display = 'flex';
    hasBtn = true;
  } else {
    previewCtaCall.style.display = 'none';
  }

  if (urlTitle) {
    previewCtaUrl.innerHTML = `<i data-lucide="external-link" style="width:13px;height:13px;"></i> ${escapeHtml(urlTitle)}`;
    previewCtaUrl.style.display = 'flex';
    hasBtn = true;
  } else {
    previewCtaUrl.style.display = 'none';
  }

  previewBubbleCta.style.display = hasBtn ? 'flex' : 'none';
  if (window.lucide) lucide.createIcons();
}

ctaCallText.addEventListener('input', updateCtaPreview);
ctaCallNumber.addEventListener('input', updateCtaPreview);
ctaUrlText.addEventListener('input', updateCtaPreview);
ctaUrlLink.addEventListener('input', updateCtaPreview);

// --- MODULAR MEDIA UPLOADERS & PHONE PREVIEW LOGIC ---

function validateMediaFile(file, maxBytes, allowedExtensions, label) {
  if (!file) return false;
  const ext = '.' + file.name.split('.').pop().toLowerCase();
  if (allowedExtensions && !allowedExtensions.includes(ext)) {
    showToast('error', 'Invalid File Type', `${label} must be ${allowedExtensions.join(', ')}.`);
    return false;
  }
  if (file.size > maxBytes) {
    const maxMb = (maxBytes / (1024 * 1024)).toFixed(0);
    const actualMb = (file.size / (1024 * 1024)).toFixed(2);
    showToast('error', 'File Too Large', `${label} size (${actualMb} MB) exceeds maximum allowed limit of ${maxMb} MB.`);
    return false;
  }
  return true;
}

function updatePreviewMedia() {
  // 1. Header Avatar for DP
  if (previewHeaderAvatar) {
    if (uploadedDP) {
      previewHeaderAvatar.innerHTML = `<img src="${uploadedDP.previewUrl}" alt="DP" style="width:100%;height:100%;object-fit:cover;border-radius:50%;">`;
    } else {
      previewHeaderAvatar.innerHTML = 'M';
    }
  }

  // 2. Chat bubble media:
  const activeImages = uploadedImages.filter(img => img !== null);

  // Gallery grid
  if (previewBubbleGallery) {
    if (activeImages.length > 1) {
      previewBubbleGallery.style.display = 'grid';
      previewBubbleGallery.innerHTML = activeImages.map(img => `
        <img src="${img.previewUrl}" style="width:100%;height:75px;object-fit:cover;border-radius:4px;" alt="Gallery">
      `).join('');
    } else {
      previewBubbleGallery.style.display = 'none';
      previewBubbleGallery.innerHTML = '';
    }
  }

  // Single Image preview
  if (previewBubbleImg) {
    if (activeImages.length === 1) {
      previewBubbleImg.src = activeImages[0].previewUrl;
      previewBubbleImg.style.display = 'block';
    } else {
      previewBubbleImg.style.display = 'none';
    }
  }

  // Video preview
  if (previewBubbleVideo) {
    if (uploadedVideo) {
      previewBubbleVideo.style.display = 'block';
      if (previewBubbleVideoName) previewBubbleVideoName.textContent = uploadedVideo.file.name;
    } else {
      previewBubbleVideo.style.display = 'none';
    }
  }

  // PDF preview
  if (previewBubbleDoc) {
    if (uploadedPDF) {
      previewBubbleDoc.style.display = 'flex';
      if (previewBubbleDocName) previewBubbleDocName.textContent = uploadedPDF.file.name;
    } else {
      previewBubbleDoc.style.display = 'none';
    }
  }

  // CTA Media preview
  if (previewBubbleCtaMedia) {
    if (uploadedCtaMedia) {
      previewBubbleCtaMedia.style.display = 'block';
      if (uploadedCtaMedia.type === 'image') {
        previewBubbleCtaMedia.innerHTML = `<img src="${uploadedCtaMedia.previewUrl}" style="width:100%;max-height:160px;object-fit:cover;border-radius:8px;" alt="CTA Media">`;
      } else if (uploadedCtaMedia.type === 'video') {
        previewBubbleCtaMedia.innerHTML = `
          <div style="background:#0f172a;color:white;border-radius:8px;padding:16px 10px;text-align:center;">
            <i data-lucide="play-circle" style="width:28px;height:28px;color:#facc15;display:block;margin:0 auto 4px auto;"></i>
            <div style="font-size:0.75rem;opacity:0.9;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${uploadedCtaMedia.file.name}</div>
          </div>
        `;
      } else if (uploadedCtaMedia.type === 'pdf') {
        previewBubbleCtaMedia.innerHTML = `
          <div style="display:flex;align-items:center;gap:8px;background:#fef9c3;border:1px solid #fde047;padding:8px 10px;border-radius:8px;font-size:0.8rem;font-weight:600;color:#854d0e;">
            <i data-lucide="file-text" style="width:18px;height:18px;color:#ca8a04;"></i>
            <span style="word-break:break-all;">${uploadedCtaMedia.file.name}</span>
          </div>
        `;
      }
    } else {
      previewBubbleCtaMedia.style.display = 'none';
      previewBubbleCtaMedia.innerHTML = '';
    }
  }

  if (window.lucide) lucide.createIcons();
}

function resetAllMediaUploads() {
  uploadedDP = null;
  uploadedImages = [null, null, null, null];
  uploadedVideo = null;
  uploadedPDF = null;
  uploadedCtaMedia = null;
  selectedCtaMediaType = 'none';

  // Reset DP UI
  if (inputDpFile) inputDpFile.value = '';
  if (dropzoneDp) dropzoneDp.classList.remove('has-file');
  if (dpPlaceholder) dpPlaceholder.style.display = 'flex';
  if (dpPreviewInfo) dpPreviewInfo.style.display = 'none';

  // Reset Gallery Images 1-4 UI
  for (let i = 1; i <= 4; i++) {
    const inp = document.getElementById(`input-image-${i}`);
    if (inp) inp.value = '';
    const slot = document.getElementById(`slot-image-${i}`);
    if (slot) slot.classList.remove('has-file');
    const emptyBox = document.getElementById(`slot-empty-${i}`);
    if (emptyBox) emptyBox.style.display = 'flex';
    const filledBox = document.getElementById(`slot-filled-${i}`);
    if (filledBox) filledBox.style.display = 'none';
  }

  // Reset Video UI
  if (inputVideoFile) inputVideoFile.value = '';
  if (dropzoneVideo) dropzoneVideo.classList.remove('has-file');
  if (videoPlaceholder) videoPlaceholder.style.display = 'flex';
  if (videoPreviewInfo) videoPreviewInfo.style.display = 'none';

  // Reset PDF UI
  if (inputPdfFile) inputPdfFile.value = '';
  if (dropzonePdf) dropzonePdf.classList.remove('has-file');
  if (pdfPlaceholder) pdfPlaceholder.style.display = 'flex';
  if (pdfPreviewInfo) pdfPreviewInfo.style.display = 'none';

  // Reset CTA Media UI
  if (inputCtaMediaFile) inputCtaMediaFile.value = '';
  if (ctaMediaDropzone) {
    ctaMediaDropzone.classList.remove('has-file');
    ctaMediaDropzone.style.display = 'none';
  }
  if (ctaMediaPlaceholder) ctaMediaPlaceholder.style.display = 'flex';
  if (ctaMediaPreviewInfo) ctaMediaPreviewInfo.style.display = 'none';
  ctaMediaTypePills.forEach(p => {
    if (p.dataset.ctaMedia === 'none') p.classList.add('active');
    else p.classList.remove('active');
  });
  if (ctaMediaLimitBadge) ctaMediaLimitBadge.textContent = 'Optional: None Selected';

  updatePreviewMedia();
}

// 1. DP Uploader Listeners
if (dropzoneDp && inputDpFile) {
  dropzoneDp.addEventListener('click', (e) => {
    if (e.target.closest('#btn-remove-dp')) return;
    inputDpFile.click();
  });
  inputDpFile.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (!validateMediaFile(file, 3 * 1024 * 1024, ['.jpg', '.jpeg', '.png'], 'DP Avatar')) {
      inputDpFile.value = '';
      return;
    }
    const reader = new FileReader();
    reader.onload = (ev) => {
      uploadedDP = { file, previewUrl: ev.target.result };
      dpThumbImg.src = ev.target.result;
      dpFileName.textContent = file.name;
      dpFileSize.textContent = (file.size / (1024 * 1024)).toFixed(2) + ' MB';
      dpPlaceholder.style.display = 'none';
      dpPreviewInfo.style.display = 'flex';
      dropzoneDp.classList.add('has-file');
      updatePreviewMedia();
    };
    reader.readAsDataURL(file);
  });
  if (btnRemoveDp) {
    btnRemoveDp.addEventListener('click', (e) => {
      e.stopPropagation();
      inputDpFile.value = '';
      uploadedDP = null;
      dpPlaceholder.style.display = 'flex';
      dpPreviewInfo.style.display = 'none';
      dropzoneDp.classList.remove('has-file');
      updatePreviewMedia();
    });
  }
}

// 2. Multi-Images Gallery Listeners (1..4)
for (let i = 1; i <= 4; i++) {
  const slot = document.getElementById(`slot-image-${i}`);
  const input = document.getElementById(`input-image-${i}`);
  const emptyBox = document.getElementById(`slot-empty-${i}`);
  const filledBox = document.getElementById(`slot-filled-${i}`);
  const thumb = document.getElementById(`thumb-image-${i}`);
  const name = document.getElementById(`name-image-${i}`);
  const btnRemove = document.getElementById(`btn-remove-img-${i}`);

  if (slot && input) {
    slot.addEventListener('click', (e) => {
      if (e.target.closest('.gallery-slot-remove')) return;
      input.click();
    });

    input.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (!file) return;
      if (!validateMediaFile(file, 3 * 1024 * 1024, ['.jpg', '.jpeg', '.png'], `Image ${i}`)) {
        input.value = '';
        return;
      }
      const reader = new FileReader();
      reader.onload = (ev) => {
        uploadedImages[i - 1] = { file, previewUrl: ev.target.result };
        thumb.src = ev.target.result;
        name.textContent = file.name;
        emptyBox.style.display = 'none';
        filledBox.style.display = 'flex';
        slot.classList.add('has-file');
        updatePreviewMedia();
      };
      reader.readAsDataURL(file);
    });

    if (btnRemove) {
      btnRemove.addEventListener('click', (e) => {
        e.stopPropagation();
        input.value = '';
        uploadedImages[i - 1] = null;
        emptyBox.style.display = 'flex';
        filledBox.style.display = 'none';
        slot.classList.remove('has-file');
        updatePreviewMedia();
      });
    }
  }
}

// 3. Video Uploader Listeners
if (dropzoneVideo && inputVideoFile) {
  dropzoneVideo.addEventListener('click', (e) => {
    if (e.target.closest('#btn-remove-video')) return;
    inputVideoFile.click();
  });
  inputVideoFile.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (!validateMediaFile(file, 20 * 1024 * 1024, ['.mp4', '.mov', '.mkv', '.webm', '.avi'], 'Video')) {
      inputVideoFile.value = '';
      return;
    }
    uploadedVideo = { file };
    videoFileName.textContent = file.name;
    videoFileSize.textContent = (file.size / (1024 * 1024)).toFixed(2) + ' MB';
    videoPlaceholder.style.display = 'none';
    videoPreviewInfo.style.display = 'flex';
    dropzoneVideo.classList.add('has-file');
    updatePreviewMedia();
  });
  if (btnRemoveVideo) {
    btnRemoveVideo.addEventListener('click', (e) => {
      e.stopPropagation();
      inputVideoFile.value = '';
      uploadedVideo = null;
      videoPlaceholder.style.display = 'flex';
      videoPreviewInfo.style.display = 'none';
      dropzoneVideo.classList.remove('has-file');
      updatePreviewMedia();
    });
  }
}

// 4. PDF Document Uploader Listeners
if (dropzonePdf && inputPdfFile) {
  dropzonePdf.addEventListener('click', (e) => {
    if (e.target.closest('#btn-remove-pdf')) return;
    inputPdfFile.click();
  });
  inputPdfFile.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (!validateMediaFile(file, 10 * 1024 * 1024, ['.pdf'], 'PDF Document')) {
      inputPdfFile.value = '';
      return;
    }
    uploadedPDF = { file };
    pdfFileName.textContent = file.name;
    pdfFileSize.textContent = (file.size / (1024 * 1024)).toFixed(2) + ' MB';
    pdfPlaceholder.style.display = 'none';
    pdfPreviewInfo.style.display = 'flex';
    dropzonePdf.classList.add('has-file');
    updatePreviewMedia();
  });
  if (btnRemovePdf) {
    btnRemovePdf.addEventListener('click', (e) => {
      e.stopPropagation();
      inputPdfFile.value = '';
      uploadedPDF = null;
      pdfPlaceholder.style.display = 'flex';
      pdfPreviewInfo.style.display = 'none';
      dropzonePdf.classList.remove('has-file');
      updatePreviewMedia();
    });
  }
}

// 5. CTA Single Media Attachment Listeners
function setCtaMediaType(type) {
  selectedCtaMediaType = type;
  uploadedCtaMedia = null;
  if (inputCtaMediaFile) inputCtaMediaFile.value = '';

  ctaMediaTypePills.forEach(pill => {
    if (pill.dataset.ctaMedia === type) pill.classList.add('active');
    else pill.classList.remove('active');
  });

  if (type === 'none') {
    if (ctaMediaDropzone) ctaMediaDropzone.style.display = 'none';
    if (ctaMediaLimitBadge) ctaMediaLimitBadge.textContent = 'Optional: None Selected';
  } else {
    if (ctaMediaDropzone) {
      ctaMediaDropzone.style.display = 'flex';
      ctaMediaDropzone.classList.remove('has-file');
    }
    if (ctaMediaPlaceholder) ctaMediaPlaceholder.style.display = 'flex';
    if (ctaMediaPreviewInfo) ctaMediaPreviewInfo.style.display = 'none';

    if (type === 'image') {
      inputCtaMediaFile.accept = '.jpg,.jpeg,.png,image/jpeg,image/png';
      if (ctaMediaLimitBadge) ctaMediaLimitBadge.textContent = 'JPEG / PNG only • Max 3 MB';
      if (ctaMediaPlaceholderText) ctaMediaPlaceholderText.textContent = 'Click to upload CTA Image (JPEG/PNG, Max 3 MB)';
    } else if (type === 'pdf') {
      inputCtaMediaFile.accept = '.pdf,application/pdf';
      if (ctaMediaLimitBadge) ctaMediaLimitBadge.textContent = 'PDF Document • Max 10 MB';
      if (ctaMediaPlaceholderText) ctaMediaPlaceholderText.textContent = 'Click to upload CTA Document (PDF, Max 10 MB)';
    } else if (type === 'video') {
      inputCtaMediaFile.accept = 'video/mp4,video/*';
      if (ctaMediaLimitBadge) ctaMediaLimitBadge.textContent = 'MP4 / Video • Max 20 MB';
      if (ctaMediaPlaceholderText) ctaMediaPlaceholderText.textContent = 'Click to upload CTA Video (MP4, Max 20 MB)';
    }
  }

  updatePreviewMedia();
  if (window.lucide) lucide.createIcons();
}

ctaMediaTypePills.forEach(pill => {
  pill.addEventListener('click', () => {
    setCtaMediaType(pill.dataset.ctaMedia);
  });
});

if (ctaMediaDropzone && inputCtaMediaFile) {
  ctaMediaDropzone.addEventListener('click', (e) => {
    if (e.target.closest('#btn-remove-cta-media')) return;
    inputCtaMediaFile.click();
  });

  inputCtaMediaFile.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;

    if (selectedCtaMediaType === 'image') {
      if (!validateMediaFile(file, 3 * 1024 * 1024, ['.jpg', '.jpeg', '.png'], 'CTA Image')) {
        inputCtaMediaFile.value = '';
        return;
      }
      const reader = new FileReader();
      reader.onload = (ev) => {
        uploadedCtaMedia = { file, type: 'image', previewUrl: ev.target.result };
        ctaMediaThumbImg.src = ev.target.result;
        ctaMediaThumbImg.style.display = 'block';
        ctaMediaIconBox.style.display = 'none';
        ctaMediaFileName.textContent = file.name;
        ctaMediaFileSize.textContent = (file.size / (1024 * 1024)).toFixed(2) + ' MB';
        ctaMediaPlaceholder.style.display = 'none';
        ctaMediaPreviewInfo.style.display = 'flex';
        ctaMediaDropzone.classList.add('has-file');
        updatePreviewMedia();
      };
      reader.readAsDataURL(file);
    } else if (selectedCtaMediaType === 'pdf') {
      if (!validateMediaFile(file, 10 * 1024 * 1024, ['.pdf'], 'CTA PDF Document')) {
        inputCtaMediaFile.value = '';
        return;
      }
      uploadedCtaMedia = { file, type: 'pdf' };
      ctaMediaThumbImg.style.display = 'none';
      ctaMediaIconBox.style.display = 'flex';
      ctaMediaTypeIcon.setAttribute('data-lucide', 'file-text');
      ctaMediaFileName.textContent = file.name;
      ctaMediaFileSize.textContent = (file.size / (1024 * 1024)).toFixed(2) + ' MB';
      ctaMediaPlaceholder.style.display = 'none';
      ctaMediaPreviewInfo.style.display = 'flex';
      ctaMediaDropzone.classList.add('has-file');
      updatePreviewMedia();
    } else if (selectedCtaMediaType === 'video') {
      if (!validateMediaFile(file, 20 * 1024 * 1024, ['.mp4', '.mov', '.mkv', '.webm'], 'CTA Video')) {
        inputCtaMediaFile.value = '';
        return;
      }
      uploadedCtaMedia = { file, type: 'video' };
      ctaMediaThumbImg.style.display = 'none';
      ctaMediaIconBox.style.display = 'flex';
      ctaMediaTypeIcon.setAttribute('data-lucide', 'video');
      ctaMediaFileName.textContent = file.name;
      ctaMediaFileSize.textContent = (file.size / (1024 * 1024)).toFixed(2) + ' MB';
      ctaMediaPlaceholder.style.display = 'none';
      ctaMediaPreviewInfo.style.display = 'flex';
      ctaMediaDropzone.classList.add('has-file');
      updatePreviewMedia();
    }
  });

  if (btnRemoveCtaMedia) {
    btnRemoveCtaMedia.addEventListener('click', (e) => {
      e.stopPropagation();
      inputCtaMediaFile.value = '';
      uploadedCtaMedia = null;
      ctaMediaPlaceholder.style.display = 'flex';
      ctaMediaPreviewInfo.style.display = 'none';
      ctaMediaDropzone.classList.remove('has-file');
      updatePreviewMedia();
    });
  }
}

function updateCostCalculator() {
  if (!currentUser) return;
  const { validNumbers, duplicateCount, invalidCount, dndCount, isCapped } = processContactInput(composerNumbers.value || '', selectedDestination);
  const count = validNumbers.length;

  recipientCountBadge.innerHTML = `<i data-lucide="check" style="width:12px;height:12px;display:inline-block;vertical-align:-1px;margin-right:3px;"></i>${count.toLocaleString()} / 50,000 valid`;
  if (isCapped) {
    recipientCountBadge.innerHTML += ` <span style="background:#fee2e2;color:#991b1b;padding:1px 5px;border-radius:4px;font-size:0.7rem;margin-left:4px;">(Max 50k Limit)</span>`;
  }
  
  const dupBadge = document.getElementById('recipient-dup-badge');
  if (dupBadge) {
    if (duplicateCount > 0) {
      dupBadge.style.display = 'inline-block';
      dupBadge.innerHTML = `<i data-lucide="copy" style="width:12px;height:12px;display:inline-block;vertical-align:-1px;margin-right:3px;"></i>${duplicateCount} dups removed`;
    } else {
      dupBadge.style.display = 'none';
    }
  }

  if (invalidCount > 0) {
    recipientInvalidBadge.style.display = 'inline-block';
    recipientInvalidBadge.innerHTML = `<i data-lucide="alert-triangle" style="width:12px;height:12px;display:inline-block;vertical-align:-1px;margin-right:3px;"></i>${invalidCount} invalid skipped`;
  } else {
    recipientInvalidBadge.style.display = 'none';
  }

  const dndBadge = document.getElementById('recipient-dnd-badge');
  if (dndBadge) {
    if (dndCount > 0) {
      dndBadge.style.display = 'inline-block';
      dndBadge.innerHTML = `<i data-lucide="shield-ban" style="width:12px;height:12px;display:inline-block;vertical-align:-1px;margin-right:3px;"></i>${dndCount} DND blocked`;
    } else {
      dndBadge.style.display = 'none';
    }
  }

  const typeLabels = {
    'normal': 'Normal Text Message',
    'dp': 'DP Media Attachment',
    'cta': 'CTA Buttons Message',
    'dp_cta': 'DP Media + CTA Buttons',
    'own_number': 'Dedicated SIM / Own Number'
  };

  const target = window.composerTargetUser || (currentUser && currentUser.role !== 'admin' ? currentUser : null);

  const campaignType = selectedCampaignType;
  const destLabel = selectedDestination === 'international' ? 'International' : 'Domestic (India)';
  document.getElementById('cost-campaign-type').textContent = `${typeLabels[campaignType]} • ${destLabel}`;
  document.getElementById('cost-target-count').textContent = count.toLocaleString();

  const creditField = `credits_${campaignType}_${selectedDestination}`;
  const currentBal = target ? (target[creditField] || 0) : 0;
  
  const balancePill = document.getElementById('composer-target-balance-pill');
  if (balancePill) {
    if (target) {
      balancePill.innerHTML = `Wallet (${escapeHtml(target.email)}): <strong>${currentBal.toLocaleString()}</strong> credits`;
      balancePill.style.background = '#dbeafe';
      balancePill.style.color = '#1e40af';
      balancePill.style.borderColor = '#93c5fd';
    } else {
      balancePill.textContent = 'Wallet: Select an Account';
      balancePill.style.background = '#fef3c7';
      balancePill.style.color = '#92400e';
      balancePill.style.borderColor = '#fde68a';
    }
  }

  const costBalEl = document.getElementById('cost-current-bal');
  if (costBalEl) {
    const targetLabel = target ? `(${target.email})` : '(No account chosen)';
    costBalEl.textContent = `${currentBal.toLocaleString()} credits ${targetLabel}`;
  }

  const afterBal = currentBal - count;
  const afterBalEl = document.getElementById('cost-after-bal');
  afterBalEl.textContent = `${afterBal.toLocaleString()} credits`;

  const submitBtn = document.getElementById('btn-submit-campaign-saas');

  if (currentUser && currentUser.role === 'admin' && !target) {
    afterBalEl.textContent = '— (Choose Target Account)';
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.style.opacity = '0.65';
      submitBtn.style.cursor = 'not-allowed';
      submitBtn.innerHTML = `<i data-lucide="user-check" style="width:18px;height:18px;margin-right:6px;"></i> Choose Beneficiary Account First`;
    }
  } else if (afterBal < 0) {
    afterBalEl.style.color = 'var(--danger)';
    afterBalEl.innerHTML = `${afterBal.toLocaleString()} credits <span style="font-size:0.75rem;font-weight:700;margin-left:4px;color:var(--danger);">(Insufficient Balance)</span><div style="margin-top:6px;"><a href="javascript:void(0)" onclick="switchView('view-billing')" style="color:var(--primary);font-weight:600;font-size:0.75rem;text-decoration:underline;">Top up credits &rarr;</a></div>`;
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.style.opacity = '0.65';
      submitBtn.style.cursor = 'not-allowed';
      submitBtn.innerHTML = `<i data-lucide="alert-circle" style="width:18px;height:18px;margin-right:6px;"></i> Insufficient Credits (${currentBal.toLocaleString()} / ${count.toLocaleString()} required)`;
    }
  } else {
    afterBalEl.style.color = 'var(--success)';
    if (submitBtn) {
      if (count === 0) {
        submitBtn.disabled = true;
        submitBtn.style.opacity = '0.65';
        submitBtn.style.cursor = 'not-allowed';
        submitBtn.innerHTML = `<i data-lucide="rocket" style="width:18px;height:18px;margin-right:6px;"></i> Launch Campaign (Add Recipients)`;
      } else {
        submitBtn.disabled = false;
        submitBtn.style.opacity = '1';
        submitBtn.style.cursor = 'pointer';
        const proxyPrefix = (target && target.id !== currentUser.id) ? `For ${target.email}: ` : '';
        submitBtn.innerHTML = `<i data-lucide="rocket" style="width:18px;height:18px;margin-right:6px;"></i> ${proxyPrefix}Launch Campaign (${count.toLocaleString()} Recipients)`;
      }
    }
  }

  if (window.lucide) lucide.createIcons();
}

// Quick Emoji Insertion
window.insertEmoji = function(emoji) {
  if (!composerText) return;
  const start = composerText.selectionStart || composerText.value.length;
  const end = composerText.selectionEnd || composerText.value.length;
  const current = composerText.value;
  composerText.value = current.substring(0, start) + emoji + current.substring(end);
  composerText.selectionStart = composerText.selectionEnd = start + emoji.length;
  composerText.focus();
  composerText.dispatchEvent(new Event('input'));
};
window.insertVariableTag = window.insertEmoji;

// Target Account Proxy Selector (Super Admin & Reseller)
window.composerTargetUser = null;

async function setupComposerTargetSelector() {
  const card = document.getElementById('composer-proxy-dispatch-card');
  const badge = document.getElementById('composer-proxy-badge');
  const select = document.getElementById('composer-target-user');
  const balancePill = document.getElementById('composer-target-balance-pill');
  if (!card || !select || !currentUser) return;

  if (currentUser.role === 'admin') {
    card.style.display = 'block';
    if (badge) badge.innerHTML = '<i data-lucide="crown" style="width:13px;height:13px;"></i> Super Admin Proxy Mode';
    
    if (!allUsers || allUsers.length === 0) {
      try { allUsers = await apiFetch('/users'); } catch(e) { allUsers = []; }
    }
    
    const nonAdmins = (allUsers || []).filter(u => u.role !== 'admin' && !u.isBlocked);
    let optionsHtml = '<option value="">-- Choose Target Account (User / Reseller) * --</option>';
    
    const resellers = nonAdmins.filter(u => u.role === 'reseller');
    const clients = nonAdmins.filter(u => u.role === 'user');
    
    if (resellers.length > 0) {
      optionsHtml += `<optgroup label="Resellers">`;
      resellers.forEach(r => {
        optionsHtml += `<option value="${r.id}">Reseller: ${escapeHtml(r.email)} (${escapeHtml(r.companyName || r.fullName || 'Partner')})</option>`;
      });
      optionsHtml += `</optgroup>`;
    }
    
    if (clients.length > 0) {
      optionsHtml += `<optgroup label="End Users & Clients">`;
      clients.forEach(c => {
        const resellerTag = c.resellerEmail ? ` [Under: ${c.resellerEmail}]` : ' [Direct]';
        optionsHtml += `<option value="${c.id}">Client: ${escapeHtml(c.email)}${escapeHtml(resellerTag)}</option>`;
      });
      optionsHtml += `</optgroup>`;
    }
    
    select.innerHTML = optionsHtml;
    window.composerTargetUser = null;
    if (balancePill) balancePill.textContent = 'Wallet: Select Target Account';
    
    select.onchange = () => {
      const targetId = parseInt(select.value, 10);
      window.composerTargetUser = nonAdmins.find(u => u.id === targetId) || null;
      updateCostCalculator();
      if (typeof populateComposerSelectors === 'function') populateComposerSelectors();
    };
  } else if (currentUser.role === 'reseller') {
    card.style.display = 'block';
    if (badge) badge.innerHTML = '<i data-lucide="users" style="width:13px;height:13px;"></i> Reseller Dispatch Account';
    
    if (!allUsers || allUsers.length === 0) {
      try { allUsers = await apiFetch('/users'); } catch(e) { allUsers = []; }
    }
    
    const myClients = (allUsers || []).filter(u => (u.resellerId === currentUser.id || u.reseller_id === currentUser.id || u.resellerEmail === currentUser.email) && !u.isBlocked);
    let optionsHtml = `<option value="self">My Reseller Account (${escapeHtml(currentUser.email)})</option>`;
    if (myClients.length > 0) {
      optionsHtml += `<optgroup label="My Managed Clients">`;
      myClients.forEach(c => {
        optionsHtml += `<option value="${c.id}">Client: ${escapeHtml(c.email)} (${escapeHtml(c.companyName || c.fullName || 'Client')})</option>`;
      });
      optionsHtml += `</optgroup>`;
    }
    select.innerHTML = optionsHtml;
    select.value = 'self';
    window.composerTargetUser = currentUser;
    
    select.onchange = () => {
      if (select.value === 'self') {
        window.composerTargetUser = currentUser;
      } else {
        const targetId = parseInt(select.value, 10);
        window.composerTargetUser = myClients.find(u => u.id === targetId) || currentUser;
      }
      updateCostCalculator();
      if (typeof populateComposerSelectors === 'function') populateComposerSelectors();
    };
  } else {
    // Regular Client
    card.style.display = 'none';
    window.composerTargetUser = currentUser;
  }
}

// SUBMIT CAMPAIGN
const btnSubmitCampaignSaas = document.getElementById('btn-submit-campaign-saas');
btnSubmitCampaignSaas.addEventListener('click', async () => {
  // Validate On-Behalf-Of target user for Admin & Reseller
  const targetSelect = document.getElementById('composer-target-user');
  let targetUserId = null;

  if (currentUser && currentUser.role === 'admin') {
    if (!targetSelect || !targetSelect.value || targetSelect.value === 'self') {
      showToast('warning', 'Target Account Required', 'Super Admin dispatches on behalf of an active User or Reseller. Please select a beneficiary account.');
      return;
    }
    targetUserId = targetSelect.value;
  } else if (currentUser && currentUser.role === 'reseller') {
    if (targetSelect && targetSelect.value && targetSelect.value !== 'self') {
      targetUserId = targetSelect.value;
    }
  }

  const rawTitle = (composerTitle ? composerTitle.value.trim() : '');
  const now = new Date();
  const dateTag = now.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }).replace(/ /g, '');
  const timeTag = `${now.getHours()}h${String(now.getMinutes()).padStart(2, '0')}`;
  const autoGeneratedTitle = `${(selectedCampaignType || 'CAMPAIGN').toUpperCase()}_${selectedDestination === 'international' ? 'INTL' : 'DOM'}_${dateTag}_${timeTag}`;
  const title = rawTitle || autoGeneratedTitle;
  const text = composerText.value.trim();
  const { validNumbers, invalidCount } = processContactInput(composerNumbers.value || '', selectedDestination);

  if (!text) {
    showToast('error', 'Validation Error', 'Please enter your campaign message text.');
    return;
  }
  if (validNumbers.length === 0) {
    showToast('error', 'Validation Error', 'Please provide at least one valid recipient phone number.');
    return;
  }

  // Strict CTA Business Rules Check (1,024 Char limit, 20 char button text, HTTPS & No wa.me)
  const isCtaCampaign = (selectedCampaignType === 'cta' || selectedCampaignType === 'dp_cta' || (composerCtaToggle && composerCtaToggle.checked));
  if (isCtaCampaign) {
    const ctaErr = validateCtaRules({
      text,
      callText: ctaCallText ? ctaCallText.value.trim() : '',
      urlText: ctaUrlText ? ctaUrlText.value.trim() : '',
      urlLink: ctaUrlLink ? ctaUrlLink.value.trim() : '',
      isCta: true
    });
    if (ctaErr) {
      showToast('error', 'CTA Validation Error', ctaErr);
      return;
    }
  }

  // Validate scheduled timing
  const isScheduled = document.querySelector('input[name="dispatch-timing"]:checked')?.value === 'later';
  let scheduledAtIso = null;
  if (isScheduled) {
    if (!composerScheduleTime.value) {
      showToast('error', 'Validation Error', 'Please pick a scheduled date and time for later dispatch.');
      return;
    }
    const schedDate = new Date(composerScheduleTime.value);
    if (schedDate <= new Date()) {
      showToast('error', 'Validation Error', 'Scheduled time must be in the future.');
      return;
    }
    scheduledAtIso = schedDate.toISOString();
  }

  btnSubmitCampaignSaas.disabled = true;
  btnSubmitCampaignSaas.innerHTML = `<i data-lucide="loader-2" class="spin" style="width:16px;height:16px;margin-right:6px;"></i> Dispatching ${validNumbers.length.toLocaleString()} Recipients...`;
  if (window.lucide) lucide.createIcons();

  const formData = new FormData();
  formData.append('title', title);
  formData.append('text', text);
  formData.append('numbers', validNumbers.join('\n'));
  formData.append('destination', selectedDestination);
  formData.append('campaign_type', selectedCampaignType);
  formData.append('channel_type', selectedCampaignType === 'own_number' ? 'own_number' : 'shared_gateway');

  if (targetUserId) {
    formData.append('target_user_id', targetUserId);
  }

  if (scheduledAtIso) {
    formData.append('scheduled_at', scheduledAtIso);
  }

  // Append distinct uploaded media assets
  if (uploadedDP && uploadedDP.file) {
    formData.append('dp_file', uploadedDP.file);
  }
  for (let i = 0; i < 4; i++) {
    if (uploadedImages[i] && uploadedImages[i].file) {
      formData.append(`image_${i + 1}`, uploadedImages[i].file);
    }
  }
  if (uploadedVideo && uploadedVideo.file) {
    formData.append('video_file', uploadedVideo.file);
  }
  if (uploadedPDF && uploadedPDF.file) {
    formData.append('pdf_file', uploadedPDF.file);
  }
  if (uploadedCtaMedia && uploadedCtaMedia.file) {
    formData.append('cta_media_file', uploadedCtaMedia.file);
  }
  if (window.composerTemplateAttachmentUrl) {
    formData.append('attachment_url', window.composerTemplateAttachmentUrl);
  }

  if (composerCtaToggle.checked) {
    const ctaData = {
      callText: ctaCallText.value.trim(),
      callNumber: ctaCallNumber.value.trim(),
      urlText: ctaUrlText.value.trim(),
      urlLink: ctaUrlLink.value.trim()
    };
    formData.append('cta_data', JSON.stringify(ctaData));
  }

  try {
    const res = await apiFetch('/campaigns', {
      method: 'POST',
      body: formData
    });

    const onBehalfMsg = res.onBehalfEmail ? ` on behalf of ${res.onBehalfEmail}` : '';
    showToast('success', 'Campaign Launched!', `"${res.title}" created with ${res.messageCount} recipients${onBehalfMsg}.`);

    // Reset Form
    if (composerTitle) composerTitle.value = '';
    composerText.value = '';
    composerNumbers.value = '';
    resetAllMediaUploads();
    window.composerTemplateAttachmentUrl = null;
    previewBubbleText.textContent = 'Your message will appear here in real-time as you compose it...';
    composerCtaToggle.checked = false;
    composerCtaBox.style.display = 'none';
    previewBubbleCta.style.display = 'none';
    if (composerScheduleTime) {
      composerScheduleTime.value = '';
      composerScheduleTime.style.display = 'none';
    }
    const radioNow = document.querySelector('input[name="dispatch-timing"][value="now"]');
    if (radioNow) radioNow.checked = true;
    
    const clonedNotice = document.getElementById('composer-cloned-notice');
    if (clonedNotice) clonedNotice.style.display = 'none';

    setCampaignType('normal');

    // Refresh user balance & campaigns
    const updatedUser = await apiFetch('/auth/me');
    currentUser = updatedUser;
    updateCreditDisplays();
    await loadCampaigns();
    if (currentUser.role === 'admin' || currentUser.role === 'reseller') {
      await loadUsers();
    }

    // Redirect to campaigns view
    switchView('view-campaigns');
  } catch (err) {
    showToast('error', 'Campaign Failed', err.message);
  } finally {
    btnSubmitCampaignSaas.disabled = false;
    btnSubmitCampaignSaas.innerHTML = '<i data-lucide="send" style="width:15px;height:15px;margin-right:6px;"></i> Launch Campaign';
    lucide.createIcons();
  }
});

// --- CAMPAIGNS LIST & REPORTING ---
async function loadCampaigns() {
  if (!currentUser) return;
  const tbody = document.getElementById('campaigns-full-tbody');
  if (tbody && (!allCampaigns || allCampaigns.length === 0)) {
    window.renderTableSkeleton(tbody, 8, 3);
  }
  try {
    allCampaigns = await apiFetch('/campaigns?channel_type=all');
    populateCampaignUserFilter();
    renderRecentDashboardCampaigns();
    renderCampaignsTable();
    updateCampaignTabBadges();
    refreshDashboardMetrics();
    updateOperatorQueueBadge();
    if (typeof loadAdminScheduledReminders === 'function') {
      loadAdminScheduledReminders();
    }
  } catch (e) {
    console.error('Error loading campaigns:', e);
  }
}

let campaignChannelScope = 'all';

window.setCampaignChannelScope = function(scope, btn) {
  campaignChannelScope = scope || 'all';

  const tabContainer = document.getElementById('campaign-channel-filter-tabs');
  if (tabContainer) {
    tabContainer.querySelectorAll('.tab-pill').forEach(p => p.classList.remove('active'));
    if (btn) {
      btn.classList.add('active');
    } else {
      const targetBtn = document.getElementById(`tab-channel-${campaignChannelScope}`);
      if (targetBtn) targetBtn.classList.add('active');
    }
  }

  const activeBadge = document.getElementById('campaigns-active-channel-badge');
  const headerIcon = document.getElementById('campaigns-channel-header-icon');
  if (activeBadge) {
    if (campaignChannelScope === 'whatsapp') {
      activeBadge.textContent = 'WHATSAPP MESSAGING';
      activeBadge.style.background = '#dcfce7';
      activeBadge.style.color = '#15803d';
      activeBadge.style.borderColor = '#bbf7d0';
      if (headerIcon) {
        headerIcon.style.background = '#16a34a';
        headerIcon.innerHTML = '<i data-lucide="message-circle" style="width:22px;height:22px;"></i>';
      }
    } else if (campaignChannelScope === 'sms') {
      activeBadge.textContent = 'GSM BULK SMS';
      activeBadge.style.background = '#eff6ff';
      activeBadge.style.color = '#1d4ed8';
      activeBadge.style.borderColor = '#bfdbfe';
      if (headerIcon) {
        headerIcon.style.background = 'linear-gradient(135deg, #6366f1, #4f46e5)';
        headerIcon.innerHTML = '<i data-lucide="radio" style="width:22px;height:22px;"></i>';
      }
    } else {
      activeBadge.textContent = 'ALL CHANNELS';
      activeBadge.style.background = '#e0e7ff';
      activeBadge.style.color = '#3730a3';
      activeBadge.style.borderColor = '#c7d2fe';
      if (headerIcon) {
        headerIcon.style.background = 'linear-gradient(135deg, #4f46e5, #6366f1)';
        headerIcon.innerHTML = '<i data-lucide="layers" style="width:22px;height:22px;"></i>';
      }
    }
  }

  campaignCurrentPage = 1;
  renderCampaignsTable();
  updateCampaignTabBadges();
  if (window.lucide) setTimeout(() => lucide.createIcons(), 50);
};

function updateCampaignTabBadges() {
  if (!allCampaigns) return;
  const now = new Date();
  
  // Update Channel Tabs Counts
  const totalAll = allCampaigns.length;
  const totalWa = allCampaigns.filter(c => c.channel_type !== 'sms' && c.campaign_type !== 'gsm_sms').length;
  const totalSms = allCampaigns.filter(c => c.channel_type === 'sms' || c.campaign_type === 'gsm_sms').length;

  const badgeAll = document.getElementById('channel-badge-all');
  const badgeWa = document.getElementById('channel-badge-whatsapp');
  const badgeSms = document.getElementById('channel-badge-sms');
  if (badgeAll) badgeAll.textContent = totalAll;
  if (badgeWa) badgeWa.textContent = totalWa;
  if (badgeSms) badgeSms.textContent = totalSms;

  const scopeCampaigns = allCampaigns.filter(c => {
    const isSms = c.channel_type === 'sms' || c.campaign_type === 'gsm_sms';
    if (campaignChannelScope === 'whatsapp') return !isSms;
    if (campaignChannelScope === 'sms') return isSms;
    return true; // 'all'
  });

  const counts = {
    all: scopeCampaigns.length,
    Scheduled: 0,
    Submitted: 0,
    Approved: 0,
    Completed: 0,
    'Report Updated': 0,
    Rejected: 0
  };
  scopeCampaigns.forEach(c => {
    const isScheduled = Boolean(c.scheduled_at && new Date(c.scheduled_at) > now && c.status === 'Submitted');
    if (isScheduled) {
      counts.Scheduled++;
    } else if (counts[c.status] !== undefined) {
      counts[c.status]++;
    }
  });

  const map = {
    'all': 'badge-camp-all',
    'Scheduled': 'badge-camp-scheduled',
    'Submitted': 'badge-camp-submitted',
    'Approved': 'badge-camp-approved',
    'Completed': 'badge-camp-completed',
    'Report Updated': 'badge-camp-reported',
    'Rejected': 'badge-camp-rejected'
  };

  Object.entries(map).forEach(([status, elId]) => {
    const el = document.getElementById(elId);
    if (el) el.textContent = counts[status] || 0;
  });
}

function updateOperatorQueueBadge() {
  const btn = document.getElementById('btn-open-operator-queue');
  const badge = document.getElementById('operator-queue-badge');
  if (!btn) return;
  const isOperator = currentUser && (currentUser.role === 'admin' || currentUser.role === 'reseller');
  btn.style.display = isOperator ? 'inline-flex' : 'none';
  if (isOperator && allCampaigns) {
    const pendingCount = allCampaigns.filter(c => c.status === 'Submitted' || c.status === 'Approved').length;
    if (badge) badge.textContent = pendingCount;
  }
}

// --- ADMIN / RESELLER SCHEDULED CAMPAIGN REMINDERS ---
let adminReminders = [];
let alertedReminderIds = new Set();
let lastReminderPollTime = 0;

window.loadAdminScheduledReminders = async function(force = false) {
  if (!currentUser || (currentUser.role !== 'admin' && currentUser.role !== 'reseller')) {
    const btn = document.getElementById('btn-admin-scheduled-reminders');
    if (btn) btn.style.display = 'none';
    const dropdown = document.getElementById('admin-reminders-dropdown');
    if (dropdown) dropdown.style.display = 'none';
    return;
  }

  // Throttle polling to every 10 seconds unless forced
  const now = Date.now();
  if (!force && (now - lastReminderPollTime < 10000)) {
    return;
  }
  lastReminderPollTime = now;

  const btn = document.getElementById('btn-admin-scheduled-reminders');
  if (btn) btn.style.display = 'inline-flex';

  try {
    const list = await apiFetch('/campaigns/reminders/active');
    adminReminders = Array.isArray(list) ? list : [];
    
    // Update badge counts
    const count = adminReminders.length;
    const badge = document.getElementById('admin-reminder-badge');
    if (badge) {
      badge.textContent = count;
      badge.style.display = count > 0 ? 'inline-block' : 'none';
    }
    const dashCount = document.getElementById('dash-admin-reminder-count');
    if (dashCount) dashCount.textContent = count;

    // Render list
    renderAdminRemindersList();

    // Check for approaching scheduled campaigns (within 30 mins) to alert admin via toast
    const currentTime = new Date().getTime();
    adminReminders.forEach(r => {
      if (r.scheduled_for) {
        const schedTime = new Date(r.scheduled_for).getTime();
        const diffMins = Math.round((schedTime - currentTime) / (60 * 1000));
        if (diffMins <= 30 && diffMins >= -10 && !alertedReminderIds.has(r.id)) {
          alertedReminderIds.add(r.id);
          const timeText = diffMins > 0 ? `in ${diffMins} min${diffMins > 1 ? 's' : ''}` : 'due now / ready';
          if (typeof showToast === 'function') {
            showToast('info', 'Scheduled Campaign Alert', `Campaign #${r.campaign_id} "${r.campaign_title || ''}" is ${timeText}!`);
          }
        }
      }
    });
  } catch (err) {
    console.warn('Failed to load admin reminders:', err);
  }
};

window.renderAdminRemindersList = function() {
  const container = document.getElementById('admin-reminders-list');
  if (!container) return;

  if (!adminReminders || adminReminders.length === 0) {
    container.innerHTML = `
      <div style="text-align:center;padding:24px 14px;color:var(--slate-400);font-size:0.8rem;">
        <i data-lucide="check-circle" style="width:24px;height:24px;margin-bottom:6px;color:#10b981;display:inline-block;"></i>
        <div>No pending scheduled reminders.</div>
      </div>
    `;
    if (window.lucide) {
      try { lucide.createIcons({ root: container }); } catch (e) { lucide.createIcons(); }
    }
    return;
  }

  const now = new Date().getTime();
  container.innerHTML = adminReminders.map(r => {
    let diffText = '';
    let isUrgent = false;
    if (r.scheduled_for) {
      const target = new Date(r.scheduled_for).getTime();
      const diffMs = target - now;
      const diffMin = Math.round(diffMs / 60000);
      if (diffMin < 0) {
        diffText = `Due ${Math.abs(diffMin)}m ago (Ready)`;
        isUrgent = true;
      } else if (diffMin < 60) {
        diffText = `In ${diffMin} mins`;
        if (diffMin <= 30) isUrgent = true;
      } else if (diffMin < 1440) {
        const hrs = Math.floor(diffMin / 60);
        const mins = diffMin % 60;
        diffText = `In ${hrs}h ${mins}m`;
      } else {
        const days = Math.floor(diffMin / 1440);
        diffText = `In ${days} day${days > 1 ? 's' : ''}`;
      }
    }

    const badgeBg = isUrgent ? '#fef2f2' : '#eff6ff';
    const badgeColor = isUrgent ? '#dc2626' : '#2563eb';
    const badgeBorder = isUrgent ? '#fca5a5' : '#bfdbfe';

    const schedDateFormatted = r.scheduled_for 
      ? new Date(r.scheduled_for).toLocaleString('en-IN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
      : 'N/A';

    return `
      <div style="padding:10px 14px;border-bottom:1px solid #f1f5f9;transition:background 0.15s ease;" onmouseenter="this.style.background='#f8fafc'" onmouseleave="this.style.background='transparent'">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;">
          <div style="flex:1;min-width:0;">
            <div style="display:flex;align-items:center;gap:6px;margin-bottom:2px;flex-wrap:wrap;">
              <span style="font-size:0.7rem;font-weight:700;padding:2px 6px;border-radius:4px;background:${badgeBg};color:${badgeColor};border:1px solid ${badgeBorder};">
                ${escapeHtml(diffText || 'Scheduled')}
              </span>
              <span style="font-weight:700;font-size:0.82rem;color:var(--slate-800);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:180px;">
                #${r.campaign_id} ${escapeHtml(r.campaign_title || 'Campaign')}
              </span>
            </div>
            <div style="font-size:0.74rem;color:var(--slate-500);line-height:1.35;margin-bottom:6px;">
              ${escapeHtml(r.message || '')}
            </div>
            <div style="display:flex;align-items:center;gap:12px;font-size:0.7rem;color:var(--slate-400);">
              <span><i data-lucide="clock" style="width:11px;height:11px;display:inline-block;vertical-align:-1px;"></i> ${schedDateFormatted}</span>
              ${r.total_numbers ? `<span><i data-lucide="users" style="width:11px;height:11px;display:inline-block;vertical-align:-1px;"></i> ${Number(r.total_numbers).toLocaleString()} contacts</span>` : ''}
            </div>
          </div>
          <div style="display:flex;flex-direction:column;gap:4px;align-items:flex-end;">
            <button type="button" onclick="dismissAdminReminder(${r.id}, event)" style="background:none;border:none;color:var(--slate-400);cursor:pointer;padding:2px;border-radius:4px;" title="Dismiss Reminder" onmouseenter="this.style.color='#ef4444'" onmouseleave="this.style.color='var(--slate-400)'">
              <i data-lucide="x" style="width:14px;height:14px;"></i>
            </button>
            <button type="button" onclick="openCampaignFromReminder(${r.campaign_id})" style="margin-top:8px;background:#f1f5f9;border:1px solid #cbd5e1;border-radius:4px;color:var(--slate-700);font-size:0.7rem;font-weight:600;padding:3px 8px;cursor:pointer;display:inline-flex;align-items:center;gap:3px;" onmouseenter="this.style.background='#e2e8f0'" onmouseleave="this.style.background='#f1f5f9'">
              View <i data-lucide="arrow-right" style="width:11px;height:11px;"></i>
            </button>
          </div>
        </div>
      </div>
    `;
  }).join('');

  if (window.lucide) {
    try { lucide.createIcons({ root: container }); } catch (e) { lucide.createIcons(); }
  }
};

window.openCampaignFromReminder = function(campaignId) {
  const dropdown = document.getElementById('admin-reminders-dropdown');
  if (dropdown) dropdown.style.display = 'none';
  if (typeof openCampaignDetailModal === 'function') {
    openCampaignDetailModal(campaignId);
  }
};

window.toggleAdminRemindersDropdown = function() {
  const dropdown = document.getElementById('admin-reminders-dropdown');
  if (!dropdown) return;
  const isHidden = dropdown.style.display === 'none' || dropdown.style.display === '';
  dropdown.style.display = isHidden ? 'block' : 'none';
  if (isHidden) {
    loadAdminScheduledReminders(true);
  }
};

window.dismissAdminReminder = async function(reminderId, ev) {
  if (ev) ev.stopPropagation();
  try {
    await apiFetch(`/campaigns/reminders/${reminderId}/dismiss`, { method: 'POST' });
    adminReminders = adminReminders.filter(r => r.id !== reminderId);
    const badge = document.getElementById('admin-reminder-badge');
    if (badge) {
      badge.textContent = adminReminders.length;
      badge.style.display = adminReminders.length > 0 ? 'inline-block' : 'none';
    }
    const dashCount = document.getElementById('dash-admin-reminder-count');
    if (dashCount) dashCount.textContent = adminReminders.length;
    renderAdminRemindersList();
  } catch (err) {
    console.error('Failed to dismiss reminder:', err);
  }
};

window.dismissAllAdminReminders = async function() {
  try {
    await apiFetch('/campaigns/reminders/dismiss-all', { method: 'POST' });
    adminReminders = [];
    const badge = document.getElementById('admin-reminder-badge');
    if (badge) {
      badge.textContent = 0;
      badge.style.display = 'none';
    }
    const dashCount = document.getElementById('dash-admin-reminder-count');
    if (dashCount) dashCount.textContent = 0;
    renderAdminRemindersList();
  } catch (err) {
    console.error('Failed to dismiss all reminders:', err);
  }
};

const btnRemindersPill = document.getElementById('btn-admin-scheduled-reminders');
if (btnRemindersPill) {
  btnRemindersPill.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleAdminRemindersDropdown();
  });
}
const btnDismissAllReminders = document.getElementById('btn-dismiss-all-reminders');
if (btnDismissAllReminders) {
  btnDismissAllReminders.addEventListener('click', (e) => {
    e.stopPropagation();
    dismissAllAdminReminders();
  });
}

window.openOperatorDispatchModal = function() {
  if (!currentUser || currentUser.role !== 'admin') {
    showToast('error', 'Access Restricted', 'Operator dispatch queue is reserved exclusively for Super Admin platform operators.');
    return;
  }
  const modal = document.getElementById('modal-operator-dispatch');
  if (modal) {
    modal.style.display = 'flex';
    if (typeof loadOperatorQueue === 'function') loadOperatorQueue();
  }
};

window.handleDashboardCardClick = function(cardNumber) {
  if (!currentUser) return;
  const role = currentUser.role || 'user';

  if (role === 'admin') {
    if (cardNumber === 1 || cardNumber === 2) {
      if (typeof setCampaignChannelScope === 'function') {
        setCampaignChannelScope('all');
      }
      switchView('view-campaigns');
    } else if (cardNumber === 3) {
      openOperatorDispatchModal();
    } else if (cardNumber === 4) {
      switchView('view-users');
    }
  } else if (role === 'reseller') {
    if (cardNumber === 1) {
      if (typeof setCampaignChannelScope === 'function') {
        setCampaignChannelScope('all');
      }
      switchView('view-campaigns');
    } else if (cardNumber === 2) {
      switchView('view-users');
    } else if (cardNumber === 3) {
      switchView('view-wallet');
    } else if (cardNumber === 4) {
      switchView('view-resellers');
    }
  } else {
    // Client / End User
    if (cardNumber === 1 || cardNumber === 2 || cardNumber === 3) {
      if (typeof setCampaignChannelScope === 'function') {
        setCampaignChannelScope('all');
      }
      switchView('view-campaigns');
    } else if (cardNumber === 4) {
      switchView('view-wallet');
    }
  }
};

async function refreshDashboardMetrics() {
  if (!currentUser) return;
  const role = (currentUser.is_team_member && currentUser.parent_role) ? currentUser.parent_role : (currentUser.role || 'user');

  // 1. Role-Adaptive Quick Action Strips
  const stripAdmin = document.getElementById('dash-quick-actions-admin');
  const stripReseller = document.getElementById('dash-quick-actions-reseller');
  const stripClient = document.getElementById('dash-quick-actions-client');

  if (stripAdmin) stripAdmin.style.display = (role === 'admin') ? 'flex' : 'none';
  if (stripReseller) stripReseller.style.display = (role === 'reseller') ? 'flex' : 'none';
  if (stripClient) stripClient.style.display = (role === 'user') ? 'flex' : 'none';

  // Reseller Commercial Profit & Margins Analytics Hub
  const rpmSection = document.getElementById('reseller-profit-margins-section');
  if (rpmSection) {
    if (role === 'reseller') {
      rpmSection.style.display = 'block';
      loadResellerProfitAnalytics();
    } else {
      rpmSection.style.display = 'none';
    }
  }

  // 2. Dynamic 4-KPI Metric Card elements
  const card1Title = document.getElementById('dash-card1-title');
  const card1Val = document.getElementById('dash-metric-campaigns');
  const card1Sub = document.getElementById('dash-card1-sub');
  const card1Box = document.getElementById('dash-card1-icon-box');

  const card2Title = document.getElementById('dash-card2-title');
  const card2Val = document.getElementById('dash-metric-numbers');
  const card2Sub = document.getElementById('dash-card2-sub');
  const card2Box = document.getElementById('dash-card2-icon-box');

  const card3Title = document.getElementById('dash-card3-title');
  const card3Val = document.getElementById('dash-metric-delivery');
  const card3Sub = document.getElementById('dash-card3-sub');
  const card3Box = document.getElementById('dash-card3-icon-box');

  const card4Title = document.getElementById('dash-card4-title');
  const card4Val = document.getElementById('dash-metric-credits');
  const card4Sub = document.getElementById('dash-card4-sub');
  const card4Box = document.getElementById('dash-card4-icon-box');

  try {
    const reportData = await apiFetch('/reports/dashboard');
    const kpi = reportData.kpi || {};

    if (role === 'admin') {
      // === SUPER ADMIN VIEW ===
      if (card1Title) card1Title.textContent = 'Total Platform Campaigns';
      if (card1Val) window.animateCountUp(card1Val, kpi.total_campaigns || 0);
      if (card1Sub) card1Sub.textContent = 'All-time system dispatches';
      if (card1Box) card1Box.innerHTML = '<i data-lucide="radio" style="width:24px;height:24px;"></i>';

      if (card2Title) card2Title.textContent = 'Total Messages Processed';
      if (card2Val) window.animateCountUp(card2Val, kpi.total_recipients || 0);
      if (card2Sub) card2Sub.textContent = 'Platform volume reached';
      if (card2Box) card2Box.innerHTML = '<i data-lucide="smartphone" style="width:24px;height:24px;"></i>';

      if (card3Title) card3Title.textContent = 'Operator Dispatch Queue';
      if (card3Val) card3Val.textContent = `${kpi.operator_queue_pending || 0} Pending`;
      if (card3Sub) card3Sub.textContent = 'Awaiting carrier export / dispatch';
      if (card3Box) card3Box.innerHTML = '<i data-lucide="send" style="width:24px;height:24px;"></i>';

      if (card4Title) card4Title.textContent = 'Active Network';
      if (card4Val) card4Val.textContent = `${kpi.total_accounts || 0} Registered`;
      if (card4Sub) card4Sub.textContent = `${kpi.total_clients || 0} Clients · ${kpi.total_resellers || 0} Resellers`;
      if (card4Box) card4Box.innerHTML = '<i data-lucide="network" style="width:24px;height:24px;"></i>';

      const adminQueueCount = document.getElementById('dash-admin-queue-count');
      if (adminQueueCount) adminQueueCount.textContent = kpi.operator_queue_pending || 0;
      const topbarQueueVal = document.getElementById('topbar-queue-val');
      if (topbarQueueVal) topbarQueueVal.textContent = kpi.operator_queue_pending || 0;

    } else if (role === 'reseller') {
      // === RESELLER AGENCY VIEW ===
      if (card1Title) card1Title.textContent = 'Client Campaigns';
      if (card1Val) window.animateCountUp(card1Val, kpi.client_campaigns || 0);
      if (card1Sub) card1Sub.textContent = 'Dispatched by your agency clients';
      if (card1Box) card1Box.innerHTML = '<i data-lucide="radio" style="width:24px;height:24px;"></i>';

      if (card2Title) card2Title.textContent = 'Managed Sub-Accounts';
      if (card2Val) card2Val.textContent = `${kpi.managed_clients || 0} Clients`;
      if (card2Sub) card2Sub.textContent = 'Active accounts in your network';
      if (card2Box) card2Box.innerHTML = '<i data-lucide="users" style="width:24px;height:24px;"></i>';

      if (card3Title) card3Title.textContent = 'Reseller Wallet Balance';
      if (card3Val) window.animateCountUp(card3Val, kpi.reseller_domestic_stock || 0);
      if (card3Sub) card3Sub.textContent = `Available stock (Intl: ${Number(kpi.reseller_intl_stock || 0).toLocaleString()})`;
      if (card3Box) card3Box.innerHTML = '<i data-lucide="coins" style="width:24px;height:24px;"></i>';

      if (card4Title) card4Title.textContent = 'Credits in Circulation';
      if (card4Val) window.animateCountUp(card4Val, kpi.credits_in_circulation || 0);
      if (card4Sub) card4Sub.textContent = 'Distributed in client wallets';
      if (card4Box) card4Box.innerHTML = '<i data-lucide="credit-card" style="width:24px;height:24px;"></i>';

    } else {
      // === END CLIENT / USER VIEW ===
      const totalDelivered = Number(kpi.total_delivered || 0);
      const totalFailed = Number(kpi.total_failed || 0);
      const totalProcessed = totalDelivered + totalFailed;
      const deliveryPct = totalProcessed > 0
        ? ((totalDelivered / totalProcessed) * 100).toFixed(1) + '%'
        : ((kpi.my_campaigns || 0) > 0 ? 'In Progress' : '—');

      if (card1Title) card1Title.textContent = 'My Campaigns';
      if (card1Val) window.animateCountUp(card1Val, kpi.my_campaigns || 0);
      if (card1Sub) card1Sub.textContent = 'Total campaigns created';
      if (card1Box) card1Box.innerHTML = '<i data-lucide="radio" style="width:24px;height:24px;"></i>';

      if (card2Title) card2Title.textContent = 'Audience Reached';
      if (card2Val) window.animateCountUp(card2Val, kpi.total_recipients || 0);
      if (card2Sub) card2Sub.textContent = 'Total unique mobile numbers reached';
      if (card2Box) card2Box.innerHTML = '<i data-lucide="smartphone" style="width:24px;height:24px;"></i>';

      if (card3Title) card3Title.textContent = 'Delivery Success Rate';
      if (card3Val) card3Val.textContent = deliveryPct;
      if (card3Sub) card3Sub.textContent = totalProcessed > 0 ? `${totalDelivered.toLocaleString()} delivered` : 'Verified delivery report ratio';
      if (card3Box) card3Box.innerHTML = '<i data-lucide="trending-up" style="width:24px;height:24px;"></i>';

      const domBal = Number(kpi.domestic_balance || 0);
      const intlBal = Number(kpi.intl_balance || 0);
      if (card4Title) card4Title.textContent = 'Total Available Wallet';
      if (card4Val) window.animateCountUp(card4Val, domBal);
      if (card4Sub) card4Sub.textContent = `Dom: ${domBal.toLocaleString()} · Intl: ${intlBal.toLocaleString()}`;
      if (card4Box) card4Box.innerHTML = '<i data-lucide="wallet" style="width:24px;height:24px;"></i>';
    }

    if (window.lucide) lucide.createIcons();

    // Render charts with atomic KPI values & ordered timeline campaigns
    renderDashboardCharts(reportData.timelineCampaigns || allCampaigns || [], kpi);
    renderRecentDashboardCampaigns(reportData.recentCampaigns || allCampaigns || []);

  } catch (err) {
    console.error('Failed to load atomic dashboard stats:', err);
  }
}

// Global Chart references to allow proper updating without destroy flicker
let volumeTrendChart = null;
let deliveryRatioChart = null;

function renderDashboardCharts(campaigns, kpi) {
  if (typeof Chart === 'undefined') return;

  const canvasTrend = document.getElementById('chart-volume-trend');
  const canvasRatio = document.getElementById('chart-delivery-ratio');
  if (!canvasTrend || !canvasRatio) return;

  // 1. DATA FOR TIMELINE TREND (Chronological left-to-right order)
  const safeList = Array.isArray(campaigns) ? campaigns : [];
  const labels = safeList.map(c => {
    if (!c.title) return `#${c.id}`;
    return c.title.length > 14 ? c.title.substring(0, 12) + '..' : c.title;
  });
  const volumes = safeList.map(c => Number(c.total_numbers || 0));

  const trendLabels = labels.length > 0 ? labels : ['No Campaigns Yet'];
  const trendData = volumes.length > 0 ? volumes : [0];

  if (volumeTrendChart) {
    volumeTrendChart.data.labels = trendLabels;
    volumeTrendChart.data.datasets[0].data = trendData;
    volumeTrendChart.update('none');
  } else {
    const ctxTrend = canvasTrend.getContext('2d');
    volumeTrendChart = new Chart(ctxTrend, {
      type: 'line',
      data: {
        labels: trendLabels,
        datasets: [{
          label: 'Dispatched Volume',
          data: trendData,
          borderColor: '#4f46e5',
          backgroundColor: 'rgba(79, 70, 229, 0.08)',
          borderWidth: 2.5,
          fill: true,
          tension: 0.35,
          pointBackgroundColor: '#4f46e5',
          pointRadius: 4,
          pointHoverRadius: 6
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: '#0f172a',
            titleFont: { size: 12, weight: 'bold' },
            bodyFont: { size: 12 },
            padding: 10,
            cornerRadius: 8,
            callbacks: {
              title: function(items) {
                const idx = items[0].dataIndex;
                const c = safeList[idx];
                return c ? `${c.title || 'Campaign #' + c.id}` : 'No Data';
              },
              label: function(item) {
                const idx = item.dataIndex;
                const c = safeList[idx];
                const st = c ? ` (${c.status})` : '';
                return `Recipients: ${item.formattedValue}${st}`;
              }
            }
          }
        },
        scales: {
          x: {
            grid: { display: false },
            ticks: { color: '#64748b', font: { size: 11 } }
          },
          y: {
            beginAtZero: true,
            grid: { color: '#f1f5f9' },
            ticks: { color: '#64748b', font: { size: 11 } }
          }
        }
      }
    });
  }

  // 2. DATA FOR DELIVERY RATIO DOUGHNUT
  // Uses exact PostgreSQL aggregated counts from kpi
  const delivered = Number(kpi?.total_delivered || 0);
  const failed = Number(kpi?.total_failed || 0);
  const pending = Number(kpi?.pending_recipients || 0);
  const rejected = Number(kpi?.rejected_recipients || 0);
  const activeVolume = delivered + failed + pending;
  const hasData = (activeVolume > 0 || rejected > 0);

  const chartData = hasData ? [delivered, pending, failed, rejected] : [1];
  const chartColors = hasData ? ['#10b981', '#3b82f6', '#ef4444', '#94a3b8'] : ['#e2e8f0'];
  const chartLabels = hasData ? ['Delivered', 'In Queue', 'Failed (Refunded)', 'Cancelled / Rejected'] : ['No message volume yet'];

  // Summary Pill below doughnut chart
  const summaryEl = document.getElementById('dash-delivery-ratio-summary');
  if (summaryEl) {
    if (hasData) {
      const processedTotal = delivered + failed;
      const delRate = processedTotal > 0 ? ((delivered / processedTotal) * 100).toFixed(1) + '%' : '—';
      summaryEl.innerHTML = `
        <span style="color:#10b981;font-weight:700;">● ${delivered.toLocaleString()} Delivered (${delRate})</span>
        <span style="color:#cbd5e1;margin:0 4px;">•</span>
        <span style="color:#3b82f6;font-weight:700;">● ${pending.toLocaleString()} Queue</span>
        <span style="color:#cbd5e1;margin:0 4px;">•</span>
        <span style="color:#ef4444;font-weight:700;">● ${failed.toLocaleString()} Failed</span>
        ${rejected > 0 ? `<span style="color:#cbd5e1;margin:0 4px;">•</span><span style="color:#64748b;">● ${rejected.toLocaleString()} Cancelled</span>` : ''}
      `;
    } else {
      summaryEl.innerHTML = `<span style="color:#94a3b8;font-weight:500;">No message volume recorded yet</span>`;
    }
  }

  if (deliveryRatioChart) {
    deliveryRatioChart.data.labels = chartLabels;
    deliveryRatioChart.data.datasets[0].data = chartData;
    deliveryRatioChart.data.datasets[0].backgroundColor = chartColors;
    deliveryRatioChart.options.plugins.tooltip.enabled = hasData;
    deliveryRatioChart.update('none');
  } else {
    const ctxRatio = canvasRatio.getContext('2d');
    deliveryRatioChart = new Chart(ctxRatio, {
      type: 'doughnut',
      data: {
        labels: chartLabels,
        datasets: [{
          data: chartData,
          backgroundColor: chartColors,
          borderWidth: 2,
          borderColor: '#ffffff',
          hoverOffset: hasData ? 4 : 0
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: '72%',
        plugins: {
          legend: {
            position: 'bottom',
            labels: {
              boxWidth: 12,
              padding: 10,
              font: { size: 11, weight: '500' },
              color: '#475569'
            }
          },
          tooltip: {
            enabled: hasData,
            backgroundColor: '#0f172a',
            padding: 10,
            cornerRadius: 8
          }
        }
      }
    });
  }
}

function getStatusBadge(status) {
  const map = {
    'Submitted': { class: 'badge-submitted', icon: 'clock', label: 'Submitted' },
    'Approved': { class: 'badge-approved', icon: 'check-circle-2', label: 'Approved' },
    'Completed': { class: 'badge-completed', icon: 'send', label: 'Completed' },
    'Report Updated': { class: 'badge-updated', icon: 'check-check', label: 'Delivered' },
    'Rejected': { class: 'badge-rejected', icon: 'x-circle', label: 'Rejected (Refunded)' }
  };
  const item = map[status] || { class: 'badge-submitted', icon: 'help-circle', label: status };
  return `<span class="status-badge ${item.class}"><i data-lucide="${item.icon}" style="width:13px;height:13px;"></i> ${item.label}</span>`;
}

function renderRecentDashboardCampaigns(campaigns) {
  const tbody = document.getElementById('dash-recent-tbody');
  const thOwner = document.getElementById('dash-th-owner');
  if (!tbody) return;

  const isManagement = currentUser && (currentUser.role === 'admin' || currentUser.role === 'reseller');
  if (thOwner) {
    thOwner.textContent = isManagement ? 'Account / Client' : 'Route / Channel';
  }

  const list = (campaigns && Array.isArray(campaigns) && campaigns.length > 0) ? campaigns : (allCampaigns || []);
  const recent = list.slice(0, 5);
  if (recent.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="6">
          <div class="empty-state-box" style="padding:28px 15px;">
            <div class="empty-state-icon"><i data-lucide="send" style="width:24px;height:24px;"></i></div>
            <div class="empty-state-title">No campaigns yet</div>
            <div class="empty-state-desc">${isManagement ? 'No client campaigns have been submitted yet.' : 'Launch your first campaign to reach your customers on WhatsApp!'}</div>
            ${!isManagement ? `
              <button type="button" class="btn-action btn-action-primary" onclick="switchView('view-new-campaign')">
                <i data-lucide="plus" style="width:13px;height:13px;"></i> Create Campaign
              </button>
            ` : ''}
          </div>
        </td>
      </tr>
    `;
    if (window.lucide) lucide.createIcons({ root: tbody });
    return;
  }

  tbody.innerHTML = recent.map(c => {
    const isPending = (c.status === 'Submitted' || c.status === 'Approved');
    const channelLabel = c.channel_type === 'own_number' ? 'Own SIM' : (c.campaign_type || 'normal');
    
    // Column 2 display
    let ownerDisplay = '';
    if (isManagement) {
      ownerDisplay = `
        <div style="font-weight:600;color:var(--slate-800);font-size:0.83rem;">${escapeHtml(c.owner_email || '—')}</div>
        <div style="font-size:0.73rem;color:var(--slate-500);">${escapeHtml(c.channel_type === 'sms' ? 'Direct SMS' : 'Direct WhatsApp')}</div>
      `;
    } else {
      ownerDisplay = `
        <div style="font-weight:600;color:var(--slate-800);font-size:0.83rem;">${escapeHtml(c.channel_type === 'sms' ? 'Direct GSM SMS' : 'Direct WhatsApp Gateway')}</div>
        <div style="font-size:0.73rem;color:var(--slate-500);">Ref: #${c.id}</div>
      `;
    }

    // Action buttons
    let actionButtons = `
      <button class="btn-action btn-action-secondary" onclick="openCampaignDetailModal(${c.id})" style="display:inline-flex;align-items:center;gap:4px;padding:4px 8px;font-size:0.78rem;" title="View Details">
        <i data-lucide="eye" style="width:13px;height:13px;"></i> Details
      </button>
    `;

    if (c.status === 'Report Updated') {
      actionButtons = `
        <button class="btn-action btn-action-success" onclick="downloadApiFile('/campaigns/${c.id}/export', 'campaign_${c.id}_report.csv')" style="display:inline-flex;align-items:center;gap:4px;padding:4px 8px;font-size:0.78rem;background:#10b981;color:#fff;border:none;" title="Download Delivery CSV Report">
          <i data-lucide="download" style="width:13px;height:13px;"></i> Report
        </button>
        ${actionButtons}
      `;
    }

    if (currentUser && currentUser.role === 'admin' && isPending) {
      actionButtons = `
        <button class="btn-action btn-action-primary" onclick="openOperatorDispatchModal()" style="display:inline-flex;align-items:center;gap:4px;padding:4px 8px;font-size:0.78rem;" title="Process in Operator Queue">
          <i data-lucide="send" style="width:13px;height:13px;"></i> Dispatch
        </button>
        ${actionButtons}
      `;
    }

    const dateFormatted = c.created_at
      ? new Date(c.created_at).toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true })
      : '—';

    return `
      <tr>
        <td>
          <a href="javascript:void(0)" onclick="openCampaignDetailModal(${c.id})" style="font-weight:700;color:var(--slate-800);text-decoration:none;font-size:0.88rem;">
            ${escapeHtml(c.title || 'Campaign #' + c.id)}
          </a>
          <div style="font-size:0.73rem;color:var(--slate-500);margin-top:2px;">ID: #${c.id} · ${dateFormatted}</div>
        </td>
        <td>${ownerDisplay}</td>
        <td>
          <span class="status-badge" style="background:#f1f5f9;color:#334155;font-size:0.75rem;font-weight:600;text-transform:uppercase;">
            ${c.destination === 'international' ? 'Intl' : 'Dom'} · ${channelLabel}
          </span>
        </td>
        <td><strong>${(c.total_numbers || 0).toLocaleString()}</strong></td>
        <td>${getStatusBadge(c.status)}</td>
        <td>
          <div style="display:flex;justify-content:flex-end;gap:6px;">
            ${actionButtons}
          </div>
        </td>
      </tr>
    `;
  }).join('');

  if (window.lucide) lucide.createIcons({ root: tbody });
}

// Campaign Filters & Multi-Dimensional State
campaignFilter = 'all';
let campaignUserFilter = 'all';
let campaignRouteFilter = 'all';
let campaignDateFilter = 'all';
let campaignCurrentPage = 1;
let campaignPageSize = 25;
window.currentFilteredCampaigns = [];

const statusTabs = document.querySelectorAll('#campaign-status-tabs .tab-pill');
statusTabs.forEach(tab => {
  tab.addEventListener('click', () => {
    statusTabs.forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    campaignFilter = tab.dataset.filter;
    campaignCurrentPage = 1;
    renderCampaignsTable();
  });
});

const campaignSearchInput = document.getElementById('campaign-search-input');
if (campaignSearchInput) {
  campaignSearchInput.addEventListener('input', () => {
    campaignCurrentPage = 1;
    renderCampaignsTable();
  });
}

const campaignFilterUser = document.getElementById('campaign-filter-user');
if (campaignFilterUser) {
  campaignFilterUser.addEventListener('change', (e) => {
    campaignUserFilter = e.target.value;
    campaignCurrentPage = 1;
    renderCampaignsTable();
  });
}

const campaignFilterRoute = document.getElementById('campaign-filter-route');
if (campaignFilterRoute) {
  campaignFilterRoute.addEventListener('change', (e) => {
    campaignRouteFilter = e.target.value;
    campaignCurrentPage = 1;
    renderCampaignsTable();
  });
}

const campaignFilterDate = document.getElementById('campaign-filter-date');
const campaignCustomDateContainer = document.getElementById('campaign-custom-date-container');
const campaignFromDate = document.getElementById('campaign-from-date');
const campaignToDate = document.getElementById('campaign-to-date');

if (campaignFilterDate) {
  campaignFilterDate.addEventListener('change', (e) => {
    campaignDateFilter = e.target.value;
    if (campaignCustomDateContainer) {
      campaignCustomDateContainer.style.display = (campaignDateFilter === 'custom') ? 'inline-flex' : 'none';
    }
    campaignCurrentPage = 1;
    renderCampaignsTable();
  });
}

if (campaignFromDate) {
  campaignFromDate.addEventListener('change', () => {
    campaignCurrentPage = 1;
    renderCampaignsTable();
  });
}
if (campaignToDate) {
  campaignToDate.addEventListener('change', () => {
    campaignCurrentPage = 1;
    renderCampaignsTable();
  });
}

const campaignsPerPage = document.getElementById('campaigns-per-page');
if (campaignsPerPage) {
  campaignsPerPage.addEventListener('change', (e) => {
    campaignPageSize = e.target.value;
    campaignCurrentPage = 1;
    renderCampaignsTable();
  });
}

const btnResetCampaignFilters = document.getElementById('btn-reset-campaign-filters');
if (btnResetCampaignFilters) {
  btnResetCampaignFilters.addEventListener('click', () => {
    campaignFilter = 'all';
    campaignUserFilter = 'all';
    campaignRouteFilter = 'all';
    campaignDateFilter = 'all';
    campaignCurrentPage = 1;

    statusTabs.forEach(t => t.classList.toggle('active', t.dataset.filter === 'all'));
    if (campaignFilterUser) campaignFilterUser.value = 'all';
    if (campaignFilterRoute) campaignFilterRoute.value = 'all';
    if (campaignFilterDate) campaignFilterDate.value = 'all';
    if (campaignCustomDateContainer) campaignCustomDateContainer.style.display = 'none';
    if (campaignFromDate) campaignFromDate.value = '';
    if (campaignToDate) campaignToDate.value = '';
    if (campaignSearchInput) campaignSearchInput.value = '';

    renderCampaignsTable();
  });
}

const btnExportFilteredCampaigns = document.getElementById('btn-export-filtered-campaigns');
if (btnExportFilteredCampaigns) {
  btnExportFilteredCampaigns.addEventListener('click', () => {
    exportFilteredCampaignsCsv();
  });
}

// ----------------------------------------------------
// CAMPAIGN SCHEDULE CALENDAR VIEW ENGINE
// ----------------------------------------------------
let campaignViewMode = 'table';
let calendarCurrentDate = new Date();

function switchCampaignViewMode(mode) {
  campaignViewMode = mode;
  const btnTable = document.getElementById('btn-view-mode-table');
  const btnCal = document.getElementById('btn-view-mode-calendar');
  const tableWrapper = document.getElementById('campaigns-table-view-card');
  const calWrapper = document.getElementById('campaigns-calendar-view-container');

  if (mode === 'calendar') {
    if (btnCal) {
      btnCal.style.background = '#2563eb';
      btnCal.style.color = '#ffffff';
    }
    if (btnTable) {
      btnTable.style.background = 'transparent';
      btnTable.style.color = 'var(--slate-600)';
    }
    if (tableWrapper) tableWrapper.style.display = 'none';
    if (calWrapper) calWrapper.style.display = 'block';
    renderCampaignCalendar();
  } else {
    if (btnTable) {
      btnTable.style.background = '#2563eb';
      btnTable.style.color = '#ffffff';
    }
    if (btnCal) {
      btnCal.style.background = 'transparent';
      btnCal.style.color = 'var(--slate-600)';
    }
    if (tableWrapper) tableWrapper.style.display = 'block';
    if (calWrapper) calWrapper.style.display = 'none';
  }
}

const btnViewModeTable = document.getElementById('btn-view-mode-table');
if (btnViewModeTable) {
  btnViewModeTable.addEventListener('click', () => switchCampaignViewMode('table'));
}
const btnViewModeCalendar = document.getElementById('btn-view-mode-calendar');
if (btnViewModeCalendar) {
  btnViewModeCalendar.addEventListener('click', () => switchCampaignViewMode('calendar'));
}

const btnCalPrev = document.getElementById('btn-calendar-prev');
if (btnCalPrev) {
  btnCalPrev.addEventListener('click', () => {
    calendarCurrentDate.setMonth(calendarCurrentDate.getMonth() - 1);
    renderCampaignCalendar();
  });
}
const btnCalToday = document.getElementById('btn-calendar-today');
if (btnCalToday) {
  btnCalToday.addEventListener('click', () => {
    calendarCurrentDate = new Date();
    renderCampaignCalendar();
  });
}
const btnCalNext = document.getElementById('btn-calendar-next');
if (btnCalNext) {
  btnCalNext.addEventListener('click', () => {
    calendarCurrentDate.setMonth(calendarCurrentDate.getMonth() + 1);
    renderCampaignCalendar();
  });
}

function renderCampaignCalendar() {
  const grid = document.getElementById('calendar-days-grid');
  const titleEl = document.getElementById('calendar-header-title');
  if (!grid) return;

  const year = calendarCurrentDate.getFullYear();
  const month = calendarCurrentDate.getMonth();

  if (titleEl) {
    titleEl.textContent = calendarCurrentDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  }

  // Active dataset respects all existing filters (User, Route, Status, Search)
  const campaignsList = window.currentFilteredCampaigns || allCampaigns || [];

  // Group campaigns by day key 'YYYY-MM-DD'
  const campaignsByDate = {};
  const now = new Date();

  campaignsList.forEach(c => {
    let dateObj = null;
    if (c.scheduled_at) {
      dateObj = new Date(c.scheduled_at);
    } else if (c.created_at) {
      dateObj = new Date(c.created_at);
    }
    if (!dateObj || isNaN(dateObj.getTime())) return;

    // Use local date string YYYY-MM-DD
    const y = dateObj.getFullYear();
    const m = String(dateObj.getMonth() + 1).padStart(2, '0');
    const d = String(dateObj.getDate()).padStart(2, '0');
    const key = `${y}-${m}-${d}`;

    if (!campaignsByDate[key]) campaignsByDate[key] = [];
    campaignsByDate[key].push(c);
  });

  // Calculate calendar grid days
  const firstDayIndex = new Date(year, month, 1).getDay(); // 0 is Sunday
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const prevMonthDays = new Date(year, month, 0).getDate();

  const today = new Date();
  const todayKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

  let cellsHtml = '';

  // 1. Previous Month leading cells
  for (let i = firstDayIndex - 1; i >= 0; i--) {
    const dayNum = prevMonthDays - i;
    const prevMonth = month === 0 ? 11 : month - 1;
    const prevYear = month === 0 ? year - 1 : year;
    const prevKey = `${prevYear}-${String(prevMonth + 1).padStart(2, '0')}-${String(dayNum).padStart(2, '0')}`;
    const dayCampaigns = campaignsByDate[prevKey] || [];

    cellsHtml += renderCalendarCell(dayNum, prevKey, dayCampaigns, true, false, now);
  }

  // 2. Current Month cells
  for (let day = 1; day <= daysInMonth; day++) {
    const key = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const dayCampaigns = campaignsByDate[key] || [];
    const isToday = (key === todayKey);

    cellsHtml += renderCalendarCell(day, key, dayCampaigns, false, isToday, now);
  }

  // 3. Next Month trailing cells to fill out 35 or 42 grid boxes
  const totalRendered = firstDayIndex + daysInMonth;
  const remainingCells = (totalRendered <= 35) ? (35 - totalRendered) : (42 - totalRendered);

  for (let nextDay = 1; nextDay <= remainingCells; nextDay++) {
    const nextMonth = month === 11 ? 0 : month + 1;
    const nextYear = month === 11 ? year + 1 : year;
    const nextKey = `${nextYear}-${String(nextMonth + 1).padStart(2, '0')}-${String(nextDay).padStart(2, '0')}`;
    const dayCampaigns = campaignsByDate[nextKey] || [];

    cellsHtml += renderCalendarCell(nextDay, nextKey, dayCampaigns, true, false, now);
  }

  grid.innerHTML = cellsHtml;
  if (window.lucide) lucide.createIcons({ root: grid });
}

function renderCalendarCell(dayNum, dateKey, dayCampaigns, isOtherMonth, isToday, now) {
  let chipsHtml = '';
  
  if (dayCampaigns.length > 0) {
    // Sort campaigns: Scheduled first, then by time
    dayCampaigns.sort((a, b) => {
      const timeA = new Date(a.scheduled_at || a.created_at).getTime();
      const timeB = new Date(b.scheduled_at || b.created_at).getTime();
      return timeA - timeB;
    });

    chipsHtml = dayCampaigns.map(c => {
      const isScheduledFuture = Boolean(c.scheduled_at && new Date(c.scheduled_at) > now && c.status === 'Submitted');
      const isUserCancelled = c.rejection_action === 'campaign_cancelled_by_user';
      
      let chipClass = 'calendar-chip-submitted';
      let iconName = 'clock';
      let statusLabel = c.status;

      if (isScheduledFuture) {
        chipClass = 'calendar-chip-scheduled';
        iconName = 'clock';
        statusLabel = 'Scheduled';
      } else if (c.status === 'Approved') {
        chipClass = 'calendar-chip-approved';
        iconName = 'check';
        statusLabel = 'In Queue';
      } else if (c.status === 'Completed') {
        chipClass = 'calendar-chip-completed';
        iconName = 'send';
        statusLabel = 'Dispatched';
      } else if (c.status === 'Report Updated') {
        chipClass = 'calendar-chip-reported';
        iconName = 'check-check';
        statusLabel = 'Delivered';
      } else if (c.status === 'Rejected') {
        chipClass = 'calendar-chip-rejected';
        iconName = isUserCancelled ? 'ban' : 'x';
        statusLabel = isUserCancelled ? 'Cancelled' : 'Rejected';
      }

      const campaignDate = new Date(c.scheduled_at || c.created_at);
      const timeStr = campaignDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: true });
      const audienceCount = (c.total_numbers || 0) >= 1000 
        ? `${((c.total_numbers || 0) / 1000).toFixed(1)}k` 
        : (c.total_numbers || 0);

      const titleText = escapeHtml(c.title || `Campaign #${c.id}`);
      const tooltip = `#${c.id}: ${titleText} • ${statusLabel} • ${audienceCount} numbers • ${timeStr} • Click for details`;

      return `
        <div class="calendar-chip ${chipClass}" onclick="openCampaignDetailModal(${c.id})" title="${tooltip}">
          <i data-lucide="${iconName}" style="width:11px;height:11px;flex-shrink:0;"></i>
          <span style="font-weight:700;margin-right:2px;">${timeStr}</span>
          <span style="overflow:hidden;text-overflow:ellipsis;">${titleText}</span>
          <span style="margin-left:auto;opacity:0.85;font-size:0.65rem;">(${audienceCount})</span>
        </div>
      `;
    }).join('');
  }

  const badgeCount = dayCampaigns.length > 0
    ? `<span style="font-size:0.68rem;font-weight:700;background:#e2e8f0;color:var(--slate-700);padding:1px 5px;border-radius:10px;">${dayCampaigns.length}</span>`
    : '';

  return `
    <div class="calendar-day-cell ${isOtherMonth ? 'other-month' : ''} ${isToday ? 'today' : ''}" data-date="${dateKey}">
      <div class="calendar-day-header">
        <span class="calendar-day-num">${dayNum}</span>
        ${badgeCount}
      </div>
      <div class="calendar-chips-list">
        ${chipsHtml}
      </div>
    </div>
  `;
}

window.populateCampaignUserFilter = function() {
  const select = document.getElementById('campaign-filter-user');
  if (!select) return;
  if (!currentUser || (currentUser.role !== 'admin' && currentUser.role !== 'reseller')) {
    select.style.display = 'none';
    return;
  }
  select.style.display = 'inline-block';
  const roleLabel = currentUser.role === 'admin' ? 'All Platform Users' : 'All My Clients';
  
  const emails = [...new Set(allCampaigns.map(c => c.owner_email).filter(Boolean))].sort();
  let html = `<option value="all">${roleLabel}</option>`;
  emails.forEach(email => {
    html += `<option value="${escapeHtml(email)}">${escapeHtml(email)}</option>`;
  });
  const prevVal = select.value;
  select.innerHTML = html;
  if (emails.includes(prevVal)) select.value = prevVal;
};

window.setCampaignPage = function(page) {
  campaignCurrentPage = page;
  renderCampaignsTable();
};

function renderActiveCampaignFilterChips() {
  const strip = document.getElementById('campaign-active-filters-strip');
  const chipsList = document.getElementById('campaign-filter-chips-list');
  if (!strip || !chipsList) return;

  const chips = [];
  if (campaignFilter !== 'all') {
    chips.push({
      label: `Status: ${campaignFilter}`,
      onRemove: () => {
        campaignFilter = 'all';
        statusTabs.forEach(t => t.classList.toggle('active', t.dataset.filter === 'all'));
        renderCampaignsTable();
      }
    });
  }
  if (campaignUserFilter !== 'all') {
    chips.push({
      label: `Client: ${campaignUserFilter}`,
      onRemove: () => {
        campaignUserFilter = 'all';
        if (campaignFilterUser) campaignFilterUser.value = 'all';
        renderCampaignsTable();
      }
    });
  }
  if (campaignRouteFilter !== 'all') {
    chips.push({
      label: `Route: ${campaignRouteFilter}`,
      onRemove: () => {
        campaignRouteFilter = 'all';
        if (campaignFilterRoute) campaignFilterRoute.value = 'all';
        renderCampaignsTable();
      }
    });
  }
  if (campaignDateFilter !== 'all') {
    chips.push({
      label: `Date: ${campaignDateFilter}`,
      onRemove: () => {
        campaignDateFilter = 'all';
        if (campaignFilterDate) campaignFilterDate.value = 'all';
        if (campaignCustomDateContainer) campaignCustomDateContainer.style.display = 'none';
        if (campaignFromDate) campaignFromDate.value = '';
        if (campaignToDate) campaignToDate.value = '';
        renderCampaignsTable();
      }
    });
  }
  const search = (campaignSearchInput ? campaignSearchInput.value : '').trim();
  if (search) {
    chips.push({
      label: `Search: "${search}"`,
      onRemove: () => {
        if (campaignSearchInput) campaignSearchInput.value = '';
        renderCampaignsTable();
      }
    });
  }

  if (chips.length === 0) {
    strip.style.display = 'none';
    chipsList.innerHTML = '';
  } else {
    strip.style.display = 'flex';
    chipsList.innerHTML = chips.map((c, idx) => `
      <span style="background:#e0f2fe;color:#0369a1;padding:2px 8px;border-radius:12px;font-weight:600;display:inline-flex;align-items:center;gap:4px;border:1px solid #bae6fd;">
        ${escapeHtml(c.label)}
        <button type="button" class="filter-chip-remove" data-index="${idx}" style="background:none;border:none;color:#0369a1;cursor:pointer;font-weight:800;padding:0;line-height:1;margin-left:2px;">&times;</button>
      </span>
    `).join('');

    chipsList.querySelectorAll('.filter-chip-remove').forEach(btn => {
      btn.onclick = (e) => {
        e.stopPropagation();
        const idx = parseInt(btn.dataset.index, 10);
        if (chips[idx]) chips[idx].onRemove();
      };
    });
  }
}

function renderCampaignsTable() {
  renderActiveCampaignFilterChips();
  const tbody = document.getElementById('campaigns-full-tbody');
  if (!tbody) return;

  const now = new Date();
  const search = (campaignSearchInput ? campaignSearchInput.value : '').toLowerCase().trim();
  const fromDateVal = campaignFromDate ? campaignFromDate.value : null;
  const toDateVal = campaignToDate ? campaignToDate.value : null;

  let filtered = allCampaigns.filter(c => {
    const isSms = c.channel_type === 'sms' || c.campaign_type === 'gsm_sms';
    if (campaignChannelScope === 'whatsapp' && isSms) return false;
    if (campaignChannelScope === 'sms' && !isSms) return false;

    // 1. Status Filter
    if (campaignFilter === 'Scheduled') {
      const isSched = Boolean(c.scheduled_at && new Date(c.scheduled_at) > now && c.status === 'Submitted');
      if (!isSched) return false;
    } else if (campaignFilter === 'Submitted') {
      const isSched = Boolean(c.scheduled_at && new Date(c.scheduled_at) > now);
      if (c.status !== 'Submitted' || isSched) return false;
    } else if (campaignFilter !== 'all') {
      if (c.status !== campaignFilter) return false;
    }

    // 2. User Filter (Admin & Reseller)
    if (campaignUserFilter !== 'all') {
      if (c.owner_email !== campaignUserFilter) return false;
    }

    // 3. Route / Channel Filter
    if (campaignRouteFilter === 'gsm_sms') {
      if (!isSms) return false;
    } else if (campaignRouteFilter === 'domestic') {
      if (c.destination !== 'domestic') return false;
    } else if (campaignRouteFilter === 'international') {
      if (c.destination !== 'international') return false;
    } else if (campaignRouteFilter !== 'all') {
      if (isSms) return false;
      if (c.campaign_type !== campaignRouteFilter && c.channel_type !== campaignRouteFilter) return false;
    }

    // 4. Date Filter
    if (campaignDateFilter !== 'all' && c.created_at) {
      const cDate = new Date(c.created_at);
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      if (campaignDateFilter === 'today') {
        if (cDate < today) return false;
      } else if (campaignDateFilter === 'yesterday') {
        const yesterday = new Date(today);
        yesterday.setDate(yesterday.getDate() - 1);
        if (cDate < yesterday || cDate >= today) return false;
      } else if (campaignDateFilter === 'last7') {
        const sevenDaysAgo = new Date(today);
        sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
        if (cDate < sevenDaysAgo) return false;
      } else if (campaignDateFilter === 'thisMonth') {
        const firstOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
        if (cDate < firstOfMonth) return false;
      } else if (campaignDateFilter === 'custom') {
        if (fromDateVal) {
          const fromD = new Date(fromDateVal);
          fromD.setHours(0, 0, 0, 0);
          if (cDate < fromD) return false;
        }
        if (toDateVal) {
          const toD = new Date(toDateVal);
          toD.setHours(23, 59, 59, 999);
          if (cDate > toD) return false;
        }
      }
    }

    // 5. Search Text (ID, Title, Text, Header, Owner)
    if (search) {
      const cleanSearch = search.replace(/^#/, '');
      const matchId = cleanSearch ? String(c.id).includes(cleanSearch) : false;
      const matchOwner = (c.owner_email || '').toLowerCase().includes(search);
      const matchTitle = (c.title || '').toLowerCase().includes(search);
      const matchText = (c.message_text || '').toLowerCase().includes(search);
      if (!matchId && !matchOwner && !matchTitle && !matchText) return false;
    }
    return true;
  });

  window.currentFilteredCampaigns = filtered;
  if (campaignViewMode === 'calendar') renderCampaignCalendar();

  const pageInfoEl = document.getElementById('campaigns-page-info');
  const pagesContainer = document.getElementById('campaigns-pagination-pages');

  if (filtered.length === 0) {
    const isSuperAdmin = currentUser && currentUser.role === 'admin';
    const emptyActionBtn = isSuperAdmin
      ? `<button type="button" class="btn-action btn-action-primary" onclick="openOperatorDispatchModal()">
          <i data-lucide="send" style="width:14px;height:14px;"></i> Open Operator Dispatch Queue
        </button>`
      : `<button type="button" class="btn-action btn-action-primary" onclick="switchView('view-new-campaign')">
          <i data-lucide="send" style="width:14px;height:14px;"></i> Create New Campaign
        </button>`;

    tbody.innerHTML = `
      <tr>
        <td colspan="8">
          <div class="empty-state-box">
            <div class="empty-state-icon"><i data-lucide="radio" style="width:24px;height:24px;"></i></div>
            <div class="empty-state-title">No matching campaigns found</div>
            <div class="empty-state-desc">There are no campaigns matching your selected filters, dates, or search criteria.</div>
            ${emptyActionBtn}
          </div>
        </td>
      </tr>
    `;
    if (pageInfoEl) pageInfoEl.textContent = 'Showing 0 campaigns';
    if (pagesContainer) pagesContainer.innerHTML = '';
    if (window.lucide) lucide.createIcons({ root: tbody });
    return;
  }

  // Handle Pagination
  const totalCount = filtered.length;
  let paged = filtered;

  if (campaignPageSize !== 'all') {
    const size = parseInt(campaignPageSize, 10);
    const totalPages = Math.ceil(totalCount / size) || 1;
    if (campaignCurrentPage > totalPages) campaignCurrentPage = totalPages;
    if (campaignCurrentPage < 1) campaignCurrentPage = 1;

    const startIdx = (campaignCurrentPage - 1) * size;
    paged = filtered.slice(startIdx, startIdx + size);

    if (pageInfoEl) {
      const endIdx = Math.min(startIdx + paged.length, totalCount);
      pageInfoEl.textContent = `Showing ${startIdx + 1}–${endIdx} of ${totalCount} campaigns`;
    }

    if (pagesContainer) {
      let pageBtns = '';
      if (totalPages > 1) {
        pageBtns += `<button type="button" class="btn-action btn-action-secondary" ${campaignCurrentPage === 1 ? 'disabled style="opacity:0.4;cursor:not-allowed;"' : 'onclick="setCampaignPage(' + (campaignCurrentPage - 1) + ')"'} style="padding:4px 8px;font-size:0.75rem;">Prev</button>`;
        for (let p = 1; p <= totalPages; p++) {
          if (p === 1 || p === totalPages || (p >= campaignCurrentPage - 1 && p <= campaignCurrentPage + 1)) {
            const activeStyle = p === campaignCurrentPage ? 'background:var(--primary);color:#fff;font-weight:700;border-color:var(--primary);' : '';
            pageBtns += `<button type="button" class="btn-action btn-action-secondary" onclick="setCampaignPage(${p})" style="padding:4px 9px;font-size:0.75rem;min-width:28px;${activeStyle}">${p}</button>`;
          } else if (p === campaignCurrentPage - 2 || p === campaignCurrentPage + 2) {
            pageBtns += `<span style="padding:0 3px;color:var(--slate-400);font-size:0.75rem;">...</span>`;
          }
        }
        pageBtns += `<button type="button" class="btn-action btn-action-secondary" ${campaignCurrentPage === totalPages ? 'disabled style="opacity:0.4;cursor:not-allowed;"' : 'onclick="setCampaignPage(' + (campaignCurrentPage + 1) + ')"'} style="padding:4px 8px;font-size:0.75rem;">Next</button>`;
      }
      pagesContainer.innerHTML = pageBtns;
    }
  } else {
    if (pageInfoEl) pageInfoEl.textContent = `Showing all ${totalCount} campaigns`;
    if (pagesContainer) pagesContainer.innerHTML = '';
  }

  const isAdmin = currentUser && currentUser.role === 'admin';
  const isReseller = currentUser && currentUser.role === 'reseller';

  tbody.innerHTML = paged.map(c => {
    const isScheduledFuture = Boolean(c.scheduled_at && new Date(c.scheduled_at) > now);
    const schedDateFormatted = isScheduledFuture
      ? new Date(c.scheduled_at).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: true })
      : '';

    const isUserCancelled = c.rejection_action === 'campaign_cancelled_by_user';

    let progressHTML = `<span style="font-size:0.75rem;color:var(--slate-400);">Pending Dispatch</span>`;
    if (isScheduledFuture && c.status === 'Submitted') {
      progressHTML = `<span style="font-size:0.75rem;color:#b45309;font-weight:600;display:inline-flex;align-items:center;gap:4px;"><i data-lucide="clock" style="width:12px;height:12px;"></i> Auto-dispatches at ${schedDateFormatted}</span>`;
    } else if (c.status === 'Report Updated' || ((c.delivered_count > 0 || c.failed_count > 0) && c.status !== 'Rejected')) {
      const delivered = c.delivered_count || 0;
      const failed = c.failed_count || 0;
      const total = delivered + failed;
      const delPct = total > 0 ? Math.round((delivered / total) * 100) : 100;
      const failPct = 100 - delPct;
      progressHTML = `
        <div class="dual-progress-container">
          <div class="dual-progress-bar">
            <div class="dual-progress-delivered" style="width:${delPct}%;"></div>
            <div class="dual-progress-failed" style="width:${failPct}%;"></div>
          </div>
          <div class="dual-progress-labels">
            <span style="color:#059669;font-weight:700;">${delivered.toLocaleString()} delivered (${delPct}%)</span>
            <span style="color:${failed > 0 ? '#dc2626' : 'var(--slate-400)'};">${failed > 0 ? `${failed.toLocaleString()} failed` : ''}</span>
          </div>
        </div>
      `;
    } else if (c.status === 'Completed') {
      progressHTML = `<span class="status-badge" style="background:#e0f2fe;color:#0284c7;border:1px solid #bae6fd;font-size:0.75rem;"><i data-lucide="send" style="width:12px;height:12px;"></i> Dispatched • Awaiting DLR</span>`;
    } else if (c.status === 'Approved') {
      progressHTML = `<span class="status-badge badge-approved" style="font-size:0.75rem;"><i data-lucide="check-circle" style="width:12px;height:12px;"></i> In Dispatch Queue</span>`;
    } else if (c.status === 'Rejected') {
      if (isUserCancelled) {
        progressHTML = `<span class="status-badge" style="background:#f1f5f9;color:#475569;border:1px solid #cbd5e1;font-size:0.75rem;"><i data-lucide="ban" style="width:12px;height:12px;"></i> Cancelled by You</span>`;
      } else {
        progressHTML = `<span class="status-badge badge-rejected" style="font-size:0.75rem;"><i data-lucide="x-circle" style="width:12px;height:12px;"></i> Rejected by Compliance</span>`;
      }
    }

    let actionsHTML = '';
    const exportTxtBtn = `<button type="button" onclick="downloadCampaignNumbers(${c.id}, 'txt')" class="btn-action btn-action-secondary" title="Export Numbers (.TXT)" style="display:inline-flex;align-items:center;gap:4px;padding:4px 8px;font-size:0.75rem;"><i data-lucide="download" style="width:12px;height:12px;"></i> Export</button>`;
    const downloadReportCsvBtn = `<button type="button" class="btn-action btn-action-success" onclick="downloadApiFile('/campaigns/${c.id}/export', 'campaign_${c.id}_delivery_report.csv')" title="Download Delivery Report CSV" style="display:inline-flex;align-items:center;gap:4px;padding:4px 8px;font-size:0.75rem;background:#10b981;color:#fff;border:none;"><i data-lucide="download" style="width:12px;height:12px;"></i> Report</button>`;

    if (isAdmin) {
      if (c.status === 'Submitted') {
        actionsHTML = `
          ${exportTxtBtn}
          <button class="btn-action btn-action-success" onclick="updateCampaignStatus(${c.id}, 'Approved')" style="display:inline-flex;align-items:center;gap:4px;padding:4px 8px;font-size:0.75rem;"><i data-lucide="check" style="width:12px;height:12px;"></i> Approve</button>
          <button class="btn-action btn-action-danger" onclick="updateCampaignStatus(${c.id}, 'Rejected')" style="display:inline-flex;align-items:center;gap:4px;padding:4px 8px;font-size:0.75rem;"><i data-lucide="x" style="width:12px;height:12px;"></i> Reject</button>
        `;
      } else if (c.status === 'Approved') {
        actionsHTML = `
          ${exportTxtBtn}
          <button class="btn-action btn-action-primary" onclick="updateCampaignStatus(${c.id}, 'Completed')" style="display:inline-flex;align-items:center;gap:4px;padding:4px 8px;font-size:0.75rem;"><i data-lucide="send" style="width:12px;height:12px;"></i> Mark Sent</button>
        `;
      } else if (c.status === 'Completed') {
        const uploadReportBtn = !c.report_processed_at
          ? `<button class="btn-action btn-action-primary" onclick="openReportModal(${c.id})" title="Upload Delivery Report" style="display:inline-flex;align-items:center;gap:4px;padding:4px 8px;font-size:0.75rem;background:#059669;"><i data-lucide="file-bar-chart" style="width:12px;height:12px;"></i> Upload Report</button>`
          : '';
        actionsHTML = `
          ${exportTxtBtn}
          ${uploadReportBtn}
        `;
      } else if (c.status === 'Report Updated') {
        actionsHTML = downloadReportCsvBtn;
      } else if (c.status === 'Rejected') {
        actionsHTML = `<span style="font-size:0.75rem;color:${isUserCancelled ? '#475569' : '#dc2626'};font-weight:600;">${isUserCancelled ? 'Cancelled' : 'Refunded'}</span>`;
      }
    } else if (isReseller) {
      if (c.status === 'Submitted') {
        actionsHTML = `
          ${exportTxtBtn}
          <button class="btn-action btn-action-success" onclick="updateCampaignStatus(${c.id}, 'Approved')" style="display:inline-flex;align-items:center;gap:4px;padding:4px 8px;font-size:0.75rem;"><i data-lucide="check" style="width:12px;height:12px;"></i> Approve</button>
          <button class="btn-action btn-action-danger" onclick="updateCampaignStatus(${c.id}, 'Rejected')" style="display:inline-flex;align-items:center;gap:4px;padding:4px 8px;font-size:0.75rem;"><i data-lucide="x" style="width:12px;height:12px;"></i> Reject</button>
        `;
      } else if (c.status === 'Approved') {
        actionsHTML = `
          ${exportTxtBtn}
          <button class="btn-action btn-action-primary" onclick="updateCampaignStatus(${c.id}, 'Completed')" style="display:inline-flex;align-items:center;gap:4px;padding:4px 8px;font-size:0.75rem;"><i data-lucide="send" style="width:12px;height:12px;"></i> Mark Sent</button>
        `;
      } else if (c.status === 'Completed') {
        actionsHTML = `
          ${exportTxtBtn}
          <span style="font-size:0.75rem;color:#0284c7;font-weight:600;display:inline-flex;align-items:center;gap:3px;"><i data-lucide="send" style="width:12px;height:12px;"></i> Sent</span>
        `;
      } else if (c.status === 'Report Updated') {
        actionsHTML = downloadReportCsvBtn;
      } else if (c.status === 'Rejected') {
        actionsHTML = `<span style="font-size:0.75rem;color:${isUserCancelled ? '#475569' : '#dc2626'};font-weight:600;">${isUserCancelled ? 'Cancelled' : 'Refunded'}</span>`;
      }
    } else {
      if (c.status === 'Submitted') {
        actionsHTML = `
          ${exportTxtBtn}
          <button class="btn-action btn-action-danger" onclick="cancelCampaign(${c.id})" title="Cancel this pending campaign & refund credits" style="display:inline-flex;align-items:center;gap:4px;padding:4px 10px;font-size:0.78rem;">
            <i data-lucide="x-circle" style="width:13px;height:13px;"></i> Cancel
          </button>
        `;
      } else if (c.status === 'Report Updated') {
        actionsHTML = downloadReportCsvBtn;
      } else if (c.status === 'Approved') {
        actionsHTML = `
          ${exportTxtBtn}
          <span style="font-size:0.78rem;color:#0284c7;font-weight:600;display:inline-flex;align-items:center;gap:4px;"><i data-lucide="clock" style="width:12px;height:12px;"></i> Queued</span>
        `;
      } else if (c.status === 'Completed') {
        actionsHTML = `
          ${exportTxtBtn}
          <span style="font-size:0.78rem;color:#0284c7;font-weight:600;display:inline-flex;align-items:center;gap:4px;"><i data-lucide="send" style="width:12px;height:12px;"></i> Sent</span>
        `;
      } else if (c.status === 'Rejected') {
        actionsHTML = `<span style="font-size:0.78rem;color:${isUserCancelled ? '#475569' : '#dc2626'};font-weight:600;display:inline-flex;align-items:center;gap:4px;"><i data-lucide="x-circle" style="width:12px;height:12px;"></i> ${isUserCancelled ? 'Cancelled' : 'Refunded'}</span>`;
      }
    }

    const dateFormatted = c.created_at
      ? new Date(c.created_at).toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true })
      : '—';

    let statusBadgeHTML = getStatusBadge(c.status);
    if (isScheduledFuture && c.status === 'Submitted') {
      statusBadgeHTML = `<span class="status-badge" style="background:#fef3c7;color:#b45309;border:1px solid #fde68a;font-size:0.75rem;display:inline-flex;align-items:center;gap:4px;"><i data-lucide="calendar" style="width:12px;height:12px;"></i> Scheduled</span>`;
    } else if (c.status === 'Rejected') {
      if (isUserCancelled) {
        statusBadgeHTML = `<span class="status-badge" style="background:#f1f5f9;color:#475569;border:1px solid #cbd5e1;font-size:0.75rem;"><i data-lucide="ban" style="width:12px;height:12px;"></i> Cancelled</span>`;
      } else {
        statusBadgeHTML = `<span class="status-badge badge-rejected" style="font-size:0.75rem;"><i data-lucide="x-circle" style="width:12px;height:12px;"></i> Rejected</span>`;
      }
    }

    const isSmsCamp = c.channel_type === 'sms' || c.campaign_type === 'gsm_sms';
    const channelBadgeHtml = isSmsCamp ? `
      <div>
        <span style="background:#eff6ff;color:#1d4ed8;padding:2px 8px;border-radius:12px;font-size:0.72rem;font-weight:700;border:1px solid #bfdbfe;display:inline-flex;align-items:center;gap:3px;">
          <i data-lucide="radio" style="width:11px;height:11px;"></i> GSM Bulk SMS
        </span>
      </div>
      <div style="font-size:0.72rem;font-weight:600;color:var(--slate-500);text-transform:uppercase;margin-top:2px;">
        CELLULAR · ${c.destination === 'international' ? 'INTL' : 'DOM'}
      </div>
    ` : `
      <div>
        <span style="background:#ecfdf5;color:#15803d;padding:2px 8px;border-radius:12px;font-size:0.72rem;font-weight:700;border:1px solid #bbf7d0;display:inline-flex;align-items:center;gap:3px;">
          <i data-lucide="message-circle" style="width:11px;height:11px;"></i> WhatsApp
        </span>
      </div>
      <div style="font-size:0.72rem;font-weight:600;color:var(--slate-500);text-transform:uppercase;margin-top:2px;">
        ${escapeHtml(c.channel_type === 'own_number' ? 'Own SIM' : (c.campaign_type || 'normal'))} · ${c.destination === 'international' ? 'INTL' : 'DOM'}
      </div>
    `;

    return `
      <tr>
        <td>
          <a href="javascript:void(0)" onclick="openCampaignDetailModal(${c.id})" style="font-weight:700;color:var(--slate-800);text-decoration:none;font-size:0.88rem;">
            ${escapeHtml(c.title || 'Campaign #' + c.id)}
          </a>
          <div style="font-size:0.73rem;color:var(--slate-500);margin-top:2px;">ID: #${c.id} · ${dateFormatted}</div>
        </td>
        <td>
          <div style="font-weight:600;color:var(--slate-800);font-size:0.82rem;">${escapeHtml(c.owner_email || '—')}</div>
        </td>
        <td>
          ${channelBadgeHtml}
        </td>
        <td>
          <div style="max-width:340px;min-width:220px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:6px;padding:6px 10px;margin-top:2px;">
            <div id="camp-msg-preview-${c.id}" style="font-size:0.8rem;color:#334155;line-height:1.45;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;word-break:break-word;white-space:pre-wrap;">${escapeHtml(c.message_text || '—')}</div>
            <div style="display:flex;align-items:center;gap:8px;margin-top:5px;padding-top:4px;border-top:1px dashed #e2e8f0;font-size:0.72rem;">
              ${c.message_text && c.message_text.length > 50 ? `
                <button type="button" onclick="window.toggleMessageExpand(event, ${c.id})" id="camp-msg-btn-${c.id}" style="border:none;background:none;padding:0;font-size:0.72rem;color:#4f46e5;font-weight:700;cursor:pointer;display:inline-flex;align-items:center;gap:2px;">
                  <span>Show More ▼</span>
                </button>
                <span style="color:#cbd5e1;">•</span>
              ` : ''}
              <button type="button" onclick="openCampaignDetailModal(${c.id})" style="border:none;background:none;padding:0;font-size:0.72rem;color:#0284c7;font-weight:600;cursor:pointer;display:inline-flex;align-items:center;gap:3px;" title="View full campaign details">
                <i data-lucide="eye" style="width:11px;height:11px;"></i> Full Details
              </button>
            </div>
          </div>
          ${(() => {
            let attCount = 0;
            if (Array.isArray(c.attachments)) attCount = c.attachments.length;
            else if (typeof c.attachments === 'string') {
              try { attCount = JSON.parse(c.attachments).length; } catch(e) {}
            }
            if (attCount > 0) {
              return `<span style="font-size:0.73rem;display:inline-flex;align-items:center;gap:3px;margin-top:4px;color:#16a34a;font-weight:700;"><i data-lucide="paperclip" style="width:11px;height:11px;"></i> ${attCount} File${attCount > 1 ? 's' : ''} Attached</span>`;
            } else if (c.attachment_url) {
              return `<button type="button" class="btn-action btn-action-secondary" data-asset-url="${escapeHtml(c.attachment_url)}" onclick="viewOrDownloadCampaignAsset(this.dataset.assetUrl)" style="font-size:0.73rem;display:inline-flex;align-items:center;gap:3px;margin-top:4px;color:var(--primary);background:none;border:none;cursor:pointer;padding:0;"><i data-lucide="paperclip" style="width:11px;height:11px;"></i> View Media</button>`;
            }
            return '';
          })()}
        </td>
        <td><strong>${(c.total_numbers || 0).toLocaleString()}</strong></td>
        <td>${progressHTML}</td>
        <td>${statusBadgeHTML}</td>
        <td>
          <div style="display:flex;gap:6px;align-items:center;">
            ${actionsHTML}
            <button class="btn-action btn-action-secondary" onclick="openCampaignDetailModal(${c.id})" title="View Details" style="display:inline-flex;align-items:center;justify-content:center;padding:5px 8px;">
              <i data-lucide="eye" style="width:13px;height:13px;"></i>
            </button>
          </div>
        </td>
      </tr>
    `;
  }).join('');

  if (window.lucide) lucide.createIcons({ root: tbody });
}

window.toggleMessageExpand = function(event, id) {
  if (event) event.stopPropagation();
  const el = document.getElementById(`camp-msg-preview-${id}`);
  const btn = document.getElementById(`camp-msg-btn-${id}`);
  if (!el || !btn) return;
  const isExpanded = el.dataset.expanded === 'true';
  if (isExpanded) {
    el.style.display = '-webkit-box';
    el.style.webkitLineClamp = '2';
    el.dataset.expanded = 'false';
    btn.innerHTML = '<span>Show More ▼</span>';
  } else {
    el.style.display = 'block';
    el.style.webkitLineClamp = 'unset';
    el.dataset.expanded = 'true';
    btn.innerHTML = '<span>Show Less ▲</span>';
  }
};

window.exportFilteredCampaignsCsv = function() {
  const rows = window.currentFilteredCampaigns || allCampaigns || [];
  if (rows.length === 0) {
    showToast('warning', 'No Campaigns', 'There are no campaigns matching current filters to export.');
    return;
  }

  let csv = 'Campaign ID,Title,User / Client Email,Route,Destination,Total Numbers,Delivered,Failed,Delivery %,Status,Scheduled Time,Created Date\n';
  rows.forEach(c => {
    const id = c.id;
    const title = `"${(c.title || 'Untitled').replace(/"/g, '""')}"`;
    const email = `"${(c.owner_email || '').replace(/"/g, '""')}"`;
    const route = c.campaign_type || 'normal';
    const dest = c.destination || 'domestic';
    const total = c.total_numbers || 0;
    const delivered = c.delivered_count || 0;
    const failed = c.failed_count || 0;
    const rate = total > 0 ? `${Math.round((delivered / total) * 100)}%` : '0%';
    const status = c.status || '';
    const sched = c.scheduled_at ? `"${new Date(c.scheduled_at).toLocaleString('en-IN')}"` : 'Immediate';
    const created = c.created_at ? `"${new Date(c.created_at).toLocaleString('en-IN')}"` : '';

    csv += `${id},${title},${email},${route},${dest},${total},${delivered},${failed},${rate},${status},${sched},${created}\n`;
  });

  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `MessageSphere_Filtered_Campaigns_${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  showToast('success', 'Export Complete', `Exported ${rows.length} filtered campaign(s) to CSV.`);
};

// Campaign Status Action with Modern SaaS Confirmation Dialog
window.updateCampaignStatus = function(campaignId, status) {
  let title = `Update Campaign #${campaignId}`;
  let message = `Are you sure you want to mark this campaign as "${status}"?`;
  let confirmText = `Mark as ${status}`;
  let confirmClass = 'btn-action-primary';
  let icon = 'check-circle';
  let iconColor = '#059669';
  let iconBg = '#dcfce7';
  let defaultReason = `Campaign ${status.toLowerCase()} by operator`;

  if (status === 'Approved') {
    title = `Approve Campaign #${campaignId}`;
    message = 'Approve this campaign and queue it for offline physical gateway / SIM batch dispatch.';
    defaultReason = 'Approved for physical gateway dispatch';
    confirmText = 'Approve Campaign';
    confirmClass = 'btn-action-success';
    icon = 'check';
  } else if (status === 'Rejected') {
    title = `Reject Campaign #${campaignId}`;
    message = 'Reject this campaign. All debited credits will be 100% refunded to the customer wallet immediately.';
    defaultReason = 'Rejected: Content policy compliance check';
    confirmText = 'Reject & Refund Credits';
    confirmClass = 'btn-action-danger';
    icon = 'ban';
    iconColor = '#dc2626';
    iconBg = '#fee2e2';
  } else if (status === 'Completed') {
    title = `Confirm Dispatch Complete #${campaignId}`;
    message = 'Confirm physical SIM/gateway dispatch has completed. This unlocks delivery report upload.';
    defaultReason = 'Dispatched via physical gateway batch';
    confirmText = 'Mark Dispatched';
    confirmClass = 'btn-action-primary';
    icon = 'send';
    iconColor = '#2563eb';
    iconBg = '#dbeafe';
  }

  window.openActionDialog({
    title,
    message,
    icon,
    iconColor,
    iconBg,
    confirmText,
    confirmClass,
    showInput: true,
    inputLabel: 'Reason / Operations Log Note',
    inputValue: defaultReason,
    showRef: true,
    refPlaceholder: 'External dispatch reference (optional)',
    onConfirm: async ({ input: reason, reference: external_reference }) => {
      try {
        const res = await apiFetch(`/campaigns/${campaignId}/status`, {
          method: 'PATCH',
          body: JSON.stringify({ status, reason, external_reference })
        });
        showToast('success', 'Status Updated', res.message || `Campaign #${campaignId} is now ${status}`);
        const updatedUser = await apiFetch('/auth/me');
        currentUser = updatedUser;
        updateCreditDisplays();
        loadCampaigns();
      } catch (err) {
        showToast('error', 'Update Failed', err.message);
      }
    }
  });
};

window.cancelCampaign = function(campaignId) {
  window.openActionDialog({
    title: `Cancel Campaign #${campaignId}`,
    message: `Are you sure you want to cancel Campaign #${campaignId}? Your campaign will be stopped and 100% of your credits will be refunded to your wallet immediately.`,
    icon: 'x-circle',
    iconColor: '#dc2626',
    iconBg: '#fee2e2',
    confirmText: 'Yes, Cancel & Refund',
    confirmClass: 'btn-action-danger',
    onConfirm: async () => {
      try {
        const res = await apiFetch(`/campaigns/${campaignId}/cancel`, { method: 'POST' });
        showToast('success', 'Campaign Cancelled', res.message || 'Credits refunded to your wallet.');
        loadCampaigns();
        const me = await apiFetch('/auth/me');
        currentUser = me;
        updateCreditDisplays();
      } catch (err) {
        showToast('error', 'Cancellation Failed', err.message);
      }
    }
  });
};

// --- CAMPAIGN DETAIL MODAL ---
const modalCampaignDetail = document.getElementById('modal-campaign-detail');
const detailCampTitle = document.getElementById('detail-camp-title');
const detailCampSub = document.getElementById('detail-camp-sub');
const detailCampText = document.getElementById('detail-camp-text');
const detailCountTotal = document.getElementById('detail-count-total');
const detailCountDelivered = document.getElementById('detail-count-delivered');
const detailCountFailed = document.getElementById('detail-count-failed');
const detailRecipientsTbody = document.getElementById('detail-recipients-tbody');
const btnDetailDownloadCsv = document.getElementById('btn-detail-download-csv');
const detailCampaignNotesSection = document.getElementById('detail-camp-notes-section');
const detailCampaignNotesList = document.getElementById('detail-camp-notes-list');
const detailCampaignNoteInput = document.getElementById('detail-camp-note-input');
const detailCampaignNoteReference = document.getElementById('detail-camp-note-reference');
const btnAddCampaignNote = document.getElementById('btn-add-campaign-note');

async function loadCampaignNotes(campaignId) {
  if (!detailCampaignNotesSection || !detailCampaignNotesList) return;
  if (!currentUser || (currentUser.role !== 'admin' && currentUser.role !== 'reseller')) {
    detailCampaignNotesSection.style.display = 'none';
    return;
  }
  detailCampaignNotesSection.style.display = 'block';
  try {
    const notes = await apiFetch(`/campaigns/${campaignId}/notes`);
    detailCampaignNotesList.innerHTML = notes.length 
      ? notes.map(note => `<div style="padding:7px 0;border-bottom:1px solid #fde68a;"><strong>${escapeHtml(note.author_email || 'Operator')}</strong> · ${new Date(note.created_at).toLocaleString()}<br>${escapeHtml(note.note)}${note.external_reference ? `<br><span style="color:#92400e;">Ref: ${escapeHtml(note.external_reference)}</span>` : ''}</div>`).join('') 
      : '<span style="color:var(--slate-500);">No manual notes yet.</span>';
  } catch (err) {
    detailCampaignNotesList.innerHTML = `<span style="color:#ef4444;">Failed to load notes: ${escapeHtml(err.message)}</span>`;
  }
}

window.downloadCampaignNumbers = async function(campaignId, format) {
  try {
    await downloadApiFile(`/campaigns/${campaignId}/export-numbers?format=${encodeURIComponent(format)}`, `campaign_${campaignId}_numbers.${format}`);
  } catch (err) {
    showToast('error', 'Export Failed', err.message);
  }
};

window.duplicateCampaign = async function(c) {
  if (!c) return;

  if (modalCampaignDetail) modalCampaignDetail.style.display = 'none';
  switchView('view-new-campaign');

  // Handle Proxy Beneficiary Account Selection (Super Admin & Reseller)
  if (currentUser && (currentUser.role === 'admin' || currentUser.role === 'reseller')) {
    await setupComposerTargetSelector();
    const targetSelect = document.getElementById('composer-target-user');
    if (targetSelect && c.user_id) {
      targetSelect.value = String(c.user_id);
      targetSelect.dispatchEvent(new Event('change'));
    }
  }

  // Show Cloned Notice
  const clonedNotice = document.getElementById('composer-cloned-notice');
  const clonedText = document.getElementById('composer-cloned-text');
  const hasMedia = Boolean(c.attachment_url || (Array.isArray(c.attachments) && c.attachments.length > 0));
  if (clonedNotice) {
    clonedNotice.style.display = 'flex';
    if (clonedText) {
      clonedText.textContent = hasMedia 
        ? `Settings & message cloned from Campaign #${c.id}. Please re-attach your fresh media asset if needed.`
        : `Settings & message cloned from Campaign #${c.id}. Add new recipient numbers to launch.`;
    }
  }

  // 1. Set Title with (Copy) suffix
  if (composerTitle) {
    composerTitle.value = `${c.title || 'Campaign'} (Copy)`;
  }

  // 2. Set Destination (Domestic vs International)
  if (c.destination === 'international') {
    if (destOptionIntl) destOptionIntl.click();
  } else {
    if (destOptionDomestic) destOptionDomestic.click();
  }

  // 3. Set Channel / Campaign Type
  const targetType = c.channel_type === 'own_number' ? 'own_number' : (c.campaign_type || 'normal');
  setCampaignType(targetType);

  // 4. Set Message Text & trigger character count calculation
  if (composerText) {
    composerText.value = c.message_text || '';
    composerText.dispatchEvent(new Event('input'));
  }

  // 6. Set CTA Interactive Buttons
  if (c.cta_data) {
    let cta = null;
    try {
      cta = typeof c.cta_data === 'string' ? JSON.parse(c.cta_data) : c.cta_data;
    } catch (e) {
      console.warn('Failed to parse cta_data on duplicate:', e);
    }
    if (cta) {
      if (ctaCallText && cta.callText) ctaCallText.value = cta.callText;
      if (ctaCallNumber && cta.callNumber) ctaCallNumber.value = cta.callNumber;
      if (ctaUrlText && cta.urlText) ctaUrlText.value = cta.urlText;
      if (ctaUrlLink && cta.urlLink) ctaUrlLink.value = cta.urlLink;
      if (composerCtaToggle) {
        composerCtaToggle.checked = true;
        if (composerCtaBox) composerCtaBox.style.display = 'block';
        if (typeof updateCtaPreview === 'function') updateCtaPreview();
      }
    }
  }

  // Clear recipients so user enters a fresh target list
  if (composerNumbers) {
    composerNumbers.value = '';
    composerNumbers.dispatchEvent(new Event('input'));
  }

  if (typeof updateCostCalculator === 'function') updateCostCalculator();
  if (typeof updatePreviewMedia === 'function') updatePreviewMedia();

  window.scrollTo({ top: 0, behavior: 'smooth' });
  showToast('success', 'Campaign Cloned', `Settings for "${c.title || 'Campaign'}" loaded into composer. Add new recipient numbers to launch.`);
};

window.openCampaignDetailModal = async function(campaignId) {
  currentDetailCampaignId = campaignId;
  modalCampaignDetail.style.display = 'flex';
  detailCampTitle.textContent = `Loading Campaign #${campaignId}...`;
  detailRecipientsTbody.innerHTML = `<tr><td colspan="3" style="text-align:center;padding:15px;color:var(--slate-400);">Loading recipients...</td></tr>`;

  try {
    const data = await apiFetch(`/campaigns/${campaignId}`);
    const c = data.campaign;
    detailCampTitle.textContent = c.title || `Campaign #${c.id}`;
    detailCampSub.textContent = `ID: #${c.id} • Created: ${new Date(c.created_at).toLocaleString()} • Owner: ${c.owner_email}`;
    detailCampText.textContent = c.message_text;

    // Display Configured CTA Buttons in Detail Modal
    const ctaSection = document.getElementById('detail-camp-cta-section');
    const ctaBtns = document.getElementById('detail-camp-cta-buttons');
    if (ctaSection && ctaBtns) {
      let cta = null;
      if (c.cta_data) {
        try { cta = typeof c.cta_data === 'string' ? JSON.parse(c.cta_data) : c.cta_data; } catch(e) {}
      }
      if (cta && (cta.callText || cta.urlText)) {
        ctaSection.style.display = 'block';
        let btnsHtml = '';
        if (cta.callText) {
          btnsHtml += `<div style="background:white;border:1px solid #ca8a04;color:#854d0e;padding:4px 10px;border-radius:4px;font-size:0.78rem;font-weight:600;display:inline-flex;align-items:center;gap:5px;"><i data-lucide="phone-call" style="width:12px;height:12px;color:#ca8a04;"></i> ${escapeHtml(cta.callText)}: <strong>${escapeHtml(cta.callNumber || 'N/A')}</strong></div>`;
        }
        if (cta.urlText) {
          btnsHtml += `<div style="background:white;border:1px solid #ca8a04;color:#854d0e;padding:4px 10px;border-radius:4px;font-size:0.78rem;font-weight:600;display:inline-flex;align-items:center;gap:5px;"><i data-lucide="external-link" style="width:12px;height:12px;color:#ca8a04;"></i> ${escapeHtml(cta.urlText)}: <a href="${escapeHtml(cta.urlLink || '#')}" target="_blank" style="color:#2563eb;text-decoration:underline;">${escapeHtml(cta.urlLink || 'Link')}</a></div>`;
        }
        ctaBtns.innerHTML = btnsHtml;
      } else {
        ctaSection.style.display = 'none';
        ctaBtns.innerHTML = '';
      }
    }

    // Status Badge & Route Pill
    const isScheduledFuture = Boolean(c.scheduled_at && new Date(c.scheduled_at) > new Date());
    const isUserCancelled = c.rejection_action === 'campaign_cancelled_by_user';
    const statusBadgeEl = document.getElementById('detail-camp-status-badge');
    if (statusBadgeEl) {
      if (isScheduledFuture && c.status === 'Submitted') {
        statusBadgeEl.className = 'status-badge';
        statusBadgeEl.style.background = '#fef3c7';
        statusBadgeEl.style.color = '#92400e';
        statusBadgeEl.style.border = '1px solid #fde68a';
        statusBadgeEl.innerHTML = `<i data-lucide="clock" style="width:12px;height:12px;"></i> Scheduled (${new Date(c.scheduled_at).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })})`;
      } else if (c.status === 'Submitted') {
        statusBadgeEl.className = 'status-badge badge-submitted';
        statusBadgeEl.innerHTML = '<i data-lucide="clock" style="width:12px;height:12px;"></i> Submitted (Pending Review)';
      } else if (c.status === 'Approved') {
        statusBadgeEl.className = 'status-badge badge-updated';
        statusBadgeEl.innerHTML = '<i data-lucide="check" style="width:12px;height:12px;"></i> In Dispatch Queue';
      } else if (c.status === 'Completed') {
        statusBadgeEl.className = 'status-badge';
        statusBadgeEl.style.background = '#e0f2fe';
        statusBadgeEl.style.color = '#0369a1';
        statusBadgeEl.style.border = '1px solid #bae6fd';
        statusBadgeEl.innerHTML = '<i data-lucide="send" style="width:12px;height:12px;"></i> Dispatched • Awaiting DLR';
      } else if (c.status === 'Report Updated') {
        statusBadgeEl.className = 'status-badge badge-updated';
        statusBadgeEl.innerHTML = '<i data-lucide="check-check" style="width:12px;height:12px;"></i> Report Reconciled';
      } else if (c.status === 'Rejected') {
        if (isUserCancelled) {
          statusBadgeEl.className = 'status-badge';
          statusBadgeEl.style.background = '#f1f5f9';
          statusBadgeEl.style.color = '#475569';
          statusBadgeEl.style.border = '1px solid #cbd5e1';
          statusBadgeEl.innerHTML = '<i data-lucide="ban" style="width:12px;height:12px;"></i> Cancelled by You (100% Refunded)';
        } else {
          statusBadgeEl.className = 'status-badge badge-rejected';
          statusBadgeEl.innerHTML = '<i data-lucide="x-circle" style="width:12px;height:12px;"></i> Rejected by Compliance (100% Refunded)';
        }
      }
    }

    // Rejection / Cancellation Detailed Banner
    const detailRejectionBanner = document.getElementById('detail-rejection-banner');
    const detailRejectionTitle = document.getElementById('detail-rejection-title');
    const detailRejectionReason = document.getElementById('detail-rejection-reason');
    if (detailRejectionBanner) {
      if (c.status === 'Rejected') {
        detailRejectionBanner.style.display = 'block';
        if (isUserCancelled) {
          if (detailRejectionTitle) detailRejectionTitle.textContent = 'Campaign Cancelled by Account Owner';
          if (detailRejectionReason) {
            detailRejectionReason.innerHTML = `This campaign was cancelled voluntarily by the account owner prior to dispatch. <strong>100% of the deducted credits (${(c.total_numbers || 0).toLocaleString()}) have been restored</strong> to your wallet balance.`;
          }
        } else {
          if (detailRejectionTitle) detailRejectionTitle.textContent = 'Campaign Rejected by Platform Compliance';
          const reasonText = c.rejection_reason ? escapeHtml(c.rejection_reason) : 'Content or destination policy restriction flagged during compliance review.';
          if (detailRejectionReason) {
            detailRejectionReason.innerHTML = `<strong>Reason:</strong> ${reasonText}<br><span style="display:inline-block;margin-top:5px;font-size:0.78rem;color:#991b1b;">100% of the deducted credits (${(c.total_numbers || 0).toLocaleString()}) were automatically refunded to the user wallet.</span>`;
          }
        }
      } else {
        detailRejectionBanner.style.display = 'none';
      }
    }

    const routePillEl = document.getElementById('detail-camp-route-pill');
    if (routePillEl) {
      const channelLabel = c.channel_type === 'own_number' ? 'Own SIM' : (c.campaign_type || 'normal').toUpperCase();
      const destLabel = c.destination === 'international' ? 'International' : 'Domestic';
      routePillEl.textContent = `${channelLabel} • ${destLabel}`;
    }

    if (detailCampaignNoteInput) detailCampaignNoteInput.value = '';
    if (detailCampaignNoteReference) detailCampaignNoteReference.value = '';
    await loadCampaignNotes(campaignId);

    // Render Campaign Attachments
    const detailAttachmentsSection = document.getElementById('detail-camp-attachments-section');
    const detailAttachmentsList = document.getElementById('detail-camp-attachments-list');
    let attachments = c.attachments || [];
    if (typeof attachments === 'string') {
      try { attachments = JSON.parse(attachments); } catch(e) { attachments = []; }
    }
    if (attachments.length === 0 && c.attachment_url) {
      attachments = [{
        type: 'general',
        label: 'Media Attachment',
        url: c.attachment_url
      }];
    }

    if (detailAttachmentsSection && detailAttachmentsList) {
      if (attachments && attachments.length > 0) {
        detailAttachmentsSection.style.display = 'block';
        detailAttachmentsList.innerHTML = attachments.map((att, idx) => {
          const isImg = att.type === 'dp' || att.type === 'image' || att.type === 'cta_image' || (att.mimetype && att.mimetype.startsWith('image/')) || (att.url && /\.(jpg|jpeg|png|webp)$/i.test(att.url));
          const isPdf = att.type === 'pdf' || att.type === 'cta_pdf' || (att.url && /\.pdf$/i.test(att.url));
          const isVid = att.type === 'video' || att.type === 'cta_video' || (att.url && /\.(mp4|mov|mkv|webm)$/i.test(att.url));
          
          const badgeColor = isImg ? '#16a34a' : (isPdf ? '#dc2626' : (isVid ? '#0284c7' : '#4f46e5'));
          const iconName = isImg ? 'image' : (isPdf ? 'file-text' : (isVid ? 'video' : 'paperclip'));
          const sizeText = att.size ? ` (${(att.size / (1024*1024)).toFixed(2)} MB)` : '';

          return `
            <div style="background:white;border:1px solid #bbf7d0;border-radius:6px;padding:6px 12px;display:inline-flex;align-items:center;gap:8px;font-size:0.8rem;">
              <i data-lucide="${iconName}" style="width:14px;height:14px;color:${badgeColor};"></i>
              <span style="font-weight:600;color:var(--slate-800);">${escapeHtml(att.label || ('Asset ' + (idx + 1)))}${sizeText}</span>
              <button type="button" data-download-url="${escapeHtml(att.url || '')}" class="btn-action btn-action-secondary campaign-asset-download" style="padding:2px 8px;font-size:0.72rem;display:inline-flex;align-items:center;gap:3px;">
                <i data-lucide="download" style="width:11px;height:11px;"></i> View / Save
              </button>
            </div>
          `;
        }).join('');
        detailAttachmentsList.querySelectorAll('.campaign-asset-download').forEach(button => {
          button.addEventListener('click', async () => {
            try {
              const endpoint = button.dataset.downloadUrl;
              const safeName = endpoint.split('/').pop() || 'campaign-asset';
              await downloadApiFile(endpoint.replace('/api', ''), safeName);
            } catch (err) {
              showToast('error', 'Download Failed', err.message);
            }
          });
        });
      } else {
        detailAttachmentsSection.style.display = 'none';
        detailAttachmentsList.innerHTML = '';
      }
    }

    detailCountTotal.textContent = (c.total_numbers || 0).toLocaleString();

    const isCompleted = c.status === 'Completed';
    const isReportReconciled = c.status === 'Report Updated' || Boolean(c.report_processed_at);

    const kpiDeliveredCard = document.getElementById('detail-card-delivered');
    const kpiDeliveredLabel = document.getElementById('detail-kpi-delivered-label');
    const kpiDeliveredIcon = document.getElementById('detail-kpi-delivered-icon');
    const kpiFailedCard = document.getElementById('detail-card-failed');
    const kpiFailedLabel = document.getElementById('detail-kpi-failed-label');
    const kpiFailedIcon = document.getElementById('detail-kpi-failed-icon');
    const dlrBanner = document.getElementById('detail-camp-dlr-banner');
    const dlrText = document.getElementById('detail-camp-dlr-text');

    if (isCompleted && !isReportReconciled) {
      if (kpiDeliveredLabel) {
        kpiDeliveredLabel.textContent = 'CARRIER DISPATCHED';
        kpiDeliveredLabel.style.color = '#0284c7';
      }
      if (kpiDeliveredCard) {
        kpiDeliveredCard.style.borderColor = '#bae6fd';
        kpiDeliveredCard.style.background = '#f0f9ff';
      }
      if (kpiDeliveredIcon) {
        kpiDeliveredIcon.setAttribute('data-lucide', 'send');
        kpiDeliveredIcon.style.color = '#0284c7';
      }
      detailCountDelivered.textContent = (c.total_numbers || 0).toLocaleString();
      detailCountDelivered.style.color = '#0369a1';

      if (kpiFailedLabel) {
        kpiFailedLabel.textContent = 'CARRIER DLR STATUS';
        kpiFailedLabel.style.color = '#4f46e5';
      }
      if (kpiFailedCard) {
        kpiFailedCard.style.borderColor = '#c7d2fe';
        kpiFailedCard.style.background = '#f5f3ff';
      }
      if (kpiFailedIcon) {
        kpiFailedIcon.setAttribute('data-lucide', 'clock');
        kpiFailedIcon.style.color = '#6366f1';
      }
      detailCountFailed.innerHTML = '<span style="font-size:0.92rem;font-weight:700;color:#4f46e5;display:inline-flex;align-items:center;gap:5px;"><i data-lucide="radio" style="width:13px;height:13px;animation:pulseSubtle 1.8s infinite;"></i> In Transit (Awaiting DLR)</span>';

      if (dlrBanner) {
        dlrBanner.style.display = 'flex';
        if (dlrText) {
          dlrText.innerHTML = `All <strong>${(c.total_numbers || 0).toLocaleString()}</strong> messages have been transmitted to telecom operator queues. Detailed carrier delivery receipts (DLR) typically sync within 2-4 hours.`;
        }
      }
    } else {
      if (kpiDeliveredLabel) {
        kpiDeliveredLabel.textContent = 'DELIVERED';
        kpiDeliveredLabel.style.color = '#166534';
      }
      if (kpiDeliveredCard) {
        kpiDeliveredCard.style.borderColor = '#dcfce7';
        kpiDeliveredCard.style.background = '#ffffff';
      }
      if (kpiDeliveredIcon) {
        kpiDeliveredIcon.setAttribute('data-lucide', 'check-circle-2');
        kpiDeliveredIcon.style.color = '#16a34a';
      }
      detailCountDelivered.textContent = (c.delivered_count || 0).toLocaleString();
      detailCountDelivered.style.color = '#15803d';

      if (kpiFailedLabel) {
        if (currentUser && currentUser.role === 'user') {
          kpiFailedLabel.textContent = 'UNDELIVERED / FAILED';
        } else {
          kpiFailedLabel.textContent = c.failed_refunded ? 'FAILED (AUTO-REFUNDED)' : 'UNDELIVERED / FAILED';
        }
        kpiFailedLabel.style.color = '#991b1b';
      }
      if (kpiFailedCard) {
        kpiFailedCard.style.borderColor = '#fee2e2';
        kpiFailedCard.style.background = '#ffffff';
      }
      if (kpiFailedIcon) {
        kpiFailedIcon.setAttribute('data-lucide', 'alert-octagon');
        kpiFailedIcon.style.color = '#ef4444';
      }
      detailCountFailed.textContent = (c.failed_count || 0).toLocaleString();
      detailCountFailed.style.color = '#dc2626';

      if (dlrBanner) dlrBanner.style.display = 'none';
    }

    // Export Audience Numbers Buttons
    const btnExportTxt = document.getElementById('btn-export-numbers-txt');
    if (btnExportTxt) {
      btnExportTxt.onclick = (e) => { e.preventDefault(); downloadCampaignNumbers(campaignId, 'txt'); };
    }
    const btnExportCsv = document.getElementById('btn-export-numbers-csv');
    if (btnExportCsv) {
      btnExportCsv.onclick = (e) => { e.preventDefault(); downloadCampaignNumbers(campaignId, 'csv'); };
    }

    // Dynamic Contextual Footer Actions
    const actionsLeftEl = document.getElementById('detail-camp-actions-left');
    if (actionsLeftEl) {
      let actionButtons = '';
      const isAdmin = currentUser && currentUser.role === 'admin';
      const isOwner = currentUser && (currentUser.id === c.user_id);
      const isReseller = currentUser && currentUser.role === 'reseller';

      if (c.status === 'Submitted') {
        if (isOwner || isReseller || isAdmin) {
          actionButtons += `
            <button type="button" class="btn-action btn-action-danger" onclick="modalCampaignDetail.style.display='none'; cancelCampaign(${c.id});" style="display:inline-flex;align-items:center;gap:6px;">
              <i data-lucide="x-circle" style="width:14px;height:14px;"></i> Cancel Campaign & Refund
            </button>
          `;
        }
        if (isAdmin || isReseller) {
          actionButtons += `
            <button type="button" class="btn-action btn-action-success" onclick="modalCampaignDetail.style.display='none'; updateCampaignStatus(${c.id}, 'Approved');" style="display:inline-flex;align-items:center;gap:6px;">
              <i data-lucide="check" style="width:14px;height:14px;"></i> Approve Campaign
            </button>
            <button type="button" class="btn-action btn-action-danger" onclick="modalCampaignDetail.style.display='none'; updateCampaignStatus(${c.id}, 'Rejected');" style="display:inline-flex;align-items:center;gap:6px;">
              <i data-lucide="ban" style="width:14px;height:14px;"></i> Reject & Refund
            </button>
          `;
        }
      } else if (c.status === 'Approved') {
        if (isAdmin || isReseller) {
          actionButtons += `
            <button type="button" class="btn-action btn-action-primary" onclick="modalCampaignDetail.style.display='none'; updateCampaignStatus(${c.id}, 'Completed');" style="display:inline-flex;align-items:center;gap:6px;">
              <i data-lucide="send" style="width:14px;height:14px;"></i> Mark Sent / Dispatched
            </button>
          `;
        }
      } else if (c.status === 'Completed') {
        actionButtons += `
          <button type="button" class="btn-action btn-action-success" onclick="downloadApiFile('/campaigns/${c.id}/export', 'campaign_${c.id}_report.csv');" style="display:inline-flex;align-items:center;gap:6px;">
            <i data-lucide="download" style="width:14px;height:14px;"></i> Download Delivery Report (.CSV)
          </button>
        `;
        // Strictly Super Admin ONLY can upload delivery reports
        if (isAdmin && !c.report_processed_at) {
          actionButtons += `
            <button type="button" class="btn-action btn-action-primary" onclick="modalCampaignDetail.style.display='none'; openReportModal(${c.id});" style="background:#059669;display:inline-flex;align-items:center;gap:6px;">
              <i data-lucide="file-bar-chart" style="width:14px;height:14px;"></i> Upload Delivery Report
            </button>
          `;
        }
      } else if (c.status === 'Report Updated') {
        actionButtons += `
          <button type="button" class="btn-action btn-action-success" onclick="downloadApiFile('/campaigns/${c.id}/export', 'campaign_${c.id}_report.csv');" style="display:inline-flex;align-items:center;gap:6px;">
            <i data-lucide="download" style="width:14px;height:14px;"></i> Download Delivery Report (.CSV)
          </button>
          <span class="status-badge" style="display:inline-flex;align-items:center;gap:5px;padding:6px 12px;font-size:0.8rem;background:#ecfdf5;color:#047857;border:1px solid #a7f3d0;font-weight:600;">
            <i data-lucide="check-check" style="width:14px;height:14px;"></i> Delivery Reconciled & Wallet Settled
          </span>
          ${isAdmin ? `
            <button type="button" class="btn-action btn-action-primary" onclick="modalCampaignDetail.style.display='none'; openReportModal(${c.id}, true);" style="background:#0284c7;display:inline-flex;align-items:center;gap:6px;padding:6px 12px;font-size:0.8rem;font-weight:600;" title="Re-upload revised carrier delivery file and adjust wallet refunds">
              <i data-lucide="rotate-ccw" style="width:14px;height:14px;"></i> Re-Upload / Revise Report
            </button>
          ` : ''}
        `;
      } else if (c.status === 'Rejected') {
        actionButtons += `
          <span style="font-size:0.8rem;color:${isUserCancelled ? '#475569' : '#dc2626'};font-weight:600;display:inline-flex;align-items:center;gap:4px;">
            <i data-lucide="${isUserCancelled ? 'ban' : 'alert-circle'}" style="width:14px;height:14px;"></i> ${isUserCancelled ? 'Cancelled by You — 100% Credits Refunded' : 'Rejected by Compliance — 100% Credits Refunded'}
          </span>
        `;
      }

      actionsLeftEl.innerHTML = actionButtons;
    }

    const btnDuplicate = document.getElementById('btn-duplicate-campaign');
    if (btnDuplicate) {
      btnDuplicate.onclick = () => duplicateCampaign(c);
    }

    const btnCopyMsg = document.getElementById('btn-copy-campaign-msg');
    if (btnCopyMsg) {
      btnCopyMsg.onclick = () => {
        navigator.clipboard.writeText(c.message_text || '');
        showToast('success', 'Copied!', 'Campaign message text copied to clipboard.');
      };
    }

    const limitNoteEl = document.getElementById('detail-recipients-limit-note');
    if (limitNoteEl) {
      if (c.total_numbers > data.recipients.length) {
        limitNoteEl.style.display = 'flex';
        limitNoteEl.innerHTML = `<i data-lucide="info" style="width:13px;height:13px;color:var(--primary);flex-shrink:0;"></i> <span>Showing preview of first <strong>${data.recipients.length}</strong> recipients of <strong>${(c.total_numbers || 0).toLocaleString()}</strong>. Use <strong>Export Numbers</strong> above to download the full verified list.</span>`;
      } else {
        limitNoteEl.style.display = 'none';
        limitNoteEl.innerHTML = '';
      }
    }

    if (data.recipients.length === 0) {
      detailRecipientsTbody.innerHTML = `<tr><td colspan="3" style="text-align:center;padding:15px;color:var(--slate-400);">No recipients found.</td></tr>`;
    } else {
      detailRecipientsTbody.innerHTML = data.recipients.map(r => {
        const rawStatus = r.status || 'Pending';
        let statusBadge = '';

        if (rawStatus === 'Delivered') {
          statusBadge = `<span class="status-badge badge-updated" style="display:inline-flex;align-items:center;gap:4px;"><i data-lucide="check-check" style="width:11px;height:11px;"></i> Delivered</span>`;
        } else if (rawStatus === 'Failed') {
          statusBadge = `<span class="status-badge badge-rejected" style="display:inline-flex;align-items:center;gap:4px;"><i data-lucide="x-circle" style="width:11px;height:11px;"></i> Failed</span>`;
        } else {
          // Status is 'Pending'
          if (c.status === 'Completed') {
            statusBadge = `<span class="status-badge" style="background:#e0f2fe;color:#0284c7;border:1px solid #bae6fd;display:inline-flex;align-items:center;gap:4px;padding:3px 8px;font-size:0.75rem;font-weight:600;"><i data-lucide="send" style="width:11px;height:11px;"></i> Dispatched</span>`;
          } else if (c.status === 'Approved') {
            statusBadge = `<span class="status-badge" style="background:#fef3c7;color:#92400e;border:1px solid #fde68a;display:inline-flex;align-items:center;gap:4px;padding:3px 8px;font-size:0.75rem;font-weight:600;"><i data-lucide="package-check" style="width:11px;height:11px;"></i> In Dispatch Queue</span>`;
          } else {
            statusBadge = `<span class="status-badge badge-submitted" style="display:inline-flex;align-items:center;gap:4px;padding:3px 8px;font-size:0.75rem;font-weight:600;"><i data-lucide="clock" style="width:11px;height:11px;"></i> Queued</span>`;
          }
        }

        return `
          <tr>
            <td><code style="font-weight:600;font-size:0.84rem;color:#1e293b;">${r.phone_number}</code></td>
            <td>${statusBadge}</td>
            <td><span style="font-size:0.75rem;color:var(--slate-500);">${new Date(r.updated_at).toLocaleTimeString()}</span></td>
          </tr>
        `;
      }).join('');
    }

    if (window.lucide) {
      try { lucide.createIcons({ root: modalCampaignDetail }); } catch(e) {}
    }
  } catch (err) {
    showToast('error', 'Failed to Load Campaign Details', err.message);
  }
};

if (btnAddCampaignNote) {
  btnAddCampaignNote.addEventListener('click', async () => {
    const note = detailCampaignNoteInput.value.trim();
    if (!note || !currentDetailCampaignId) return showToast('warning', 'Note Required', 'Enter an operations note before saving.');
    try {
      await apiFetch(`/campaigns/${currentDetailCampaignId}/notes`, { method: 'POST', body: JSON.stringify({ note, external_reference: detailCampaignNoteReference.value.trim() }) });
      detailCampaignNoteInput.value = '';
      detailCampaignNoteReference.value = '';
      await loadCampaignNotes(currentDetailCampaignId);
      showToast('success', 'Note Recorded', 'The immutable operations note has been added.');
    } catch (err) { showToast('error', 'Note Failed', err.message); }
  });
}

// --- USER MANAGEMENT (ADMIN / RESELLER) ---
const userSearchInput = document.getElementById('user-search-input');
if (userSearchInput) {
  userSearchInput.addEventListener('input', () => renderUsersTable());
}
const userResellerFilter = document.getElementById('user-reseller-filter');
if (userResellerFilter) {
  userResellerFilter.addEventListener('change', () => renderUsersTable());
}
const userRoleFilter = document.getElementById('user-role-filter');
if (userRoleFilter) {
  userRoleFilter.addEventListener('change', () => renderUsersTable());
}

function populateResellerFilterDropdown() {
  const select = document.getElementById('user-reseller-filter');
  if (!select) return;
  if (!currentUser || currentUser.role !== 'admin') {
    select.style.display = 'none';
    return;
  }
  select.style.display = 'inline-block';

  const currentVal = select.value;
  const resellerMap = new Map();

  allUsers.forEach(u => {
    if (u.role === 'reseller') {
      resellerMap.set(u.id, {
        id: u.id,
        email: u.email,
        name: u.fullName || u.companyName || u.email,
        count: 0
      });
    } else if (u.resellerId) {
      if (!resellerMap.has(u.resellerId)) {
        resellerMap.set(u.resellerId, {
          id: u.resellerId,
          email: u.resellerEmail || `Reseller #${u.resellerId}`,
          name: u.resellerFullName || u.resellerCompanyName || u.resellerEmail || `Reseller #${u.resellerId}`,
          count: 0
        });
      }
    }
  });

  allUsers.forEach(u => {
    if (u.resellerId && resellerMap.has(u.resellerId)) {
      resellerMap.get(u.resellerId).count++;
    }
  });

  let optionsHtml = `
    <option value="all">All Resellers & Accounts</option>
    <option value="direct">Direct Users (Platform Root)</option>
    <option value="resellers_only">Resellers Only</option>
  `;

  if (resellerMap.size > 0) {
    optionsHtml += `<optgroup label="Filter by Reseller Portfolio:">`;
    resellerMap.forEach(r => {
      optionsHtml += `<option value="reseller_${r.id}">${escapeHtml(r.name)} (${escapeHtml(r.email)}) — ${r.count} User${r.count === 1 ? '' : 's'}</option>`;
    });
    optionsHtml += `</optgroup>`;
  }

  select.innerHTML = optionsHtml;
  if (currentVal && Array.from(select.options).some(o => o.value === currentVal)) {
    select.value = currentVal;
  } else {
    select.value = 'all';
  }
}

window.filterByUserReseller = function(resellerId) {
  const select = document.getElementById('user-reseller-filter');
  if (select) {
    select.value = `reseller_${resellerId}`;
    renderUsersTable();
  }
};

async function loadUsers() {
  const canManage = currentUser && (currentUser.role === 'admin' || currentUser.role === 'reseller' || (currentUser.isTeamMember && currentUser.parentRole === 'reseller'));
  if (!canManage) return;
  const tbody = document.getElementById('users-table-tbody');
  if (tbody && (!allUsers || allUsers.length === 0)) {
    window.renderTableSkeleton(tbody, 9, 3);
  }
  try {
    allUsers = await apiFetch('/users');
    populateResellerFilterDropdown();
    if (typeof populateUserAgentFilter === 'function') populateUserAgentFilter();
    renderUsersTable();
    refreshDashboardMetrics();
    if (currentUser.role === 'admin') await loadPasswordResetRequests();
  } catch (err) {
    showToast('error', 'Error loading users', err.message);
  }
}

let currentUserSegmentFilter = 'all';

window.setUserSegmentFilter = function(seg) {
  currentUserSegmentFilter = seg;
  ['all', 'reseller', 'client', 'direct'].forEach(key => {
    const btnId = `user-seg-${key === 'client' ? 'clients' : key}`;
    const btn = document.getElementById(btnId);
    if (btn) {
      if (key === seg) {
        btn.classList.add('active');
        btn.style.background = '#ffffff';
        btn.style.color = '#0f172a';
        btn.style.boxShadow = '0 1px 3px rgba(0,0,0,0.08)';
        btn.style.fontWeight = '700';
      } else {
        btn.classList.remove('active');
        btn.style.background = 'transparent';
        btn.style.color = '#64748b';
        btn.style.boxShadow = 'none';
        btn.style.fontWeight = '600';
      }
    }
  });
  renderUsersTable();
};

window.quickToggleTaxModeForUser = async function(userId, currentMode, email) {
  const newMode = currentMode === 'with_gst' ? 'non_gst' : 'with_gst';
  const label = newMode === 'with_gst' ? 'With GST (18% B2B Tax Invoice)' : 'Non-GST (0% Retail Bill of Supply)';
  if (!confirm(`Switch tax invoicing mode for ${email || 'user'} to:\n${label}?`)) return;

  try {
    await apiFetch(`/users/${userId}/settings`, {
      method: 'PATCH',
      body: JSON.stringify({ tax_mode: newMode })
    });
    showToast('success', 'Tax Invoicing Mode Updated', `Account is now: ${label}`);
    if (typeof loadUsers === 'function') loadUsers();
    if (typeof openUser360Modal === 'function' && document.getElementById('modal-user-360')?.style.display === 'flex') {
      openUser360Modal(userId);
    }
  } catch (err) {
    showToast('error', 'Tax Mode Update Failed', err.message);
  }
};

function renderUsersTable() {
  const tbody = document.getElementById('users-table-tbody');
  if (!tbody) return;

  // Update Segment counts
  const totalCount = allUsers.length;
  const resellerCount = allUsers.filter(u => u.role === 'reseller').length;
  const clientCount = allUsers.filter(u => u.role === 'user' && u.resellerId).length;
  const directCount = allUsers.filter(u => u.role === 'user' && !u.resellerId).length;

  const elCountAll = document.getElementById('user-count-all');
  if (elCountAll) elCountAll.textContent = totalCount;
  const elCountRes = document.getElementById('user-count-reseller');
  if (elCountRes) elCountRes.textContent = resellerCount;
  const elCountCli = document.getElementById('user-count-clients');
  if (elCountCli) elCountCli.textContent = clientCount;
  const elCountDir = document.getElementById('user-count-direct');
  if (elCountDir) elCountDir.textContent = directCount;

  // Role-adaptive Segment Pills
  const isResellerActor = currentUser && currentUser.role === 'reseller';
  const elResellerBtn = document.getElementById('user-seg-reseller');
  const elDirectBtn = document.getElementById('user-seg-direct');
  const elClientsBtn = document.getElementById('user-seg-clients');
  const elAllBtn = document.getElementById('user-seg-all');

  if (isResellerActor) {
    if (elResellerBtn) elResellerBtn.style.display = 'none';
    if (elDirectBtn) elDirectBtn.style.display = 'none';
    if (elClientsBtn) elClientsBtn.style.display = 'none';
    if (elAllBtn) {
      elAllBtn.innerHTML = `<i data-lucide="users" style="width:13px;height:13px;color:#4f46e5;"></i> My Clients (<span id="user-count-all">${totalCount}</span>)`;
    }
  } else {
    if (elResellerBtn) elResellerBtn.style.display = 'inline-flex';
    if (elDirectBtn) elDirectBtn.style.display = 'inline-flex';
    if (elClientsBtn) elClientsBtn.style.display = 'inline-flex';
  }

  const search = (userSearchInput ? userSearchInput.value : '').toLowerCase().trim();
  const resellerFilter = document.getElementById('user-reseller-filter') ? document.getElementById('user-reseller-filter').value : 'all';
  const roleFilter = document.getElementById('user-role-filter') ? document.getElementById('user-role-filter').value : 'all';
  const agentFilter = document.getElementById('user-agent-filter') ? document.getElementById('user-agent-filter').value : 'all';

  // Staff Agent Portfolio Banner
  const portfolioBanner = document.getElementById('staff-portfolio-banner');
  if (portfolioBanner) {
    const isStaff = Boolean(currentUser && currentUser.isTeamMember && !currentUser.permissions?.can_manage_team);
    if (isStaff) {
      portfolioBanner.style.display = 'flex';
      const myDirect = allUsers.filter(u => u.assignedAgentId === currentUser.id).length;
      const myCoverage = allUsers.filter(u => u.isTemporaryCoverage).length;
      const statsEl = document.getElementById('staff-portfolio-stats');
      const subHeadingEl = document.getElementById('staff-portfolio-subheading');
      if (statsEl) {
        statsEl.textContent = `${myDirect} Direct Clients${myCoverage > 0 ? ` + ${myCoverage} Temporary Coverage` : ''}`;
      }
      if (subHeadingEl) {
        subHeadingEl.textContent = myCoverage > 0
          ? `Showing your dedicated client accounts plus active backup coverage for colleagues on leave.`
          : `Showing clients directly assigned to your management account.`;
      }
    } else {
      portfolioBanner.style.display = 'none';
    }
  }

  let filtered = allUsers.filter(u => {
    // Top segment filter
    if (currentUserSegmentFilter === 'reseller' && u.role !== 'reseller') return false;
    if (currentUserSegmentFilter === 'client' && (u.role !== 'user' || !u.resellerId)) return false;
    if (currentUserSegmentFilter === 'direct' && (u.role !== 'user' || u.resellerId)) return false;

    // Search query
    if (search && ![u.email, u.fullName, u.companyName, u.phone, u.resellerEmail, u.resellerFullName, u.resellerCompanyName, u.agentFullName, u.agentEmail].filter(Boolean).some(value => String(value).toLowerCase().includes(search))) return false;

    // Role dropdown filter
    if (roleFilter !== 'all' && u.role !== roleFilter) return false;

    // Agent / Account Manager dropdown filter
    if (agentFilter !== 'all') {
      if (agentFilter === 'unassigned') {
        if (u.assignedAgentId) return false;
      } else {
        const targetAgentId = parseInt(agentFilter, 10);
        if (u.assignedAgentId !== targetAgentId) return false;
      }
    }

    // Reseller dropdown filter
    if (currentUser && currentUser.role === 'admin' && resellerFilter !== 'all') {
      if (resellerFilter === 'direct') {
        if (u.role === 'reseller' || u.resellerId) return false;
      } else if (resellerFilter === 'resellers_only') {
        if (u.role !== 'reseller') return false;
      } else if (resellerFilter.startsWith('reseller_')) {
        const targetResellerId = parseInt(resellerFilter.replace('reseller_', ''), 10);
        if (u.resellerId !== targetResellerId) return false;
      }
    }

    return true;
  });

  window.currentFilteredUsers = filtered;

  if (filtered.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="8">
          <div class="empty-state-box" style="padding:40px 20px;">
            <div class="empty-state-icon"><i data-lucide="users" style="width:24px;height:24px;"></i></div>
            <div class="empty-state-title">No user accounts found</div>
            <div class="empty-state-desc">Try clearing search/reseller filters or create a new user account to get started.</div>
            <button type="button" class="btn-action btn-action-primary" onclick="document.getElementById('btn-open-create-user-modal').click()">
              <i data-lucide="user-plus" style="width:14px;height:14px;"></i> Create New User
            </button>
          </div>
        </td>
      </tr>
    `;
    if (window.lucide) lucide.createIcons({ root: tbody });
    return;
  }

  tbody.innerHTML = filtered.map(u => {
    const domTotal = (u.credits_gsm_sms_domestic||0) + (u.credits_normal_domestic||0) + (u.credits_dp_domestic||0) + (u.credits_cta_domestic||0) + (u.credits_dp_cta_domestic||0) + (u.credits_own_number_domestic||0);
    const intlTotal = (u.credits_gsm_sms_international||0) + (u.credits_normal_international||0) + (u.credits_dp_international||0) + (u.credits_cta_international||0) + (u.credits_dp_cta_international||0) + (u.credits_own_number_international||0);

    const domBreakdown = `GSM SMS: ${(u.credits_gsm_sms_domestic||0).toLocaleString()} • WA Text: ${(u.credits_normal_domestic||0).toLocaleString()} • DP: ${(u.credits_dp_domestic||0).toLocaleString()} • CTA: ${(u.credits_cta_domestic||0).toLocaleString()} • Own: ${(u.credits_own_number_domestic||0).toLocaleString()}`;
    const intlBreakdown = `GSM SMS: ${(u.credits_gsm_sms_international||0).toLocaleString()} • WA Text: ${(u.credits_normal_international||0).toLocaleString()} • DP: ${(u.credits_dp_international||0).toLocaleString()} • CTA: ${(u.credits_cta_international||0).toLocaleString()} • Own: ${(u.credits_own_number_international||0).toLocaleString()}`;

    // Col 1: User & Account
    const initial = escapeHtml(u.email ? u.email.charAt(0).toUpperCase() : 'U');
    const avatarBg = u.role === 'admin' ? '#0f172a' : (u.role === 'reseller' ? '#7c3aed' : '#2563eb');

    // Col 2: Role & Hierarchy
    let roleHierarchyHtml = '';
    if (u.role === 'admin') {
      roleHierarchyHtml = `
        <span class="role-badge" style="background:#0f172a;color:#f8fafc;font-weight:700;font-size:0.72rem;padding:3px 8px;border-radius:5px;display:inline-flex;align-items:center;gap:4px;">
          <i data-lucide="shield" style="width:11px;height:11px;color:#38bdf8;"></i> SUPER ADMIN
        </span>
        <div style="font-size:0.72rem;color:#64748b;margin-top:3px;font-weight:500;">Master Controller</div>
      `;
    } else if (u.role === 'reseller') {
      const childCount = allUsers.filter(x => x.resellerId === u.id).length;
      roleHierarchyHtml = `
        <span class="role-badge" style="background:#f5f3ff;color:#6d28d9;border:1px solid #ddd6fe;font-weight:700;font-size:0.72rem;padding:3px 8px;border-radius:5px;display:inline-flex;align-items:center;gap:4px;">
          <i data-lucide="award" style="width:11px;height:11px;color:#7c3aed;"></i> RESELLER PARTNER
        </span>
        <div style="font-size:0.73rem;color:#7c3aed;margin-top:3px;font-weight:600;display:flex;align-items:center;gap:4px;">
          <i data-lucide="users" style="width:11px;height:11px;"></i> ${childCount} Managed Client${childCount === 1 ? '' : 's'}
        </div>
      `;
    } else if (u.resellerId) {
      const rName = escapeHtml(u.resellerFullName || u.resellerCompanyName || u.resellerEmail || ('Reseller #' + u.resellerId));
      roleHierarchyHtml = `
        <span class="role-badge" style="background:#eff6ff;color:#1d4ed8;border:1px solid #bfdbfe;font-weight:700;font-size:0.72rem;padding:3px 8px;border-radius:5px;display:inline-flex;align-items:center;gap:4px;">
          <i data-lucide="user" style="width:11px;height:11px;color:#3b82f6;"></i> CLIENT USER
        </span>
        <div style="font-size:0.73rem;color:#475569;margin-top:3px;">
          ${isResellerActor 
            ? '<span style="color:#059669;font-weight:600;"><i data-lucide="check" style="width:11px;height:11px;display:inline-block;vertical-align:-1px;"></i> Direct Managed Client</span>' 
            : `Under: <span style="color:#4338ca;font-weight:700;cursor:pointer;text-decoration:underline;" onclick="window.filterByUserReseller(${u.resellerId})" title="Click to filter by ${rName}">${rName}</span>`}
        </div>
      `;
    } else {
      roleHierarchyHtml = `
        <span class="role-badge" style="background:#f1f5f9;color:#475569;border:1px solid #cbd5e1;font-weight:700;font-size:0.72rem;padding:3px 8px;border-radius:5px;display:inline-flex;align-items:center;gap:4px;">
          <i data-lucide="shield-check" style="width:11px;height:11px;color:#64748b;"></i> DIRECT CLIENT
        </span>
        <div style="font-size:0.72rem;color:#64748b;margin-top:3px;font-weight:500;">Platform Root</div>
      `;
    }

    // Col 2.5: Account Manager / Assigned Staff Agent
    let agentCellHtml = '';
    if (u.role === 'user') {
      const isCovering = Boolean(u.isTemporaryCoverage);
      const agName = escapeHtml(u.agentFullName || u.agentEmail || 'Unassigned');
      if (u.assignedAgentId) {
        agentCellHtml = `
          <div style="display:flex;align-items:center;gap:6px;">
            <span style="font-weight:600;font-size:0.82rem;color:#1e293b;">👤 ${agName}</span>
          </div>
          ${isCovering ? `<div style="margin-top:2px;"><span style="font-size:0.68rem;font-weight:700;padding:1px 6px;border-radius:4px;background:#fef3c7;color:#92400e;border:1px solid #fde68a;" title="Covering for staff on leave">🏖️ Leave Coverage</span></div>` : ''}
        `;
      } else {
        agentCellHtml = `<span style="font-size:0.75rem;color:#94a3b8;font-style:italic;">Unassigned</span>`;
      }
      if (currentUser && (currentUser.role === 'admin' || currentUser.role === 'reseller' || currentUser.permissions?.can_manage_team)) {
        agentCellHtml += `
          <div style="margin-top:4px;">
            <button type="button" onclick="openAssignAgentModal(${u.id}, '${escapeHtml(u.email)}', ${u.assignedAgentId || 'null'})" style="font-size:0.72rem;padding:2px 6px;border:1px solid #cbd5e1;background:#fff;border-radius:4px;color:#4f46e5;cursor:pointer;font-weight:600;">
              ⇄ Assign
            </button>
          </div>
        `;
      }
    } else {
      agentCellHtml = `<span style="color:#94a3b8;font-size:0.75rem;">—</span>`;
    }

    // Col 3: Dedicated Tax Invoicing Mode
    const isWithGst = u.taxMode === 'with_gst';
    const taxCellHtml = isWithGst
      ? `<button type="button" class="btn-action" data-action="toggle-tax-mode" data-user-id="${u.id}" data-tax-mode="with_gst" data-email="${escapeHtml(u.email)}" style="background:#eff6ff;color:#1d4ed8;border:1px solid #bfdbfe;padding:3px 8px;border-radius:6px;font-size:0.74rem;font-weight:700;display:inline-flex;align-items:center;gap:4px;cursor:pointer;" title="Click to switch tax mode: Currently B2B GST 18%">
          <i data-lucide="receipt" style="width:11px;height:11px;"></i> GST 18%
         </button>
         <div style="font-size:0.68rem;color:#1d4ed8;margin-top:2px;font-weight:500;">B2B Tax Invoice</div>`
      : `<button type="button" class="btn-action" data-action="toggle-tax-mode" data-user-id="${u.id}" data-tax-mode="non_gst" data-email="${escapeHtml(u.email)}" style="background:#f0fdf4;color:#15803d;border:1px solid #bbf7d0;padding:3px 8px;border-radius:6px;font-size:0.74rem;font-weight:600;display:inline-flex;align-items:center;gap:4px;cursor:pointer;" title="Click to switch tax mode: Currently Non-GST 0%">
          <i data-lucide="tag" style="width:11px;height:11px;"></i> Non-GST (0%)
         </button>
         <div style="font-size:0.68rem;color:#15803d;margin-top:2px;font-weight:500;">Bill of Supply</div>`;

    // Col 4: Dedicated DLR Refund Routing
    let refundCellHtml = '';
    if (u.role === 'user' && u.resellerEmail) {
      if (u.refundDestination === 'reseller') {
        refundCellHtml = `
          <button type="button" class="btn-action" data-action="toggle-user-refund" data-user-id="${u.id}" data-email="${escapeHtml(u.email)}" data-dest="reseller" style="background:#fffbeb;color:#b45309;border:1px solid #fde68a;padding:3px 8px;border-radius:6px;font-size:0.74rem;font-weight:700;display:inline-flex;align-items:center;gap:4px;cursor:pointer;" title="Failed campaign credits refund back to managing Reseller wallet. Click to switch to Client.">
            <i data-lucide="refresh-cw" style="width:11px;height:11px;color:#d97706;"></i> To Reseller
          </button>
          <div style="font-size:0.68rem;color:#b45309;margin-top:2px;font-weight:600;">Credited to Reseller</div>
        `;
      } else {
        refundCellHtml = `
          <button type="button" class="btn-action" data-action="toggle-user-refund" data-user-id="${u.id}" data-email="${escapeHtml(u.email)}" data-dest="user" style="background:#f0fdf4;color:#166534;border:1px solid #bbf7d0;padding:3px 8px;border-radius:6px;font-size:0.74rem;font-weight:700;display:inline-flex;align-items:center;gap:4px;cursor:pointer;" title="Failed campaign credits refund to this Client wallet. Click to switch to Reseller.">
            <i data-lucide="user-check" style="width:11px;height:11px;color:#16a34a;"></i> To Client
          </button>
          <div style="font-size:0.68rem;color:#166534;margin-top:2px;font-weight:600;">Direct Client Refund</div>
        `;
      }
    } else if (u.role === 'reseller') {
      refundCellHtml = `
        <span style="font-size:0.73rem;color:#64748b;display:inline-flex;align-items:center;gap:4px;background:#f8fafc;padding:3px 8px;border-radius:6px;border:1px solid #e2e8f0;font-weight:600;">
          <i data-lucide="wallet" style="width:11px;height:11px;color:#7c3aed;"></i> Reseller Vault
        </span>
        <div style="font-size:0.68rem;color:#94a3b8;margin-top:2px;">Wholesale Balance</div>
      `;
    } else {
      refundCellHtml = `
        <span style="font-size:0.73rem;color:#64748b;display:inline-flex;align-items:center;gap:4px;background:#f8fafc;padding:3px 8px;border-radius:6px;border:1px solid #e2e8f0;font-weight:600;">
          <i data-lucide="shield-check" style="width:11px;height:11px;color:#0284c7;"></i> Direct Wallet
        </span>
        <div style="font-size:0.68rem;color:#94a3b8;margin-top:2px;">Direct Root User</div>
      `;
    }

    return `
      <tr>
        <td>
          <div style="display:flex;align-items:center;gap:10px;cursor:pointer;" onclick="openUser360Modal(${u.id}, event)" title="Click to view 360° Profile">
            <div class="user-avatar" style="width:36px;height:36px;border-radius:8px;font-size:0.9rem;font-weight:700;background:${avatarBg};color:#fff;display:flex;align-items:center;justify-content:center;flex-shrink:0;">
              ${initial}
            </div>
            <div style="min-width:0;">
              <div style="font-weight:700;color:var(--primary);font-size:0.87rem;display:flex;align-items:center;gap:6px;flex-wrap:wrap;">
                ${escapeHtml(u.fullName || u.email)}
                ${u.companyName ? `<span style="font-size:0.72rem;background:#f1f5f9;color:#475569;padding:1px 6px;border-radius:4px;border:1px solid #e2e8f0;font-weight:500;">${escapeHtml(u.companyName)}</span>` : ''}
              </div>
              <div style="font-size:0.75rem;color:var(--slate-500);margin-top:2px;display:flex;align-items:center;gap:6px;flex-wrap:wrap;">
                <span>${escapeHtml(u.email)}</span>
                ${u.phone ? `<span>•</span><span style="color:#64748b;">${escapeHtml(u.phone)}</span>` : ''}
              </div>
            </div>
          </div>
        </td>
        <td>${roleHierarchyHtml}</td>
        <td>${agentCellHtml}</td>
        <td>${taxCellHtml}</td>
        <td>${refundCellHtml}</td>
        <td>
          <div style="display:inline-flex;align-items:center;gap:6px;">
            <div class="credit-pill credit-pill-primary" title="${domBreakdown}" style="cursor:help;">
              <i data-lucide="map-pin" style="width:12px;height:12px;"></i>
              <span>${domTotal.toLocaleString()}</span>
            </div>
            ${domTotal <= 0 
              ? '<span class="badge" style="background:rgba(239,68,68,0.12);color:#dc2626;border:1px solid rgba(239,68,68,0.3);font-size:10px;font-weight:700;padding:2px 6px;border-radius:9999px;white-space:nowrap;" title="Zero domestic credits balance">⚠️ Empty</span>' 
              : (domTotal < 500 
                  ? '<span class="badge" style="background:rgba(245,158,11,0.15);color:#d97706;border:1px solid rgba(245,158,11,0.3);font-size:10px;font-weight:700;padding:2px 6px;border-radius:9999px;white-space:nowrap;" title="Domestic balance is below 500 threshold">⚠️ Low</span>' 
                  : '')}
            <button type="button" class="btn-quick-topup" data-action="open-allot-credits" data-user-id="${u.id}" data-email="${escapeHtml(u.email)}" title="Quick Allot Credits" style="width:22px;height:22px;border-radius:6px;border:1px solid #cbd5e1;background:#ffffff;color:#4f46e5;display:inline-flex;align-items:center;justify-content:center;cursor:pointer;padding:0;transition:all 0.15s;" onmouseover="this.style.background='#4f46e5';this.style.color='#ffffff';" onmouseout="this.style.background='#ffffff';this.style.color='#4f46e5';">
              <i data-lucide="plus" style="width:12px;height:12px;"></i>
            </button>
          </div>
        </td>
        <td>
          <div class="credit-pill credit-pill-intl" title="${intlBreakdown}" style="cursor:help;">
            <i data-lucide="globe" style="width:12px;height:12px;"></i>
            <span>${intlTotal.toLocaleString()}</span>
          </div>
        </td>
        <td>
          ${u.isBlocked 
            ? '<span class="status-badge badge-rejected" style="display:inline-flex;align-items:center;gap:3px;"><i data-lucide="ban" style="width:11px;height:11px;"></i> Blocked</span>' 
            : '<span class="status-badge badge-updated" style="display:inline-flex;align-items:center;gap:3px;"><i data-lucide="check-circle" style="width:11px;height:11px;"></i> Active</span>'}
        </td>
        <td style="text-align:right;">
          <div style="display:inline-flex;align-items:center;gap:6px;justify-content:flex-end;">
            <button type="button" class="btn-action btn-action-primary" onclick="openUser360Modal(${u.id}, event)" style="display:inline-flex;align-items:center;gap:5px;font-weight:600;padding:5px 10px;font-size:0.78rem;" title="View User 360° Profile">
              <i data-lucide="sparkles" style="width:13px;height:13px;"></i> 360° Profile
            </button>

            <div class="action-dropdown-wrap">
              <button type="button" class="btn-action-more" onclick="toggleUserDropdown(event, ${u.id})" title="More Actions">
                <i data-lucide="more-horizontal" style="width:15px;height:15px;"></i>
              </button>
              <div id="user-dropdown-${u.id}" class="action-dropdown-menu">
                <button type="button" class="action-dropdown-item" data-action="open-allot-credits" data-user-id="${u.id}" data-email="${escapeHtml(u.email)}">
                  <i data-lucide="coins" style="width:14px;height:14px;color:#4f46e5;"></i> Allot Credits
                </button>
                ${(currentUser && (currentUser.role === 'admin' || (currentUser.role === 'reseller' && u.resellerId === currentUser.id)) && u.role !== 'admin' && u.id !== currentUser.id) ? `
                <button type="button" class="action-dropdown-item" data-action="impersonate-user" data-user-id="${u.id}" data-email="${escapeHtml(u.email)}">
                  <i data-lucide="user-check" style="width:14px;height:14px;color:#10b981;"></i> Login as User
                </button>` : ''}
                <button type="button" class="action-dropdown-item" data-action="open-reset-password" data-user-id="${u.id}" data-email="${escapeHtml(u.email)}">
                  <i data-lucide="key" style="width:14px;height:14px;color:#0891b2;"></i> Reset Password
                </button>
                <button type="button" class="action-dropdown-item" data-action="toggle-tax-mode" data-user-id="${u.id}" data-tax-mode="${u.taxMode || 'non_gst'}" data-email="${escapeHtml(u.email)}">
                  <i data-lucide="receipt" style="width:14px;height:14px;color:#2563eb;"></i> Toggle Tax Mode (${isWithGst ? 'GST 18%' : 'Non-GST'})
                </button>
                ${u.role === 'user' && u.resellerEmail ? `
                <button type="button" class="action-dropdown-item" data-action="toggle-user-refund" data-user-id="${u.id}" data-email="${escapeHtml(u.email)}" data-dest="${u.refundDestination || 'user'}">
                  <i data-lucide="rotate-ccw" style="width:14px;height:14px;color:#d97706;"></i> ${u.refundDestination === 'reseller' ? 'Route Refund to Client' : 'Route Refund to Reseller'}
                </button>` : ''}
                <button type="button" class="action-dropdown-item" onclick="closeAllDropdowns(); toggleBlockUser(${u.id})">
                  <i data-lucide="${u.isBlocked ? 'unlock' : 'lock'}" style="width:14px;height:14px;color:${u.isBlocked ? '#10b981' : '#f59e0b'};"></i> ${u.isBlocked ? 'Unblock Account' : 'Block Account'}
                </button>
                <div style="height:1px;background:#e2e8f0;margin:3px 0;"></div>
                <button type="button" class="action-dropdown-item danger" data-action="delete-user" data-user-id="${u.id}" data-email="${escapeHtml(u.email)}">
                  <i data-lucide="trash-2" style="width:14px;height:14px;"></i> Delete User
                </button>
              </div>
            </div>
          </div>
        </td>
      </tr>
    `;
  }).join('');

  if (window.lucide) lucide.createIcons({ root: tbody });
}

window.toggleUserDropdown = function(event, userId) {
  event.stopPropagation();
  const menu = document.getElementById(`user-dropdown-${userId}`);
  const isAlreadyOpen = menu && menu.classList.contains('show');
  closeAllDropdowns();
  if (menu && !isAlreadyOpen) {
    menu.classList.add('show');
  }
};

window.closeAllDropdowns = function() {
  document.querySelectorAll('.action-dropdown-menu.show').forEach(m => m.classList.remove('show'));
};

document.addEventListener('click', (e) => {
  closeAllDropdowns();
  const remWrap = document.getElementById('topbar-reminders-wrapper');
  const remDropdown = document.getElementById('admin-reminders-dropdown');
  const btnDashRem = document.querySelector('[onclick*="toggleAdminRemindersDropdown"]');
  if (remDropdown && remDropdown.style.display !== 'none') {
    if (remWrap && !remWrap.contains(e.target) && (!btnDashRem || !btnDashRem.contains(e.target))) {
      remDropdown.style.display = 'none';
    }
  }
});

async function loadPasswordResetRequests() {
  const card = document.getElementById('password-reset-queue-card');
  const tbody = document.getElementById('password-reset-requests-tbody');
  if (!tbody || !currentUser || currentUser.role !== 'admin') {
    if (card) card.style.display = 'none';
    return;
  }
  try {
    const requests = await apiFetch('/auth/password-reset-requests');
    if (!requests || requests.length === 0) {
      if (card) card.style.display = 'none';
      return;
    }
    if (card) card.style.display = 'block';
    tbody.innerHTML = requests.map(request => `<tr>
      <td>${new Date(request.requested_at).toLocaleString()}</td>
      <td><strong>${escapeHtml(request.full_name || request.email)}</strong><div style="font-size:0.75rem;color:var(--slate-500);">${escapeHtml(request.email)}</div></td>
      <td>${escapeHtml(request.company_name || '—')}</td>
      <td style="text-align:right;"><div style="display:inline-flex;gap:6px;justify-content:flex-end;"><button class="btn-action btn-action-primary" onclick="openResetPasswordModal(${Number(request.user_id)}, '', ${Number(request.id)})">Verify & reset</button><button class="btn-action btn-action-danger" onclick="rejectPasswordResetRequest(${Number(request.id)})">Reject</button></div></td>
    </tr>`).join('');
  } catch (err) {
    if (card) card.style.display = 'none';
  }
}

window.rejectPasswordResetRequest = function(requestId) {
  window.openActionDialog({
    title: `Reject Password Reset #${requestId}`,
    message: 'Please provide the identity-verification reason for rejecting this password reset request.',
    icon: 'shield-alert',
    iconColor: '#dc2626',
    iconBg: '#fee2e2',
    confirmText: 'Reject Request',
    confirmClass: 'btn-action-danger',
    showInput: true,
    inputLabel: 'Identity Verification Reason',
    inputValue: 'Identity verification failed via secondary channel',
    onConfirm: async ({ input: reason }) => {
      try {
        const result = await apiFetch(`/auth/password-reset-requests/${requestId}/reject`, { method: 'PATCH', body: JSON.stringify({ reason }) });
        showToast('info', 'Request Rejected', result.message || 'The password-reset request was rejected.');
        await loadPasswordResetRequests();
      } catch (err) { showToast('error', 'Rejection Failed', err.message); }
    }
  });
};

window.toggleUserRefundRouting = async function(userId, email, currentDest) {
  const newDest = currentDest === 'reseller' ? 'user' : 'reseller';
  const label = newDest === 'reseller' ? 'Route Refund to Reseller Wallet' : 'Refund to Client Wallet';
  const notice = newDest === 'reseller'
    ? 'Undelivered campaign refunds will be credited directly to the managing Reseller. The client user will NOT see any refund notifications.'
    : 'Undelivered campaign refunds will be credited back to this Client account.';
  if (!confirm(`Switch auto-refund destination for ${email} to:\n${label}?\n\nNote: ${notice}`)) return;

  try {
    await apiFetch(`/users/${userId}/settings`, {
      method: 'PATCH',
      body: JSON.stringify({ refund_destination: newDest })
    });
    showToast('success', 'Refund Rule Updated', `Auto-refunds for ${email} will now go to: ${label}`);
    if (typeof loadUsers === 'function') loadUsers();
    if (typeof openUser360Modal === 'function' && document.getElementById('modal-user-360')?.style.display === 'flex') {
      openUser360Modal(userId);
    }
  } catch (err) {
    showToast('error', 'Update Failed', err.message);
  }
};

window.toggleBlockUser = async function(userId) {
  try {
    const res = await apiFetch(`/users/${userId}/block`, { method: 'PATCH' });
    showToast('info', 'User Status Updated', res.message);
    loadUsers();
  } catch (err) {
    showToast('error', 'Block Action Failed', err.message);
  }
};

window.deleteUserAccount = function(userId, email) {
  window.openActionDialog({
    title: 'Delete User Account',
    message: `Are you sure you want to permanently delete user account "${email}"? All account data will be removed. This action cannot be undone.`,
    icon: 'trash-2',
    iconColor: '#dc2626',
    iconBg: '#fee2e2',
    confirmText: 'Delete Account',
    confirmClass: 'btn-action-danger',
    onConfirm: async () => {
      try {
        const res = await apiFetch(`/users/${userId}`, { method: 'DELETE' });
        showToast('success', 'User Deleted', res.message);
        loadUsers();
      } catch (err) {
        showToast('error', 'Deletion Failed', err.message);
      }
    }
  });
};

// --- EXPORT USERS REPORT (.CSV) ---
window.exportUsersCsv = function() {
  const usersToExport = window.currentFilteredUsers || allUsers || [];
  if (usersToExport.length === 0) {
    showToast('warning', 'Export CSV', 'No user accounts found matching current filters to export.');
    return;
  }

  const headers = [
    'User ID',
    'Email Address',
    'Full Name',
    'Company Name',
    'Phone Number',
    'Role',
    'Associated Reseller',
    'Tax Invoicing Mode',
    'Auto-Refund Routing',
    'GSTIN',
    'Business Address',
    'Total Domestic Credits',
    'GSM SMS Domestic',
    'WA Text Domestic',
    'WA DP Domestic',
    'WA CTA Domestic',
    'WA Combo Domestic',
    'Own Number Domestic',
    'Total International Credits',
    'Account Status',
    'Registered Date'
  ];

  const rows = usersToExport.map(u => {
    const domTotal = (u.credits_gsm_sms_domestic||0) + (u.credits_normal_domestic||0) + (u.credits_dp_domestic||0) + (u.credits_cta_domestic||0) + (u.credits_dp_cta_domestic||0) + (u.credits_own_number_domestic||0);
    const intlTotal = (u.credits_gsm_sms_international||0) + (u.credits_normal_international||0) + (u.credits_dp_international||0) + (u.credits_cta_international||0) + (u.credits_dp_cta_international||0) + (u.credits_own_number_international||0);

    let resellerInfo = 'Direct Platform User';
    if (u.role === 'admin') resellerInfo = 'Super Admin';
    else if (u.role === 'reseller') resellerInfo = 'Reseller Partner';
    else if (u.resellerEmail) resellerInfo = `${u.resellerFullName || u.resellerCompanyName || ''} (${u.resellerEmail})`.trim();

    return [
      u.id,
      u.email,
      u.fullName || '',
      u.companyName || '',
      u.phone || '',
      u.role.toUpperCase(),
      resellerInfo,
      u.taxMode === 'with_gst' ? 'GST 18%' : 'Non-GST 0%',
      u.refundDestination === 'reseller' ? 'To Reseller Wallet' : 'To Client Wallet',
      u.gstin || '',
      u.businessAddress || '',
      domTotal,
      u.credits_gsm_sms_domestic || 0,
      u.credits_normal_domestic || 0,
      u.credits_dp_domestic || 0,
      u.credits_cta_domestic || 0,
      u.credits_dp_cta_domestic || 0,
      u.credits_own_number_domestic || 0,
      intlTotal,
      u.isBlocked ? 'Blocked' : 'Active',
      u.createdAt ? new Date(u.createdAt).toISOString() : ''
    ].map(val => `"${String(val).replace(/"/g, '""')}"`).join(',');
  });

  const csvContent = '\uFEFF' + [headers.map(h => `"${h}"`).join(','), ...rows].join('\r\n');
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `MessageSphere_Users_Report_${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);

  showToast('success', 'Export Complete', `Successfully exported ${usersToExport.length} user accounts to CSV.`);
};

// --- ENTERPRISE USER IMPERSONATION CONTROLLER ---
window.impersonateUserAccount = async function(targetId, targetEmail) {
  if (!confirm(`Switch session to client: ${targetEmail}?\n\nYou will enter Impersonation Mode to view and troubleshoot the portal from their exact perspective.\n\nYou can click "Exit & Return to Admin" at the top of the screen at any time.`)) {
    return;
  }

  try {
    const data = await apiFetch(`/users/${targetId}/impersonate`, {
      method: 'POST'
    });

    if (!data || !data.token) {
      throw new Error(data?.error || 'Failed to obtain impersonation token');
    }

    // Save current admin session token & user info in sessionStorage
    const currentToken = getAuthToken();
    if (!currentToken) {
      throw new Error('No active session token found to save.');
    }
    sessionStorage.setItem('ms_impersonator_token', currentToken);
    sessionStorage.setItem('ms_impersonator_info', JSON.stringify({
      id: currentUser.id,
      email: currentUser.email,
      role: currentUser.role
    }));

    // Set target user's token and user info
    setAuthToken(data.token);
    if (data.user) {
      localStorage.setItem('user', JSON.stringify(data.user));
    }

    showToast('info', 'Entering Impersonation Mode', `Now viewing portal as ${targetEmail}...`);
    setTimeout(() => {
      window.location.reload();
    }, 400);
  } catch (err) {
    showToast('error', 'Impersonation Failed', err.message);
  }
};

window.exitImpersonation = function() {
  const origToken = sessionStorage.getItem('ms_impersonator_token');
  if (!origToken || origToken === 'null' || origToken === 'undefined' || origToken.trim() === '') {
    sessionStorage.removeItem('ms_impersonator_token');
    sessionStorage.removeItem('ms_impersonator_info');
    showToast('warning', 'Session Not Found', 'No valid original admin session token found in session storage.');
    return;
  }

  if (!confirm('Exit Impersonation Mode and return to your Admin session?')) {
    return;
  }

  // Restore admin token
  setAuthToken(origToken);
  sessionStorage.removeItem('ms_impersonator_token');
  sessionStorage.removeItem('ms_impersonator_info');
  localStorage.removeItem('user');

  showToast('info', 'Restoring Session', 'Returning to your Admin portal...');
  setTimeout(() => {
    window.location.reload();
  }, 400);
};

window.checkImpersonationStatus = function() {
  const impersonatorToken = sessionStorage.getItem('ms_impersonator_token');
  const banner = document.getElementById('impersonation-banner');
  if (!banner) return;

  if (impersonatorToken) {
    let impInfo = null;
    try {
      impInfo = JSON.parse(sessionStorage.getItem('ms_impersonator_info') || '{}');
    } catch(e) {}

    banner.style.display = 'flex';
    const targetEmailEl = document.getElementById('impersonation-target-email');
    if (targetEmailEl && currentUser) {
      targetEmailEl.textContent = currentUser.email;
    }
    const adminSourceEl = document.getElementById('impersonation-admin-source');
    if (adminSourceEl && impInfo && impInfo.email) {
      adminSourceEl.textContent = `(Controlled by ${impInfo.role === 'admin' ? 'Super Admin' : 'Reseller'}: ${impInfo.email})`;
    }
    if (window.lucide) setTimeout(() => lucide.createIcons({ root: banner }), 50);
  } else {
    banner.style.display = 'none';
  }
};

// --- RESET PASSWORD MODAL ---
const modalResetPassword = document.getElementById('modal-reset-password');
const resetModalTitle = document.getElementById('reset-modal-title');
const resetModalUserId = document.getElementById('reset-modal-user-id');
const resetModalRequestId = document.getElementById('reset-modal-request-id');
const resetModalNewPass = document.getElementById('reset-modal-new-pass');
const btnModalConfirmReset = document.getElementById('btn-modal-confirm-reset');

window.openResetPasswordModal = function(userId, email, resetRequestId = '') {
  const accountEmail = email || allUsers.find(user => Number(user.id) === Number(userId))?.email || `Account #${userId}`;
  resetModalUserId.value = userId;
  resetModalRequestId.value = resetRequestId || '';
  resetModalTitle.textContent = `Reset Password for ${accountEmail}`;
  resetModalNewPass.value = '';
  modalResetPassword.style.display = 'flex';
};

if (btnModalConfirmReset) {
  btnModalConfirmReset.addEventListener('click', async () => {
    const userId = resetModalUserId.value;
    const newPassword = resetModalNewPass.value;

    if (!newPassword || newPassword.length < 8) {
      showToast('error', 'Validation Error', 'Password must be at least 8 characters long.');
      return;
    }

    btnModalConfirmReset.disabled = true;
    btnModalConfirmReset.textContent = 'Resetting...';

    try {
      const res = await apiFetch(`/users/${userId}/reset-password`, {
        method: 'PATCH',
        body: JSON.stringify({ newPassword, reset_request_id: resetModalRequestId.value || undefined })
      });
      showToast('success', 'Password Reset', res.message);
      modalResetPassword.style.display = 'none';
      if (resetModalRequestId.value) loadPasswordResetRequests();
    } catch (err) {
      showToast('error', 'Reset Failed', err.message);
    } finally {
      btnModalConfirmReset.disabled = false;
      btnModalConfirmReset.textContent = 'Reset Password';
    }
  });
}

// --- UNIVERSAL SAAS ACTION CONFIRMATION DIALOG (Replaces raw prompt() and confirm()) ---
window.openActionDialog = function({
  title = 'Confirm Action',
  message = 'Are you sure you want to proceed?',
  icon = 'help-circle',
  iconColor = '#4f46e5',
  iconBg = '#e0e7ff',
  confirmText = 'Confirm',
  confirmClass = 'btn-action-primary',
  showInput = false,
  inputLabel = 'Reason / Note',
  inputPlaceholder = 'Enter details...',
  inputValue = '',
  showRef = false,
  refPlaceholder = 'External reference ID (optional)',
  onConfirm
}) {
  const modal = document.getElementById('modal-action-dialog');
  if (!modal) return;

  document.getElementById('action-dialog-title').textContent = title;
  document.getElementById('action-dialog-message').textContent = message;

  const iconWrap = document.getElementById('action-dialog-icon-wrap');
  if (iconWrap) {
    iconWrap.style.background = iconBg;
    iconWrap.style.color = iconColor;
    iconWrap.innerHTML = `<i data-lucide="${icon}" style="width:18px;height:18px;"></i>`;
  }

  const inputGroup = document.getElementById('action-dialog-input-group');
  const inputEl = document.getElementById('action-dialog-input');
  if (inputGroup && inputEl) {
    if (showInput) {
      inputGroup.style.display = 'block';
      document.getElementById('action-dialog-input-label').textContent = inputLabel;
      inputEl.placeholder = inputPlaceholder;
      inputEl.value = inputValue;
    } else {
      inputGroup.style.display = 'none';
      inputEl.value = '';
    }
  }

  const refGroup = document.getElementById('action-dialog-ref-group');
  const refEl = document.getElementById('action-dialog-ref-input');
  if (refGroup && refEl) {
    if (showRef) {
      refGroup.style.display = 'block';
      refEl.placeholder = refPlaceholder;
      refEl.value = '';
    } else {
      refGroup.style.display = 'none';
      refEl.value = '';
    }
  }

  const btnConfirm = document.getElementById('btn-action-dialog-confirm');
  if (btnConfirm) {
    btnConfirm.textContent = confirmText;
    btnConfirm.className = `btn-action ${confirmClass}`;

    btnConfirm.onclick = async () => {
      const val = inputEl ? inputEl.value.trim() : '';
      const refVal = refEl ? refEl.value.trim() : '';
      if (showInput && !val) {
        showToast('warning', 'Input Required', 'Please provide the requested reason or note.');
        if (inputEl) inputEl.focus();
        return;
      }
      modal.style.display = 'none';
      if (typeof onConfirm === 'function') {
        try {
          await onConfirm({ input: val, reference: refVal });
        } catch (e) {
          showToast('error', 'Action Failed', e.message);
        }
      }
    };
  }

  modal.style.display = 'flex';
  if (window.lucide) {
    try { lucide.createIcons({ root: modal }); } catch(e) {}
  }
  if (showInput && inputEl) setTimeout(() => inputEl.focus(), 60);
};

// Global escape key handler to dismiss any open modal or drawer
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    document.querySelectorAll('.modal-overlay').forEach(m => {
      if (m.style.display === 'flex' || m.style.display === 'block') {
        m.style.display = 'none';
      }
    });
    const drawer = document.getElementById('drawer-group-contacts');
    if (drawer && drawer.style.display === 'flex') drawer.style.display = 'none';
    if (typeof closeAllDropdowns === 'function') closeAllDropdowns();
  }
});

// --- MODAL CONTROLLERS ---
function setupModal(modalId) {
  const modal = document.getElementById(modalId);
  if (!modal) return;

  const closeBtns = modal.querySelectorAll(`[data-close="${modalId}"], [data-close], .btn-modal-close`);
  closeBtns.forEach(b => b.addEventListener('click', () => {
    modal.style.display = 'none';
  }));

  modal.addEventListener('click', (e) => {
    if (e.target === modal) modal.style.display = 'none';
  });
}

// Global Delegation for ALL Modal Close Buttons & Backdrops
document.addEventListener('click', (e) => {
  const closeTarget = e.target.closest('[data-close], .btn-modal-close');
  if (closeTarget) {
    const modalId = closeTarget.getAttribute('data-close');
    if (modalId) {
      const targetModal = document.getElementById(modalId);
      if (targetModal) targetModal.style.display = 'none';
    }
    const parentModal = closeTarget.closest('.modal-overlay');
    if (parentModal) parentModal.style.display = 'none';
  }
  if (e.target.classList && e.target.classList.contains('modal-overlay')) {
    e.target.style.display = 'none';
  }
});

[
  'modal-create-user', 'modal-forgot-password', 'modal-allot-credits', 'modal-upload-report', 
  'modal-campaign-detail', 'modal-reset-password', 'modal-operator-dispatch', 'modal-bulk-confirm', 
  'modal-user-360', 'modal-action-dialog', 'modal-create-group', 'modal-edit-group', 
  'modal-merge-groups', 'modal-add-blacklist', 'modal-create-template', 'modal-edit-template',
  'modal-preview-template', 'modal-starter-templates', 'modal-request-header', 'modal-billing-order',
  'modal-recharge-receipt', 'modal-admin-reseller-brand', 'modal-create-plan', 'modal-render-cloud-config'
].forEach(setupModal);

// Create User Modal
const btnOpenCreateUserModal = document.getElementById('btn-open-create-user-modal');
const modalCreateUser = document.getElementById('modal-create-user');
const modalUserEmail = document.getElementById('modal-user-email');
const modalUserPass = document.getElementById('modal-user-pass');
const modalUserFullName = document.getElementById('modal-user-full-name');
const modalUserCompanyName = document.getElementById('modal-user-company-name');
const modalUserPhone = document.getElementById('modal-user-phone');
const modalUserGstin = document.getElementById('modal-user-gstin');
const modalUserBusinessAddress = document.getElementById('modal-user-business-address');
const modalUserRole = document.getElementById('modal-user-role');
const modalRoleResellerOpt = document.getElementById('modal-role-reseller-opt');
const modalUserResellerWrap = document.getElementById('modal-user-reseller-wrap');
const modalUserResellerId = document.getElementById('modal-user-reseller-id');
const btnModalSaveUser = document.getElementById('btn-modal-save-user');

async function populateResellerAssignments() {
  if (!currentUser || currentUser.role !== 'admin' || !modalUserResellerId) return;
  const resellers = await apiFetch('/resellers');
  modalUserResellerId.innerHTML = '<option value="">Direct Super Admin account</option>' + resellers.map(reseller => `<option value="${Number(reseller.id)}">${escapeHtml(reseller.brand_name || reseller.email)} (${escapeHtml(reseller.email)})</option>`).join('');
}

function updateResellerAssignmentVisibility() {
  const isClientUser = Boolean(modalUserRole?.value === 'user');
  const visible = Boolean(currentUser?.role === 'admin' && isClientUser);
  if (modalUserResellerWrap) modalUserResellerWrap.style.display = visible ? '' : 'none';
  if (!visible && modalUserResellerId && currentUser?.role === 'admin') modalUserResellerId.value = '';

  const refundDestWrap = document.getElementById('modal-user-refund-dest-wrap');
  if (refundDestWrap) {
    const hasReseller = Boolean(
      (currentUser?.role === 'reseller') || 
      (currentUser?.role === 'admin' && modalUserResellerId?.value)
    );
    refundDestWrap.style.display = (isClientUser && hasReseller) ? '' : 'none';
  }
}

if (modalUserResellerId) {
  modalUserResellerId.addEventListener('change', updateResellerAssignmentVisibility);
}

window.onModalUserGstinChange = function(val) {
  const taxSelect = document.getElementById('modal-user-tax-mode');
  if (taxSelect) {
    if (String(val || '').trim().length >= 4) {
      taxSelect.value = 'with_gst';
    }
  }
};

window.openCreateUserModalWithRole = async function(defaultRole = 'user') {
  if (modalUserEmail) modalUserEmail.value = '';
  if (modalUserPass) modalUserPass.value = '';
  if (modalUserFullName) modalUserFullName.value = '';
  if (modalUserCompanyName) modalUserCompanyName.value = '';
  if (modalUserPhone) modalUserPhone.value = '';
  if (modalUserGstin) modalUserGstin.value = '';
  if (modalUserBusinessAddress) modalUserBusinessAddress.value = '';
  if (modalUserRole) modalUserRole.value = defaultRole;
  const taxSelect = document.getElementById('modal-user-tax-mode');
  if (taxSelect) taxSelect.value = 'non_gst';
  const refundSelect = document.getElementById('modal-user-refund-dest');
  if (refundSelect) refundSelect.value = 'user';

  if (modalRoleResellerOpt && currentUser) {
    modalRoleResellerOpt.disabled = (currentUser.role !== 'admin');
  }
  try { await populateResellerAssignments(); } catch (err) { }
  updateResellerAssignmentVisibility();
  if (modalCreateUser) modalCreateUser.style.display = 'flex';
  if (window.lucide) setTimeout(() => lucide.createIcons(), 50);
};

if (btnOpenCreateUserModal) {
  btnOpenCreateUserModal.addEventListener('click', async () => {
    window.openCreateUserModalWithRole('user');
  });
}

if (modalUserRole) modalUserRole.addEventListener('change', updateResellerAssignmentVisibility);

if (btnModalSaveUser) {
  btnModalSaveUser.addEventListener('click', async () => {
    const email = modalUserEmail.value.trim();
    const password = modalUserPass.value;
    const role = modalUserRole.value;
    const full_name = modalUserFullName.value.trim();
    const company_name = modalUserCompanyName.value.trim();
    const phone = modalUserPhone.value.trim();
    const gstin = modalUserGstin.value.trim();
    const business_address = modalUserBusinessAddress.value.trim();
    const tax_mode = document.getElementById('modal-user-tax-mode')?.value || 'non_gst';
    const refund_destination = document.getElementById('modal-user-refund-dest')?.value || 'user';

    if (!email || !password || !full_name || !phone) {
      showToast('error', 'Validation Error', 'Full name, email, phone number and temporary password are required.');
      return;
    }
    if (password.length < 8) {
      showToast('error', 'Validation Error', 'Password must be at least 8 characters.');
      return;
    }

    btnModalSaveUser.disabled = true;
    btnModalSaveUser.textContent = 'Creating...';

    try {
      await apiFetch('/users', {
        method: 'POST',
        body: JSON.stringify({ email, password, role, full_name, company_name, phone, gstin, business_address, reseller_id: modalUserResellerId?.value || null, tax_mode, refund_destination })
      });
      showToast('success', 'User Created!', `Account ${email} has been created.`);
      modalCreateUser.style.display = 'none';
      loadUsers();
    } catch (err) {
      showToast('error', 'Creation Failed', err.message);
    } finally {
      btnModalSaveUser.disabled = false;
      btnModalSaveUser.textContent = 'Create User Account';
    }
  });
}

// Allot Credits Modal
const modalAllotCredits = document.getElementById('modal-allot-credits');
const modalAllotUserId = document.getElementById('modal-allot-user-id');
const modalAllotTitle = document.getElementById('modal-allot-title');
const btnModalSaveCredits = document.getElementById('btn-modal-save-credits');

window.openWalletAllotCreditsModal = function() {
  window.openAllotCreditsModal(null, null);
};

let allocCurrentMode = 'credit';

window.setAllocMode = function(mode) {
  allocCurrentMode = mode === 'debit' ? 'debit' : 'credit';
  const modeInput = document.getElementById('modal-allot-mode');
  if (modeInput) modeInput.value = allocCurrentMode;

  const btnCredit = document.getElementById('alloc-mode-btn-credit');
  const btnDebit = document.getElementById('alloc-mode-btn-debit');
  const modalTitle = document.getElementById('modal-allot-title');
  const saveBtn = document.getElementById('btn-modal-save-credits');
  const reasonInput = document.getElementById('alloc-reason');
  const commercialSec = document.getElementById('alloc-commercial-section');

  const rateFields = document.querySelectorAll('.alloc-rate-field');
  const subtotalPills = document.querySelectorAll('[id^="subtotal-"]');

  if (allocCurrentMode === 'debit') {
    if (btnCredit) {
      btnCredit.style.background = 'transparent';
      btnCredit.style.color = '#64748b';
      btnCredit.style.fontWeight = '600';
    }
    if (btnDebit) {
      btnDebit.style.background = '#dc2626';
      btnDebit.style.color = '#ffffff';
      btnDebit.style.fontWeight = '700';
    }
    if (modalTitle) modalTitle.textContent = 'Deduct / Clawback Credits from Account';
    if (saveBtn) {
      saveBtn.style.background = '#dc2626';
      saveBtn.textContent = 'Confirm & Deduct Credits';
    }
    if (reasonInput && (!reasonInput.value || reasonInput.value.includes('allotment'))) {
      reasonInput.value = 'Credit deduction / correction by admin';
    }
    if (commercialSec) commercialSec.style.display = 'none';
    rateFields.forEach(el => el.style.display = 'none');
    subtotalPills.forEach(el => el.style.display = 'none');
  } else {
    if (btnCredit) {
      btnCredit.style.background = '#10b981';
      btnCredit.style.color = '#ffffff';
      btnCredit.style.fontWeight = '700';
    }
    if (btnDebit) {
      btnDebit.style.background = 'transparent';
      btnDebit.style.color = '#64748b';
      btnDebit.style.fontWeight = '600';
    }
    if (modalTitle) modalTitle.textContent = 'Allot Credits to Account';
    if (saveBtn) {
      saveBtn.style.background = '';
      saveBtn.textContent = 'Save & Transfer Credits';
    }
    if (reasonInput && (!reasonInput.value || reasonInput.value.includes('deduction'))) {
      reasonInput.value = 'Manual credit allotment by admin';
    }
    if (commercialSec) commercialSec.style.display = 'block';
    rateFields.forEach(el => el.style.display = '');
    subtotalPills.forEach(el => el.style.display = '');
  }
};

const DEFAULT_CHANNEL_RATES = {
  'gsm_sms-domestic': 0.1200,
  'normal-domestic': 0.1500,
  'dp-domestic': 0.2800,
  'cta-domestic': 0.2400,
  'dp_cta-domestic': 0.3500,
  'own_number-domestic': 0.0800,
  'gsm_sms-international': 1.5000,
  'normal-international': 2.0000,
  'dp-international': 2.5000,
  'cta-international': 2.5000,
  'dp_cta-international': 3.0000,
  'own_number-international': 1.2000
};

window.applyChannelRates = function(ratesMap = {}) {
  const keys = [
    'gsm_sms-domestic', 'normal-domestic', 'dp-domestic', 'cta-domestic', 'dp_cta-domestic', 'own_number-domestic',
    'gsm_sms-international', 'normal-international', 'dp-international', 'cta-international', 'dp_cta-international', 'own_number-international'
  ];
  keys.forEach(k => {
    const rateInp = document.getElementById(`alloc-rate-${k}`);
    if (rateInp) {
      const dbKey = k.replace(/-/g, '_');
      const val = (ratesMap && ratesMap[dbKey] !== undefined && ratesMap[dbKey] !== null) 
        ? parseFloat(ratesMap[dbKey]) 
        : DEFAULT_CHANNEL_RATES[k];
      rateInp.value = Number(val).toFixed(4);
    }
  });
};

window.loadTargetUserRates = async function(userId) {
  if (!userId) {
    window.applyChannelRates({});
    return;
  }
  try {
    const res = await apiFetch(`/users/${userId}/360`);
    if (res && res.credits && res.credits.rates) {
      window.applyChannelRates(res.credits.rates);
    } else {
      window.applyChannelRates({});
    }
  } catch(e) {
    window.applyChannelRates({});
  }
  window.calculateAllocKhata();
};

window.onAllocPaymentStatusChange = function() {
  const status = document.getElementById('alloc-payment-status')?.value;
  const partialGrp = document.getElementById('alloc-partial-amount-group');
  if (partialGrp) {
    partialGrp.style.display = status === 'partial' ? 'block' : 'none';
  }
  window.calculateAllocKhata();
};

window.setAllocTaxMode = function(mode) {
  const hiddenInp = document.getElementById('alloc-tax-mode');
  if (hiddenInp) hiddenInp.value = mode;

  const btnNon = document.getElementById('alloc-tax-btn-non_gst');
  const btnWith = document.getElementById('alloc-tax-btn-with_gst');
  const hintEl = document.getElementById('alloc-tax-hint');

  if (mode === 'with_gst') {
    if (btnWith) {
      btnWith.style.background = '#e0e7ff';
      btnWith.style.color = '#3730a3';
      btnWith.style.borderColor = '#6366f1';
      btnWith.style.fontWeight = '700';
    }
    if (btnNon) {
      btnNon.style.background = '#ffffff';
      btnNon.style.color = '#475569';
      btnNon.style.borderColor = '#cbd5e1';
      btnNon.style.fontWeight = '600';
    }
    if (hintEl) hintEl.textContent = 'With GST +18% (SAC 998413 Tax Invoice)';
  } else {
    if (btnNon) {
      btnNon.style.background = '#ecfdf5';
      btnNon.style.color = '#065f46';
      btnNon.style.borderColor = '#10b981';
      btnNon.style.fontWeight = '700';
    }
    if (btnWith) {
      btnWith.style.background = '#ffffff';
      btnWith.style.color = '#475569';
      btnWith.style.borderColor = '#cbd5e1';
      btnWith.style.fontWeight = '600';
    }
    if (hintEl) hintEl.textContent = 'Non-GST Account (0% Tax / Bill of Supply)';
  }
  window.calculateAllocKhata();
};

window.calculateAllocKhata = function() {
  const keys = [
    'gsm_sms-domestic', 'normal-domestic', 'dp-domestic', 'cta-domestic', 'dp_cta-domestic', 'own_number-domestic',
    'gsm_sms-international', 'normal-international', 'dp-international', 'cta-international', 'dp_cta-international', 'own_number-international'
  ];
  let totalCredits = 0;
  let baseSubtotal = 0;

  keys.forEach(k => {
    const qtyInp = document.getElementById(`alloc-${k}`);
    const rateInp = document.getElementById(`alloc-rate-${k}`);
    const subtotalEl = document.getElementById(`subtotal-${k}`);

    const qty = parseInt(qtyInp ? qtyInp.value : 0, 10) || 0;
    const defRate = DEFAULT_CHANNEL_RATES[k] || 0.1500;
    const rate = parseFloat(rateInp && rateInp.value !== '' ? rateInp.value : defRate) || 0;
    const channelCost = Math.round((qty * rate) * 100) / 100;

    if (subtotalEl) {
      subtotalEl.textContent = `₹${channelCost.toFixed(2)}`;
    }

    totalCredits += qty;
    baseSubtotal += channelCost;
  });

  baseSubtotal = Math.round(baseSubtotal * 100) / 100;
  const taxMode = document.getElementById('alloc-tax-mode')?.value || 'non_gst';

  let gstAmount = 0.00;
  let grossTotal = baseSubtotal;

  if (taxMode === 'with_gst') {
    gstAmount = Math.round(baseSubtotal * 0.18 * 100) / 100;
    grossTotal = Math.round((baseSubtotal + gstAmount) * 100) / 100;
  }

  const baseEl = document.getElementById('alloc-calc-base');
  if (baseEl) baseEl.textContent = `₹${baseSubtotal.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  const gstEl = document.getElementById('alloc-calc-gst');
  if (gstEl) gstEl.textContent = `₹${gstAmount.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  const taxLabel = document.getElementById('alloc-tax-percent-label');
  if (taxLabel) {
    taxLabel.textContent = taxMode === 'with_gst' ? '+18% GST' : '0% Non-GST';
  }

  const totalBillDisplay = document.getElementById('alloc-total-bill-display');
  if (totalBillDisplay) {
    totalBillDisplay.textContent = `₹${grossTotal.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }

  const status = document.getElementById('alloc-payment-status')?.value || 'unpaid';
  const paidInp = document.getElementById('alloc-paid-amount');
  let received = 0;
  if (status === 'paid') {
    received = grossTotal;
  } else if (status === 'partial') {
    received = parseFloat(paidInp ? paidInp.value : 0) || 0;
  } else {
    received = 0;
  }
  const due = Math.max(0, Math.round((grossTotal - received) * 100) / 100);

  const calcCr = document.getElementById('alloc-calc-credits');
  if (calcCr) calcCr.textContent = totalCredits.toLocaleString();
  const calcRec = document.getElementById('alloc-calc-received');
  if (calcRec) calcRec.textContent = `₹${received.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const calcBaki = document.getElementById('alloc-calc-baki');
  if (calcBaki) calcBaki.textContent = `₹${due.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};

window.openAllotCreditsModal = async function(userId, email) {
  window.setAllocMode('credit');
  const userGroup = document.getElementById('modal-allot-user-group');
  const userSelect = document.getElementById('modal-allot-user-select');

  let targetTaxMode = 'non_gst';
  if (userId) {
    const targetObj = (allUsers || []).find(u => String(u.id) === String(userId));
    if (targetObj && (targetObj.taxMode === 'with_gst' || (targetObj.gstin && String(targetObj.gstin).trim()))) {
      targetTaxMode = 'with_gst';
    }
  }

  if (userId) {
    modalAllotUserId.value = userId;
    modalAllotTitle.textContent = `Allot Credits for ${email}`;
    if (userGroup) userGroup.style.display = 'none';
    await window.loadTargetUserRates(userId);
  } else {
    modalAllotUserId.value = '';
    modalAllotTitle.textContent = 'Allot / Transfer Credits to Client';
    if (userGroup) {
      userGroup.style.display = 'block';
      userSelect.innerHTML = '<option value="">— Select client account —</option>';
      try {
        const uData = await apiFetch('/users?limit=200');
        const uList = Array.isArray(uData) ? uData : (uData.users || []);
        uList.forEach(u => {
          const opt = document.createElement('option');
          opt.value = u.id;
          opt.textContent = `${u.email} (${u.role})`;
          userSelect.appendChild(opt);
        });
      } catch(e) {}
    }
    window.applyChannelRates({});
  }

  window.setAllocTaxMode(targetTaxMode);

  // Clear quantity inputs
  const keys = [
    'gsm_sms-domestic', 'normal-domestic', 'dp-domestic', 'cta-domestic', 'dp_cta-domestic', 'own_number-domestic',
    'gsm_sms-international', 'normal-international', 'dp-international', 'cta-international', 'dp_cta-international', 'own_number-international'
  ];
  keys.forEach(k => {
    const qInp = document.getElementById(`alloc-${k}`);
    if (qInp) qInp.value = '';
  });

  const pStatusSelect = document.getElementById('alloc-payment-status');
  if (pStatusSelect) pStatusSelect.value = 'unpaid';
  const partialGrp = document.getElementById('alloc-partial-amount-group');
  if (partialGrp) partialGrp.style.display = 'none';
  const paidInp = document.getElementById('alloc-paid-amount');
  if (paidInp) paidInp.value = '';

  window.calculateAllocKhata();

  modalAllotCredits.style.display = 'flex';
  if (window.lucide) setTimeout(() => lucide.createIcons(), 50);
};

window.onAllotUserSelectChange = async function() {
  const userSelect = document.getElementById('modal-allot-user-select');
  if (userSelect) {
    modalAllotUserId.value = userSelect.value;
    if (userSelect.value) {
      const selectedObj = (allUsers || []).find(u => String(u.id) === String(userSelect.value));
      if (selectedObj && (selectedObj.taxMode === 'with_gst' || (selectedObj.gstin && String(selectedObj.gstin).trim()))) {
        window.setAllocTaxMode('with_gst');
      } else {
        window.setAllocTaxMode('non_gst');
      }
      await window.loadTargetUserRates(userSelect.value);
    } else {
      window.applyChannelRates({});
      window.setAllocTaxMode('non_gst');
      window.calculateAllocKhata();
    }
  }
};

if (btnModalSaveCredits) {
  btnModalSaveCredits.addEventListener('click', async () => {
    const userId = modalAllotUserId.value;
    if (!userId) {
      showToast('warning', 'Target Account Required', 'Please select a beneficiary client account.');
      return;
    }

    const updates = {};
    const rates = {};
    const keys = [
      'gsm_sms-domestic', 'normal-domestic', 'dp-domestic', 'cta-domestic', 'dp_cta-domestic', 'own_number-domestic',
      'gsm_sms-international', 'normal-international', 'dp-international', 'cta-international', 'dp_cta-international', 'own_number-international'
    ];

    keys.forEach(k => {
      const inp = document.getElementById(`alloc-${k}`);
      const val = parseInt(inp ? inp.value : 0, 10) || 0;
      if (val > 0) {
        updates[k.replace(/-/g, '_')] = val;
      }
      const rateInp = document.getElementById(`alloc-rate-${k}`);
      if (rateInp && rateInp.value !== '') {
        rates[k.replace(/-/g, '_')] = parseFloat(rateInp.value);
      }
    });

    if (Object.keys(updates).length === 0) {
      showToast('warning', 'No credits specified', 'Please enter an amount for at least one channel.');
      return;
    }

    const mode = document.getElementById('modal-allot-mode')?.value || 'credit';
    btnModalSaveCredits.disabled = true;
    btnModalSaveCredits.textContent = mode === 'debit' ? 'Deducting...' : 'Transferring...';

    try {
      const reasonInput = document.getElementById('alloc-reason');
      const defaultReason = mode === 'debit' ? 'Credit deduction / clawback' : (currentUser?.role === 'admin' ? 'Manual credit allotment' : 'Wholesale client balance allotment');
      const allocReason = (reasonInput && reasonInput.value.trim()) ? reasonInput.value.trim() : defaultReason;
      
      const paymentStatus = document.getElementById('alloc-payment-status')?.value || 'unpaid';
      const paidAmount = parseFloat(document.getElementById('alloc-paid-amount')?.value) || 0;
      const totalBillEl = document.getElementById('alloc-total-bill-display');
      const totalBill = totalBillEl ? (parseFloat(totalBillEl.textContent.replace(/[^0-9.]/g, '')) || 0) : 0;
      const tax_mode = document.getElementById('alloc-tax-mode')?.value || 'non_gst';

      const res = await apiFetch(`/users/${userId}/credits`, {
        method: 'POST',
        body: JSON.stringify({ 
          updates, 
          rates,
          reason: allocReason, 
          mode,
          payment_status: paymentStatus,
          paid_amount: paidAmount,
          total_bill: totalBill,
          tax_mode
        })
      });
      showToast('success', mode === 'debit' ? 'Credits Deducted!' : 'Credits Transferred!', res.message);
      modalAllotCredits.style.display = 'none';
      if (typeof loadUsers === 'function') loadUsers();

      // Refresh own credits & update displays and ledger
      const me = await apiFetch('/auth/me');
      currentUser = me;
      updateCreditDisplays();
      updateWalletView();
      if (typeof loadLedgerTransactions === 'function') loadLedgerTransactions();
      if (typeof loadBillingOrders === 'function') loadBillingOrders();
      if (typeof loadResellerWalletData === 'function' && currentUser.role === 'reseller') {
        loadResellerWalletData().then(() => {
          if (document.getElementById('modal-reseller-clients')?.style.display === 'flex') {
            renderResellerClientsTable(resellerCachedClients);
          }
        });
      }
      if (typeof loadResellerProfitAnalytics === 'function' && currentUser.role === 'reseller') {
        loadResellerProfitAnalytics();
      }
    } catch (err) {
      showToast('error', 'Operation Failed', err.message);
    } finally {
      btnModalSaveCredits.disabled = false;
      btnModalSaveCredits.textContent = mode === 'debit' ? 'Confirm & Deduct Credits' : 'Save & Transfer Credits';
    }
  });
}

// Upload / Revise Report Modal (Enterprise Reconciliation & Pre-Validation)
const modalUploadReport = document.getElementById('modal-upload-report');
const modalReportCampaignId = document.getElementById('modal-report-campaign-id');
const modalReportFile = document.getElementById('modal-report-file');
const reportDropzone = document.getElementById('report-dropzone');
const reportFileLabel = document.getElementById('report-file-label');
const btnModalProcessReport = document.getElementById('btn-modal-process-report');
const modalReportConfirm = document.getElementById('modal-report-confirm');
let currentReportPreviewData = null;
let reportProgressTimerInterval = null;
let reportProgressSimInterval = null;

function resetReportModalState() {
  if (reportProgressTimerInterval) {
    clearInterval(reportProgressTimerInterval);
    reportProgressTimerInterval = null;
  }
  if (reportProgressSimInterval) {
    clearInterval(reportProgressSimInterval);
    reportProgressSimInterval = null;
  }

  const inputView = document.getElementById('report-modal-input-view');
  const progView = document.getElementById('report-modal-progress-view');
  const activeCard = document.getElementById('report-active-progress-card');
  const successCard = document.getElementById('report-success-completion-card');
  const errorCard = document.getElementById('report-error-card');
  const defaultFooter = document.getElementById('report-modal-footer');
  const doneFooter = document.getElementById('report-modal-done-footer');
  const closeBtn = document.getElementById('btn-report-modal-close');
  const progressBarFill = document.getElementById('report-progress-bar-fill');
  const percentLabel = document.getElementById('report-progress-percentage');
  const timerLabel = document.getElementById('report-progress-timer');

  if (inputView) inputView.style.display = 'block';
  if (progView) progView.style.display = 'none';
  if (activeCard) activeCard.style.display = 'block';
  if (successCard) successCard.style.display = 'none';
  if (errorCard) errorCard.style.display = 'none';
  if (defaultFooter) defaultFooter.style.display = 'flex';
  if (doneFooter) doneFooter.style.display = 'none';
  if (closeBtn) closeBtn.style.display = 'block';
  if (progressBarFill) {
    progressBarFill.style.width = '0%';
    progressBarFill.style.background = 'linear-gradient(90deg, #4f46e5 0%, #06b6d4 50%, #10b981 100%)';
  }
  if (percentLabel) percentLabel.textContent = '0%';
  if (timerLabel) timerLabel.textContent = '0.0s';

  setReportStageStatus(1, 'active');
  setReportStageStatus(2, 'pending');
  setReportStageStatus(3, 'pending');
  setReportStageStatus(4, 'pending');
}

function setReportStageStatus(stageNum, status, customDesc) {
  const stageEl = document.getElementById(`report-stage-${stageNum}`);
  if (!stageEl) return;
  const iconWrap = stageEl.querySelector('.stage-icon-wrap');
  const badge = stageEl.querySelector('.stage-status-badge');
  const descEl = stageEl.querySelector('.stage-desc');

  if (customDesc && descEl) {
    descEl.textContent = customDesc;
  }

  if (status === 'active') {
    stageEl.style.opacity = '1';
    if (iconWrap) {
      iconWrap.style.background = '#e0e7ff';
      iconWrap.style.color = '#4f46e5';
      iconWrap.innerHTML = `<i data-lucide="loader-2" class="spin" style="width:13px;height:13px;"></i>`;
    }
    if (badge) {
      badge.style.color = '#4f46e5';
      badge.style.fontWeight = '700';
      badge.textContent = 'Active';
    }
  } else if (status === 'completed') {
    stageEl.style.opacity = '1';
    if (iconWrap) {
      iconWrap.style.background = '#ecfdf5';
      iconWrap.style.color = '#15803d';
      iconWrap.innerHTML = `<i data-lucide="check" style="width:13px;height:13px;"></i>`;
    }
    if (badge) {
      badge.style.color = '#15803d';
      badge.style.fontWeight = '700';
      badge.textContent = 'Done';
    }
  } else {
    // pending
    stageEl.style.opacity = '0.45';
    if (iconWrap) {
      iconWrap.style.background = '#f1f5f9';
      iconWrap.style.color = '#64748b';
      iconWrap.textContent = String(stageNum);
    }
    if (badge) {
      badge.style.color = '#94a3b8';
      badge.style.fontWeight = '600';
      badge.textContent = 'Pending';
    }
  }
  if (window.lucide) {
    try { lucide.createIcons({ root: stageEl }); } catch(e) {}
  }
}

window.openReportModal = function(campaignId, isRevision = false) {
  if (!currentUser || currentUser.role !== 'admin') {
    showToast('error', 'Access Denied', 'Only Platform Super Admin is authorized to upload and reconcile delivery reports.');
    return;
  }
  resetReportModalState();
  currentReportPreviewData = null;

  modalReportCampaignId.value = campaignId;
  modalReportCampaignId.dataset.isRevision = isRevision ? 'true' : 'false';
  modalReportFile.value = '';
  if (modalReportConfirm) modalReportConfirm.checked = false;
  if (btnModalProcessReport) {
    btnModalProcessReport.disabled = true;
    btnModalProcessReport.textContent = isRevision ? 'Confirm & Revise Settlement' : 'Process & Reconcile Delivery';
  }

  const titleEl = document.getElementById('report-modal-title');
  if (titleEl) {
    titleEl.innerHTML = `<i data-lucide="${isRevision ? 'rotate-ccw' : 'file-bar-chart'}" style="width:20px;height:20px;color:${isRevision ? '#0284c7' : '#4f46e5'};"></i> <span>${isRevision ? 'Revise Delivery Report (Campaign #' + campaignId + ')' : 'Reconcile Campaign Delivery Report (#' + campaignId + ')'}</span>`;
  }

  const descEl = document.getElementById('report-modal-desc');
  if (descEl) {
    descEl.textContent = isRevision
      ? 'Upload an updated/revised carrier DLR file. The system will safely recalculate delivery numbers and adjust wallet refunds automatically.'
      : 'Upload a carrier DLR CSV or TXT file to verify message delivery and automatically settle undelivered refunds.';
  }

  const confirmLabel = document.getElementById('modal-report-confirm-label');
  if (confirmLabel) {
    confirmLabel.textContent = isRevision
      ? 'I have verified the revised report preview and authorize recalculating delivery counts and wallet refund delta.'
      : 'I have reviewed the matched delivery breakdown and authorize automated wallet reconciliation.';
  }

  const previewBox = document.getElementById('report-preview-box');
  if (previewBox) {
    previewBox.style.display = 'none';
    previewBox.innerHTML = '';
  }

  reportFileLabel.textContent = 'Select or Drag Carrier DLR File (.CSV / .TXT)';
  modalUploadReport.style.display = 'flex';
  if (window.lucide) {
    try { lucide.createIcons({ root: modalUploadReport }); } catch(e) {}
  }
};

// Retry button when an error occurs during reconciliation
document.getElementById('btn-report-retry')?.addEventListener('click', () => {
  resetReportModalState();
  if (btnModalProcessReport) {
    btnModalProcessReport.disabled = false;
  }
});

// Done button after successful reconciliation
document.getElementById('btn-modal-done-report')?.addEventListener('click', () => {
  if (modalUploadReport) modalUploadReport.style.display = 'none';
  resetReportModalState();
});

if (reportDropzone) {
  reportDropzone.addEventListener('click', () => modalReportFile.click());
  modalReportFile.addEventListener('change', async (e) => {
    const f = e.target.files[0];
    const previewBox = document.getElementById('report-preview-box');
    if (!f) {
      if (previewBox) previewBox.style.display = 'none';
      if (btnModalProcessReport) btnModalProcessReport.disabled = true;
      currentReportPreviewData = null;
      return;
    }

    reportFileLabel.textContent = `${f.name} (${(f.size / 1024).toFixed(1)} KB)`;
    if (previewBox) {
      previewBox.style.display = 'block';
      previewBox.innerHTML = `
        <div style="text-align:center;padding:16px;color:#4f46e5;font-size:0.84rem;font-weight:600;">
          <i data-lucide="loader-2" class="spin" style="width:20px;height:20px;margin-bottom:6px;display:inline-block;"></i>
          <div>Analyzing DLR file &amp; cross-referencing campaign recipients...</div>
        </div>
      `;
      if (window.lucide) lucide.createIcons({ root: previewBox });
    }

    const campaignId = modalReportCampaignId.value;
    const formData = new FormData();
    formData.append('reportFile', f);

    try {
      const res = await apiFetch(`/campaigns/${campaignId}/report/preview`, {
        method: 'POST',
        body: formData
      });
      currentReportPreviewData = res;

      // Also pre-fill values in progress view
      const targetScope = res.totalCampaignNumbers || res.fileTotalRows || 0;
      const targetEl = document.getElementById('report-prog-target-val');
      const delivEl = document.getElementById('report-prog-deliv-val');
      const failEl = document.getElementById('report-prog-fail-val');
      const statCount = document.getElementById('report-progress-stat-count');
      if (targetEl) targetEl.textContent = Number(targetScope).toLocaleString();
      if (delivEl) delivEl.textContent = Number(res.projectedDelivered || 0).toLocaleString();
      if (failEl) failEl.textContent = Number(res.projectedFailed || 0).toLocaleString();
      if (statCount) statCount.textContent = `Target: ${Number(targetScope).toLocaleString()} rows`;

      const matchBadgeColor = res.matchRate >= 80 ? '#15803d' : (res.matchRate >= 50 ? '#b45309' : '#b91c1c');
      const matchBadgeBg = res.matchRate >= 80 ? '#ecfdf5' : (res.matchRate >= 50 ? '#fffbeb' : '#fef2f2');
      const matchBadgeBorder = res.matchRate >= 80 ? '#bbf7d0' : (res.matchRate >= 50 ? '#fde68a' : '#fecaca');

      let warningsHtml = '';
      if (res.warnings && res.warnings.length > 0) {
        warningsHtml = `
          <div style="margin-top:12px;background:${res.isSevereMismatch ? '#fef2f2' : '#fffbeb'};border:1.5px solid ${res.isSevereMismatch ? '#fecaca' : '#fde68a'};border-radius:8px;padding:10px 12px;font-size:0.78rem;color:${res.isSevereMismatch ? '#991b1b' : '#92400e'};">
            <div style="font-weight:700;display:flex;align-items:center;gap:5px;margin-bottom:4px;">
              <i data-lucide="${res.isSevereMismatch ? 'alert-triangle' : 'info'}" style="width:14px;height:14px;"></i>
              ${res.isSevereMismatch ? 'Recipient Mismatch Warning' : 'Reconciliation Notes'}
            </div>
            <ul style="margin:0;padding-left:18px;line-height:1.45;">
              ${res.warnings.map(w => `<li>${escapeHtml(w)}</li>`).join('')}
            </ul>
          </div>
        `;
      }

      let walletImpactHtml = '';
      if (res.isRevision) {
        const delta = res.deltaFailed || 0;
        if (delta > 0) {
          walletImpactHtml = `<span style="color:#0284c7;font-weight:700;">+${delta.toLocaleString()} credits will be refunded (additional failed)</span>`;
        } else if (delta < 0) {
          walletImpactHtml = `<span style="color:#b91c1c;font-weight:700;">-${Math.abs(delta).toLocaleString()} credits will be debited back (recovered delivery)</span>`;
        } else {
          walletImpactHtml = `<span style="color:#15803d;font-weight:700;">0 credit change (failed count unchanged)</span>`;
        }
      } else {
        walletImpactHtml = `<span style="color:#0284c7;font-weight:700;">${res.projectedFailed.toLocaleString()} credits will be auto-refunded to wallet</span>`;
      }

      if (previewBox) {
        previewBox.innerHTML = `
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;flex-wrap:wrap;gap:8px;">
            <strong style="font-size:0.86rem;color:#0f172a;">Pre-Reconciliation Match Analysis</strong>
            <span style="font-size:0.74rem;font-weight:700;padding:2px 8px;border-radius:12px;background:${matchBadgeBg};color:${matchBadgeColor};border:1px solid ${matchBadgeBorder};">
              ${res.matchRate}% Recipient Match
            </span>
          </div>

          <div style="display:grid;grid-template-columns:repeat(2, 1fr);gap:8px;font-size:0.78rem;">
            <div style="background:#f8fafc;padding:8px 10px;border-radius:6px;border:1px solid #e2e8f0;">
              <span style="color:#64748b;">Campaign Target:</span>
              <div style="font-size:0.95rem;font-weight:800;color:#0f172a;">${res.totalCampaignNumbers.toLocaleString()}</div>
            </div>
            <div style="background:#f8fafc;padding:8px 10px;border-radius:6px;border:1px solid #e2e8f0;">
              <span style="color:#64748b;">Report File Rows:</span>
              <div style="font-size:0.95rem;font-weight:800;color:#0f172a;">${res.fileTotalRows.toLocaleString()}</div>
            </div>
            <div style="background:#ecfdf5;padding:8px 10px;border-radius:6px;border:1px solid #bbf7d0;">
              <span style="color:#166534;">Projected Delivered:</span>
              <div style="font-size:0.95rem;font-weight:800;color:#15803d;">${res.projectedDelivered.toLocaleString()}</div>
            </div>
            <div style="background:#fef2f2;padding:8px 10px;border-radius:6px;border:1px solid #fecaca;">
              <span style="color:#991b1b;">Projected Failed:</span>
              <div style="font-size:0.95rem;font-weight:800;color:#b91c1c;">${res.projectedFailed.toLocaleString()}</div>
            </div>
          </div>

          <div style="margin-top:10px;padding:8px 10px;background:#f0fdf4;border:1px solid #bbf7d0;border-radius:6px;font-size:0.76rem;">
            <strong>Wallet Impact:</strong> ${walletImpactHtml}
          </div>

          ${warningsHtml}
        `;
        if (window.lucide) lucide.createIcons({ root: previewBox });
      }

      if (btnModalProcessReport) {
        btnModalProcessReport.disabled = false;
      }
    } catch(err) {
      currentReportPreviewData = null;
      if (previewBox) {
        previewBox.innerHTML = `
          <div style="color:#dc2626;font-size:0.8rem;padding:8px;">
            <strong>Validation Error:</strong> ${escapeHtml(err.message)}
          </div>
        `;
      }
      if (btnModalProcessReport) btnModalProcessReport.disabled = true;
    }
  });
}

if (btnModalProcessReport) {
  btnModalProcessReport.addEventListener('click', async () => {
    const campaignId = modalReportCampaignId.value;
    const file = modalReportFile.files[0];
    const isRevision = modalReportCampaignId.dataset.isRevision === 'true';

    if (!file) {
      showToast('warning', 'File Required', 'Please select a delivery report CSV or TXT file.');
      return;
    }
    if (!modalReportConfirm || !modalReportConfirm.checked) {
      showToast('warning', 'Confirmation Required', 'Please confirm the reconciliation preview before proceeding.');
      return;
    }

    // Switch view to Interactive Progress View
    const inputView = document.getElementById('report-modal-input-view');
    const progView = document.getElementById('report-modal-progress-view');
    const activeCard = document.getElementById('report-active-progress-card');
    const successCard = document.getElementById('report-success-completion-card');
    const errorCard = document.getElementById('report-error-card');
    const defaultFooter = document.getElementById('report-modal-footer');
    const doneFooter = document.getElementById('report-modal-done-footer');
    const closeBtn = document.getElementById('btn-report-modal-close');
    const stageName = document.getElementById('report-progress-stage-name');
    const percentLabel = document.getElementById('report-progress-percentage');
    const barFill = document.getElementById('report-progress-bar-fill');
    const actionDesc = document.getElementById('report-progress-action-desc');
    const timerLabel = document.getElementById('report-progress-timer');

    if (inputView) inputView.style.display = 'none';
    if (progView) progView.style.display = 'block';
    if (activeCard) activeCard.style.display = 'block';
    if (successCard) successCard.style.display = 'none';
    if (errorCard) errorCard.style.display = 'none';
    if (defaultFooter) defaultFooter.style.display = 'none';
    if (doneFooter) doneFooter.style.display = 'none';
    if (closeBtn) closeBtn.style.display = 'none'; // Lock modal from accidental close during DB transaction

    const totalTarget = currentReportPreviewData ? (currentReportPreviewData.totalCampaignNumbers || currentReportPreviewData.fileTotalRows) : 0;
    const totalDelivered = currentReportPreviewData ? currentReportPreviewData.projectedDelivered : 0;
    const totalFailed = currentReportPreviewData ? currentReportPreviewData.projectedFailed : 0;

    let progressPct = 8;
    function updateProgressUI(pct, text, desc) {
      progressPct = Math.min(100, Math.max(progressPct, pct));
      if (barFill) barFill.style.width = `${progressPct}%`;
      if (percentLabel) percentLabel.textContent = `${Math.round(progressPct)}%`;
      if (text && stageName) stageName.textContent = text;
      if (desc && actionDesc) actionDesc.textContent = desc;
    }

    updateProgressUI(8, 'Ingesting & streaming delivery report payload...', `Uploading ${(file.size / 1024).toFixed(1)} KB of recipient DLR records`);
    setReportStageStatus(1, 'active');
    setReportStageStatus(2, 'pending');
    setReportStageStatus(3, 'pending');
    setReportStageStatus(4, 'pending');

    // Live timer
    const startTime = Date.now();
    if (reportProgressTimerInterval) clearInterval(reportProgressTimerInterval);
    reportProgressTimerInterval = setInterval(() => {
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      if (timerLabel) timerLabel.textContent = `${elapsed}s`;
    }, 100);

    const formData = new FormData();
    formData.append('reportFile', file);
    formData.append('confirm', 'true');
    formData.append('reason', isRevision ? 'Super Admin revised DLR delivery report' : 'Super Admin confirmed verified external delivery report');

    // Use XMLHttpRequest for real network upload stream tracking and phased progress execution
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${API_BASE}/campaigns/${campaignId}/report`, true);
    const token = getAuthToken();
    if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);

    // Phase 1: Upload stream progress
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) {
        const streamPct = Math.round((e.loaded / e.total) * 25); // 0% to 25%
        updateProgressUI(
          Math.max(8, streamPct),
          'Streaming delivery report payload to server...',
          `Uploaded ${(e.loaded / 1024).toFixed(1)} KB / ${(e.total / 1024).toFixed(1)} KB (${Math.round((e.loaded/e.total)*100)}%)`
        );
      }
    };

    // Phase 2, 3, 4: Phased DB reconciliation simulation while server processes 50,000 records
    xhr.upload.onload = () => {
      setReportStageStatus(1, 'completed');
      setReportStageStatus(2, 'active');
      updateProgressUI(28, 'Database Recipient Synchronization...', 'Executing chunked batch updates across database recipients (2,000 / batch)...');

      let currentSimStep = 0;
      const totalSimSteps = 20;
      if (reportProgressSimInterval) clearInterval(reportProgressSimInterval);
      reportProgressSimInterval = setInterval(() => {
        currentSimStep++;
        if (currentSimStep <= 10) {
          // Phase 2: Database Recipient Synchronization (28% -> 70%)
          const chunkNum = Math.min(25, Math.ceil((currentSimStep / 10) * Math.ceil((totalTarget || 50000) / 2000)));
          const simulatedPct = 28 + (currentSimStep / 10) * 42;
          updateProgressUI(
            simulatedPct,
            'Database Recipient Synchronization...',
            `Batch updating recipients: chunk ${chunkNum} committed in database...`
          );
          if (currentSimStep === 10) {
            setReportStageStatus(2, 'completed');
            setReportStageStatus(3, 'active');
          }
        } else if (currentSimStep <= 16) {
          // Phase 3: Ledger Settlement & Auto-Refund (70% -> 88%)
          const simulatedPct = 70 + ((currentSimStep - 10) / 6) * 18;
          updateProgressUI(
            simulatedPct,
            'Ledger Settlement & Auto-Refund...',
            `Auditing failed dispatches (${totalFailed.toLocaleString()} numbers) & adjusting user credit balance...`
          );
          if (currentSimStep === 16) {
            setReportStageStatus(3, 'completed');
            setReportStageStatus(4, 'active');
          }
        } else if (currentSimStep < totalSimSteps) {
          // Phase 4: Tamper-Proof Audit Sealing (88% -> 94%)
          const simulatedPct = 88 + ((currentSimStep - 16) / 4) * 6;
          updateProgressUI(
            simulatedPct,
            'Tamper-Proof Audit Sealing...',
            'Locking delivery metrics & writing immutable security audit trail...'
          );
        }
      }, 180);
    };

    xhr.onload = async () => {
      if (reportProgressSimInterval) clearInterval(reportProgressSimInterval);
      if (reportProgressTimerInterval) clearInterval(reportProgressTimerInterval);

      if (xhr.status >= 200 && xhr.status < 300) {
        let res = {};
        try {
          res = JSON.parse(xhr.responseText);
        } catch(e) {
          res = { deliveredCount: totalDelivered, failedCount: totalFailed, refundedCredits: totalFailed };
        }

        // Finalize 100% state
        updateProgressUI(100, 'Reconciliation Finalized!', 'All recipient statuses and ledger refunds committed.');
        setReportStageStatus(1, 'completed');
        setReportStageStatus(2, 'completed');
        setReportStageStatus(3, 'completed');
        setReportStageStatus(4, 'completed');

        // Smooth visual transition to success completion card
        setTimeout(() => {
          if (activeCard) activeCard.style.display = 'none';
          if (successCard) {
            successCard.style.display = 'block';
            const delivVal = document.getElementById('report-res-deliv');
            const failVal = document.getElementById('report-res-fail');
            const refundVal = document.getElementById('report-res-refund');
            const successTitle = document.getElementById('report-success-title');
            const successDesc = document.getElementById('report-success-message');

            if (delivVal) delivVal.textContent = Number(res.deliveredCount || totalDelivered).toLocaleString();
            if (failVal) failVal.textContent = Number(res.failedCount || totalFailed).toLocaleString();
            if (refundVal) {
              const refAmt = res.refundedCredits !== undefined ? res.refundedCredits : totalFailed;
              refundVal.textContent = refAmt > 0 ? `+${refAmt.toLocaleString()} Credits` : (refAmt < 0 ? `-${Math.abs(refAmt).toLocaleString()} Credits` : `0 Credits`);
            }
            if (successTitle) successTitle.textContent = isRevision ? 'Delivery Report Revised Successfully!' : 'Reconciliation Completed Successfully!';
            if (successDesc) successDesc.textContent = res.message || 'All campaign delivery metrics have been reconciled and wallet ledger updated.';
            if (window.lucide) lucide.createIcons({ root: successCard });
          }
          if (doneFooter) doneFooter.style.display = 'flex';
          if (closeBtn) closeBtn.style.display = 'block';

          showToast('success', isRevision ? 'Report Revised!' : 'Report Processed!', `Delivered: ${Number(res.deliveredCount || 0).toLocaleString()} | Failed: ${Number(res.failedCount || 0).toLocaleString()}`);
          if (res.refundedCredits !== 0 && res.refundedCredits !== undefined) {
            if (res.refundedCredits > 0) {
              showToast('info', 'Refund Applied', `+${res.refundedCredits.toLocaleString()} credits refunded to wallet.`);
            } else {
              showToast('info', 'Refund Adjusted', `${Math.abs(res.refundedCredits).toLocaleString()} over-refunded credits adjusted from wallet.`);
            }
          }

          // Refresh campaigns & user credit balance in background
          if (typeof loadCampaigns === 'function') loadCampaigns();
          if (typeof loadSmsCampaigns === 'function') loadSmsCampaigns();
          apiFetch('/auth/me').then(me => {
            currentUser = me;
            window.currentUser = me;
            updateCreditDisplays();
          }).catch(() => {});
        }, 500);

      } else {
        // Error handling
        let errMsg = 'Failed to process report';
        try {
          const errRes = JSON.parse(xhr.responseText);
          errMsg = errRes.error || errMsg;
        } catch(e) {
          errMsg = xhr.statusText || errMsg;
        }

        if (barFill) barFill.style.background = '#ef4444';
        if (percentLabel) {
          percentLabel.textContent = 'Failed';
          percentLabel.style.color = '#dc2626';
        }
        if (stageName) {
          stageName.textContent = 'Process Interrupted';
          stageName.style.color = '#dc2626';
        }
        if (errorCard) {
          errorCard.style.display = 'block';
          const errMsgEl = document.getElementById('report-error-msg');
          if (errMsgEl) errMsgEl.textContent = errMsg;
          if (window.lucide) lucide.createIcons({ root: errorCard });
        }
        if (closeBtn) closeBtn.style.display = 'block';
        showToast('error', 'Processing Failed', errMsg);
      }
    };

    xhr.onerror = () => {
      if (reportProgressSimInterval) clearInterval(reportProgressSimInterval);
      if (reportProgressTimerInterval) clearInterval(reportProgressTimerInterval);
      if (barFill) barFill.style.background = '#ef4444';
      if (percentLabel) percentLabel.textContent = 'Network Error';
      if (errorCard) {
        errorCard.style.display = 'block';
        const errMsgEl = document.getElementById('report-error-msg');
        if (errMsgEl) errMsgEl.textContent = 'Network error during report upload. Please check connectivity and try again.';
      }
      if (closeBtn) closeBtn.style.display = 'block';
      showToast('error', 'Network Error', 'Connection lost during report processing.');
    };

    try {
      xhr.send(formData);
    } catch(err) {
      if (reportProgressSimInterval) clearInterval(reportProgressSimInterval);
      if (reportProgressTimerInterval) clearInterval(reportProgressTimerInterval);
      showToast('error', 'Request Error', err.message);
    }
  });
}

// ==========================================
// ENTERPRISE MODULE 1: CONTACTS & DND BLACKLIST
// ==========================================
const contactGroupsTbody = document.getElementById('contact-groups-tbody');
const blacklistTbody = document.getElementById('blacklist-tbody');
const modalCreateGroup = document.getElementById('modal-create-group');
const btnCreateGroupModal = document.getElementById('btn-create-group-modal');
const btnModalSaveGroup = document.getElementById('btn-modal-save-group');
const modalGroupName = document.getElementById('modal-group-name');
const modalGroupDesc = document.getElementById('modal-group-desc');
const modalGroupNumbers = document.getElementById('modal-group-numbers');
const modalGroupDropzone = document.getElementById('modal-group-dropzone');
const modalGroupFileInput = document.getElementById('modal-group-file-input');
const modalGroupCountBadge = document.getElementById('modal-group-count-badge');

const modalEditGroup = document.getElementById('modal-edit-group');
const modalEditGroupId = document.getElementById('modal-edit-group-id');
const modalEditGroupName = document.getElementById('modal-edit-group-name');
const modalEditGroupDesc = document.getElementById('modal-edit-group-desc');
const btnModalUpdateGroup = document.getElementById('btn-modal-update-group');

const modalAddBlacklist = document.getElementById('modal-add-blacklist');
const btnAddBlacklistModal = document.getElementById('btn-add-blacklist-modal');
const btnModalSaveBlacklist = document.getElementById('btn-modal-save-blacklist');
const modalBlacklistPhone = document.getElementById('modal-blacklist-phone');
const modalBlacklistReason = document.getElementById('modal-blacklist-reason');
const contactGroupsSearch = document.getElementById('contact-groups-search');
const blacklistSearch = document.getElementById('blacklist-search');
const btnExportBlacklistCsv = document.getElementById('btn-export-blacklist-csv');

let userContactGroups = [];
let cachedBlacklist = [];
let userTemplates = [];
let userHeaders = [];
let currentBlacklistMode = 'single';
let currentDrawerAddMode = 'single';
let drawerExtractedFileContacts = [];

// Helper: Extract valid phone numbers & optional names from Excel / CSV / TXT in-browser
function extractNumbersFromFile(file, onDone) {
  if (!file) return onDone(new Error('No file selected'));
  const ext = file.name.split('.').pop().toLowerCase();
  const reader = new FileReader();

  if (ext === 'xlsx' || ext === 'xls') {
    reader.onload = function(e) {
      try {
        if (!window.XLSX) return onDone(new Error('Excel parser library not ready'));
        const data = new Uint8Array(e.target.result);
        const workbook = XLSX.read(data, { type: 'array' });
        const firstSheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[firstSheetName];
        const json = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
        const contacts = [];
        for (const row of json) {
          if (!Array.isArray(row)) continue;
          let phone = '';
          let name = '';
          for (const cell of row) {
            const clean = String(cell || '').replace(/\D/g, '');
            if (!phone && clean.length >= 10 && clean.length <= 15) {
              phone = clean;
            } else if (!name && typeof cell === 'string' && isNaN(cell) && cell.trim().length > 1 && !/^\+?\d+$/.test(cell.trim())) {
              name = cell.trim().slice(0, 100);
            }
          }
          if (phone) {
            contacts.push(name ? { phone, name } : phone);
          }
        }
        onDone(null, contacts);
      } catch (err) {
        onDone(err);
      }
    };
    reader.onerror = () => onDone(new Error('Failed to read file'));
    reader.readAsArrayBuffer(file);
  } else {
    reader.onload = function(e) {
      try {
        const text = String(e.target.result || '');
        const lines = text.split(/[\r\n]+/);
        const contacts = [];
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          const parts = trimmed.split(/[,;\t]/);
          let phone = '';
          let name = '';
          for (const p of parts) {
            const clean = String(p || '').replace(/\D/g, '');
            if (!phone && clean.length >= 10 && clean.length <= 15) {
              phone = clean;
            } else if (!name && isNaN(p) && p.trim().length > 1 && !/^\+?\d+$/.test(p.trim())) {
              name = p.replace(/^["']|["']$/g, '').trim().slice(0, 100);
            }
          }
          if (phone) {
            contacts.push(name ? { phone, name } : phone);
          }
        }
        onDone(null, contacts);
      } catch (err) {
        onDone(err);
      }
    };
    reader.onerror = () => onDone(new Error('Failed to read file'));
    reader.readAsText(file);
  }
}

window.switchAudienceTab = function(tabName) {
  const btnGroups = document.getElementById('subtab-btn-groups');
  const btnBlacklist = document.getElementById('subtab-btn-blacklist');
  const controlsGroups = document.getElementById('controls-tab-groups');
  const controlsBlacklist = document.getElementById('controls-tab-blacklist');
  const panelGroups = document.getElementById('panel-contacts-groups');
  const panelBlacklist = document.getElementById('panel-contacts-blacklist');

  if (tabName === 'groups') {
    if (btnGroups) btnGroups.classList.add('active');
    if (btnBlacklist) btnBlacklist.classList.remove('active');
    if (controlsGroups) controlsGroups.style.display = 'flex';
    if (controlsBlacklist) controlsBlacklist.style.display = 'none';
    if (panelGroups) panelGroups.style.display = 'block';
    if (panelBlacklist) panelBlacklist.style.display = 'none';
    loadContactGroups();
  } else {
    if (btnBlacklist) btnBlacklist.classList.add('active');
    if (btnGroups) btnGroups.classList.remove('active');
    if (controlsGroups) controlsGroups.style.display = 'none';
    if (controlsBlacklist) controlsBlacklist.style.display = 'flex';
    if (panelGroups) panelGroups.style.display = 'none';
    if (panelBlacklist) panelBlacklist.style.display = 'block';
    loadBlacklist();
  }
  if (window.lucide) lucide.createIcons();
};

if (contactGroupsSearch) {
  contactGroupsSearch.addEventListener('input', () => renderContactGroupsTable());
}
if (blacklistSearch) {
  blacklistSearch.addEventListener('input', () => renderBlacklistTable());
}

// Sample CSV Download Helper
window.downloadSampleContactCsv = function() {
  const sample = "phone_number,name\n919876543210,Rahul Sharma\n9876543211,\n919876543212,Priya Patel\n9876543213,\n";
  const blob = new Blob([sample], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = "sample_contacts_template.csv";
  a.click();
  URL.revokeObjectURL(url);
}

// Group Creation Modal Wiring
if (btnCreateGroupModal) {
  btnCreateGroupModal.addEventListener('click', async () => {
    if (modalGroupName) modalGroupName.value = '';
    if (modalGroupDesc) modalGroupDesc.value = '';
    if (modalGroupNumbers) modalGroupNumbers.value = '';
    if (modalGroupCountBadge) modalGroupCountBadge.textContent = '0 Numbers';

    // Target Account Assignment for Admin & Reseller
    const wrapTargetUser = document.getElementById('wrap-group-target-user');
    const selectTargetUser = document.getElementById('modal-group-target-user');
    if (wrapTargetUser && selectTargetUser) {
      if (currentUser && (currentUser.role === 'admin' || currentUser.role === 'reseller')) {
        wrapTargetUser.style.display = 'block';
        if (!allUsers || allUsers.length === 0) {
          try { allUsers = await apiFetch('/users'); } catch (e) { allUsers = []; }
        }
        let opts = `<option value="">My Own Account (${escapeHtml(currentUser.email)})</option>`;
        if (currentUser.role === 'admin') {
          opts += (allUsers || []).map(u => `<option value="${u.id}">${escapeHtml(u.email)} (${u.role}${u.companyName ? ' - ' + escapeHtml(u.companyName) : ''})</option>`).join('');
        } else if (currentUser.role === 'reseller') {
          const myClients = (allUsers || []).filter(u => u.resellerId === currentUser.id || u.reseller_id === currentUser.id || u.resellerEmail === currentUser.email);
          opts += myClients.map(u => `<option value="${u.id}">${escapeHtml(u.email)} (Client)</option>`).join('');
        }
        selectTargetUser.innerHTML = opts;
        selectTargetUser.value = '';
      } else {
        wrapTargetUser.style.display = 'none';
      }
    }

    if (modalCreateGroup) modalCreateGroup.style.display = 'flex';
  });
}

if (modalGroupNumbers) {
  modalGroupNumbers.addEventListener('input', () => {
    const raw = modalGroupNumbers.value.trim();
    const count = raw ? raw.split(/[\r\n,]+/).map(n => n.trim()).filter(n => n.replace(/\D/g, '').length >= 10).length : 0;
    if (modalGroupCountBadge) modalGroupCountBadge.textContent = `${count} Numbers`;
  });
}

if (modalGroupDropzone && modalGroupFileInput) {
  modalGroupDropzone.addEventListener('click', () => modalGroupFileInput.click());
  modalGroupDropzone.addEventListener('dragover', (e) => {
    e.preventDefault();
    modalGroupDropzone.style.borderColor = '#4f46e5';
    modalGroupDropzone.style.background = '#eef2ff';
  });
  modalGroupDropzone.addEventListener('dragleave', () => {
    modalGroupDropzone.style.borderColor = '#cbd5e1';
    modalGroupDropzone.style.background = '#f8fafc';
  });
  modalGroupDropzone.addEventListener('drop', (e) => {
    e.preventDefault();
    modalGroupDropzone.style.borderColor = '#cbd5e1';
    modalGroupDropzone.style.background = '#f8fafc';
    if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleModalGroupFile(e.dataTransfer.files[0]);
    }
  });

  modalGroupFileInput.addEventListener('change', () => {
    if (modalGroupFileInput.files && modalGroupFileInput.files[0]) {
      handleModalGroupFile(modalGroupFileInput.files[0]);
    }
  });
}

function handleModalGroupFile(file) {
  extractNumbersFromFile(file, (err, numbers) => {
    if (err) return showToast('error', 'Parse Error', err.message);
    if (!numbers || numbers.length === 0) return showToast('warning', 'No Numbers Found', 'Could not detect any 10-15 digit numbers in this file.');
    const existing = modalGroupNumbers.value.trim();
    const combined = existing ? existing + '\n' + numbers.join('\n') : numbers.join('\n');
    modalGroupNumbers.value = combined;
    modalGroupNumbers.dispatchEvent(new Event('input'));
    showToast('success', 'File Parsed', `Loaded ${numbers.length} numbers from ${file.name}`);
  });
}

if (btnModalSaveGroup) {
  btnModalSaveGroup.addEventListener('click', async () => {
    const name = modalGroupName.value.trim();
    const description = modalGroupDesc ? modalGroupDesc.value.trim() : '';
    const rawNumbers = modalGroupNumbers.value.trim();
    if (!name) {
      showToast('warning', 'Name Required', 'Please enter a name for the group.');
      return;
    }
    const numbers = rawNumbers.split(/[\r\n,]+/).map(n => n.trim()).filter(Boolean);
    const targetSelect = document.getElementById('modal-group-target-user');
    const target_user_id = (targetSelect && targetSelect.value) ? targetSelect.value : undefined;

    try {
      btnModalSaveGroup.disabled = true;
      btnModalSaveGroup.textContent = 'Saving...';
      const payload = { name, description, numbers };
      if (target_user_id) payload.target_user_id = target_user_id;

      const created = await apiFetch('/contacts/groups', {
        method: 'POST',
        body: JSON.stringify(payload)
      });
      showToast('success', 'Group Created', `Contact group "${name}" saved with ${numbers.length} contacts.`);
      if (modalCreateGroup) modalCreateGroup.style.display = 'none';
      loadContactGroups();
      populateComposerSelectors();
    } catch (err) {
      showToast('error', 'Error', err.message);
    } finally {
      btnModalSaveGroup.disabled = false;
      btnModalSaveGroup.textContent = 'Save Contact Group';
    }
  });
}

// Group Edit Modal Wiring
window.openEditGroupModal = function(groupId) {
  const g = userContactGroups.find(item => Number(item.id) === Number(groupId));
  if (!g) return;
  if (modalEditGroupId) modalEditGroupId.value = g.id;
  if (modalEditGroupName) modalEditGroupName.value = g.name || '';
  if (modalEditGroupDesc) modalEditGroupDesc.value = g.description || '';
  if (modalEditGroup) modalEditGroup.style.display = 'flex';
};

if (btnModalUpdateGroup) {
  btnModalUpdateGroup.addEventListener('click', async () => {
    const id = modalEditGroupId ? modalEditGroupId.value : '';
    const name = modalEditGroupName ? modalEditGroupName.value.trim() : '';
    const description = modalEditGroupDesc ? modalEditGroupDesc.value.trim() : '';
    if (!name) {
      return showToast('warning', 'Name Required', 'Please provide a group name.');
    }
    try {
      btnModalUpdateGroup.disabled = true;
      btnModalUpdateGroup.textContent = 'Updating...';
      await apiFetch(`/contacts/groups/${id}`, {
        method: 'PUT',
        body: JSON.stringify({ name, description })
      });
      showToast('success', 'Group Updated', `Group #${id} details updated successfully.`);
      if (modalEditGroup) modalEditGroup.style.display = 'none';
      loadContactGroups();
      populateComposerSelectors();
    } catch (err) {
      showToast('error', 'Update Failed', err.message);
    } finally {
      btnModalUpdateGroup.disabled = false;
      btnModalUpdateGroup.textContent = 'Update Group';
    }
  });
}

// Merge Groups Modal Wiring
const btnMergeGroupsModal = document.getElementById('btn-merge-groups-modal');
const modalMergeGroups = document.getElementById('modal-merge-groups');
const modalMergeSourceGroup = document.getElementById('modal-merge-source-group');
const modalMergeTargetGroup = document.getElementById('modal-merge-target-group');
const modalMergeDeleteSource = document.getElementById('modal-merge-delete-source');
const btnModalSubmitMerge = document.getElementById('btn-modal-submit-merge');

if (btnMergeGroupsModal) {
  btnMergeGroupsModal.addEventListener('click', () => {
    if (!userContactGroups || userContactGroups.length < 2) {
      return showToast('warning', 'Multiple Groups Required', 'You need at least 2 contact groups to perform a merge.');
    }
    const opts = userContactGroups.map(g => {
      const count = parseInt(g.total_contacts || g.contact_count, 10) || 0;
      return `<option value="${g.id}">#${g.id} - ${escapeHtml(g.name)} (${count.toLocaleString()} contacts)${g.owner_email ? ' [' + escapeHtml(g.owner_email) + ']' : ''}</option>`;
    }).join('');

    if (modalMergeSourceGroup) modalMergeSourceGroup.innerHTML = opts;
    if (modalMergeTargetGroup) {
      modalMergeTargetGroup.innerHTML = opts;
      if (userContactGroups.length > 1) {
        modalMergeTargetGroup.selectedIndex = 1;
      }
    }
    if (modalMergeDeleteSource) modalMergeDeleteSource.checked = false;
    if (modalMergeGroups) modalMergeGroups.style.display = 'flex';
  });
}

if (btnModalSubmitMerge) {
  btnModalSubmitMerge.addEventListener('click', async () => {
    const sourceId = modalMergeSourceGroup ? modalMergeSourceGroup.value : '';
    const targetId = modalMergeTargetGroup ? modalMergeTargetGroup.value : '';
    const deleteSource = modalMergeDeleteSource ? modalMergeDeleteSource.checked : false;

    if (!sourceId || !targetId) {
      return showToast('warning', 'Select Groups', 'Please select both source and target groups.');
    }
    if (sourceId === targetId) {
      return showToast('warning', 'Invalid Selection', 'Source and target group cannot be the same group.');
    }

    try {
      btnModalSubmitMerge.disabled = true;
      btnModalSubmitMerge.textContent = 'Merging Contacts...';
      const res = await apiFetch('/contacts/groups/merge', {
        method: 'POST',
        body: JSON.stringify({
          source_group_id: sourceId,
          target_group_id: targetId,
          delete_source: deleteSource
        })
      });
      showToast('success', 'Groups Merged', `Successfully merged! ${res.contactsMerged ?? res.mergedCount ?? 0} contacts added to target (${res.duplicatesSkipped || 0} duplicates skipped).`);
      if (modalMergeGroups) modalMergeGroups.style.display = 'none';
      loadContactGroups();
      populateComposerSelectors();
    } catch (err) {
      showToast('error', 'Merge Failed', err.message);
    } finally {
      btnModalSubmitMerge.disabled = false;
      btnModalSubmitMerge.textContent = 'Merge Contacts';
    }
  });
}

async function loadContactGroups() {
  if (!contactGroupsTbody) return;
  try {
    userContactGroups = await apiFetch('/contacts/groups');
    
    // Setup User Filter for Admin & Reseller
    const userFilter = document.getElementById('contact-groups-user-filter');
    if (userFilter) {
      if (currentUser && (currentUser.role === 'admin' || currentUser.role === 'reseller')) {
        userFilter.style.display = 'inline-block';
        const distinctOwners = Array.from(new Set(userContactGroups.map(g => g.owner_email).filter(Boolean)));
        const currentVal = userFilter.value;
        userFilter.innerHTML = '<option value="">All Accounts</option>' + distinctOwners.map(e => `<option value="${escapeHtml(e)}">${escapeHtml(e)}</option>`).join('');
        if (distinctOwners.includes(currentVal)) {
          userFilter.value = currentVal;
        }
        userFilter.onchange = () => renderContactGroupsTable();
      } else {
        userFilter.style.display = 'none';
      }
    }

    renderContactGroupsTable();
  } catch (err) {
    contactGroupsTbody.innerHTML = `<tr><td colspan="4" style="text-align:center;color:red;padding:20px;">Failed to load groups: ${escapeHtml(err.message)}</td></tr>`;
  }
}

function renderContactGroupsTable() {
  if (!contactGroupsTbody) return;
  const totalGroups = userContactGroups.length;
  const totalContacts = userContactGroups.reduce((acc, g) => acc + (parseInt(g.total_contacts || g.contact_count, 10) || 0), 0);
  
  const kpiGroups = document.getElementById('kpi-total-groups');
  const kpiContacts = document.getElementById('kpi-total-contacts');
  const badgeGroups = document.getElementById('badge-groups-count');
  if (kpiGroups) kpiGroups.textContent = totalGroups.toLocaleString();
  if (kpiContacts) kpiContacts.textContent = totalContacts.toLocaleString();
  if (badgeGroups) badgeGroups.textContent = totalGroups;

  const userFilter = document.getElementById('contact-groups-user-filter');
  const selectedUser = (userFilter && userFilter.value) ? userFilter.value.trim() : '';

  const q = (contactGroupsSearch ? contactGroupsSearch.value : '').toLowerCase().trim();
  const filtered = userContactGroups.filter(g => {
    if (selectedUser && g.owner_email !== selectedUser) return false;
    if (!q) return true;
    return (g.name || '').toLowerCase().includes(q) || (g.description || '').toLowerCase().includes(q) || String(g.id).includes(q) || (g.owner_email || '').toLowerCase().includes(q);
  });

  if (filtered.length === 0) {
    contactGroupsTbody.innerHTML = `
      <tr>
        <td colspan="4">
          <div class="empty-state-box">
            <div class="empty-state-icon"><i data-lucide="folder-plus" style="width:24px;height:24px;"></i></div>
            <div class="empty-state-title">${q ? 'No matching contact groups' : 'No contact groups yet'}</div>
            <div class="empty-state-desc">${q ? 'Try clearing your search query.' : 'Create audience groups to quickly dispatch campaigns to verified customer segments.'}</div>
            ${!q ? `<button type="button" class="btn-action btn-action-primary" onclick="btnCreateGroupModal.click()">
              <i data-lucide="plus" style="width:13px;height:13px;"></i> Create Group
            </button>` : ''}
          </div>
        </td>
      </tr>
    `;
    if (window.lucide) lucide.createIcons({ root: contactGroupsTbody });
    return;
  }

  contactGroupsTbody.innerHTML = filtered.map(g => {
    const count = parseInt(g.total_contacts || g.contact_count, 10) || 0;
    return `
      <tr>
        <td>
          <div style="display:flex;align-items:center;gap:12px;">
            <div style="width:38px;height:38px;border-radius:8px;background:#eef2ff;color:#4f46e5;display:flex;align-items:center;justify-content:center;flex-shrink:0;">
              <i data-lucide="folder" style="width:18px;height:18px;"></i>
            </div>
            <div>
              <a href="javascript:void(0)" data-action="open-group-contacts" data-group-id="${g.id}" data-group-name="${escapeHtml(g.name)}" style="font-weight:700;color:var(--slate-800);text-decoration:none;font-size:0.9rem;">
                ${escapeHtml(g.name)}
              </a>
              <div style="font-size:0.75rem;color:var(--slate-500);margin-top:2px;">
                ID: #${g.id} ${g.description ? '· ' + escapeHtml(g.description) : ''}
                ${(g.owner_email && currentUser && (currentUser.role === 'admin' || currentUser.role === 'reseller')) ? `<span style="font-size:0.7rem;color:#4f46e5;background:#eef2ff;padding:1px 6px;border-radius:4px;margin-left:6px;"><i data-lucide="user" style="width:10px;height:10px;display:inline-block;vertical-align:-1px;"></i> ${escapeHtml(g.owner_email)}</span>` : ''}
              </div>
            </div>
          </div>
        </td>
        <td>
          <span class="status-badge badge-updated" style="font-size:0.8rem;padding:4px 10px;font-weight:600;">
            <i data-lucide="users" style="width:13px;height:13px;"></i> ${count.toLocaleString()} Contacts
          </span>
        </td>
        <td>
          <span style="font-size:0.82rem;color:var(--slate-600);">${g.created_at ? new Date(g.created_at).toLocaleDateString() : '—'}</span>
        </td>
        <td>
          <div style="display:flex;justify-content:flex-end;gap:6px;flex-wrap:wrap;">
            <button type="button" class="btn-action" onclick="useGroupForCampaign(${g.id})" style="background:#10b981;color:#fff;border:none;display:inline-flex;align-items:center;gap:4px;padding:5px 8px;font-size:0.8rem;font-weight:600;" title="Launch WhatsApp Campaign with this Group">
              <i data-lucide="message-circle" style="width:12px;height:12px;"></i> WhatsApp
            </button>
            <button type="button" class="btn-action" onclick="useGroupForSmsCampaign(${g.id})" style="background:#6366f1;color:#fff;border:none;display:inline-flex;align-items:center;gap:4px;padding:5px 8px;font-size:0.8rem;font-weight:600;" title="Launch Bulk SMS Campaign with this Group">
              <i data-lucide="smartphone" style="width:12px;height:12px;"></i> SMS
            </button>
            <button type="button" class="btn-action btn-action-secondary" onclick="openEditGroupModal(${g.id})" style="display:inline-flex;align-items:center;gap:4px;padding:5px 8px;font-size:0.8rem;" title="Edit Group Name">
              <i data-lucide="edit-2" style="width:13px;height:13px;"></i> Edit
            </button>
            <button type="button" class="btn-action btn-action-primary" data-action="open-group-contacts" data-group-id="${g.id}" data-group-name="${escapeHtml(g.name)}" style="display:inline-flex;align-items:center;gap:4px;padding:5px 9px;font-size:0.8rem;">
              <i data-lucide="eye" style="width:13px;height:13px;"></i> Contacts
            </button>
            <button type="button" class="btn-action btn-action-secondary" data-action="export-group-csv" data-group-id="${g.id}" data-group-name="${escapeHtml(g.name)}" style="display:inline-flex;align-items:center;gap:4px;padding:5px 8px;font-size:0.8rem;" title="Download CSV of contacts in this group">
              <i data-lucide="download" style="width:12px;height:12px;"></i>
            </button>
            <button type="button" class="btn-action btn-action-danger" onclick="deleteContactGroup(${g.id})" style="display:inline-flex;align-items:center;gap:4px;padding:5px 8px;font-size:0.8rem;" title="Delete contact group">
              <i data-lucide="trash-2" style="width:12px;height:12px;"></i>
            </button>
          </div>
        </td>
      </tr>
    `;
  }).join('');
  if (window.lucide) lucide.createIcons({ root: contactGroupsTbody });
}

window.useGroupForCampaign = function(groupId) {
  switchView('view-new-campaign');
  setTimeout(() => {
    const groupSelect = document.getElementById('composer-contact-group-select');
    if (groupSelect) {
      groupSelect.value = String(groupId);
      const btnInsert = document.getElementById('btn-insert-group-numbers');
      if (btnInsert) btnInsert.click();
    }
  }, 100);
};

window.useGroupForSmsCampaign = function(groupId) {
  switchView('view-sms');
  if (typeof openSmsComposer === 'function') openSmsComposer();
  setTimeout(async () => {
    const groupSelect = document.getElementById('sms-contact-group-select');
    if (groupSelect) {
      groupSelect.value = String(groupId);
      if (typeof insertGroupIntoSmsComposer === 'function') {
        await insertGroupIntoSmsComposer();
      }
    }
  }, 200);
};

window.exportGroupCsvDirect = async function(groupId, groupName) {
  if (currentUser && currentUser.is_team_member && !currentUser.permissions?.can_export_contacts) {
    return showToast('error', 'Permission Denied', 'Organization security policy restricts exporting raw contact numbers.');
  }
  try {
    const res = await apiFetch(`/contacts/groups/${groupId}/all-numbers?export=true`);
    const contacts = res.contacts || [];
    if (contacts.length === 0) return showToast('warning', 'Empty Group', 'No numbers in this group to export.');
    const csvContent = 'phone_number,name\n' + contacts.map(c => `"${c.phone_number}","${(c.name || '').replace(/"/g, '""')}"`).join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${(groupName || 'group_' + groupId).replace(/\s+/g, '_')}_contacts.csv`;
    a.click();
    URL.revokeObjectURL(url);
    showToast('success', 'Export Complete', `Downloaded ${contacts.length} contacts for ${groupName}.`);
  } catch (err) {
    showToast('error', 'Export Failed', err.message);
  }
};

// --- CONTACT GROUP INSPECTOR DRAWER ---
let currentDrawerGroupId = null;
let currentDrawerContacts = [];

const drawerGroupContacts = document.getElementById('drawer-group-contacts');
const drawerGroupName = document.getElementById('drawer-group-name');
const drawerGroupCount = document.getElementById('drawer-group-count');
const drawerContactsSearch = document.getElementById('drawer-contacts-search');
const drawerContactsTbody = document.getElementById('drawer-contacts-tbody');
const btnCloseDrawerContacts = document.getElementById('btn-close-drawer-contacts');
const btnDrawerClose = document.getElementById('btn-drawer-close');
const btnDrawerExportCsv = document.getElementById('btn-drawer-export-csv');
const drawerAddPhone = document.getElementById('drawer-add-phone');
const drawerAddName = document.getElementById('drawer-add-name');
const btnDrawerAddContact = document.getElementById('btn-drawer-add-contact');

const drawerBulkNumbers = document.getElementById('drawer-bulk-numbers');
const drawerBulkCountBadge = document.getElementById('drawer-bulk-count-badge');
const btnDrawerBulkAdd = document.getElementById('btn-drawer-bulk-add');

const drawerDropzone = document.getElementById('drawer-dropzone');
const drawerFileInput = document.getElementById('drawer-file-input');
const drawerFileStatus = document.getElementById('drawer-file-status');
const btnDrawerFileAdd = document.getElementById('btn-drawer-file-add');

window.switchDrawerAddMode = function(mode) {
  currentDrawerAddMode = mode;
  const tabSingle = document.getElementById('btn-drawer-tab-single');
  const tabBulk = document.getElementById('btn-drawer-tab-bulk');
  const tabFile = document.getElementById('btn-drawer-tab-file');

  const panelSingle = document.getElementById('drawer-panel-single');
  const panelBulk = document.getElementById('drawer-panel-bulk');
  const panelFile = document.getElementById('drawer-panel-file');

  if (tabSingle) tabSingle.classList.toggle('active', mode === 'single');
  if (tabBulk) tabBulk.classList.toggle('active', mode === 'bulk');
  if (tabFile) tabFile.classList.toggle('active', mode === 'file');

  if (panelSingle) panelSingle.style.display = mode === 'single' ? 'flex' : 'none';
  if (panelBulk) panelBulk.style.display = mode === 'bulk' ? 'block' : 'none';
  if (panelFile) panelFile.style.display = mode === 'file' ? 'block' : 'none';

  if (window.lucide) lucide.createIcons();
};

if (drawerBulkNumbers) {
  drawerBulkNumbers.addEventListener('input', () => {
    const raw = drawerBulkNumbers.value.trim();
    const count = raw ? raw.split(/[\r\n,]+/).map(n => n.trim()).filter(n => n.replace(/\D/g, '').length >= 10).length : 0;
    if (drawerBulkCountBadge) drawerBulkCountBadge.textContent = `${count} Numbers`;
  });
}

if (btnDrawerBulkAdd) {
  btnDrawerBulkAdd.addEventListener('click', async () => {
    if (!currentDrawerGroupId) return;
    const raw = drawerBulkNumbers.value.trim();
    if (!raw) {
      return showToast('warning', 'Numbers Required', 'Please paste at least one phone number.');
    }
    const numbers = raw.split(/[\r\n,]+/).map(n => n.trim()).filter(Boolean);
    try {
      btnDrawerBulkAdd.disabled = true;
      btnDrawerBulkAdd.textContent = 'Saving...';
      const res = await apiFetch(`/contacts/groups/${currentDrawerGroupId}/bulk-numbers`, {
        method: 'POST',
        body: JSON.stringify({ numbers })
      });
      showToast('success', 'Contacts Added', `Added ${res.addedCount} contacts (${res.duplicatesSkipped} duplicates skipped).`);
      drawerBulkNumbers.value = '';
      if (drawerBulkCountBadge) drawerBulkCountBadge.textContent = '0 Numbers';
      openGroupContactsDrawer(currentDrawerGroupId, drawerGroupName.textContent);
      loadContactGroups();
      populateComposerSelectors();
    } catch (err) {
      showToast('error', 'Bulk Add Failed', err.message);
    } finally {
      btnDrawerBulkAdd.disabled = false;
      btnDrawerBulkAdd.innerHTML = '<i data-lucide="check" style="width:13px;height:13px;"></i> Save Numbers to Group';
      if (window.lucide) lucide.createIcons();
    }
  });
}

if (drawerDropzone && drawerFileInput) {
  drawerDropzone.addEventListener('click', () => drawerFileInput.click());
  drawerDropzone.addEventListener('dragover', (e) => {
    e.preventDefault();
    drawerDropzone.style.borderColor = '#4f46e5';
    drawerDropzone.style.background = '#eef2ff';
  });
  drawerDropzone.addEventListener('dragleave', () => {
    drawerDropzone.style.borderColor = '#cbd5e1';
    drawerDropzone.style.background = '#f8fafc';
  });
  drawerDropzone.addEventListener('drop', (e) => {
    e.preventDefault();
    drawerDropzone.style.borderColor = '#cbd5e1';
    drawerDropzone.style.background = '#f8fafc';
    if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleDrawerContactFile(e.dataTransfer.files[0]);
    }
  });

  drawerFileInput.addEventListener('change', () => {
    if (drawerFileInput.files && drawerFileInput.files[0]) {
      handleDrawerContactFile(drawerFileInput.files[0]);
    }
  });
}

function handleDrawerContactFile(file) {
  extractNumbersFromFile(file, (err, numbers) => {
    if (err) return showToast('error', 'Parse Error', err.message);
    if (!numbers || numbers.length === 0) return showToast('warning', 'No Numbers Found', 'Could not detect any 10-15 digit numbers.');
    drawerExtractedFileContacts = numbers;
    if (drawerFileStatus) {
      drawerFileStatus.textContent = `Found ${numbers.length.toLocaleString()} valid numbers from ${file.name}`;
      drawerFileStatus.style.color = '#16a34a';
      drawerFileStatus.style.fontWeight = '600';
    }
    if (btnDrawerFileAdd) {
      btnDrawerFileAdd.style.display = 'inline-flex';
      btnDrawerFileAdd.disabled = false;
      btnDrawerFileAdd.innerHTML = `<i data-lucide="check" style="width:13px;height:13px;"></i> Import ${numbers.length.toLocaleString()} Contacts`;
      if (window.lucide) lucide.createIcons();
    }
    showToast('success', 'File Parsed', `Extracted ${numbers.length} numbers ready to import.`);
  });
}

if (btnDrawerFileAdd) {
  btnDrawerFileAdd.addEventListener('click', async () => {
    if (!currentDrawerGroupId || !drawerExtractedFileContacts.length) return;
    try {
      btnDrawerFileAdd.disabled = true;
      btnDrawerFileAdd.textContent = 'Importing...';
      const res = await apiFetch(`/contacts/groups/${currentDrawerGroupId}/bulk-numbers`, {
        method: 'POST',
        body: JSON.stringify({ numbers: drawerExtractedFileContacts })
      });
      showToast('success', 'Import Complete', `Successfully imported ${res.addedCount} contacts (${res.duplicatesSkipped} duplicates skipped).`);
      drawerExtractedFileContacts = [];
      if (drawerFileStatus) {
        drawerFileStatus.textContent = 'Auto-detects phone columns even without names';
        drawerFileStatus.style.color = 'var(--slate-400)';
        drawerFileStatus.style.fontWeight = 'normal';
      }
      btnDrawerFileAdd.style.display = 'none';
      openGroupContactsDrawer(currentDrawerGroupId, drawerGroupName.textContent);
      loadContactGroups();
      populateComposerSelectors();
    } catch (err) {
      showToast('error', 'Import Failed', err.message);
    } finally {
      btnDrawerFileAdd.disabled = false;
    }
  });
}

if (btnCloseDrawerContacts) btnCloseDrawerContacts.onclick = () => closeGroupContactsDrawer();
if (btnDrawerClose) btnDrawerClose.onclick = () => closeGroupContactsDrawer();
if (drawerGroupContacts) {
  drawerGroupContacts.onclick = (e) => {
    if (e.target === drawerGroupContacts) closeGroupContactsDrawer();
  };
}

if (drawerContactsSearch) {
  drawerContactsSearch.addEventListener('input', () => renderDrawerContacts());
}

if (btnDrawerAddContact) {
  btnDrawerAddContact.addEventListener('click', async () => {
    if (!currentDrawerGroupId) return;
    const phone = drawerAddPhone ? drawerAddPhone.value.trim() : '';
    const name = drawerAddName ? drawerAddName.value.trim() : '';
    if (!phone) {
      return showToast('warning', 'Phone Required', 'Please enter a valid phone number.');
    }
    try {
      const added = await apiFetch(`/contacts/groups/${currentDrawerGroupId}/contacts`, {
        method: 'POST',
        body: JSON.stringify({ phone_number: phone, name })
      });
      showToast('success', 'Contact Added', `${phone} added to group.`);
      if (drawerAddPhone) drawerAddPhone.value = '';
      if (drawerAddName) drawerAddName.value = '';
      currentDrawerContacts.unshift(added);
      if (drawerGroupCount) drawerGroupCount.textContent = `${currentDrawerContacts.length} Contacts Saved`;
      renderDrawerContacts();
      loadContactGroups();
      populateComposerSelectors();
    } catch (err) {
      showToast('error', 'Add Failed', err.message);
    }
  });

  [drawerAddPhone, drawerAddName].forEach(inp => {
    if (inp) {
      inp.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          if (btnDrawerAddContact) btnDrawerAddContact.click();
        }
      });
    }
  });
}

window.closeGroupContactsDrawer = function() {
  if (drawerGroupContacts) drawerGroupContacts.style.display = 'none';
};

window.openGroupContactsDrawer = async function(groupId, groupName) {
  currentDrawerGroupId = groupId;
  if (!drawerGroupContacts) return;
  drawerGroupName.textContent = groupName;
  drawerGroupCount.textContent = 'Loading contacts...';
  drawerContactsTbody.innerHTML = '<tr><td colspan="3" style="text-align:center;padding:24px;color:var(--slate-400);">Loading contacts...</td></tr>';
  if (drawerContactsSearch) drawerContactsSearch.value = '';
  if (drawerAddPhone) drawerAddPhone.value = '';
  if (drawerAddName) drawerAddName.value = '';
  drawerGroupContacts.style.display = 'flex';

  if (btnDrawerExportCsv) {
    if (currentUser?.isTeamMember && !currentUser?.permissions?.can_export_contacts) {
      btnDrawerExportCsv.style.display = 'none';
    } else {
      btnDrawerExportCsv.style.display = 'inline-flex';
    }
  }

  try {
    const [contacts] = await Promise.all([
      apiFetch(`/contacts/groups/${groupId}/contacts`),
      ensureBlacklistLoaded().catch(() => {})
    ]);
    currentDrawerContacts = contacts || [];
    drawerGroupCount.textContent = `${currentDrawerContacts.length} Contacts Saved`;
    renderDrawerContacts();
  } catch (err) {
    drawerContactsTbody.innerHTML = `<tr><td colspan="3" style="text-align:center;color:red;padding:20px;">Failed to load contacts: ${escapeHtml(err.message)}</td></tr>`;
  }
};

function renderDrawerContacts() {
  if (!drawerContactsTbody) return;
  const q = (drawerContactsSearch ? drawerContactsSearch.value : '').toLowerCase().trim();
  const canManage = !currentUser?.isTeamMember || Boolean(currentUser?.permissions?.can_manage_contacts);
  const filtered = currentDrawerContacts.filter(c => {
    if (!q) return true;
    return (c.phone_number || '').includes(q) || (c.name || '').toLowerCase().includes(q);
  });

  if (filtered.length === 0) {
    drawerContactsTbody.innerHTML = '<tr><td colspan="3" style="text-align:center;padding:24px;color:var(--slate-400);">No contacts match your search.</td></tr>';
    return;
  }

  drawerContactsTbody.innerHTML = filtered.map(c => {
    const isDnd = cachedBlacklistSet && cachedBlacklistSet.has(c.phone_number);
    return `
    <tr>
      <td>
        <div style="display:flex;align-items:center;gap:6px;">
          <strong style="color:var(--slate-800);">${escapeHtml(c.phone_number)}</strong>
          ${isDnd ? `<span class="status-badge badge-rejected" style="font-size:0.65rem;padding:1px 6px;line-height:1.2;display:inline-flex;align-items:center;gap:2px;" title="This number is on the DND Blacklist"><i data-lucide="shield-ban" style="width:10px;height:10px;"></i> DND</span>` : ''}
        </div>
      </td>
      <td><span style="color:var(--slate-600);">${escapeHtml(c.name || '—')}</span></td>
      <td>
        ${canManage ? `
          <button type="button" class="btn-action btn-action-danger" onclick="deleteContactFromGroup(${currentDrawerGroupId}, ${c.id})" style="padding:3px 7px;font-size:0.75rem;" title="Delete this number">
            <i data-lucide="trash-2" style="width:12px;height:12px;"></i>
          </button>
        ` : '<span style="color:var(--slate-400);font-size:0.75rem;">—</span>'}
      </td>
    </tr>
  `;
  }).join('');

  if (window.lucide) lucide.createIcons({ root: drawerContactsTbody });
}

window.deleteContactFromGroup = function(groupId, contactId) {
  window.openActionDialog({
    title: 'Remove Contact Number',
    message: 'Are you sure you want to remove this contact number from the group?',
    icon: 'trash-2',
    iconColor: '#dc2626',
    iconBg: '#fee2e2',
    confirmText: 'Remove Number',
    confirmClass: 'btn-action-danger',
    onConfirm: async () => {
      try {
        await apiFetch(`/contacts/groups/${groupId}/contacts/${contactId}`, { method: 'DELETE' });
        showToast('success', 'Contact Removed', 'Number deleted from group.');
        currentDrawerContacts = currentDrawerContacts.filter(c => Number(c.id) !== Number(contactId));
        if (drawerGroupCount) drawerGroupCount.textContent = `${currentDrawerContacts.length} Contacts Saved`;
        renderDrawerContacts();
        loadContactGroups();
        populateComposerSelectors();
      } catch (err) {
        showToast('error', 'Delete Failed', err.message);
      }
    }
  });
};

if (btnDrawerExportCsv) {
  btnDrawerExportCsv.addEventListener('click', async () => {
    if (!currentDrawerGroupId) return;
    try {
      const res = await apiFetch(`/contacts/groups/${currentDrawerGroupId}/all-numbers?export=true`);
      const contacts = res.contacts || [];
      if (contacts.length === 0) return showToast('warning', 'Empty Group', 'No numbers to export.');
      const csvContent = 'phone_number,name\n' + contacts.map(c => `"${c.phone_number}","${(c.name || '').replace(/"/g, '""')}"`).join('\n');
      const blob = new Blob([csvContent], { type: 'text/csv' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `group_${currentDrawerGroupId}_contacts.csv`;
      a.click();
      URL.revokeObjectURL(url);
      showToast('success', 'Exported', `Exported ${contacts.length} contacts to CSV.`);
    } catch (err) {
      showToast('error', 'Export Failed', err.message);
    }
  });
}

window.clearGroupContacts = function() {
  if (!currentDrawerGroupId) return;
  window.openActionDialog({
    title: 'Empty Contact Group',
    message: 'Are you sure you want to remove ALL contacts from this group? The group will be emptied but kept in your phonebook.',
    icon: 'trash',
    iconColor: '#dc2626',
    iconBg: '#fee2e2',
    confirmText: 'Empty Group',
    confirmClass: 'btn-action-danger',
    onConfirm: async () => {
      try {
        await apiFetch(`/contacts/groups/${currentDrawerGroupId}/clear`, { method: 'DELETE' });
        showToast('info', 'Group Emptied', 'All contacts have been removed.');
        currentDrawerContacts = [];
        if (drawerGroupCount) drawerGroupCount.textContent = '0 Contacts Saved';
        renderDrawerContacts();
        loadContactGroups();
        populateComposerSelectors();
      } catch (err) {
        showToast('error', 'Clear Failed', err.message);
      }
    }
  });
};

window.deleteContactGroup = function(id) {
  window.openActionDialog({
    title: 'Delete Contact Group',
    message: 'Are you sure you want to delete this contact group? All contacts inside it will be permanently removed.',
    icon: 'trash-2',
    iconColor: '#dc2626',
    iconBg: '#fee2e2',
    confirmText: 'Delete Group',
    confirmClass: 'btn-action-danger',
    onConfirm: async () => {
      try {
        await apiFetch(`/contacts/groups/${id}`, { method: 'DELETE' });
        showToast('info', 'Deleted', 'Contact group deleted.');
        loadContactGroups();
        populateComposerSelectors();
      } catch (err) {
        showToast('error', 'Delete Failed', err.message);
      }
    }
  });
};

window.switchBlacklistMode = function(mode) {
  currentBlacklistMode = mode;
  const tabSingle = document.getElementById('btn-bllist-tab-single');
  const tabBulk = document.getElementById('btn-bllist-tab-bulk');
  const wrapSingle = document.getElementById('wrap-bllist-single');
  const wrapBulk = document.getElementById('wrap-bllist-bulk');

  if (tabSingle) tabSingle.classList.toggle('active', mode === 'single');
  if (tabBulk) tabBulk.classList.toggle('active', mode === 'bulk');
  if (wrapSingle) wrapSingle.style.display = mode === 'single' ? 'block' : 'none';
  if (wrapBulk) wrapBulk.style.display = mode === 'bulk' ? 'block' : 'none';
  if (window.lucide) lucide.createIcons();
};

const modalBlacklistBulkNumbers = document.getElementById('modal-blacklist-bulk-numbers');
const modalBlacklistCountBadge = document.getElementById('modal-blacklist-count-badge');
const modalBlacklistDropzone = document.getElementById('modal-blacklist-dropzone');
const modalBlacklistFileInput = document.getElementById('modal-blacklist-file-input');

if (modalBlacklistBulkNumbers) {
  modalBlacklistBulkNumbers.addEventListener('input', () => {
    const raw = modalBlacklistBulkNumbers.value.trim();
    const count = raw ? raw.split(/[\r\n,]+/).map(n => n.trim()).filter(n => n.replace(/\D/g, '').length >= 10).length : 0;
    if (modalBlacklistCountBadge) modalBlacklistCountBadge.textContent = `${count} Numbers`;
  });
}

if (modalBlacklistDropzone && modalBlacklistFileInput) {
  modalBlacklistDropzone.addEventListener('click', () => modalBlacklistFileInput.click());
  modalBlacklistDropzone.addEventListener('dragover', (e) => {
    e.preventDefault();
    modalBlacklistDropzone.style.borderColor = '#dc2626';
    modalBlacklistDropzone.style.background = '#fef2f2';
  });
  modalBlacklistDropzone.addEventListener('dragleave', () => {
    modalBlacklistDropzone.style.borderColor = '#cbd5e1';
    modalBlacklistDropzone.style.background = '#f8fafc';
  });
  modalBlacklistDropzone.addEventListener('drop', (e) => {
    e.preventDefault();
    modalBlacklistDropzone.style.borderColor = '#cbd5e1';
    modalBlacklistDropzone.style.background = '#f8fafc';
    if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]) {
      extractNumbersFromFile(e.dataTransfer.files[0], (err, numbers) => {
        if (err) return showToast('error', 'Parse Error', err.message);
        if (!numbers || !numbers.length) return showToast('warning', 'No Numbers Found', 'Could not detect any phone numbers in this file.');
        const existing = modalBlacklistBulkNumbers.value.trim();
        modalBlacklistBulkNumbers.value = existing ? existing + '\n' + numbers.join('\n') : numbers.join('\n');
        modalBlacklistBulkNumbers.dispatchEvent(new Event('input'));
        showToast('success', 'File Parsed', `Loaded ${numbers.length} numbers from ${e.dataTransfer.files[0].name}`);
      });
    }
  });

  modalBlacklistFileInput.addEventListener('change', () => {
    if (modalBlacklistFileInput.files && modalBlacklistFileInput.files[0]) {
      const file = modalBlacklistFileInput.files[0];
      extractNumbersFromFile(file, (err, numbers) => {
        if (err) return showToast('error', 'Parse Error', err.message);
        if (!numbers || !numbers.length) return showToast('warning', 'No Numbers Found', 'Could not detect any phone numbers in this file.');
        const existing = modalBlacklistBulkNumbers.value.trim();
        modalBlacklistBulkNumbers.value = existing ? existing + '\n' + numbers.join('\n') : numbers.join('\n');
        modalBlacklistBulkNumbers.dispatchEvent(new Event('input'));
        showToast('success', 'File Parsed', `Loaded ${numbers.length} numbers from ${file.name}`);
      });
    }
  });
}

if (btnAddBlacklistModal) {
  btnAddBlacklistModal.addEventListener('click', () => {
    if (modalBlacklistPhone) modalBlacklistPhone.value = '';
    if (modalBlacklistReason) modalBlacklistReason.value = '';
    if (modalBlacklistBulkNumbers) modalBlacklistBulkNumbers.value = '';
    if (modalBlacklistCountBadge) modalBlacklistCountBadge.textContent = '0 Numbers';
    switchBlacklistMode('single');

    const globalWrap = document.getElementById('modal-blacklist-global-wrap');
    const isGlobalChk = document.getElementById('modal-blacklist-is-global');
    if (globalWrap) {
      globalWrap.style.display = (currentUser && currentUser.role === 'admin') ? 'block' : 'none';
    }
    if (isGlobalChk) isGlobalChk.checked = false;
    if (modalAddBlacklist) modalAddBlacklist.style.display = 'flex';
  });
}

if (btnModalSaveBlacklist) {
  btnModalSaveBlacklist.addEventListener('click', async () => {
    const reason = modalBlacklistReason ? modalBlacklistReason.value.trim() : '';
    const isGlobalChk = document.getElementById('modal-blacklist-is-global');
    const is_global = isGlobalChk ? isGlobalChk.checked : false;

    if (currentBlacklistMode === 'single') {
      const phone_number = modalBlacklistPhone ? modalBlacklistPhone.value.trim() : '';
      if (!phone_number) {
        showToast('warning', 'Phone Required', 'Enter the phone number to block.');
        return;
      }
      try {
        btnModalSaveBlacklist.disabled = true;
        await apiFetch('/contacts/blacklist', {
          method: 'POST',
          body: JSON.stringify({ phone_number, reason, is_global })
        });
        showToast('success', 'Blacklisted', `${phone_number} has been blocked.`);
        if (modalAddBlacklist) modalAddBlacklist.style.display = 'none';
        loadBlacklist();
        ensureBlacklistLoaded().catch(() => {});
      } catch (err) {
        showToast('error', 'Error', err.message);
      } finally {
        btnModalSaveBlacklist.disabled = false;
      }
    } else {
      // Bulk mode
      const raw = modalBlacklistBulkNumbers ? modalBlacklistBulkNumbers.value.trim() : '';
      if (!raw) {
        return showToast('warning', 'Numbers Required', 'Please paste at least one phone number to block.');
      }
      const numbers = raw.split(/[\r\n,]+/).map(n => n.trim()).filter(Boolean);
      try {
        btnModalSaveBlacklist.disabled = true;
        btnModalSaveBlacklist.textContent = 'Blocking...';
        const res = await apiFetch('/contacts/blacklist/bulk', {
          method: 'POST',
          body: JSON.stringify({ numbers, reason, is_global })
        });
        showToast('success', 'Bulk Blacklist Complete', `Blocked ${res.addedCount} numbers (${res.skippedCount} skipped/duplicates).`);
        if (modalAddBlacklist) modalAddBlacklist.style.display = 'none';
        loadBlacklist();
        ensureBlacklistLoaded().catch(() => {});
      } catch (err) {
        showToast('error', 'Bulk Block Failed', err.message);
      } finally {
        btnModalSaveBlacklist.disabled = false;
        btnModalSaveBlacklist.textContent = 'Block Number(s)';
      }
    }
  });
}

if (btnExportBlacklistCsv) {
  btnExportBlacklistCsv.addEventListener('click', () => {
    if (!cachedBlacklist || cachedBlacklist.length === 0) {
      return showToast('warning', 'Empty Registry', 'No blacklisted numbers to export.');
    }
    const header = 'phone_number,classification,reason,created_at\n';
    const rows = cachedBlacklist.map(b => {
      const scope = (b.user_id === null) ? 'Global Platform DND' : 'Account DND';
      const cleanReason = (b.reason || '').replace(/"/g, '""');
      return `"${b.phone_number}","${scope}","${cleanReason}","${b.created_at || ''}"`;
    }).join('\n');
    const blob = new Blob([header + rows], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `dnd_blacklist_export_${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    showToast('success', 'Exported', `Exported ${cachedBlacklist.length} DND numbers.`);
  });
}

async function loadBlacklist() {
  if (!blacklistTbody) return;
  try {
    const res = await apiFetch('/contacts/blacklist?limit=1000');
    cachedBlacklist = Array.isArray(res) ? res : (res.data || []);

    // Setup Blacklist Filter for Admin & Reseller
    const blFilter = document.getElementById('blacklist-user-filter');
    if (blFilter) {
      if (currentUser && (currentUser.role === 'admin' || currentUser.role === 'reseller')) {
        blFilter.style.display = 'inline-block';
        const distinctOwners = Array.from(new Set(cachedBlacklist.map(b => b.owner_email).filter(Boolean)));
        const currentVal = blFilter.value;
        blFilter.innerHTML = '<option value="">All Scopes & Accounts</option><option value="__global__">Global Platform DND</option>' + 
          distinctOwners.map(e => `<option value="${escapeHtml(e)}">${escapeHtml(e)}</option>`).join('');
        if (distinctOwners.includes(currentVal) || currentVal === '__global__') {
          blFilter.value = currentVal;
        }
        blFilter.onchange = () => renderBlacklistTable();
      } else {
        blFilter.style.display = 'none';
      }
    }

    renderBlacklistTable();
  } catch (err) {
    blacklistTbody.innerHTML = `<tr><td colspan="5" style="text-align:center;color:red;padding:20px;">Failed to load DND blacklist: ${escapeHtml(err.message)}</td></tr>`;
  }
}

function renderBlacklistTable() {
  if (!blacklistTbody) return;
  const kpiBlacklist = document.getElementById('kpi-total-blacklist');
  const badgeBlacklist = document.getElementById('badge-blacklist-count');
  if (kpiBlacklist) kpiBlacklist.textContent = cachedBlacklist.length.toLocaleString();
  if (badgeBlacklist) badgeBlacklist.textContent = cachedBlacklist.length;

  const blFilter = document.getElementById('blacklist-user-filter');
  const selectedScope = (blFilter && blFilter.value) ? blFilter.value.trim() : '';

  const q = (blacklistSearch ? blacklistSearch.value : '').toLowerCase().trim();
  const filtered = cachedBlacklist.filter(item => {
    if (selectedScope === '__global__' && (item.user_id !== null && item.user_id !== undefined)) return false;
    if (selectedScope && selectedScope !== '__global__' && item.owner_email !== selectedScope) return false;
    if (!q) return true;
    return (item.phone_number || '').includes(q) || (item.reason || '').toLowerCase().includes(q) || (item.owner_email || '').toLowerCase().includes(q);
  });

  if (filtered.length === 0) {
    blacklistTbody.innerHTML = `
      <tr>
        <td colspan="5">
          <div class="empty-state-box">
            <div class="empty-state-icon"><i data-lucide="shield-check" style="width:24px;height:24px;color:#16a34a;"></i></div>
            <div class="empty-state-title">${q ? 'No matching blocked numbers' : 'No numbers in DND blacklist'}</div>
            <div class="empty-state-desc">${q ? 'No blacklisted numbers match your filter.' : 'All customer contacts are eligible for campaign dispatches.'}</div>
          </div>
        </td>
      </tr>
    `;
    if (window.lucide) lucide.createIcons({ root: blacklistTbody });
    return;
  }

  blacklistTbody.innerHTML = filtered.map(item => {
    const isGlobal = (item.user_id === null || item.user_id === undefined);
    return `
      <tr>
        <td>
          <div style="display:flex;align-items:center;gap:8px;">
            <i data-lucide="phone-off" style="width:14px;height:14px;color:#dc2626;"></i>
            <strong style="color:var(--slate-800);letter-spacing:0.5px;">${escapeHtml(item.phone_number)}</strong>
          </div>
        </td>
        <td>
          ${isGlobal 
            ? `<span class="status-badge badge-rejected" style="font-size:0.75rem;"><i data-lucide="globe" style="width:12px;height:12px;"></i> Global Platform DND</span>`
            : `<span class="status-badge badge-submitted" style="font-size:0.75rem;"><i data-lucide="user" style="width:12px;height:12px;"></i> ${item.owner_email && currentUser && (currentUser.role === 'admin' || currentUser.role === 'reseller') ? escapeHtml(item.owner_email) : 'Account DND'}</span>`}
        </td>
        <td>
          <span style="font-size:0.82rem;color:var(--slate-700);">${escapeHtml(item.reason || 'User opt-out')}</span>
        </td>
        <td>
          <span style="font-size:0.8rem;color:var(--slate-500);">${item.created_at ? new Date(item.created_at).toLocaleDateString() : '—'}</span>
        </td>
        <td>
          <div style="display:flex;justify-content:flex-end;">
            <button type="button" class="btn-action btn-action-secondary" data-action="remove-blacklist" data-phone="${escapeHtml(item.phone_number)}" style="display:inline-flex;align-items:center;gap:4px;padding:4px 9px;font-size:0.78rem;">
              <i data-lucide="unlock" style="width:12px;height:12px;"></i> Unblock
            </button>
          </div>
        </td>
      </tr>
    `;
  }).join('');
  if (window.lucide) lucide.createIcons({ root: blacklistTbody });
}

window.confirmRemoveBlacklist = function(phone) {
  window.openActionDialog({
    title: 'Unblock Number',
    message: `Are you sure you want to unblock ${phone}? It will be eligible for future message dispatches.`,
    icon: 'unlock',
    iconColor: '#059669',
    iconBg: '#ecfdf5',
    confirmText: 'Unblock Number',
    confirmClass: 'btn-action-primary',
    onConfirm: async () => {
      try {
        await apiFetch(`/contacts/blacklist/${phone}`, { method: 'DELETE' });
        showToast('info', 'Unblocked', `${phone} removed from blacklist.`);
        loadBlacklist();
      } catch (err) {
        showToast('error', 'Error', err.message);
      }
    }
  });
};

window.removeBlacklist = async function(phone) {
  window.confirmRemoveBlacklist(phone);
};

// ==========================================
// ENTERPRISE MODULE 2: MESSAGE TEMPLATES (WHATSAPP & SMS GSM)
// ==========================================
const templatesTbody = document.getElementById('templates-tbody');
const modalCreateTemplate = document.getElementById('modal-create-template');
const btnCreateTemplateModal = document.getElementById('btn-create-template-modal');
const btnModalSaveTemplate = document.getElementById('btn-modal-save-template');
const modalTemplateName = document.getElementById('modal-template-name');
const modalTemplateCat = document.getElementById('modal-template-cat');
const modalTemplateBody = document.getElementById('modal-template-body');

const modalEditTemplate = document.getElementById('modal-edit-template');
const modalEditTplId = document.getElementById('modal-edit-tpl-id');
const modalEditTplName = document.getElementById('modal-edit-tpl-name');
const modalEditTplCat = document.getElementById('modal-edit-tpl-cat');
const modalEditTplBody = document.getElementById('modal-edit-tpl-body');
const btnModalUpdateTemplate = document.getElementById('btn-modal-update-template');

const modalPreviewTemplate = document.getElementById('modal-preview-template');
const modalStarterTemplates = document.getElementById('modal-starter-templates');
const btnOpenStarters = document.getElementById('btn-open-starters');

let currentTemplateChannel = 'all'; // 'all', 'whatsapp', 'sms'
let cachedStarterTemplates = [];

// Template Media Upload State (Standard: 3 Images, 1 Video, 1 PDF; CTA: Single Media)
const tplMediaStates = {
  create: {
    images: [null, null, null],
    video: null,
    pdf: null,
    ctaMedia: { type: 'none', file: null }
  },
  edit: {
    images: [null, null, null],
    video: null,
    pdf: null,
    ctaMedia: { type: 'none', file: null, existingUrl: null, name: null }
  }
};

function resetTplMedia(mode) {
  const st = tplMediaStates[mode];
  st.images = [null, null, null];
  st.video = null;
  st.pdf = null;
  st.ctaMedia = { type: 'none', file: null, existingUrl: null, name: null };

  // Reset Standard Images (1, 2, 3)
  for (let i = 1; i <= 3; i++) {
    const slotBox = document.getElementById(`tpl-${mode}-slot-img-${i}`);
    const empty = document.getElementById(`tpl-${mode}-empty-img-${i}`);
    const filled = document.getElementById(`tpl-${mode}-filled-img-${i}`);
    const thumb = document.getElementById(`tpl-${mode}-thumb-img-${i}`);
    const input = document.getElementById(`input-tpl-${mode}-img-${i}`);
    if (slotBox) slotBox.classList.remove('has-file');
    if (empty) empty.style.display = 'flex';
    if (filled) filled.style.display = 'none';
    if (thumb) thumb.src = '';
    if (input) input.value = '';
  }

  // Reset Video
  const vidPh = document.getElementById(`tpl-${mode}-video-placeholder`);
  const vidPrev = document.getElementById(`tpl-${mode}-video-preview`);
  const vidInput = document.getElementById(`input-tpl-${mode}-video`);
  if (vidPh) vidPh.style.display = 'flex';
  if (vidPrev) vidPrev.style.display = 'none';
  if (vidInput) vidInput.value = '';

  // Reset PDF
  const pdfPh = document.getElementById(`tpl-${mode}-pdf-placeholder`);
  const pdfPrev = document.getElementById(`tpl-${mode}-pdf-preview`);
  const pdfInput = document.getElementById(`input-tpl-${mode}-pdf`);
  if (pdfPh) pdfPh.style.display = 'flex';
  if (pdfPrev) pdfPrev.style.display = 'none';
  if (pdfInput) pdfInput.value = '';

  // Reset CTA Media
  const ctaPills = document.querySelectorAll(`#tpl-${mode}-cta-media-pills button`);
  ctaPills.forEach(b => b.classList.toggle('active', b.dataset[`tpl${mode === 'edit' ? 'Edit' : 'Create'}CtaMedia`] === 'none'));
  const ctaBadge = document.getElementById(`tpl-${mode}-cta-media-badge`);
  const ctaDrop = document.getElementById(`dropzone-tpl-${mode}-cta-media`);
  const ctaPh = document.getElementById(`tpl-${mode}-cta-media-placeholder`);
  const ctaPrev = document.getElementById(`tpl-${mode}-cta-media-preview`);
  const ctaInput = document.getElementById(`input-tpl-${mode}-cta-media`);
  if (ctaBadge) ctaBadge.textContent = 'None';
  if (ctaDrop) ctaDrop.style.display = 'none';
  if (ctaPh) ctaPh.style.display = 'flex';
  if (ctaPrev) ctaPrev.style.display = 'none';
  if (ctaInput) ctaInput.value = '';
}

function setupAllTemplateMediaListeners(mode) {
  const isEdit = (mode === 'edit');
  const dataKey = isEdit ? 'tplEditCtaMedia' : 'tplCreateCtaMedia';

  // 1. Standard Images (Slots 1, 2, 3)
  for (let i = 1; i <= 3; i++) {
    const slotIdx = i - 1;
    const slotBox = document.getElementById(`tpl-${mode}-slot-img-${i}`);
    const input = document.getElementById(`input-tpl-${mode}-img-${i}`);
    const empty = document.getElementById(`tpl-${mode}-empty-img-${i}`);
    const filled = document.getElementById(`tpl-${mode}-filled-img-${i}`);
    const thumb = document.getElementById(`tpl-${mode}-thumb-img-${i}`);
    const nameEl = document.getElementById(`tpl-${mode}-name-img-${i}`);
    const btnRemove = document.getElementById(`btn-remove-tpl-${mode}-img-${i}`);

    if (slotBox && input) {
      slotBox.addEventListener('click', (e) => {
        if (e.target.closest(`#btn-remove-tpl-${mode}-img-${i}`)) return;
        input.click();
      });

      input.addEventListener('change', () => {
        if (input.files && input.files[0]) {
          const file = input.files[0];
          if (!file.type.startsWith('image/')) {
            showToast('warning', 'Invalid File', 'Please select a valid image (JPG or PNG).');
            return;
          }
          if (file.size > 3 * 1024 * 1024) {
            showToast('warning', 'File Too Large', `Image exceeds 3 MB limit (${(file.size / (1024 * 1024)).toFixed(1)} MB).`);
            return;
          }
          tplMediaStates[mode].images[slotIdx] = { file, name: file.name, size: file.size };
          if (thumb) thumb.src = URL.createObjectURL(file);
          if (nameEl) nameEl.textContent = file.name;
          if (empty) empty.style.display = 'none';
          if (filled) filled.style.display = 'flex';
          slotBox.classList.add('has-file');
          showToast('success', 'Image Attached', `Slot ${i}: "${file.name}"`);
        }
      });
    }

    if (btnRemove) {
      btnRemove.addEventListener('click', (e) => {
        e.stopPropagation();
        tplMediaStates[mode].images[slotIdx] = null;
        if (input) input.value = '';
        if (empty) empty.style.display = 'flex';
        if (filled) filled.style.display = 'none';
        if (thumb) thumb.src = '';
        if (slotBox) slotBox.classList.remove('has-file');
      });
    }
  }

  // 2. Video Upload (Max 20 MB)
  const vidDrop = document.getElementById(`dropzone-tpl-${mode}-video`);
  const vidInput = document.getElementById(`input-tpl-${mode}-video`);
  const vidPh = document.getElementById(`tpl-${mode}-video-placeholder`);
  const vidPrev = document.getElementById(`tpl-${mode}-video-preview`);
  const vidName = document.getElementById(`tpl-${mode}-video-name`);
  const vidSize = document.getElementById(`tpl-${mode}-video-size`);
  const btnRemoveVid = document.getElementById(`btn-remove-tpl-${mode}-video`);

  if (vidDrop && vidInput) {
    vidDrop.addEventListener('click', (e) => {
      if (e.target.closest(`#btn-remove-tpl-${mode}-video`)) return;
      vidInput.click();
    });

    vidInput.addEventListener('change', () => {
      if (vidInput.files && vidInput.files[0]) {
        const file = vidInput.files[0];
        if (!file.type.startsWith('video/') && !file.name.toLowerCase().endsWith('.mp4')) {
          showToast('warning', 'Invalid File', 'Please select an MP4 video file.');
          return;
        }
        if (file.size > 20 * 1024 * 1024) {
          showToast('warning', 'File Too Large', `Video exceeds 20 MB limit (${(file.size / (1024 * 1024)).toFixed(1)} MB).`);
          return;
        }
        tplMediaStates[mode].video = { file, name: file.name, size: file.size };
        if (vidName) vidName.textContent = file.name;
        if (vidSize) vidSize.textContent = (file.size / (1024 * 1024)).toFixed(1) + ' MB';
        if (vidPh) vidPh.style.display = 'none';
        if (vidPrev) vidPrev.style.display = 'flex';
        showToast('success', 'Video Attached', `Attached "${file.name}".`);
      }
    });
  }

  if (btnRemoveVid) {
    btnRemoveVid.addEventListener('click', (e) => {
      e.stopPropagation();
      tplMediaStates[mode].video = null;
      if (vidInput) vidInput.value = '';
      if (vidPh) vidPh.style.display = 'flex';
      if (vidPrev) vidPrev.style.display = 'none';
    });
  }

  // 3. PDF Upload (Max 10 MB)
  const pdfDrop = document.getElementById(`dropzone-tpl-${mode}-pdf`);
  const pdfInput = document.getElementById(`input-tpl-${mode}-pdf`);
  const pdfPh = document.getElementById(`tpl-${mode}-pdf-placeholder`);
  const pdfPrev = document.getElementById(`tpl-${mode}-pdf-preview`);
  const pdfName = document.getElementById(`tpl-${mode}-pdf-name`);
  const pdfSize = document.getElementById(`tpl-${mode}-pdf-size`);
  const btnRemovePdf = document.getElementById(`btn-remove-tpl-${mode}-pdf`);

  if (pdfDrop && pdfInput) {
    pdfDrop.addEventListener('click', (e) => {
      if (e.target.closest(`#btn-remove-tpl-${mode}-pdf`)) return;
      pdfInput.click();
    });

    pdfInput.addEventListener('change', () => {
      if (pdfInput.files && pdfInput.files[0]) {
        const file = pdfInput.files[0];
        if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
          showToast('warning', 'Invalid File', 'Please select a valid PDF document.');
          return;
        }
        if (file.size > 10 * 1024 * 1024) {
          showToast('warning', 'File Too Large', `PDF exceeds 10 MB limit (${(file.size / (1024 * 1024)).toFixed(1)} MB).`);
          return;
        }
        tplMediaStates[mode].pdf = { file, name: file.name, size: file.size };
        if (pdfName) pdfName.textContent = file.name;
        if (pdfSize) pdfSize.textContent = (file.size / (1024 * 1024)).toFixed(1) + ' MB';
        if (pdfPh) pdfPh.style.display = 'none';
        if (pdfPrev) pdfPrev.style.display = 'flex';
        showToast('success', 'PDF Attached', `Attached "${file.name}".`);
      }
    });
  }

  if (btnRemovePdf) {
    btnRemovePdf.addEventListener('click', (e) => {
      e.stopPropagation();
      tplMediaStates[mode].pdf = null;
      if (pdfInput) pdfInput.value = '';
      if (pdfPh) pdfPh.style.display = 'flex';
      if (pdfPrev) pdfPrev.style.display = 'none';
    });
  }

  // 4. CTA Single Media Header
  const ctaPills = document.querySelectorAll(`#tpl-${mode}-cta-media-pills button`);
  const ctaInput = document.getElementById(`input-tpl-${mode}-cta-media`);
  const ctaDrop = document.getElementById(`dropzone-tpl-${mode}-cta-media`);
  const ctaPh = document.getElementById(`tpl-${mode}-cta-media-placeholder`);
  const ctaPhText = document.getElementById(`tpl-${mode}-cta-media-placeholder-text`);
  const ctaPrev = document.getElementById(`tpl-${mode}-cta-media-preview`);
  const ctaThumb = document.getElementById(`tpl-${mode}-cta-thumb-img`);
  const ctaIconBox = document.getElementById(`tpl-${mode}-cta-icon-box`);
  const ctaTypeIcon = document.getElementById(`tpl-${mode}-cta-type-icon`);
  const ctaFileName = document.getElementById(`tpl-${mode}-cta-file-name`);
  const ctaFileSize = document.getElementById(`tpl-${mode}-cta-file-size`);
  const ctaBadge = document.getElementById(`tpl-${mode}-cta-media-badge`);
  const btnRemoveCta = document.getElementById(`btn-remove-tpl-${mode}-cta-media`);

  ctaPills.forEach(btn => {
    btn.addEventListener('click', () => {
      const targetType = btn.dataset[dataKey];
      tplMediaStates[mode].ctaMedia.type = targetType;
      ctaPills.forEach(b => b.classList.toggle('active', b === btn));

      if (targetType === 'none') {
        if (ctaBadge) ctaBadge.textContent = 'None';
        if (ctaDrop) ctaDrop.style.display = 'none';
        tplMediaStates[mode].ctaMedia.file = null;
        if (ctaInput) ctaInput.value = '';
        return;
      }

      if (ctaDrop) ctaDrop.style.display = 'block';
      if (ctaBadge) ctaBadge.textContent = targetType.toUpperCase();

      if (ctaInput) {
        if (targetType === 'image') {
          ctaInput.accept = '.jpg,.jpeg,.png,image/jpeg,image/png';
          if (ctaPhText) ctaPhText.textContent = 'Click to select CTA Image (Max 3MB)';
        } else if (targetType === 'pdf') {
          ctaInput.accept = '.pdf,application/pdf';
          if (ctaPhText) ctaPhText.textContent = 'Click to select CTA PDF (Max 10MB)';
        } else if (targetType === 'video') {
          ctaInput.accept = '.mp4,video/mp4,video/*';
          if (ctaPhText) ctaPhText.textContent = 'Click to select CTA Video (Max 20MB)';
        }
        ctaInput.value = '';
      }

      if (!tplMediaStates[mode].ctaMedia.file && !tplMediaStates[mode].ctaMedia.existingUrl) {
        if (ctaInput) ctaInput.click();
      }
    });
  });

  if (ctaDrop && ctaInput) {
    ctaDrop.addEventListener('click', (e) => {
      if (e.target.closest(`#btn-remove-tpl-${mode}-cta-media`)) return;
      ctaInput.click();
    });

    ctaInput.addEventListener('change', () => {
      if (ctaInput.files && ctaInput.files[0]) {
        const file = ctaInput.files[0];
        const targetType = tplMediaStates[mode].ctaMedia.type;

        if (targetType === 'image') {
          if (!file.type.startsWith('image/')) return showToast('warning', 'Invalid File', 'Please select a JPG or PNG.');
          if (file.size > 3 * 1024 * 1024) return showToast('warning', 'File Too Large', 'Image exceeds 3 MB limit.');
        } else if (targetType === 'pdf') {
          if (file.type !== 'application/pdf' && !file.name.endsWith('.pdf')) return showToast('warning', 'Invalid File', 'Please select a PDF document.');
          if (file.size > 10 * 1024 * 1024) return showToast('warning', 'File Too Large', 'PDF exceeds 10 MB limit.');
        } else if (targetType === 'video') {
          if (!file.type.startsWith('video/') && !file.name.endsWith('.mp4')) return showToast('warning', 'Invalid File', 'Please select an MP4 video.');
          if (file.size > 20 * 1024 * 1024) return showToast('warning', 'File Too Large', 'Video exceeds 20 MB limit.');
        }

        tplMediaStates[mode].ctaMedia.file = file;
        if (ctaFileName) ctaFileName.textContent = file.name;
        if (ctaFileSize) ctaFileSize.textContent = (file.size / (1024 * 1024)).toFixed(1) + ' MB';
        if (ctaPh) ctaPh.style.display = 'none';
        if (ctaPrev) ctaPrev.style.display = 'flex';

        if (targetType === 'image') {
          if (ctaThumb) { ctaThumb.src = URL.createObjectURL(file); ctaThumb.style.display = 'block'; }
          if (ctaIconBox) ctaIconBox.style.display = 'none';
        } else {
          if (ctaThumb) ctaThumb.style.display = 'none';
          if (ctaIconBox) {
            ctaIconBox.style.display = 'flex';
            ctaIconBox.style.background = (targetType === 'pdf') ? '#fee2e2' : '#e0f2fe';
            ctaIconBox.style.color = (targetType === 'pdf') ? '#b91c1c' : '#0284c7';
          }
          if (ctaTypeIcon) ctaTypeIcon.setAttribute('data-lucide', targetType === 'pdf' ? 'file-text' : 'video');
        }
        showToast('success', 'CTA Media Attached', file.name);
        if (window.lucide) lucide.createIcons({ root: ctaDrop });
      }
    });
  }

  if (btnRemoveCta) {
    btnRemoveCta.addEventListener('click', (e) => {
      e.stopPropagation();
      tplMediaStates[mode].ctaMedia = { type: 'none', file: null, existingUrl: null, name: null };
      ctaPills.forEach(b => b.classList.toggle('active', b.dataset[dataKey] === 'none'));
      if (ctaBadge) ctaBadge.textContent = 'None';
      if (ctaDrop) ctaDrop.style.display = 'none';
      if (ctaInput) ctaInput.value = '';
      if (ctaPh) ctaPh.style.display = 'flex';
      if (ctaPrev) ctaPrev.style.display = 'none';
    });
  }
}

// Initialize template media listeners for Create & Edit modals
setupAllTemplateMediaListeners('create');
setupAllTemplateMediaListeners('edit');

// GSM-7 Basic & Extended Character Set (Standard Latin Telecom Specification 3GPP TS 23.038)
const GSM_7_EXTENDED_CHARS = new Set(['^', '{', '}', '\\', '[', '~', ']', '|', '€']);
const GSM_7_REGEX = /^[A-Za-z0-9 \r\n@£$¥èéùìòÇØøÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ!"#¤%&'()*+,\-./:;<=>?¡¿ÄÖÑÜ§äöñüà\^{}\[~\]|€]*$/;

// Live GSM & Unicode Calculation Helper (Compliant with 3GPP Concatenation Standards)
function computeGsmMetrics(text, channel = 'whatsapp', forceUnicode = false) {
  const str = String(text || '');
  const rawGlyphCount = Array.from(str).length;

  if (channel === 'whatsapp') {
    return {
      charCount: rawGlyphCount,
      isUnicode: false,
      parts: 1,
      carrierWarning: null,
      infoText: 'WhatsApp Rich Message • 1 Credit per recipient',
      badgeText: `${rawGlyphCount} chars • 1 Credit`
    };
  }

  const isUnicode = Boolean(forceUnicode) || !GSM_7_REGEX.test(str);
  let effectiveCharCount = 0;
  let parts = 1;
  let charsLeft = 0;

  if (isUnicode) {
    effectiveCharCount = rawGlyphCount;
    // Standard 3GPP Unicode SMS Rule: 70 chars for single part, 67 chars per part for concatenated multi-part
    if (effectiveCharCount <= 70) {
      parts = effectiveCharCount === 0 ? 0 : 1;
      charsLeft = 70 - effectiveCharCount;
    } else {
      parts = Math.ceil(effectiveCharCount / 67);
      charsLeft = (parts * 67) - effectiveCharCount;
    }
  } else {
    // GSM-7 Rule: basic chars = 1, extended chars (^ { } \ [ ~ ] | €) = 2
    for (const ch of str) {
      effectiveCharCount += GSM_7_EXTENDED_CHARS.has(ch) ? 2 : 1;
    }
    // Standard 3GPP GSM-7 SMS Rule: 160 chars for single part, 153 chars per part for concatenated multi-part
    if (effectiveCharCount <= 160) {
      parts = effectiveCharCount === 0 ? 0 : 1;
      charsLeft = 160 - effectiveCharCount;
    } else {
      parts = Math.ceil(effectiveCharCount / 153);
      charsLeft = (parts * 153) - effectiveCharCount;
    }
  }

  const carrierWarning = (parts >= 5) 
    ? `High Parts Warning: Message requires ${parts} SMS parts (${parts} credits per number). Carriers may throttle messages exceeding 4 parts.` 
    : null;

  return {
    charCount: effectiveCharCount,
    isUnicode,
    parts: parts || 1,
    charsLeft,
    carrierWarning,
    infoText: isUnicode 
      ? `Unicode (Hindi/Regional) • ${parts || 1} Part(s) (70/67 chars) • ${charsLeft} left in part`
      : `GSM-7 Latin • ${parts || 1} Part(s) (160/153 chars) • ${charsLeft} left in part`,
    badgeText: isUnicode 
      ? `${effectiveCharCount} chars • ${parts || 1} Part${parts > 1 ? 's' : ''} (Unicode)`
      : `${effectiveCharCount} chars • ${parts || 1} Part${parts > 1 ? 's' : ''} (GSM-7)`
  };
}

// Quick Emojis Insertion Helper
window.insertTplEmoji = function(mode, emoji) {
  const textarea = (mode === 'edit') ? modalEditTplBody : modalTemplateBody;
  if (!textarea) return;
  const start = textarea.selectionStart || textarea.value.length;
  const end = textarea.selectionEnd || textarea.value.length;
  const val = textarea.value;
  textarea.value = val.substring(0, start) + emoji + val.substring(end);
  textarea.selectionStart = textarea.selectionEnd = start + emoji.length;
  textarea.focus();
  textarea.dispatchEvent(new Event('input'));
};

// WhatsApp Format Switcher (Standard vs Interactive CTA)
function updateTplCtaCharCount(mode) {
  const textarea = (mode === 'edit') ? modalEditTplBody : modalTemplateBody;
  const numEl = document.getElementById(`tpl-${mode}-cta-char-num`);
  const statusEl = document.getElementById(`tpl-${mode}-cta-char-status`);
  if (!textarea || !numEl) return;
  const len = textarea.value.length;
  numEl.textContent = len;
  if (statusEl) {
    if (len >= 1024) {
      statusEl.textContent = 'Limit Reached (1,024 max)';
      statusEl.style.color = '#dc2626';
    } else {
      statusEl.textContent = `${1024 - len} characters left`;
      statusEl.style.color = '#16a34a';
    }
  }
}

window.onTemplateFormatChange = function(mode) {
  const selFormat = document.querySelector(`input[name="tpl-${mode}-format"]:checked`)?.value || 'standard';
  const lblStd = document.getElementById(`tpl-${mode}-format-std-lbl`);
  const lblCta = document.getElementById(`tpl-${mode}-format-cta-lbl`);
  const wrapStdMedia = document.getElementById(`wrap-tpl-${mode}-standard-media`);
  const wrapCta = document.getElementById(`wrap-tpl-${mode}-cta`);
  const ctaStrip = document.getElementById(`tpl-${mode}-cta-char-strip`);
  const textarea = (mode === 'edit') ? modalEditTplBody : modalTemplateBody;

  if (lblStd && lblCta) {
    if (selFormat === 'cta') {
      lblCta.style.borderColor = '#10b981';
      lblCta.style.background = '#ecfdf5';
      lblStd.style.borderColor = '#cbd5e1';
      lblStd.style.background = '#f8fafc';
      if (wrapStdMedia) wrapStdMedia.style.display = 'none';
      if (wrapCta) wrapCta.style.display = 'block';
      if (ctaStrip) ctaStrip.style.display = 'flex';
      if (textarea) {
        textarea.maxLength = 1024;
        if (textarea.value.length > 1024) textarea.value = textarea.value.slice(0, 1024);
      }
    } else {
      lblStd.style.borderColor = '#10b981';
      lblStd.style.background = '#ecfdf5';
      lblCta.style.borderColor = '#cbd5e1';
      lblCta.style.background = '#f8fafc';
      if (wrapStdMedia) wrapStdMedia.style.display = 'block';
      if (wrapCta) wrapCta.style.display = 'none';
      if (ctaStrip) ctaStrip.style.display = 'none';
      if (textarea) {
        textarea.removeAttribute('maxLength');
      }
    }
  }
  updateTplCtaCharCount(mode);
};

// Channel Switcher in Create / Edit Modal
window.onTemplateChannelChange = function(mode) {
  const isEdit = (mode === 'edit');
  const selChannel = document.querySelector(`input[name="tpl-${mode}-channel"]:checked`)?.value || 'whatsapp';
  const optWa = document.getElementById(`tpl-${mode}-opt-wa`);
  const optSms = document.getElementById(`tpl-${mode}-opt-sms`);
  const catSelect = isEdit ? modalEditTplCat : modalTemplateCat;
  const gsmStrip = document.getElementById(`tpl-${mode}-gsm-strip`);
  const textarea = isEdit ? modalEditTplBody : modalTemplateBody;

  const wrapFormat = document.getElementById(`wrap-tpl-${mode}-format`);
  const wrapStdMedia = document.getElementById(`wrap-tpl-${mode}-standard-media`);
  const wrapCta = document.getElementById(`wrap-tpl-${mode}-cta`);
  const ctaStrip = document.getElementById(`tpl-${mode}-cta-char-strip`);

  if (optWa && optSms) {
    if (selChannel === 'whatsapp') {
      optWa.style.borderColor = '#10b981';
      optWa.style.background = '#ecfdf5';
      optSms.style.borderColor = '#cbd5e1';
      optSms.style.background = '#f8fafc';
      if (wrapFormat) wrapFormat.style.display = 'block';
      onTemplateFormatChange(mode);
    } else {
      optSms.style.borderColor = '#2563eb';
      optSms.style.background = '#eff6ff';
      optWa.style.borderColor = '#cbd5e1';
      optWa.style.background = '#f8fafc';
      if (wrapFormat) wrapFormat.style.display = 'none';
      if (wrapStdMedia) wrapStdMedia.style.display = 'none';
      if (wrapCta) wrapCta.style.display = 'none';
      if (ctaStrip) ctaStrip.style.display = 'none';
      if (textarea) textarea.removeAttribute('maxLength');
    }
  }

  // Category is permanently locked to Marketing
  if (catSelect) {
    catSelect.value = 'MARKETING';
  }

  if (gsmStrip) {
    gsmStrip.style.display = (selChannel === 'sms') ? 'block' : 'none';
  }

  // Refresh live meter
  if (textarea) textarea.dispatchEvent(new Event('input'));
};

// Explicit GSM-7 vs Unicode Selection in Create/Edit Modal
window.onTplEncodingSelect = function(mode, enc) {
  const gsmRadio = document.querySelector(`input[name="tpl-${mode}-encoding"][value="gsm7"]`);
  const uniRadio = document.querySelector(`input[name="tpl-${mode}-encoding"][value="unicode"]`);
  const gsmLbl = document.getElementById(`tpl-${mode}-enc-gsm-lbl`);
  const uniLbl = document.getElementById(`tpl-${mode}-enc-uni-lbl`);
  const isUni = (enc === 'unicode');

  if (gsmRadio && uniRadio) {
    gsmRadio.checked = !isUni;
    uniRadio.checked = isUni;
  }
  if (gsmLbl && uniLbl) {
    gsmLbl.style.border = isUni ? '1.5px solid #cbd5e1' : '2px solid #16a34a';
    gsmLbl.style.background = isUni ? '#ffffff' : '#f0fdf4';
    uniLbl.style.border = isUni ? '2px solid #d97706' : '1.5px solid #cbd5e1';
    uniLbl.style.background = isUni ? '#fffbeb' : '#ffffff';
  }

  const textarea = (mode === 'edit') ? modalEditTplBody : modalTemplateBody;
  if (textarea) textarea.dispatchEvent(new Event('input'));
};

function updateTplGsmUi(mode, text, selChannel) {
  const encRadio = document.querySelector(`input[name="tpl-${mode}-encoding"]:checked`);
  const forcedUnicode = encRadio ? (encRadio.value === 'unicode') : false;
  const metrics = computeGsmMetrics(text, selChannel, forcedUnicode);

  const badge = document.getElementById(`tpl-${mode}-meter-badge`);
  const gsmStrip = document.getElementById(`tpl-${mode}-gsm-strip`);
  const gsmParts = document.getElementById(`tpl-${mode}-gsm-parts`);
  const charNum = document.getElementById(`tpl-${mode}-char-num`);
  const encDetected = document.getElementById(`tpl-${mode}-enc-detected`);
  const gsmLbl = document.getElementById(`tpl-${mode}-enc-gsm-lbl`);
  const uniLbl = document.getElementById(`tpl-${mode}-enc-uni-lbl`);
  const gsmRadio = document.querySelector(`input[name="tpl-${mode}-encoding"][value="gsm7"]`);
  const uniRadio = document.querySelector(`input[name="tpl-${mode}-encoding"][value="unicode"]`);
  const warnBox = document.getElementById(`tpl-${mode}-carrier-warning`);
  const warnText = document.getElementById(`tpl-${mode}-warning-text`);

  if (badge) {
    badge.textContent = metrics.badgeText;
    if (metrics.carrierWarning) {
      badge.style.background = '#fef2f2'; badge.style.color = '#b91c1c'; badge.style.borderColor = '#fecaca';
    } else if (metrics.isUnicode) {
      badge.style.background = '#fef3c7'; badge.style.color = '#92400e'; badge.style.borderColor = '#fde68a';
    } else if (selChannel === 'sms') {
      badge.style.background = '#eff6ff'; badge.style.color = '#1e40af'; badge.style.borderColor = '#bfdbfe';
    } else {
      badge.style.background = '#ecfdf5'; badge.style.color = '#047857'; badge.style.borderColor = '#a7f3d0';
    }
  }

  if (gsmStrip) gsmStrip.style.display = (selChannel === 'sms') ? 'block' : 'none';

  if (selChannel === 'sms') {
    if (charNum) charNum.textContent = metrics.charCount;
    if (gsmParts) gsmParts.textContent = `${metrics.parts} Part${metrics.parts > 1 ? 's' : ''} (${metrics.parts} Credit${metrics.parts > 1 ? 's' : ''})`;

    if (metrics.isUnicode) {
      if (uniRadio) uniRadio.checked = true;
      if (gsmRadio) gsmRadio.checked = false;
      if (uniLbl) { uniLbl.style.border = '2px solid #d97706'; uniLbl.style.background = '#fffbeb'; }
      if (gsmLbl) { gsmLbl.style.border = '1.5px solid #cbd5e1'; gsmLbl.style.background = '#ffffff'; }
      if (encDetected) {
        encDetected.innerHTML = '<i data-lucide="info" style="width:12px;height:12px;display:inline-block;vertical-align:-1px;margin-right:3px;"></i> Unicode Active (75 chars/credit)';
        encDetected.style.background = '#fef3c7';
        encDetected.style.color = '#92400e';
        encDetected.style.border = '1px solid #fde68a';
      }
    } else {
      if (gsmRadio) gsmRadio.checked = true;
      if (uniRadio) uniRadio.checked = false;
      if (gsmLbl) { gsmLbl.style.border = '2px solid #16a34a'; gsmLbl.style.background = '#f0fdf4'; }
      if (uniLbl) { uniLbl.style.border = '1.5px solid #cbd5e1'; uniLbl.style.background = '#ffffff'; }
      if (encDetected) {
        encDetected.innerHTML = '<i data-lucide="check-circle" style="width:12px;height:12px;display:inline-block;vertical-align:-1px;margin-right:3px;"></i> GSM-7 Active (160 chars/credit)';
        encDetected.style.background = '#ecfdf5';
        encDetected.style.color = '#15803d';
        encDetected.style.border = '1px solid #bbf7d0';
      }
    }
    if (window.lucide) setTimeout(() => lucide.createIcons(), 20);
  }

  if (warnBox && warnText) {
    if (selChannel === 'sms' && metrics.carrierWarning) {
      warnBox.style.display = 'block';
      warnText.textContent = metrics.carrierWarning;
    } else {
      warnBox.style.display = 'none';
    }
  }
}

// Wire Create Modal Inputs
if (modalTemplateBody) {
  modalTemplateBody.addEventListener('input', () => {
    const selChannel = document.querySelector('input[name="tpl-create-channel"]:checked')?.value || 'whatsapp';
    updateTplGsmUi('create', modalTemplateBody.value, selChannel);
    updateTplCtaCharCount('create');
  });
}

// Wire Edit Modal Inputs
if (modalEditTplBody) {
  modalEditTplBody.addEventListener('input', () => {
    const selChannel = document.querySelector('input[name="tpl-edit-channel"]:checked')?.value || 'whatsapp';
    updateTplGsmUi('edit', modalEditTplBody.value, selChannel);
    updateTplCtaCharCount('edit');
  });
}

// Wire Button Character Counters (20 chars max)
['create', 'edit'].forEach(mode => {
  const urlTxt = document.getElementById(`modal-tpl-${mode}-url-text`);
  const callTxt = document.getElementById(`modal-tpl-${mode}-call-text`);
  const urlCount = document.getElementById(`tpl-${mode}-url-char-count`);
  const callCount = document.getElementById(`tpl-${mode}-call-char-count`);

  if (urlTxt && urlCount) {
    urlTxt.addEventListener('input', () => {
      urlCount.textContent = `${urlTxt.value.length}/20`;
    });
  }
  if (callTxt && callCount) {
    callTxt.addEventListener('input', () => {
      callCount.textContent = `${callTxt.value.length}/20`;
    });
  }
});

// Open Create Modal Wiring
if (btnCreateTemplateModal) {
  btnCreateTemplateModal.addEventListener('click', async () => {
    if (modalTemplateName) modalTemplateName.value = '';
    if (modalTemplateBody) modalTemplateBody.value = '';
    
    // Default to currently selected channel tab or whatsapp
    const defChannel = (currentTemplateChannel === 'sms') ? 'sms' : 'whatsapp';
    const radio = document.querySelector(`input[name="tpl-create-channel"][value="${defChannel}"]`);
    if (radio) radio.checked = true;

    // Reset format, attachment and CTA fields
    const stdRadio = document.querySelector('input[name="tpl-create-format"][value="standard"]');
    if (stdRadio) stdRadio.checked = true;
    
    // Reset media attachments state (3 Images, 1 Video, 1 PDF & CTA)
    resetTplMedia('create');
    onTemplateChannelChange('create');

    const urlTxt = document.getElementById('modal-tpl-create-url-text');
    const urlLnk = document.getElementById('modal-tpl-create-url-link');
    const callTxt = document.getElementById('modal-tpl-create-call-text');
    const callNum = document.getElementById('modal-tpl-create-call-number');
    if (urlTxt) urlTxt.value = '';
    if (urlLnk) urlLnk.value = '';
    if (callTxt) callTxt.value = '';
    if (callNum) callNum.value = '';

    const createUrlCount = document.getElementById('tpl-create-url-char-count');
    const createCallCount = document.getElementById('tpl-create-call-char-count');
    if (createUrlCount) createUrlCount.textContent = '0/20';
    if (createCallCount) createCallCount.textContent = '0/20';
    updateTplCtaCharCount('create');

    // Setup Target User Assignment for Admin & Reseller
    const wrapTargetUser = document.getElementById('wrap-tpl-target-user');
    const selectTargetUser = document.getElementById('modal-tpl-target-user');
    if (wrapTargetUser && selectTargetUser) {
      if (currentUser && (currentUser.role === 'admin' || currentUser.role === 'reseller')) {
        wrapTargetUser.style.display = 'block';
        if (!allUsers || allUsers.length === 0) {
          try { allUsers = await apiFetch('/users'); } catch (e) { allUsers = []; }
        }
        let opts = `<option value="">My Own Account (${escapeHtml(currentUser.email)})</option>`;
        if (currentUser.role === 'admin') {
          opts += (allUsers || []).map(u => `<option value="${u.id}">${escapeHtml(u.email)} (${u.role}${u.companyName ? ' - ' + escapeHtml(u.companyName) : ''})</option>`).join('');
        } else if (currentUser.role === 'reseller') {
          const myClients = (allUsers || []).filter(u => u.resellerId === currentUser.id || u.reseller_id === currentUser.id || u.resellerEmail === currentUser.email);
          opts += myClients.map(u => `<option value="${u.id}">${escapeHtml(u.email)} (Client)</option>`).join('');
        }
        selectTargetUser.innerHTML = opts;
        selectTargetUser.value = '';
      } else {
        wrapTargetUser.style.display = 'none';
      }
    }

    if (modalCreateTemplate) {
      modalCreateTemplate.style.display = 'flex';
      const mb = modalCreateTemplate.querySelector('.modal-body-saas');
      if (mb) mb.scrollTop = 0;
      if (window.lucide) lucide.createIcons({ root: modalCreateTemplate });
    }
  });
}

// Save New Template
if (btnModalSaveTemplate) {
  btnModalSaveTemplate.addEventListener('click', async () => {
    const title = modalTemplateName.value.trim();
    const channel = document.querySelector('input[name="tpl-create-channel"]:checked')?.value || 'whatsapp';
    const category = modalTemplateCat.value || 'MARKETING';
    const body = modalTemplateBody.value.trim();
    const targetSelect = document.getElementById('modal-tpl-target-user');
    const target_user_id = (targetSelect && targetSelect.value) ? targetSelect.value : undefined;

    if (!title || !body) {
      showToast('warning', 'Fields Required', 'Please provide a title and message content for the template.');
      return;
    }

    const template_type = (channel === 'whatsapp')
      ? (document.querySelector('input[name="tpl-create-format"]:checked')?.value || 'standard')
      : 'standard';
    let cta_data = null;

    if (channel === 'whatsapp' && template_type === 'cta') {
      const url_text = document.getElementById('modal-tpl-create-url-text')?.value.trim() || '';
      const url_link = document.getElementById('modal-tpl-create-url-link')?.value.trim() || '';
      const call_text = document.getElementById('modal-tpl-create-call-text')?.value.trim() || '';
      const call_number = document.getElementById('modal-tpl-create-call-number')?.value.trim() || '';

      if (!url_link && !call_number) {
        showToast('warning', 'CTA Action Required', 'Please provide at least a Website URL or Call Phone Number for CTA buttons.');
        return;
      }

      const ctaErr = validateCtaRules({
        text: body,
        callText: call_text,
        urlText: url_text,
        urlLink: url_link,
        isCta: true
      });
      if (ctaErr) {
        showToast('error', 'CTA Validation Error', ctaErr);
        return;
      }

      cta_data = { url_text, url_link, call_text, call_number };
    }

    try {
      btnModalSaveTemplate.disabled = true;
      btnModalSaveTemplate.textContent = 'Saving...';

      const formData = new FormData();
      formData.append('title', title);
      formData.append('channel', channel);
      formData.append('template_type', template_type);
      formData.append('category', category);
      formData.append('body', body);
      if (target_user_id) formData.append('target_user_id', target_user_id);

      if (channel === 'whatsapp') {
        if (template_type === 'standard') {
          // Standard Message Media: Up to 3 Images, 1 Video, 1 PDF
          const st = tplMediaStates.create;
          if (st.images[0] && st.images[0].file) formData.append('image_1', st.images[0].file);
          if (st.images[1] && st.images[1].file) formData.append('image_2', st.images[1].file);
          if (st.images[2] && st.images[2].file) formData.append('image_3', st.images[2].file);
          if (st.video && st.video.file) formData.append('video_file', st.video.file);
          if (st.pdf && st.pdf.file) formData.append('pdf_file', st.pdf.file);
        } else if (template_type === 'cta') {
          // Interactive CTA Message Media: Single media header + CTA data
          const st = tplMediaStates.create;
          if (st.ctaMedia && st.ctaMedia.type !== 'none' && st.ctaMedia.file) {
            formData.append('cta_media_file', st.ctaMedia.file);
          }
          if (cta_data) formData.append('cta_data', JSON.stringify(cta_data));
        }
      }

      const res = await fetch('/api/templates', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${getAuthToken()}`
        },
        body: formData
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to save template');

      showToast('success', 'Template Created', `Template "${title}" saved and ready for campaigns.`);
      if (modalCreateTemplate) modalCreateTemplate.style.display = 'none';
      loadTemplates();
      populateComposerSelectors();
    } catch (err) {
      showToast('error', 'Error', err.message);
    } finally {
      btnModalSaveTemplate.disabled = false;
      btnModalSaveTemplate.textContent = 'Save Template';
    }
  });
}

// Update Existing Template Wiring
if (btnModalUpdateTemplate) {
  btnModalUpdateTemplate.addEventListener('click', async () => {
    const id = modalEditTplId ? modalEditTplId.value : '';
    const title = modalEditTplName ? modalEditTplName.value.trim() : '';
    const channel = document.querySelector('input[name="tpl-edit-channel"]:checked')?.value || 'whatsapp';
    const category = modalEditTplCat ? modalEditTplCat.value : 'MARKETING';
    const body = modalEditTplBody ? modalEditTplBody.value.trim() : '';

    if (!title || !body) {
      return showToast('warning', 'Fields Required', 'Please provide a template title and body.');
    }

    const template_type = (channel === 'whatsapp')
      ? (document.querySelector('input[name="tpl-edit-format"]:checked')?.value || 'standard')
      : 'standard';
    let cta_data = null;

    if (channel === 'whatsapp' && template_type === 'cta') {
      const url_text = document.getElementById('modal-tpl-edit-url-text')?.value.trim() || '';
      const url_link = document.getElementById('modal-tpl-edit-url-link')?.value.trim() || '';
      const call_text = document.getElementById('modal-tpl-edit-call-text')?.value.trim() || '';
      const call_number = document.getElementById('modal-tpl-edit-call-number')?.value.trim() || '';

      if (!url_link && !call_number) {
        showToast('warning', 'CTA Action Required', 'Please provide at least a Website URL or Call Phone Number for CTA buttons.');
        return;
      }

      const ctaErr = validateCtaRules({
        text: body,
        callText: call_text,
        urlText: url_text,
        urlLink: url_link,
        isCta: true
      });
      if (ctaErr) {
        showToast('error', 'CTA Validation Error', ctaErr);
        return;
      }

      cta_data = { url_text, url_link, call_text, call_number };
    }

    try {
      btnModalUpdateTemplate.disabled = true;
      btnModalUpdateTemplate.textContent = 'Updating...';

      const formData = new FormData();
      formData.append('title', title);
      formData.append('channel', channel);
      formData.append('template_type', template_type);
      formData.append('category', category);
      formData.append('body', body);

      if (channel === 'whatsapp') {
        if (template_type === 'standard') {
          const st = tplMediaStates.edit;
          const retained = [];
          for (let i = 0; i < 3; i++) {
            if (st.images[i]) {
              if (st.images[i].file) formData.append(`image_${i + 1}`, st.images[i].file);
              else if (st.images[i].existingUrl) retained.push({ slot: `image_${i + 1}`, type: 'image', url: st.images[i].existingUrl, filename: st.images[i].name, size: st.images[i].size });
            }
          }
          if (st.video) {
            if (st.video.file) formData.append('video_file', st.video.file);
            else if (st.video.existingUrl) retained.push({ slot: 'video_file', type: 'video', url: st.video.existingUrl, filename: st.video.name, size: st.video.size });
          }
          if (st.pdf) {
            if (st.pdf.file) formData.append('pdf_file', st.pdf.file);
            else if (st.pdf.existingUrl) retained.push({ slot: 'pdf_file', type: 'pdf', url: st.pdf.existingUrl, filename: st.pdf.name, size: st.pdf.size });
          }
          formData.append('existing_attachments', JSON.stringify(retained));
        } else if (template_type === 'cta') {
          const st = tplMediaStates.edit;
          if (st.ctaMedia && st.ctaMedia.type !== 'none') {
            if (st.ctaMedia.file) formData.append('cta_media_file', st.ctaMedia.file);
            else if (st.ctaMedia.existingUrl) {
              formData.append('existing_attachments', JSON.stringify([{
                slot: 'cta_media_file',
                type: st.ctaMedia.type,
                url: st.ctaMedia.existingUrl,
                filename: st.ctaMedia.name || 'attachment',
                size: 0
              }]));
            }
          } else {
            formData.append('remove_attachment', 'true');
          }
          if (cta_data) formData.append('cta_data', JSON.stringify(cta_data));
        }
      } else {
        formData.append('remove_attachment', 'true');
      }

      const res = await fetch(`/api/templates/${id}`, {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${getAuthToken()}`
        },
        body: formData
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Update failed');

      showToast('success', 'Template Updated', `Template #${id} details updated successfully.`);
      if (modalEditTemplate) modalEditTemplate.style.display = 'none';
      loadTemplates();
      populateComposerSelectors();
    } catch (err) {
      showToast('error', 'Update Failed', err.message);
    } finally {
      btnModalUpdateTemplate.disabled = false;
      btnModalUpdateTemplate.textContent = 'Update Template';
    }
  });
}

// Master Channel Switcher (All / WhatsApp / SMS)
window.switchTemplateChannel = function(ch) {
  currentTemplateChannel = ch;
  const tabAll = document.getElementById('tab-tpl-all');
  const tabWa = document.getElementById('tab-tpl-wa');
  const tabSms = document.getElementById('tab-tpl-sms');

  if (tabAll) tabAll.classList.toggle('active', ch === 'all');
  if (tabWa) tabWa.classList.toggle('active', ch === 'whatsapp');
  if (tabSms) tabSms.classList.toggle('active', ch === 'sms');

  renderTemplatesTable();
};

// Filter event listeners
const templatesSearch = document.getElementById('templates-search');
const templatesUserFilter = document.getElementById('templates-user-filter');

if (templatesSearch) templatesSearch.addEventListener('input', () => renderTemplatesTable());
if (templatesUserFilter) templatesUserFilter.addEventListener('change', () => renderTemplatesTable());

// Load Templates from API
async function loadTemplates() {
  if (!templatesTbody) return;
  try {
    userTemplates = await apiFetch('/templates');

    // Setup User Filter for Admin & Reseller
    if (templatesUserFilter) {
      if (currentUser && (currentUser.role === 'admin' || currentUser.role === 'reseller')) {
        templatesUserFilter.style.display = 'inline-block';
        const distinctOwners = Array.from(new Set(userTemplates.map(t => t.owner_email).filter(Boolean)));
        const currentVal = templatesUserFilter.value;
        templatesUserFilter.innerHTML = '<option value="">All Accounts</option>' + distinctOwners.map(e => `<option value="${escapeHtml(e)}">${escapeHtml(e)}</option>`).join('');
        if (distinctOwners.includes(currentVal)) {
          templatesUserFilter.value = currentVal;
        }
      } else {
        templatesUserFilter.style.display = 'none';
      }
    }

    renderTemplatesTable();
  } catch (err) {
    templatesTbody.innerHTML = `<tr><td colspan="6" style="text-align:center;color:red;padding:20px;">Failed to load templates: ${escapeHtml(err.message)}</td></tr>`;
  }
}

// Render Templates Table
function renderTemplatesTable() {
  if (!templatesTbody) return;

  const totalAll = userTemplates.length;
  const totalWa = userTemplates.filter(t => (t.channel || 'whatsapp') === 'whatsapp').length;
  const totalSms = userTemplates.filter(t => t.channel === 'sms').length;

  const kpiAll = document.getElementById('kpi-total-templates');
  const kpiWa = document.getElementById('kpi-wa-templates');
  const kpiSms = document.getElementById('kpi-sms-templates');
  const badgeAll = document.getElementById('badge-tpl-all-count');
  const badgeWa = document.getElementById('badge-tpl-wa-count');
  const badgeSms = document.getElementById('badge-tpl-sms-count');

  if (kpiAll) kpiAll.textContent = totalAll.toLocaleString();
  if (kpiWa) kpiWa.textContent = totalWa.toLocaleString();
  if (kpiSms) kpiSms.textContent = totalSms.toLocaleString();
  if (badgeAll) badgeAll.textContent = totalAll;
  if (badgeWa) badgeWa.textContent = totalWa;
  if (badgeSms) badgeSms.textContent = totalSms;

  const q = (templatesSearch ? templatesSearch.value : '').toLowerCase().trim();
  const selectedUser = (templatesUserFilter ? templatesUserFilter.value : '').trim();

  const filtered = userTemplates.filter(t => {
    const ch = t.channel || 'whatsapp';
    if (currentTemplateChannel !== 'all' && ch !== currentTemplateChannel) return false;
    if (selectedUser && t.owner_email !== selectedUser) return false;
    if (!q) return true;
    return (t.title || '').toLowerCase().includes(q) || (t.content || t.body || '').toLowerCase().includes(q) || (t.owner_email || '').toLowerCase().includes(q);
  });

  if (filtered.length === 0) {
    templatesTbody.innerHTML = `
      <tr>
        <td colspan="6">
          <div class="empty-state-box">
            <div class="empty-state-icon"><i data-lucide="file-plus" style="width:24px;height:24px;"></i></div>
            <div class="empty-state-title">${q ? 'No matching templates found' : 'No templates created yet'}</div>
            <div class="empty-state-desc">${q ? 'Try clearing your search query.' : 'Create WhatsApp and SMS (GSM) templates for 1-click campaign dispatches.'}</div>
            ${!q ? `
              <div style="display:flex;gap:10px;justify-content:center;margin-top:12px;">
                <button type="button" class="btn-action btn-action-secondary" onclick="btnOpenStarters.click()">
                  <i data-lucide="sparkles" style="width:13px;height:13px;color:#f59e0b;"></i> Browse Starters
                </button>
                <button type="button" class="btn-action btn-action-primary" onclick="btnCreateTemplateModal.click()">
                  <i data-lucide="plus" style="width:13px;height:13px;"></i> Create Template
                </button>
              </div>
            ` : ''}
          </div>
        </td>
      </tr>
    `;
    if (window.lucide) lucide.createIcons({ root: templatesTbody });
    return;
  }

  templatesTbody.innerHTML = filtered.map(t => {
    const text = t.content || t.body || '';
    const isSms = (t.channel === 'sms');
    const isUnicode = Boolean(t.is_unicode);
    const parts = t.parts_count || 1;
    const charCount = t.character_count || Array.from(text).length;

    const channelBadge = isSms 
      ? `<span class="status-badge" style="background:#eff6ff;color:#1e40af;border:1px solid #bfdbfe;font-size:0.75rem;"><i data-lucide="smartphone" style="width:12px;height:12px;"></i> SMS</span>`
      : `<span class="status-badge" style="background:#ecfdf5;color:#047857;border:1px solid #a7f3d0;font-size:0.75rem;"><i data-lucide="message-circle" style="width:12px;height:12px;"></i> WhatsApp</span>`;

    const isHighParts = (isSms && parts >= 5);
    const encodingBadge = isSms
      ? (isUnicode 
          ? `<span class="status-badge" style="background:#fef3c7;color:#92400e;border:1px solid #fde68a;font-size:0.75rem;" title="Unicode Encoding (Hindi / Emojis)"><i data-lucide="globe" style="width:11px;height:11px;"></i> Unicode • ${parts} Part${parts > 1 ? 's' : ''} (${charCount}c)</span>`
          : `<span class="status-badge" style="background:#f1f5f9;color:#334155;border:1px solid #cbd5e1;font-size:0.75rem;" title="Standard GSM-7 Latin Text"><i data-lucide="type" style="width:11px;height:11px;"></i> GSM-7 • ${parts} Part${parts > 1 ? 's' : ''} (${charCount}c)</span>`)
      : `<span class="status-badge badge-updated" style="font-size:0.75rem;"><i data-lucide="check" style="width:11px;height:11px;"></i> 1 Credit (${charCount}c)</span>`;

    const partsWarningBadge = isHighParts 
      ? `<span class="status-badge" style="background:#fef2f2;color:#b91c1c;border:1px solid #fecaca;font-size:0.72rem;margin-top:3px;display:inline-flex;" title="Carriers recommend ≤ 4 parts"><i data-lucide="alert-triangle" style="width:10px;height:10px;"></i> ${parts} Parts (High)</span>` 
      : '';

    const formatBadge = (!isSms && t.template_type === 'cta')
      ? `<span class="status-badge" style="background:#fef3c7;color:#b45309;border:1px solid #fde68a;font-size:0.72rem;"><i data-lucide="mouse-pointer-click" style="width:11px;height:11px;"></i> CTA Button</span>`
      : (!isSms ? `<span class="status-badge" style="background:#f1f5f9;color:#475569;border:1px solid #cbd5e1;font-size:0.72rem;">Standard</span>` : '');

    const attachmentBadge = (!isSms && t.attachment_url)
      ? `<span class="status-badge" style="background:#f5f3ff;color:#6d28d9;border:1px solid #ddd6fe;font-size:0.72rem;" title="Has media attachment"><i data-lucide="paperclip" style="width:11px;height:11px;"></i> Media</span>`
      : '';

    const isOwner = (currentUser && Number(t.user_id) === Number(currentUser.id));
    const isAdmin = (currentUser && currentUser.role === 'admin');
    const isResellerOfOwner = (currentUser && currentUser.role === 'reseller' && t.owner_role !== 'admin');
    const canManage = isOwner || isAdmin || isResellerOfOwner;

    const campaignBtn = isSms
      ? `<button type="button" class="btn-action" onclick="useTemplateForCampaign(${t.id})" style="background:#6366f1;color:#fff;border:none;display:inline-flex;align-items:center;gap:4px;padding:4px 8px;font-size:0.78rem;font-weight:600;" title="Launch Bulk SMS Campaign with this Template">
          <i data-lucide="smartphone" style="width:12px;height:12px;"></i> SMS
        </button>`
      : `<button type="button" class="btn-action" onclick="useTemplateForCampaign(${t.id})" style="background:#10b981;color:#fff;border:none;display:inline-flex;align-items:center;gap:4px;padding:4px 8px;font-size:0.78rem;font-weight:600;" title="Launch WhatsApp Campaign with this Template">
          <i data-lucide="message-circle" style="width:12px;height:12px;"></i> WhatsApp
        </button>`;

    return `
      <tr>
        <td>
          <div>
            <a href="javascript:void(0)" onclick="openPreviewTemplateModal(${t.id})" style="font-weight:700;color:var(--slate-800);text-decoration:none;font-size:0.9rem;">
              ${escapeHtml(t.title)}
            </a>
            <div style="font-size:0.74rem;color:var(--slate-500);margin-top:2px;">
              ID: #${t.id}
              ${(t.owner_email && currentUser && (currentUser.role === 'admin' || currentUser.role === 'reseller')) ? `<span style="font-size:0.7rem;color:#4f46e5;background:#eef2ff;padding:1px 6px;border-radius:4px;margin-left:6px;"><i data-lucide="user" style="width:10px;height:10px;display:inline-block;vertical-align:-1px;"></i> ${escapeHtml(t.owner_email)}</span>` : ''}
            </div>
          </div>
        </td>
        <td>
          <div style="display:flex;align-items:center;gap:5px;flex-wrap:wrap;">
            ${channelBadge}
            ${formatBadge}
            ${attachmentBadge}
            <span class="status-badge badge-submitted" style="font-size:0.75rem;">Marketing</span>
          </div>
        </td>
        <td>
          <div style="display:flex;flex-direction:column;align-items:flex-start;">
            ${encodingBadge}
            ${partsWarningBadge}
          </div>
        </td>
        <td>
          <div style="display:flex;align-items:center;gap:6px;">
            <span style="font-size:0.83rem;color:var(--slate-600);line-height:1.4;">
              ${escapeHtml(text.slice(0, 80))}${text.length > 80 ? '...' : ''}
            </span>
            <button type="button" class="btn-action btn-action-secondary" onclick="openPreviewTemplateModal(${t.id})" style="padding:2px 5px;font-size:0.7rem;flex-shrink:0;" title="Live Preview">
              <i data-lucide="eye" style="width:11px;height:11px;"></i>
            </button>
          </div>
        </td>
        <td>
          <span style="font-size:0.8rem;color:var(--slate-500);">${t.created_at ? new Date(t.created_at).toLocaleDateString() : '—'}</span>
        </td>
        <td>
          <div style="display:flex;justify-content:flex-end;gap:5px;flex-wrap:wrap;">
            ${campaignBtn}
            <button type="button" class="btn-action btn-action-secondary" onclick="copyTemplateContent(${t.id})" style="display:inline-flex;align-items:center;gap:4px;padding:4px 7px;font-size:0.78rem;" title="Copy Content">
              <i data-lucide="clipboard-copy" style="width:12px;height:12px;"></i>
            </button>
            ${canManage ? `
              <button type="button" class="btn-action btn-action-secondary" onclick="openEditTemplateModal(${t.id})" style="display:inline-flex;align-items:center;gap:4px;padding:4px 7px;font-size:0.78rem;" title="Edit Template">
                <i data-lucide="edit-2" style="width:12px;height:12px;"></i>
              </button>
            ` : ''}
            <button type="button" class="btn-action btn-action-secondary" onclick="duplicateTemplate(${t.id})" style="display:inline-flex;align-items:center;gap:4px;padding:4px 7px;font-size:0.78rem;" title="Duplicate / Clone Template into My Library">
              <i data-lucide="copy" style="width:12px;height:12px;"></i>
            </button>
            ${canManage ? `
              <button type="button" class="btn-action btn-action-danger" onclick="deleteTemplate(${t.id})" style="display:inline-flex;align-items:center;gap:4px;padding:4px 7px;font-size:0.78rem;" title="Delete Template">
                <i data-lucide="trash-2" style="width:12px;height:12px;"></i>
              </button>
            ` : ''}
          </div>
        </td>
      </tr>
    `;
  }).join('');

  if (window.lucide) lucide.createIcons({ root: templatesTbody });
}

// 1-Click Copy Template Message Content
window.copyTemplateContent = function(templateId) {
  const t = userTemplates.find(item => Number(item.id) === Number(templateId));
  if (!t) return;
  const text = t.content || t.body || '';
  navigator.clipboard.writeText(text).then(() => {
    showToast('success', 'Copied to Clipboard', `Template text for "${t.title}" copied!`);
  }).catch(() => {
    showToast('info', 'Template Text', text);
  });
};

// 1-Click Export Templates to CSV
window.exportTemplatesCsv = async function() {
  try {
    const res = await fetch('/api/templates/export/csv', {
      headers: {
        'Authorization': `Bearer ${getAuthToken()}`
      }
    });
    if (!res.ok) throw new Error('Failed to export templates');
    const blob = await res.blob();
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `MessageSphere_Marketing_Templates_${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.URL.revokeObjectURL(url);
    showToast('success', 'Export Ready', 'Downloaded MessageSphere_Marketing_Templates.csv');
  } catch (err) {
    showToast('error', 'Export Failed', err.message);
  }
};

// 1-Click "Use in Campaign"
window.useTemplateForCampaign = function(templateId) {
  const t = userTemplates.find(item => Number(item.id) === Number(templateId));
  if (!t) return;

  const isSms = (t.channel === 'sms');

  if (isSms) {
    switchView('view-sms');
    if (typeof openSmsComposer === 'function') openSmsComposer();
    setTimeout(() => {
      const msgBox = document.getElementById('sms-message');
      const titleBox = document.getElementById('sms-title');
      if (msgBox) {
        msgBox.value = t.content || t.body || '';
        if (typeof onSmsMessageInput === 'function') onSmsMessageInput();
      }
      if (titleBox && !titleBox.value.trim()) {
        titleBox.value = t.title || '';
      }
      const tplSel = document.getElementById('sms-template-select');
      if (tplSel) {
        tplSel.value = encodeURIComponent(t.content || t.body || '');
      }
      showToast('info', 'Template Loaded', `Loaded SMS template "${t.title}" into GSM SMS Composer.`);
    }, 150);
    return;
  }

  switchView('view-new-campaign');
  setTimeout(() => {
    const isCta = (t.template_type === 'cta');

    // Parse all attachments (images, video, pdf)
    let attList = [];
    if (t.attachments) {
      try { attList = typeof t.attachments === 'string' ? JSON.parse(t.attachments) : t.attachments; } catch(e){}
    }
    if ((!attList || attList.length === 0) && t.attachment_url) {
      attList = [{ slot: 'image_1', type: t.media_type || 'image', url: t.attachment_url, filename: t.attachment_name || 'attachment' }];
    }

    // Switch route / type
    if (isSms) {
      const routeRadio = document.querySelector('input[name="campaign-route"][value="domestic"]');
      if (routeRadio) routeRadio.checked = true;
      const normalRadio = document.querySelector('input[name="campaign-type-picker"][value="normal"]');
      if (normalRadio) { normalRadio.checked = true; normalRadio.dispatchEvent(new Event('change')); }
    } else if (isCta) {
      const ctaRadio = document.querySelector('input[name="campaign-type-picker"][value="cta"]');
      if (ctaRadio) {
        ctaRadio.checked = true;
        ctaRadio.dispatchEvent(new Event('change'));
      }
    } else if (attList.length > 0) {
      const dpRadio = document.querySelector('input[name="campaign-type-picker"][value="dp"]');
      if (dpRadio) {
        dpRadio.checked = true;
        dpRadio.dispatchEvent(new Event('change'));
      }
    } else {
      const normalRadio = document.querySelector('input[name="campaign-type-picker"][value="normal"]');
      if (normalRadio) {
        normalRadio.checked = true;
        normalRadio.dispatchEvent(new Event('change'));
      }
    }

    // Fill message content
    if (composerText) {
      composerText.value = t.content || t.body || '';
      composerText.dispatchEvent(new Event('input'));
    }

    // Fill CTA buttons if present
    let cta = null;
    if (t.cta_data) {
      try { cta = typeof t.cta_data === 'string' ? JSON.parse(t.cta_data) : t.cta_data; } catch(e){}
    }
    if (isCta && cta) {
      const callTxt = document.getElementById('cta-call-text');
      const callNum = document.getElementById('cta-call-number');
      const urlTxt = document.getElementById('cta-url-text');
      const urlLnk = document.getElementById('cta-url-link');
      if (callTxt) { callTxt.value = cta.call_text || ''; callTxt.dispatchEvent(new Event('input')); }
      if (callNum) { callNum.value = cta.call_number || ''; callNum.dispatchEvent(new Event('input')); }
      if (urlTxt) { urlTxt.value = cta.url_text || ''; urlTxt.dispatchEvent(new Event('input')); }
      if (urlLnk) { urlLnk.value = cta.url_link || ''; urlLnk.dispatchEvent(new Event('input')); }
    }

    // Flow attachments into campaign composer slots
    if (!isSms && attList.length > 0) {
      if (isCta) {
        const ctaAtt = attList[0];
        if (ctaAtt && ctaAtt.url) {
          window.composerTemplateAttachmentUrl = ctaAtt.url;
          window.composerTemplateMediaType = ctaAtt.type;
          window.composerTemplateAttachmentName = ctaAtt.filename;
          const ctaPill = document.querySelector(`button[data-cta-media="${ctaAtt.type}"]`);
          if (ctaPill) ctaPill.click();
        }
      } else {
        // Standard WhatsApp: populate multi-images, video & pdf
        resetAllMediaUploads();
        let imgIdx = 0;
        attList.forEach(att => {
          if (att.type === 'image' && imgIdx < 4) {
            uploadedImages[imgIdx] = { file: null, name: att.filename || `Image ${imgIdx + 1}`, size: att.size || 0, url: att.url };
            const slotBox = document.getElementById(`slot-image-${imgIdx + 1}`);
            const empty = document.getElementById(`slot-empty-${imgIdx + 1}`);
            const filled = document.getElementById(`slot-filled-${imgIdx + 1}`);
            const thumb = document.getElementById(`thumb-image-${imgIdx + 1}`);
            const nameEl = document.getElementById(`name-image-${imgIdx + 1}`);
            if (slotBox) slotBox.classList.add('has-file');
            if (empty) empty.style.display = 'none';
            if (filled) filled.style.display = 'flex';
            if (thumb) thumb.src = att.url;
            if (nameEl) nameEl.textContent = att.filename || `Image ${imgIdx + 1}`;
            imgIdx++;
          } else if (att.type === 'video') {
            uploadedVideo = { file: null, name: att.filename || 'video.mp4', size: att.size || 0, url: att.url };
            const ph = document.getElementById('video-placeholder');
            const prev = document.getElementById('video-preview-info');
            const nameEl = document.getElementById('video-file-name');
            const sizeEl = document.getElementById('video-file-size');
            if (ph) ph.style.display = 'none';
            if (prev) prev.style.display = 'flex';
            if (nameEl) nameEl.textContent = att.filename || 'video.mp4';
            if (sizeEl) sizeEl.textContent = att.size ? (att.size / (1024 * 1024)).toFixed(1) + ' MB' : 'Existing Video';
          } else if (att.type === 'pdf') {
            uploadedPDF = { file: null, name: att.filename || 'document.pdf', size: att.size || 0, url: att.url };
            const ph = document.getElementById('pdf-placeholder');
            const prev = document.getElementById('pdf-preview-info');
            const nameEl = document.getElementById('pdf-file-name');
            const sizeEl = document.getElementById('pdf-file-size');
            if (ph) ph.style.display = 'none';
            if (prev) prev.style.display = 'flex';
            if (nameEl) nameEl.textContent = att.filename || 'document.pdf';
            if (sizeEl) sizeEl.textContent = att.size ? (att.size / (1024 * 1024)).toFixed(1) + ' MB' : 'Existing PDF';
          }
        });
        updatePreviewMedia();
      }
    }

    const templateSelect = document.getElementById('composer-template-select');
    if (templateSelect) {
      templateSelect.value = encodeURIComponent(t.content || t.body || '');
    }

    if (attList.length > 0) {
      showToast('info', 'Template Loaded', `Loaded "${t.title}" with attachments & settings into Campaign Composer.`);
    } else {
      showToast('info', 'Template Loaded', `Loaded "${t.title}" into Campaign Composer.`);
    }
  }, 120);
};

// 1-Click Duplicate Template
window.duplicateTemplate = async function(templateId) {
  try {
    const res = await apiFetch(`/templates/${templateId}/duplicate`, { method: 'POST' });
    showToast('success', 'Template Cloned', `Cloned as "${res.title}".`);
    loadTemplates();
    populateComposerSelectors();
  } catch (err) {
    showToast('error', 'Duplicate Failed', err.message);
  }
};

// Open Edit Modal
window.openEditTemplateModal = function(templateId) {
  const t = userTemplates.find(item => Number(item.id) === Number(templateId));
  if (!t) return;

  if (modalEditTplId) modalEditTplId.value = t.id;
  if (modalEditTplName) modalEditTplName.value = t.title || '';
  if (modalEditTplBody) modalEditTplBody.value = t.content || t.body || '';

  const ch = t.channel || 'whatsapp';
  const radio = document.querySelector(`input[name="tpl-edit-channel"][value="${ch}"]`);
  if (radio) radio.checked = true;

  const fmt = t.template_type || 'standard';
  const radioFmt = document.querySelector(`input[name="tpl-edit-format"][value="${fmt}"]`);
  if (radioFmt) radioFmt.checked = true;

  // Reset and populate media state for Edit Modal
  resetTplMedia('edit');
  onTemplateChannelChange('edit');

  let attList = [];
  if (t.attachments) {
    try { attList = typeof t.attachments === 'string' ? JSON.parse(t.attachments) : t.attachments; } catch(e){}
  }
  if ((!attList || attList.length === 0) && t.attachment_url) {
    attList = [{
      slot: (fmt === 'cta') ? 'cta_media_file' : 'image_1',
      type: t.media_type || 'image',
      url: t.attachment_url,
      filename: t.attachment_name || 'attachment',
      size: t.attachment_size || 0
    }];
  }

  if (fmt === 'standard') {
    let imgIdx = 0;
    attList.forEach(att => {
      if (att.type === 'image' && imgIdx < 3) {
        tplMediaStates.edit.images[imgIdx] = { file: null, existingUrl: att.url, name: att.filename, size: att.size };
        const slotBox = document.getElementById(`tpl-edit-slot-img-${imgIdx + 1}`);
        const empty = document.getElementById(`tpl-edit-empty-img-${imgIdx + 1}`);
        const filled = document.getElementById(`tpl-edit-filled-img-${imgIdx + 1}`);
        const thumb = document.getElementById(`tpl-edit-thumb-img-${imgIdx + 1}`);
        const nameEl = document.getElementById(`tpl-edit-name-img-${imgIdx + 1}`);
        if (slotBox) slotBox.classList.add('has-file');
        if (empty) empty.style.display = 'none';
        if (filled) filled.style.display = 'flex';
        if (thumb) thumb.src = att.url;
        if (nameEl) nameEl.textContent = att.filename || `Image ${imgIdx + 1}`;
        imgIdx++;
      } else if (att.type === 'video') {
        tplMediaStates.edit.video = { file: null, existingUrl: att.url, name: att.filename, size: att.size };
        const ph = document.getElementById('tpl-edit-video-placeholder');
        const prev = document.getElementById('tpl-edit-video-preview');
        const nameEl = document.getElementById('tpl-edit-video-name');
        const sizeEl = document.getElementById('tpl-edit-video-size');
        if (ph) ph.style.display = 'none';
        if (prev) prev.style.display = 'flex';
        if (nameEl) nameEl.textContent = att.filename || 'video.mp4';
        if (sizeEl) sizeEl.textContent = att.size ? (att.size / (1024 * 1024)).toFixed(1) + ' MB' : 'Existing Video';
      } else if (att.type === 'pdf') {
        tplMediaStates.edit.pdf = { file: null, existingUrl: att.url, name: att.filename, size: att.size };
        const ph = document.getElementById('tpl-edit-pdf-placeholder');
        const prev = document.getElementById('tpl-edit-pdf-preview');
        const nameEl = document.getElementById('tpl-edit-pdf-name');
        const sizeEl = document.getElementById('tpl-edit-pdf-size');
        if (ph) ph.style.display = 'none';
        if (prev) prev.style.display = 'flex';
        if (nameEl) nameEl.textContent = att.filename || 'document.pdf';
        if (sizeEl) sizeEl.textContent = att.size ? (att.size / (1024 * 1024)).toFixed(1) + ' MB' : 'Existing PDF';
      }
    });
  } else if (fmt === 'cta') {
    const ctaAtt = attList[0];
    if (ctaAtt) {
      tplMediaStates.edit.ctaMedia = { type: ctaAtt.type, file: null, existingUrl: ctaAtt.url, name: ctaAtt.filename };
      const pills = document.querySelectorAll('#tpl-edit-cta-media-pills button');
      pills.forEach(b => b.classList.toggle('active', b.dataset.tplEditCtaMedia === ctaAtt.type));
      const badge = document.getElementById('tpl-edit-cta-media-badge');
      if (badge) badge.textContent = ctaAtt.type.toUpperCase();
      const drop = document.getElementById('dropzone-tpl-edit-cta-media');
      const ph = document.getElementById('tpl-edit-cta-media-placeholder');
      const prev = document.getElementById('tpl-edit-cta-media-preview');
      const thumb = document.getElementById('tpl-edit-cta-thumb-img');
      const iconBox = document.getElementById('tpl-edit-cta-icon-box');
      const nameEl = document.getElementById('tpl-edit-cta-file-name');
      const sizeEl = document.getElementById('tpl-edit-cta-file-size');
      if (drop) drop.style.display = 'block';
      if (ph) ph.style.display = 'none';
      if (prev) prev.style.display = 'flex';
      if (nameEl) nameEl.textContent = ctaAtt.filename || 'attachment';
      if (sizeEl) sizeEl.textContent = 'Existing Media';
      if (ctaAtt.type === 'image') {
        if (thumb) { thumb.src = ctaAtt.url; thumb.style.display = 'block'; }
        if (iconBox) iconBox.style.display = 'none';
      } else {
        if (thumb) thumb.style.display = 'none';
        if (iconBox) iconBox.style.display = 'flex';
      }
    }
  }

  let cta = null;
  if (t.cta_data) {
    try { cta = typeof t.cta_data === 'string' ? JSON.parse(t.cta_data) : t.cta_data; } catch(e){}
  }
  const urlTxt = document.getElementById('modal-tpl-edit-url-text');
  const urlLnk = document.getElementById('modal-tpl-edit-url-link');
  const callTxt = document.getElementById('modal-tpl-edit-call-text');
  const callNum = document.getElementById('modal-tpl-edit-call-number');
  if (urlTxt) urlTxt.value = cta?.url_text || '';
  if (urlLnk) urlLnk.value = cta?.url_link || '';
  if (callTxt) callTxt.value = cta?.call_text || '';
  if (callNum) callNum.value = cta?.call_number || '';

  const editUrlCount = document.getElementById('tpl-edit-url-char-count');
  const editCallCount = document.getElementById('tpl-edit-call-char-count');
  if (editUrlCount) editUrlCount.textContent = `${(urlTxt ? urlTxt.value.length : 0)}/20`;
  if (editCallCount) editCallCount.textContent = `${(callTxt ? callTxt.value.length : 0)}/20`;
  updateTplCtaCharCount('edit');

  if (modalEditTplCat) modalEditTplCat.value = 'MARKETING';
  if (modalEditTemplate) {
    modalEditTemplate.style.display = 'flex';
    const mb = modalEditTemplate.querySelector('.modal-body-saas');
    if (mb) mb.scrollTop = 0;
  }
  if (window.lucide) lucide.createIcons({ root: modalEditTemplate });
};

// Open Interactive Phone Preview Modal
window.openPreviewTemplateModal = function(templateId) {
  const t = userTemplates.find(item => Number(item.id) === Number(templateId));
  if (!t || !modalPreviewTemplate) return;

  const isSms = (t.channel === 'sms');
  const text = t.content || t.body || '';
  const metrics = computeGsmMetrics(text, isSms ? 'sms' : 'whatsapp');

  const pill = document.getElementById('tpl-preview-channel-pill');
  const appHeader = document.getElementById('tpl-preview-app-header');
  const senderName = document.getElementById('tpl-preview-sender-name');
  const subStatus = document.getElementById('tpl-preview-sub-status');
  const canvas = document.getElementById('tpl-preview-canvas');
  const bubble = document.getElementById('tpl-preview-bubble');
  const previewText = document.getElementById('tpl-preview-text');
  const ticks = document.getElementById('tpl-preview-ticks');
  const metaEncoding = document.getElementById('tpl-preview-meta-encoding');
  const metaChars = document.getElementById('tpl-preview-meta-chars');
  const btnUse = document.getElementById('btn-tpl-preview-use');
  const btnCopy = document.getElementById('btn-tpl-preview-copy');

  if (pill) {
    const isCta = (!isSms && t.template_type === 'cta');
    pill.textContent = isSms ? 'SMS (GSM)' : (isCta ? 'WhatsApp CTA' : 'WhatsApp');
    pill.style.background = isSms ? '#2563eb' : (isCta ? '#7c3aed' : '#10b981');
  }

  if (appHeader) {
    appHeader.style.background = isSms ? '#1e3a8a' : '#075e54';
  }
  if (senderName) {
    senderName.textContent = isSms ? 'SMS Gateway (MSGSPH)' : 'MessageSphere Official';
  }
  if (subStatus) {
    subStatus.textContent = isSms ? 'Direct Carrier Route' : 'online';
    subStatus.style.color = isSms ? '#93c5fd' : '#bbf7d0';
  }

  if (canvas) {
    canvas.style.background = isSms ? '#f1f5f9' : '#e5ddd5';
  }
  if (bubble) {
    bubble.style.background = isSms ? '#dbeafe' : '#fff';
    bubble.style.color = isSms ? '#1e3a8a' : '#111827';
  }
  if (ticks) {
    ticks.style.display = isSms ? 'none' : 'inline';
  }

  // Handle Media Attachment Preview in Phone Bubble (Multi-image, Video, PDF)
  const mediaBox = document.getElementById('tpl-preview-media-box');
  const mediaImg = document.getElementById('tpl-preview-media-img');
  const mediaPdf = document.getElementById('tpl-preview-media-pdf');
  const mediaPdfName = document.getElementById('tpl-preview-pdf-name');
  const mediaVideo = document.getElementById('tpl-preview-media-video');
  const mediaVideoName = document.getElementById('tpl-preview-video-name');

  let attList = [];
  if (t.attachments) {
    try { attList = typeof t.attachments === 'string' ? JSON.parse(t.attachments) : t.attachments; } catch(e){}
  }
  if ((!attList || attList.length === 0) && t.attachment_url) {
    attList = [{
      type: t.media_type || 'image',
      url: t.attachment_url,
      filename: t.attachment_name || 'attachment'
    }];
  }

  if (attList.length > 0 && !isSms) {
    if (mediaBox) mediaBox.style.display = 'block';
    const firstImg = attList.find(a => a.type === 'image');
    const firstPdf = attList.find(a => a.type === 'pdf');
    const firstVideo = attList.find(a => a.type === 'video');

    if (firstImg) {
      if (mediaImg) {
        mediaImg.style.display = 'block';
        mediaImg.src = firstImg.url;
      }
    } else {
      if (mediaImg) mediaImg.style.display = 'none';
    }

    if (firstVideo) {
      if (mediaVideo) {
        mediaVideo.style.display = 'flex';
        if (mediaVideoName) mediaVideoName.textContent = firstVideo.filename || 'video.mp4';
      }
    } else {
      if (mediaVideo) mediaVideo.style.display = 'none';
    }

    if (firstPdf) {
      if (mediaPdf) {
        mediaPdf.style.display = 'flex';
        if (mediaPdfName) mediaPdfName.textContent = firstPdf.filename || 'document.pdf';
      }
    } else {
      if (mediaPdf) mediaPdf.style.display = 'none';
    }
  } else {
    if (mediaBox) mediaBox.style.display = 'none';
    if (mediaImg) mediaImg.style.display = 'none';
    if (mediaPdf) mediaPdf.style.display = 'none';
    if (mediaVideo) mediaVideo.style.display = 'none';
  }

  if (previewText) {
    previewText.innerHTML = formatLiveMessagePreview(text);
  }

  // Handle WhatsApp CTA Buttons under the Phone Bubble
  const ctaBox = document.getElementById('tpl-preview-cta-box');
  const ctaUrlBtn = document.getElementById('tpl-preview-cta-url-btn');
  const ctaUrlTxt = document.getElementById('tpl-preview-cta-url-text');
  const ctaCallBtn = document.getElementById('tpl-preview-cta-call-btn');
  const ctaCallTxt = document.getElementById('tpl-preview-cta-call-text');

  let cta = null;
  if (t.cta_data) {
    try { cta = typeof t.cta_data === 'string' ? JSON.parse(t.cta_data) : t.cta_data; } catch(e){}
  }

  if (!isSms && t.template_type === 'cta' && cta) {
    if (ctaBox) ctaBox.style.display = 'flex';
    if (cta.url_link) {
      if (ctaUrlBtn) {
        ctaUrlBtn.style.display = 'block';
        ctaUrlBtn.href = cta.url_link;
      }
      if (ctaUrlTxt) ctaUrlTxt.textContent = cta.url_text || 'Visit Website';
    } else {
      if (ctaUrlBtn) ctaUrlBtn.style.display = 'none';
    }

    if (cta.call_number) {
      if (ctaCallBtn) {
        ctaCallBtn.style.display = 'block';
        ctaCallBtn.href = 'tel:' + cta.call_number;
      }
      if (ctaCallTxt) ctaCallTxt.textContent = cta.call_text || 'Call Now';
    } else {
      if (ctaCallBtn) ctaCallBtn.style.display = 'none';
    }
  } else {
    if (ctaBox) ctaBox.style.display = 'none';
  }

  if (metaEncoding) {
    metaEncoding.textContent = isSms ? (metrics.isUnicode ? `Unicode • ${metrics.parts} Part(s)` : `GSM-7 • ${metrics.parts} Part(s)`) : '1 WhatsApp Credit';
  }
  if (metaChars) {
    metaChars.textContent = `${metrics.charCount} Characters`;
  }

  if (btnCopy) {
    btnCopy.onclick = () => {
      copyTemplateContent(t.id);
    };
  }

  if (btnUse) {
    btnUse.innerHTML = isSms 
      ? '<i data-lucide="smartphone" style="width:12px;height:12px;"></i> Use in Bulk SMS' 
      : '<i data-lucide="send" style="width:12px;height:12px;"></i> Use in WhatsApp Campaign';
    btnUse.style.background = isSms ? '#6366f1' : '#10b981';
    btnUse.onclick = () => {
      modalPreviewTemplate.style.display = 'none';
      useTemplateForCampaign(t.id);
    };
  }

  modalPreviewTemplate.style.display = 'flex';
  if (window.lucide) lucide.createIcons({ root: modalPreviewTemplate });
};

// Browse Starter Templates Gallery
if (btnOpenStarters) {
  btnOpenStarters.addEventListener('click', async () => {
    try {
      if (!cachedStarterTemplates || cachedStarterTemplates.length === 0) {
        cachedStarterTemplates = await apiFetch('/templates/starters');
      }
      renderStarterTemplatesGrid();
      if (modalStarterTemplates) modalStarterTemplates.style.display = 'flex';
    } catch (err) {
      showToast('error', 'Failed to load starters', err.message);
    }
  });
}

function renderStarterTemplatesGrid() {
  const grid = document.getElementById('starter-templates-grid');
  if (!grid || !cachedStarterTemplates.length) return;

  grid.innerHTML = cachedStarterTemplates.map((s, idx) => {
    const isSms = (s.channel === 'sms');
    const metrics = computeGsmMetrics(s.content, isSms ? 'sms' : 'whatsapp');
    const channelBadge = isSms
      ? `<span class="status-badge" style="background:#eff6ff;color:#1e40af;font-size:0.72rem;"><i data-lucide="smartphone" style="width:11px;height:11px;"></i> SMS</span>`
      : `<span class="status-badge" style="background:#ecfdf5;color:#047857;font-size:0.72rem;"><i data-lucide="message-circle" style="width:11px;height:11px;"></i> WhatsApp</span>`;

    const formatBadge = (!isSms && s.template_type === 'cta')
      ? `<span class="status-badge" style="background:#fef3c7;color:#b45309;font-size:0.7rem;"><i data-lucide="mouse-pointer-click" style="width:10px;height:10px;"></i> CTA</span>`
      : '';
    const attBadge = (!isSms && s.attachment_url)
      ? `<span class="status-badge" style="background:#f5f3ff;color:#6d28d9;font-size:0.7rem;"><i data-lucide="paperclip" style="width:10px;height:10px;"></i> Media</span>`
      : '';

    return `
      <div style="background:#fff;border:1px solid #e2e8f0;border-radius:10px;padding:14px;display:flex;flex-direction:column;justify-content:space-between;box-shadow:0 1px 3px rgba(0,0,0,0.05);transition:transform 0.15s ease;">
        <div>
          <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;margin-bottom:8px;">
            <strong style="color:var(--slate-800);font-size:0.88rem;">${escapeHtml(s.title)}</strong>
            <div style="display:flex;align-items:center;gap:4px;">
              ${channelBadge}
              ${formatBadge}
              ${attBadge}
            </div>
          </div>
          <div style="background:#f8fafc;border-radius:6px;padding:8px 10px;font-size:0.8rem;color:var(--slate-700);line-height:1.45;margin-bottom:10px;white-space:pre-wrap;max-height:90px;overflow-y:auto;">
            ${escapeHtml(s.content)}
          </div>
        </div>
        <div style="display:flex;justify-content:space-between;align-items:center;margin-top:6px;padding-top:8px;border-top:1px solid #f1f5f9;">
          <span style="font-size:0.7rem;color:var(--slate-500);">${metrics.badgeText}</span>
          <button type="button" class="btn-action btn-action-primary" onclick="installStarterTemplate(${idx})" style="padding:4px 10px;font-size:0.75rem;">
            <i data-lucide="plus" style="width:12px;height:12px;"></i> Add to My Templates
          </button>
        </div>
      </div>
    `;
  }).join('');

  if (window.lucide) lucide.createIcons({ root: grid });
}

window.installStarterTemplate = async function(starterIndex) {
  const s = cachedStarterTemplates[starterIndex];
  if (!s) return;

  try {
    const res = await apiFetch('/templates', {
      method: 'POST',
      body: JSON.stringify({
        title: s.title,
        channel: s.channel,
        template_type: s.template_type || 'standard',
        attachment_url: s.attachment_url || null,
        cta_data: s.cta_data || null,
        category: s.category || 'MARKETING',
        body: s.content
      })
    });
    showToast('success', 'Starter Added', `"${s.title}" has been saved to your templates!`);
    loadTemplates();
    populateComposerSelectors();
    if (modalStarterTemplates) modalStarterTemplates.style.display = 'none';
  } catch (err) {
    showToast('error', 'Add Failed', err.message);
  }
};

window.deleteTemplate = function(id) {
  window.openActionDialog({
    title: 'Delete Template',
    message: 'Are you sure you want to delete this message template? It will be removed from your template library.',
    icon: 'trash-2',
    iconColor: '#dc2626',
    iconBg: '#fee2e2',
    confirmText: 'Delete Template',
    confirmClass: 'btn-action-danger',
    onConfirm: async () => {
      try {
        await apiFetch(`/templates/${id}`, { method: 'DELETE' });
        showToast('info', 'Deleted', 'Template removed.');
        loadTemplates();
        populateComposerSelectors();
      } catch (err) {
        showToast('error', 'Delete Failed', err.message);
      }
    }
  });
};

// ==========================================
// ENTERPRISE MODULE 4: BILLING ORDERS & TOP-UPS
// ==========================================
const billingOrdersTbody = document.getElementById('billing-orders-tbody');
const modalBillingOrder = document.getElementById('modal-billing-order');
const btnNewBillingOrderModal = document.getElementById('btn-new-billing-order-modal');
const btnModalSaveOrder = document.getElementById('btn-modal-save-order');
const modalOrderDest = document.getElementById('modal-order-dest');
const modalOrderType = document.getElementById('modal-order-type');
const modalOrderCredits = document.getElementById('modal-order-credits');
const modalOrderNotes = document.getElementById('modal-order-notes');

window.selectTopupPreset = function(credits, cardEl) {
  if (modalOrderCredits) {
    modalOrderCredits.value = credits;
  }
  document.querySelectorAll('.topup-bundle-card').forEach(c => {
    c.style.borderColor = '#e2e8f0';
    c.style.background = '#f8fafc';
  });
  if (cardEl) {
    cardEl.style.borderColor = '#4f46e5';
    cardEl.style.background = '#eef2ff';
  }
  window.calculateTopupAmount();
};

window.calculateTopupAmount = function() {
  const credits = parseInt(modalOrderCredits?.value || 0, 10);
  const dest = modalOrderDest?.value || 'domestic';
  const type = modalOrderType?.value || 'normal';
  const calcEl = document.getElementById('modal-order-calc-price');
  const rateInput = document.getElementById('modal-order-rate');
  if (!calcEl) return;

  if (!credits || credits <= 0) {
    calcEl.textContent = '₹0';
    return;
  }

  let rate = 0.15;
  if (rateInput && rateInput.value !== '' && !rateInput.dataset.autoReset) {
    rate = parseFloat(rateInput.value) || 0.15;
  } else {
    if (dest === 'international') {
      rate = 2.50;
    } else {
      if (type === 'gsm_sms' || type === 'normal') {
        if (credits >= 100000) rate = 0.09;
        else if (credits >= 50000) rate = 0.11;
        else if (credits >= 25000) rate = 0.13;
        else rate = 0.15;
      } else if (type === 'dp') {
        rate = 0.30;
      } else if (type === 'cta') {
        rate = 0.25;
      } else if (type === 'dp_cta') {
        rate = 0.40;
      } else {
        rate = 0.15;
      }
    }
    if (rateInput) rateInput.value = rate.toFixed(3);
  }

  const total = Math.round(credits * rate);
  calcEl.textContent = `₹${total.toLocaleString()}`;
};

window.handleTopupReceiptFile = function(input) {
  const file = input?.files?.[0];
  if (!file) return;
  if (file.size > 5 * 1024 * 1024) {
    showToast('warning', 'File Too Large', 'Payment receipt file must be under 5 MB.');
    input.value = '';
    return;
  }
  const reader = new FileReader();
  reader.onload = function(e) {
    const dataUrl = e.target.result;
    const urlInput = document.getElementById('modal-order-receipt-url');
    if (urlInput) urlInput.value = dataUrl;

    const placeholder = document.getElementById('topup-receipt-placeholder');
    const preview = document.getElementById('topup-receipt-preview');
    const filenameEl = document.getElementById('topup-receipt-filename');
    if (placeholder) placeholder.style.display = 'none';
    if (preview) preview.style.display = 'flex';
    if (filenameEl) filenameEl.textContent = file.name;
    showToast('info', 'Receipt Attached', `${file.name} attached successfully.`);
  };
  reader.readAsDataURL(file);
};

window.removeTopupReceipt = function() {
  const input = document.getElementById('modal-order-receipt-input');
  const urlInput = document.getElementById('modal-order-receipt-url');
  if (input) input.value = '';
  if (urlInput) urlInput.value = '';
  const placeholder = document.getElementById('topup-receipt-placeholder');
  const preview = document.getElementById('topup-receipt-preview');
  if (placeholder) placeholder.style.display = 'flex';
  if (preview) preview.style.display = 'none';
};

window.openCreditTopupModal = function() {
  if (currentUser && currentUser.role === 'admin') {
    showToast('info', 'Master Issuer Account', 'Super Admin is the root issuer of the platform with unlimited master credits. Use "Allot Credits" to allocate stock to clients or resellers.');
    window.openWalletAllotCreditsModal();
    return;
  }
  if (modalOrderCredits) modalOrderCredits.value = '';
  if (modalOrderNotes) modalOrderNotes.value = '';
  window.removeTopupReceipt();
  const calcEl = document.getElementById('modal-order-calc-price');
  if (calcEl) calcEl.textContent = '₹0';
  document.querySelectorAll('.topup-bundle-card').forEach(c => {
    c.style.borderColor = '#e2e8f0';
    c.style.background = '#f8fafc';
  });
  if (modalBillingOrder) {
    modalBillingOrder.style.display = 'flex';
    if (window.lucide) setTimeout(() => lucide.createIcons(), 50);
  }
};

window.openRechargeReceiptModal = function(txId) {
  const tx = (allTransactions || []).find(t => String(t.id) === String(txId));
  if (!tx) {
    showToast('info', 'Receipt Slip', `Transaction #${txId} details not found in current loaded list.`);
    return;
  }
  const modal = document.getElementById('modal-recharge-receipt');
  if (!modal) return;

  const setTxt = (id, txt) => {
    const el = document.getElementById(id);
    if (el) el.textContent = txt;
  };

  const credits = Math.abs(Number(tx.amount) || 0);
  const rawReason = String(tx.reason || '').toLowerCase();
  const isRefund = Boolean(tx.refund_campaign_id) || rawReason.includes('refund') || rawReason.includes('auto-refund');

  const estRate = (tx.destination === 'international') ? 2.50 : 0.15;
  const computedGross = Number(tx.base_amount || 0) > 0 ? (Number(tx.base_amount) + Number(tx.gst_amount || 0)) : Math.round(credits * estRate);

  const isWithGst = !isRefund && (tx.tax_mode === 'with_gst' || Number(tx.gst_amount) > 0);

  const baseVal = Number(tx.base_amount || 0) > 0 ? Number(tx.base_amount) : (isWithGst ? (computedGross / 1.18) : computedGross);
  const gstVal = isWithGst ? (Number(tx.gst_amount || 0) > 0 ? Number(tx.gst_amount) : (computedGross - baseVal)) : 0;
  const grossVal = isWithGst ? (baseVal + gstVal) : baseVal;

  const titleEl = document.getElementById('receipt-modal-title');
  const pillEl = document.getElementById('receipt-status-pill');
  const pillTxt = document.getElementById('receipt-status-text');
  const taxMeta = document.getElementById('receipt-company-tax-meta');
  const unitsLabel = document.getElementById('receipt-label-units');
  const subUnits = document.getElementById('receipt-sub-units');
  const taxHeader = document.getElementById('receipt-tax-header');
  const taxRow1Label = document.getElementById('receipt-tax-label-1');
  const taxRow2 = document.getElementById('receipt-tax-row-2');
  const taxRow3Label = document.getElementById('receipt-tax-label-3');

  if (isRefund) {
    if (titleEl) titleEl.textContent = 'Telecom Credit Reversal Voucher';
    if (pillEl) {
      pillEl.style.background = '#eff6ff';
      pillEl.style.color = '#1d4ed8';
      pillEl.style.borderColor = '#bfdbfe';
    }
    if (pillTxt) pillTxt.textContent = 'CARRIER REVERSAL / FAILED AUTO-REFUND';
    if (taxMeta) taxMeta.innerHTML = 'Delivery Reconciliation Ledger &bull; Internal Credit Reversal &bull; Non-Taxable';
    if (unitsLabel) unitsLabel.textContent = 'Refunded Credits Restored';
    if (subUnits) subUnits.textContent = 'Undelivered Mobile Broadcast Balance Credited Back';
    if (taxHeader) taxHeader.textContent = 'Credit Reversal Reconciliation (Exempt from GST)';
    if (taxRow1Label) taxRow1Label.textContent = 'Reversed Balance Valuation:';
    if (taxRow2) taxRow2.style.display = 'none';
    if (taxRow3Label) taxRow3Label.textContent = 'Net Statutory Tax Impact:';

    setTxt('receipt-taxable-val', '₹0.00 (Telecom Balance Restored)');
    setTxt('receipt-gst-val', '₹0.00 (Exempt)');
    setTxt('receipt-total-val', '₹0.00 (Exempt Reversal)');
  } else if (!isWithGst) {
    if (titleEl) titleEl.textContent = 'Commercial Credit Voucher (Non-GST)';
    if (pillEl) {
      pillEl.style.background = '#ecfdf5';
      pillEl.style.color = '#059669';
      pillEl.style.borderColor = '#bbf7d0';
    }
    if (pillTxt) pillTxt.textContent = 'VERIFIED & CREDITED TO VAULT';
    if (taxMeta) taxMeta.innerHTML = 'Bill of Supply (Section 31(3)(c) of CGST Act) &bull; Retail Non-GST Telecom Supply';
    if (unitsLabel) unitsLabel.textContent = 'Credits Credited';
    if (subUnits) subUnits.textContent = 'Direct Telecom Balance Added';
    if (taxHeader) taxHeader.textContent = 'Commercial Invoicing (Non-GST / Bill of Supply)';
    if (taxRow1Label) taxRow1Label.textContent = 'Commercial Service Value:';
    if (taxRow2) taxRow2.style.display = 'none';
    if (taxRow3Label) taxRow3Label.textContent = 'Total Commercial Invoice Value:';

    setTxt('receipt-taxable-val', `₹${grossVal.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
    setTxt('receipt-gst-val', '₹0.00 (0% Exempt)');
    setTxt('receipt-total-val', `₹${grossVal.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
  } else {
    if (titleEl) titleEl.textContent = 'Credit Voucher & GST Tax Statement';
    if (pillEl) {
      pillEl.style.background = '#ecfdf5';
      pillEl.style.color = '#059669';
      pillEl.style.borderColor = '#bbf7d0';
    }
    if (pillTxt) pillTxt.textContent = 'VERIFIED & CREDITED TO VAULT';
    
    // Dynamic White-Label Tax Meta & Legal Entity
    const activeBrand = window.activeBrandProfile;
    const companyNameEl = document.getElementById('receipt-company-name');
    if (companyNameEl) {
      companyNameEl.textContent = activeBrand?.company_legal_name || activeBrand?.brand_name || 'MessageSphere Technologies Pvt Ltd';
    }

    const brandGstin = activeBrand?.company_gstin || '08AABCM1234F1Z5';
    const brandAddress = activeBrand?.company_address ? ` &bull; ${escapeHtml(activeBrand.company_address)}` : ' &bull; State: 08 (Rajasthan / India)';
    if (taxMeta) taxMeta.innerHTML = `GSTIN: <strong>${escapeHtml(brandGstin)}</strong>${brandAddress} &bull; SAC: <strong>998413</strong>`;
    
    if (unitsLabel) unitsLabel.textContent = 'Credits Credited';
    if (subUnits) subUnits.textContent = 'Direct Telecom Balance Added';
    if (taxHeader) taxHeader.textContent = 'Statutory Tax Breakdown (SAC 998413)';
    if (taxRow1Label) taxRow1Label.textContent = 'Taxable Service Base Value:';
    if (taxRow2) taxRow2.style.display = 'flex';
    if (taxRow3Label) taxRow3Label.textContent = 'Total Invoice Gross Value:';

    setTxt('receipt-taxable-val', `₹${baseVal.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
    setTxt('receipt-gst-val', `₹${gstVal.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
    setTxt('receipt-total-val', `₹${grossVal.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
  }

  const activeBrand = window.activeBrandProfile;
  const brandPrefix = (activeBrand?.brand_name || 'MS').replace(/[^A-Za-z0-9]/g, '').slice(0, 4).toUpperCase();
  setTxt('receipt-tx-id', `${brandPrefix}-REC-${tx.id}`);
  setTxt('receipt-timestamp', new Date(tx.created_at).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }));
  let voucherNotes = tx.reason || 'Telecom credit allotment approved & verified';
  let voucherAccount = currentUser?.email || tx.counterparty_email || 'Verified Account';
  if (currentUser && currentUser.role !== 'admin') {
    voucherNotes = voucherNotes
      .replace(/Allotted by (?:reseller|admin)\s*(?:\([^)]*\))?\s*:\s*/gi, 'Telecom Balance Allotment: ')
      .replace(/Deduction by (?:reseller|admin)\s*(?:\([^)]*\))?\s*:\s*/gi, 'Balance Adjustment: ')
      .replace(/\bby reseller\b/gi, 'via Telecom Gateway')
      .replace(/\[Created by [^\]]+ on behalf of account\]/gi, '');
    voucherAccount = currentUser?.email || 'Verified Account';
  }

  setTxt('receipt-account', voucherAccount);
  setTxt('receipt-channel', `${(tx.credit_type || 'normal').toUpperCase()} (${tx.destination === 'international' ? 'International' : 'Domestic'})`);
  setTxt('receipt-amount', `+${credits.toLocaleString()}`);
  setTxt('receipt-notes', voucherNotes);

  modal.style.display = 'flex';
  if (window.lucide) setTimeout(() => lucide.createIcons(), 50);
};

window.printReceiptVoucher = function() {
  const printContent = document.getElementById('receipt-printable-area');
  if (!printContent) return;
  const win = window.open('', '_blank', 'width=650,height=600');
  win.document.write(`
    <!DOCTYPE html>
    <html>
      <head>
        <title>Credit Voucher Slip - MessageSphere</title>
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; padding: 28px; color: #0f172a; margin: 0; }
          @media print { body { padding: 12px; } }
        </style>
      </head>
      <body>
        ${printContent.innerHTML}
        <script>
          window.onload = function() { window.print(); };
        <\/script>
      </body>
    </html>
  `);
  win.document.close();
};

if (btnNewBillingOrderModal) {
  btnNewBillingOrderModal.addEventListener('click', () => {
    if (currentUser && currentUser.role === 'admin') {
      window.openWalletAllotCreditsModal();
    } else {
      window.openCreditTopupModal();
    }
  });
}

if (btnModalSaveOrder) {
  btnModalSaveOrder.addEventListener('click', async () => {
    const destination = modalOrderDest.value;
    const credit_type = modalOrderType.value;
    const credits = parseInt(modalOrderCredits.value, 10);
    const notes = modalOrderNotes.value.trim();
    const receipt_url = document.getElementById('modal-order-receipt-url')?.value || null;
    const rate_per_credit = parseFloat(document.getElementById('modal-order-rate')?.value) || 0.150;

    if (!credits || credits <= 0) {
      showToast('warning', 'Invalid Credits', 'Please enter or select a valid credit quantity.');
      return;
    }

    if (!notes) {
      showToast('warning', 'UTR Reference Required', 'Please enter your payment UTR / Transaction reference number so our billing team can verify and credit your vault.');
      modalOrderNotes.focus();
      return;
    }

    btnModalSaveOrder.disabled = true;
    btnModalSaveOrder.textContent = 'Submitting Request...';

    try {
      const res = await apiFetch('/billing/requests', {
        method: 'POST',
        body: JSON.stringify({ destination, credit_type, credits, notes, receipt_url, rate_per_credit })
      });
      showToast('success', 'Top-up Request Submitted', `Order #${res.request.id} for ${credits.toLocaleString()} credits submitted. Verification TAT: 5-15 mins.`);
      modalBillingOrder.style.display = 'none';
      if (typeof loadBillingOrders === 'function') loadBillingOrders();
    } catch (err) {
      showToast('error', 'Error', err.message);
    } finally {
      btnModalSaveOrder.disabled = false;
      btnModalSaveOrder.textContent = 'Submit Top-up Order';
    }
  });
}

let cachedBillingOrders = [];
let billingCurrentFilter = 'all';
let billingSearchQuery = '';
let adminBillingScope = 'direct'; // 'direct' or 'reseller_sales'
window.adminBillingScope = 'direct';

window.switchAdminBillingScope = function(scope) {
  adminBillingScope = scope || 'direct';
  window.adminBillingScope = adminBillingScope;
  const btnDirect = document.getElementById('btn-billing-scope-direct');
  const btnReseller = document.getElementById('btn-billing-scope-reseller');
  const hintEl = document.getElementById('billing-scope-hint');

  if (btnDirect && btnReseller) {
    if (adminBillingScope === 'direct') {
      btnDirect.style.background = '#4f46e5';
      btnDirect.style.color = '#fff';
      btnDirect.style.fontWeight = '700';
      btnReseller.style.background = 'transparent';
      btnReseller.style.color = '#475569';
      btnReseller.style.fontWeight = '600';
      if (hintEl) hintEl.textContent = 'Accounts receivable owed directly to Platform Admin by direct clients and reseller partner accounts.';
    } else {
      btnReseller.style.background = '#4f46e5';
      btnReseller.style.color = '#fff';
      btnReseller.style.fontWeight = '700';
      btnDirect.style.background = 'transparent';
      btnDirect.style.color = '#475569';
      btnDirect.style.fontWeight = '600';
      if (hintEl) hintEl.textContent = 'Auditing client sales made by Resellers. (Reseller collects payment directly from their client; not owed to Admin).';
    }
  }

  loadBillingOrders();
};

window.filterBillingTab = function(filter, btn) {
  billingCurrentFilter = filter || 'all';
  document.querySelectorAll('.billing-tab-pill').forEach(b => {
    b.classList.remove('active');
    b.style.fontWeight = '600';
  });
  if (btn) {
    btn.classList.add('active');
    btn.style.fontWeight = '700';
  }
  renderBillingOrdersTable();
};

window.onBillingSearch = function(query) {
  billingSearchQuery = (query || '').trim().toLowerCase();
  renderBillingOrdersTable();
};

function renderBillingOrdersTable() {
  if (!billingOrdersTbody) return;
  if (!cachedBillingOrders || cachedBillingOrders.length === 0) {
    billingOrdersTbody.innerHTML = `<tr><td colspan="12" style="text-align:center;padding:30px;color:var(--slate-400);">No billing top-up orders found.</td></tr>`;
    return;
  }

  let filtered = cachedBillingOrders.slice();

  // Filter by tab
  if (billingCurrentFilter === 'due') {
    filtered = filtered.filter(o => {
      const pStatus = (o.payment_status || 'unpaid').toLowerCase();
      const due = parseFloat(o.due_amount !== undefined ? o.due_amount : (parseFloat(o.amount_inr || 0) - parseFloat(o.paid_amount || 0)));
      return pStatus === 'unpaid' || due > 0;
    });
  } else if (billingCurrentFilter === 'partial') {
    filtered = filtered.filter(o => {
      const pStatus = (o.payment_status || '').toLowerCase();
      const paid = parseFloat(o.paid_amount) || 0;
      const total = parseFloat(o.amount_inr) || 0;
      return pStatus === 'partial' || (paid > 0 && paid < total);
    });
  } else if (billingCurrentFilter === 'paid') {
    filtered = filtered.filter(o => {
      const pStatus = (o.payment_status || '').toLowerCase();
      const due = parseFloat(o.due_amount !== undefined ? o.due_amount : (parseFloat(o.amount_inr || 0) - parseFloat(o.paid_amount || 0)));
      return pStatus === 'paid' || (due <= 0 && parseFloat(o.amount_inr) > 0);
    });
  }

  // Filter by search query
  if (billingSearchQuery) {
    filtered = filtered.filter(o => {
      const email = (o.user_email || '').toLowerCase();
      const utr = (o.utr_number || '').toLowerCase();
      const idStr = String(o.id);
      return email.includes(billingSearchQuery) || utr.includes(billingSearchQuery) || idStr.includes(billingSearchQuery);
    });
  }

  if (filtered.length === 0) {
    billingOrdersTbody.innerHTML = `<tr><td colspan="12" style="text-align:center;padding:30px;color:var(--slate-400);">No orders matching current filter or search criteria.</td></tr>`;
    return;
  }

  const isAdmin = currentUser && currentUser.role === 'admin';
  const isReseller = currentUser && currentUser.role === 'reseller';

  billingOrdersTbody.innerHTML = filtered.map(ord => {
    const oStatus = (ord.status || 'Pending').toLowerCase();
    let badgeClass = 'badge-submitted';
    if (oStatus === 'approved') badgeClass = 'badge-updated';
    if (oStatus === 'rejected') badgeClass = 'badge-rejected';

    const totalBill = parseFloat(ord.amount_inr) || 0;
    const paidAmount = parseFloat(ord.paid_amount) || 0;
    const dueAmount = Math.max(0, totalBill - paidAmount);

    let pBadgeHtml = '';
    if (dueAmount <= 0 && totalBill > 0) {
      pBadgeHtml = `<span class="status-badge" style="background:#ecfdf5;color:#047857;border:1px solid #a7f3d0;font-weight:700;font-size:0.7rem;">PAID (SETTLED)</span>`;
    } else if (paidAmount > 0 && dueAmount > 0) {
      pBadgeHtml = `<span class="status-badge" style="background:#fffbeb;color:#b45309;border:1px solid #fde68a;font-weight:700;font-size:0.7rem;">PARTIAL (₹${dueAmount.toLocaleString()} DUE)</span>`;
    } else {
      pBadgeHtml = `<span class="status-badge" style="background:#fef2f2;color:#b91c1c;border:1px solid #fecaca;font-weight:700;font-size:0.7rem;">UNPAID (FULL DUE)</span>`;
    }

    const ratePerCr = parseFloat(ord.rate_per_credit) || (totalBill > 0 && ord.credits_requested ? (totalBill / ord.credits_requested) : 0.150);

    const isDownstream = Boolean(ord.is_downstream_client);

    // Settlement permission boundary:
    // Admin ONLY settles direct users and reseller accounts. Downstream client invoices are strictly between client and reseller!
    // Resellers ONLY settle their own downstream clients. Resellers cannot settle their own invoice to Admin.
    let canManageKhata = false;
    if (isAdmin) {
      canManageKhata = !isDownstream;
    } else if (isReseller) {
      canManageKhata = isDownstream && (ord.reseller_id === currentUser.id);
    }

    let actionBtns = [];
    if (canManageKhata) {
      actionBtns.push(`
        <button class="btn-action" onclick="openRecordPaymentModal(${ord.id})" style="padding:3px 8px;font-size:0.72rem;background:#ecfdf5;color:#059669;border:1px solid #a7f3d0;font-weight:700;display:inline-flex;align-items:center;gap:3px;" title="Record payment or settle invoice">
          <i data-lucide="hand-coins" style="width:12px;height:12px;"></i> Settle ₹
        </button>
      `);
    }

    const canApproveReject = (
      (isAdmin && !isDownstream) || 
      (isReseller && isDownstream && ord.reseller_id === currentUser.id)
    ) && oStatus === 'pending';

    if (canApproveReject) {
      actionBtns.push(`
        <button class="btn-action btn-action-success" onclick="approveBillingOrder(${ord.id})" style="padding:3px 8px;font-size:0.72rem;display:inline-flex;align-items:center;gap:3px;" title="Approve order & allot credits">
          <i data-lucide="check" style="width:12px;height:12px;"></i> Approve
        </button>
        <button class="btn-action btn-action-danger" onclick="rejectBillingOrder(${ord.id})" style="padding:3px 8px;font-size:0.72rem;display:inline-flex;align-items:center;gap:3px;" title="Reject request">
          <i data-lucide="x" style="width:12px;height:12px;"></i> Reject
        </button>
      `);
    }

    const actionsHtml = actionBtns.length > 0 ? `<div style="display:flex;gap:4px;justify-content:center;flex-wrap:wrap;">${actionBtns.join('')}</div>` : '-';

    const cTypeLabel = ord.credit_type === 'gsm_sms' ? 'GSM Bulk SMS' : (ord.credit_type === 'normal' ? 'WA Text' : (ord.credit_type || '').toUpperCase());

    let clientAccountHtml = `
      <strong style="font-size:0.82rem;color:#0f172a;">${escapeHtml(ord.user_email || currentUser.email)}</strong>
      <div style="font-size:0.68rem;color:#64748b;text-transform:uppercase;">${ord.user_role || 'client'}</div>
    `;

    if (isDownstream) {
      const resellerLabel = ord.reseller_company || ord.reseller_name || ord.reseller_email || 'Partner';
      clientAccountHtml = `
        <strong style="font-size:0.82rem;color:#0f172a;">${escapeHtml(ord.user_email || '')}</strong>
        <div style="margin-top:2px;display:flex;align-items:center;gap:4px;flex-wrap:wrap;">
          <span class="status-badge" style="background:#e0e7ff;color:#3730a3;font-size:0.65rem;font-weight:700;padding:1px 6px;">Client</span>
          <span style="font-size:0.7rem;color:#64748b;">via Reseller: <strong style="color:#1e1b4b;">${escapeHtml(resellerLabel)}</strong></span>
        </div>
      `;
    }

    let paymentStatusColHtml = `<div style="text-align:center;">${pBadgeHtml}</div>`;
    if (isDownstream && isAdmin) {
      paymentStatusColHtml = `
        <div style="text-align:center;">
          ${pBadgeHtml}
          <div style="font-size:0.65rem;color:#64748b;margin-top:3px;font-weight:600;">(Reseller Khata)</div>
        </div>
      `;
    }

    return `
      <tr>
        <td>
          <strong style="font-family:monospace;font-size:0.82rem;">#${ord.id}</strong>
          <div style="font-size:0.68rem;color:#64748b;font-family:monospace;">${escapeHtml(ord.utr_number || 'INV')}</div>
        </td>
        <td>
          ${clientAccountHtml}
        </td>
        <td>
          <span style="display:inline-flex;align-items:center;gap:4px;font-size:0.78rem;font-weight:600;">
            <i data-lucide="${ord.destination === 'international' ? 'globe-2' : 'globe'}" style="width:13px;height:13px;color:var(--primary);"></i>
            ${ord.destination === 'international' ? 'Intl' : 'Dom'} / ${cTypeLabel}
          </span>
        </td>
        <td style="text-align:right;">
          <strong style="color:var(--primary);font-size:0.85rem;">${Number(ord.credits_requested || ord.credits || 0).toLocaleString()}</strong>
        </td>
        <td style="text-align:right;font-size:0.8rem;color:#475569;font-family:monospace;">
          ₹${ratePerCr.toFixed(3)}
        </td>
        <td style="text-align:right;">
          <strong style="font-size:0.85rem;color:#0f172a;">₹${totalBill.toLocaleString('en-IN', {minimumFractionDigits: 2, maximumFractionDigits: 2})}</strong>
        </td>
        <td style="text-align:right;">
          <strong style="font-size:0.85rem;color:#059669;">₹${paidAmount.toLocaleString('en-IN', {minimumFractionDigits: 2, maximumFractionDigits: 2})}</strong>
        </td>
        <td style="text-align:right;">
          <strong style="font-size:0.85rem;color:${dueAmount > 0 ? '#dc2626' : '#64748b'};">₹${dueAmount.toLocaleString('en-IN', {minimumFractionDigits: 2, maximumFractionDigits: 2})}</strong>
        </td>
        <td style="text-align:center;">${paymentStatusColHtml}</td>
        <td style="text-align:center;"><span class="status-badge ${badgeClass}">${(ord.status || 'Pending').toUpperCase()}</span></td>
        <td style="font-size:0.75rem;color:#64748b;white-space:nowrap;">${new Date(ord.created_at).toLocaleDateString()}</td>
        <td style="text-align:center;">${actionsHtml}</td>
      </tr>
    `;
  }).join('');

  if (window.lucide) lucide.createIcons({ root: billingOrdersTbody });
}

async function loadBillingOrders() {
  if (!billingOrdersTbody) return;
  try {
    const effectiveRole = (currentUser.is_team_member && currentUser.parent_role) ? currentUser.parent_role : currentUser.role;
    const isAdmin = currentUser && effectiveRole === 'admin';
    const activeScope = (typeof adminBillingScope !== 'undefined' ? adminBillingScope : (window.adminBillingScope || 'direct'));
    const scopeParam = isAdmin ? `?scope=${activeScope}` : '';

    const scopeContainer = document.getElementById('admin-billing-scope-container');
    if (scopeContainer) {
      scopeContainer.style.display = isAdmin ? 'flex' : 'none';
    }

    const [orders, summary] = await Promise.all([
      apiFetch(`/billing/requests${scopeParam}`),
      apiFetch(`/billing/summary${scopeParam}`).catch(() => null)
    ]);

    cachedBillingOrders = Array.isArray(orders) ? orders : [];

    if (summary) {
      const setEl = (id, val) => {
        const el = document.getElementById(id);
        if (el) el.textContent = val;
      };

      if (isAdmin && activeScope === 'reseller_sales') {
        setEl('billing-kpi-title-billed', 'Reseller Retail Billed');
        setEl('billing-kpi-sub-billed', 'Gross invoiced by resellers to clients');
        setEl('billing-kpi-title-paid', 'Reseller Collected');
        setEl('billing-kpi-sub-paid', 'Client payments collected by resellers');
        setEl('billing-kpi-title-due', 'Reseller Client Due');
        setEl('billing-kpi-sub-due', 'Pending balance with reseller clients');
        setEl('billing-kpi-title-pending', 'Open Client Orders');
        setEl('billing-kpi-sub-pending', 'Reseller client orders with balance');
      } else {
        setEl('billing-kpi-title-billed', 'Total Billed Value');
        setEl('billing-kpi-sub-billed', 'Gross invoiced to direct users & resellers');
        setEl('billing-kpi-title-paid', 'Cleared (Paid)');
        setEl('billing-kpi-sub-paid', 'Total payment collected by Admin');
        setEl('billing-kpi-title-due', 'Outstanding Balance Due');
        setEl('billing-kpi-sub-due', 'Direct receivables owed to Admin');
        setEl('billing-kpi-title-pending', 'Open Invoiced Accounts');
        setEl('billing-kpi-sub-pending', 'Orders with pending / partial payment to Admin');
      }

      setEl('billing-kpi-total-billed', `₹${Number(summary.total_billed || 0).toLocaleString('en-IN', {minimumFractionDigits: 2, maximumFractionDigits: 2})}`);
      setEl('billing-kpi-total-paid', `₹${Number(summary.total_paid || 0).toLocaleString('en-IN', {minimumFractionDigits: 2, maximumFractionDigits: 2})}`);
      setEl('billing-kpi-total-due', `₹${Number(summary.total_due || 0).toLocaleString('en-IN', {minimumFractionDigits: 2, maximumFractionDigits: 2})}`);
      setEl('billing-kpi-pending-count', (Number(summary.count_unpaid || 0) + Number(summary.count_partial || 0)).toLocaleString());

      setEl('tab-cnt-all', summary.total_orders || cachedBillingOrders.length);
      setEl('tab-cnt-due', summary.count_unpaid || 0);
      setEl('tab-cnt-partial', summary.count_partial || 0);
      setEl('tab-cnt-paid', summary.count_paid || 0);
    } else {
      const dueCount = cachedBillingOrders.filter(o => (parseFloat(o.amount_inr || 0) - parseFloat(o.paid_amount || 0)) > 0 && parseFloat(o.paid_amount || 0) === 0).length;
      const partCount = cachedBillingOrders.filter(o => parseFloat(o.paid_amount || 0) > 0 && (parseFloat(o.amount_inr || 0) - parseFloat(o.paid_amount || 0)) > 0).length;
      const paidCount = cachedBillingOrders.filter(o => parseFloat(o.paid_amount || 0) >= parseFloat(o.amount_inr || 0) && parseFloat(o.amount_inr || 0) > 0).length;
      const setEl = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
      setEl('tab-cnt-all', cachedBillingOrders.length);
      setEl('tab-cnt-due', dueCount);
      setEl('tab-cnt-partial', partCount);
      setEl('tab-cnt-paid', paidCount);
    }

    const btnNewOrder = document.getElementById('btn-new-billing-order-modal');
    if (btnNewOrder && currentUser) {
      if (effectiveRole === 'admin') {
        btnNewOrder.innerHTML = `<i data-lucide="arrow-right-left" style="width: 15px; height: 15px;"></i> Allot Credits / New Invoice`;
      } else {
        btnNewOrder.innerHTML = `<i data-lucide="plus-circle" style="width: 15px; height: 15px;"></i> Request Credit Top-up`;
      }
      if (window.lucide) lucide.createIcons({ root: btnNewOrder });
    }

    renderBillingOrdersTable();
  } catch (err) {
    billingOrdersTbody.innerHTML = `<tr><td colspan="12" style="text-align:center;color:red;padding:20px;">Failed to load orders: ${escapeHtml(err.message)}</td></tr>`;
  }
}

let currentRecordingOrder = null;
window.openRecordPaymentModal = function(id) {
  const ord = (cachedBillingOrders || []).find(o => o.id === id);
  if (!ord) return;
  currentRecordingOrder = ord;

  const totalBill = parseFloat(ord.amount_inr) || 0;
  const alreadyPaid = parseFloat(ord.paid_amount) || 0;
  const currentDue = Math.max(0, totalBill - alreadyPaid);

  const setEl = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
  setEl('modal-payment-client-email', ord.user_email || currentUser.email);
  setEl('modal-payment-total-bill', `₹${totalBill.toLocaleString('en-IN', {minimumFractionDigits: 2, maximumFractionDigits: 2})}`);
  setEl('modal-payment-already-paid', `₹${alreadyPaid.toLocaleString('en-IN', {minimumFractionDigits: 2, maximumFractionDigits: 2})}`);
  setEl('modal-payment-current-due', `₹${currentDue.toLocaleString('en-IN', {minimumFractionDigits: 2, maximumFractionDigits: 2})}`);
  
  const idInp = document.getElementById('modal-payment-order-id');
  if (idInp) idInp.value = ord.id;
  const amtInput = document.getElementById('modal-payment-amount');
  if (amtInput) amtInput.value = currentDue > 0 ? currentDue : '';
  const refInput = document.getElementById('modal-payment-ref');
  if (refInput) refInput.value = '';
  const notesInput = document.getElementById('modal-payment-notes');
  if (notesInput) notesInput.value = '';

  const modal = document.getElementById('modal-record-payment');
  if (modal) {
    modal.style.display = 'flex';
    if (window.lucide) setTimeout(() => lucide.createIcons(), 50);
  }
};

window.setFullSettlementAmount = function() {
  if (!currentRecordingOrder) return;
  const totalBill = parseFloat(currentRecordingOrder.amount_inr) || 0;
  const alreadyPaid = parseFloat(currentRecordingOrder.paid_amount) || 0;
  const currentDue = Math.max(0, totalBill - alreadyPaid);
  const amtInput = document.getElementById('modal-payment-amount');
  if (amtInput) amtInput.value = currentDue;
};

window.submitRecordPayment = function() {
  if (!currentRecordingOrder) return;
  const id = currentRecordingOrder.id;
  const amount = parseFloat(document.getElementById('modal-payment-amount')?.value);
  const payment_mode = document.getElementById('modal-payment-mode')?.value || 'UPI';
  const utr_number = document.getElementById('modal-payment-ref')?.value || '';
  const notes = document.getElementById('modal-payment-notes')?.value || '';

  if (isNaN(amount) || amount <= 0) {
    showToast('warning', 'Invalid Amount', 'Please enter a valid payment amount greater than zero.');
    return;
  }

  const btn = document.getElementById('btn-save-record-payment');
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Recording...';
  }

  apiFetch(`/billing/requests/${id}/record-payment`, {
    method: 'POST',
    body: JSON.stringify({ amount, payment_mode, utr_number, notes })
  }).then(res => {
    showToast('success', 'Payment Recorded!', res.message);
    const modal = document.getElementById('modal-record-payment');
    if (modal) modal.style.display = 'none';
    loadBillingOrders();
  }).catch(err => {
    showToast('error', 'Payment Failed', err.message);
  }).finally(() => {
    if (btn) {
      btn.disabled = false;
      btn.textContent = 'Record & Settle';
    }
  });
};

window.approveBillingOrder = function(id) {
  window.openActionDialog({
    title: `Approve Top-up Order #${id}`,
    message: 'Verify payment receipt and credit user wallet balance immediately.',
    icon: 'coins',
    iconColor: '#059669',
    iconBg: '#dcfce7',
    confirmText: 'Approve & Credit',
    confirmClass: 'btn-action-success',
    showInput: true,
    inputLabel: 'Verification / Bank UTR Reference (Required)',
    inputValue: 'Payment verified via bank statement',
    onConfirm: async ({ input: reason }) => {
      try {
        const res = await apiFetch(`/billing/requests/${id}/approve`, { method: 'POST', body: JSON.stringify({ reason }) });
        showToast('success', 'Order Approved', res.message);
        loadBillingOrders();
        const me = await apiFetch('/auth/me');
        currentUser = me;
        updateCreditDisplays();
      } catch (err) {
        showToast('error', 'Approval Failed', err.message);
      }
    }
  });
};

window.rejectBillingOrder = function(id) {
  window.openActionDialog({
    title: `Reject Top-up Order #${id}`,
    message: 'Reject this top-up order. No credits will be allocated.',
    icon: 'x-circle',
    iconColor: '#dc2626',
    iconBg: '#fee2e2',
    confirmText: 'Reject Request',
    confirmClass: 'btn-action-danger',
    showInput: true,
    inputLabel: 'Rejection Reason (Required)',
    inputValue: 'Payment not received or UTR mismatch',
    onConfirm: async ({ input: reason }) => {
      try {
        const res = await apiFetch(`/billing/requests/${id}/reject`, { method: 'POST', body: JSON.stringify({ reason }) });
        showToast('info', 'Order Rejected', res.message);
        loadBillingOrders();
      } catch (err) {
        showToast('error', 'Rejection Failed', err.message);
      }
    }
  });
};

// ==========================================
// SUPER ADMIN OPERATIONS AUDIT
// ==========================================
async function loadOperationsAudit() {
  if (!currentUser || currentUser.role !== 'admin') return;
  const tbody = document.getElementById('audit-events-tbody');
  try {
    const [events, alerts] = await Promise.all([apiFetch('/audit/events?limit=100'), apiFetch('/audit/alerts')]);
    const setMetric = (id, value) => { const el = document.getElementById(id); if (el) el.textContent = Number(value || 0).toLocaleString(); };
    setMetric('ops-pending-approval', alerts.pending_approval);
    setMetric('ops-awaiting-dispatch', alerts.awaiting_manual_dispatch);
    setMetric('ops-awaiting-report', alerts.awaiting_report);
    if (!tbody) return;
    tbody.innerHTML = events.length ? events.map(event => {
      const details = typeof event.details === 'string' ? JSON.parse(event.details || '{}') : (event.details || {});
      const reason = details.reason || details.externalReference || details.external_reference || '-';
      return `<tr><td>${new Date(event.created_at).toLocaleString()}</td><td>${escapeHtml(event.actor_email || 'System')}</td><td>${escapeHtml(event.action)}</td><td>${escapeHtml(`${event.entity_type}${event.entity_id ? ` #${event.entity_id}` : ''}`)}</td><td>${escapeHtml(reason)}</td></tr>`;
    }).join('') : '<tr><td colspan="5" style="text-align:center;padding:24px;">No audit events recorded yet.</td></tr>';
  } catch (err) {
    if (tbody) tbody.innerHTML = `<tr><td colspan="5" style="text-align:center;padding:24px;color:#dc2626;">${escapeHtml(err.message)}</td></tr>`;
  }
  loadRetentionSettings();
}

async function loadRetentionSettings() {
  if (!currentUser || currentUser.role !== 'admin') return;
  try {
    const list = await apiFetch('/audit/retention');
    if (!Array.isArray(list)) return;
    list.forEach(item => {
      if (item.setting_key === 'audit_logs') {
        const el = document.getElementById('retention-audit-logs');
        if (el) el.value = item.retention_days;
      } else if (item.setting_key === 'delivery_reports') {
        const el = document.getElementById('retention-delivery-reports');
        if (el) el.value = item.retention_days;
      } else if (item.setting_key === 'campaign_data') {
        const el = document.getElementById('retention-campaign-data');
        if (el) el.value = item.retention_days;
      }
    });
  } catch (_) {}
}

const btnSaveRetention = document.getElementById('btn-save-retention-settings');
if (btnSaveRetention) {
  btnSaveRetention.addEventListener('click', async () => {
    try {
      const auditDays = parseInt(document.getElementById('retention-audit-logs')?.value, 10);
      const reportDays = parseInt(document.getElementById('retention-delivery-reports')?.value, 10);
      const campDays = parseInt(document.getElementById('retention-campaign-data')?.value, 10);

      await Promise.all([
        apiFetch('/audit/retention/audit_logs', { method: 'PATCH', body: JSON.stringify({ retention_days: auditDays }) }),
        apiFetch('/audit/retention/delivery_reports', { method: 'PATCH', body: JSON.stringify({ retention_days: reportDays }) }),
        apiFetch('/audit/retention/campaign_data', { method: 'PATCH', body: JSON.stringify({ retention_days: campDays }) })
      ]);
      showToast('success', 'Retention Policies Saved', 'Data retention schedules updated successfully.');
    } catch (err) {
      showToast('error', 'Save Failed', err.message);
    }
  });
}

const btnPurgeRetention = document.getElementById('btn-purge-retention-now');
if (btnPurgeRetention) {
  btnPurgeRetention.addEventListener('click', async () => {
    if (!confirm('Run data retention purge now?\n\nThis will permanently delete audit logs, delivery reports, and completed/rejected campaigns older than your configured retention policy.')) {
      return;
    }
    try {
      const res = await apiFetch('/audit/retention/purge-now', { method: 'POST' });
      const p = res.purged || {};
      showToast('success', 'Purge Complete', `Cleaned: ${p.audit_logs || 0} audit events, ${p.delivery_reports || 0} reports, ${p.campaigns || 0} campaigns.`);
      loadOperationsAudit();
    } catch (err) {
      showToast('error', 'Purge Failed', err.message);
    }
  });
}

const btnRefreshAudit = document.getElementById('btn-refresh-audit');
if (btnRefreshAudit) btnRefreshAudit.addEventListener('click', loadOperationsAudit);

// ==========================================
// RESELLER NETWORK & WHITE-LABEL BRANDING
// ==========================================
function applyThemeAccent(hex) {
  if (!hex || !/^#[0-9A-Fa-f]{6}$/.test(hex)) return;
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  
  const hoverR = Math.max(0, Math.floor(r * 0.88));
  const hoverG = Math.max(0, Math.floor(g * 0.88));
  const hoverB = Math.max(0, Math.floor(b * 0.88));
  const activeR = Math.max(0, Math.floor(r * 0.76));
  const activeG = Math.max(0, Math.floor(g * 0.76));
  const activeB = Math.max(0, Math.floor(b * 0.76));
  
  const toHex = (n) => n.toString(16).padStart(2, '0');
  const hoverHex = `#${toHex(hoverR)}${toHex(hoverG)}${toHex(hoverB)}`;
  const activeHex = `#${toHex(activeR)}${toHex(activeG)}${toHex(activeB)}`;
  const lightRgba = `rgba(${r}, ${g}, ${b}, 0.08)`;
  const borderRgba = `rgba(${r}, ${g}, ${b}, 0.25)`;
  const glowRgba = `rgba(${r}, ${g}, ${b}, 0.22)`;

  const docEl = document.documentElement.style;
  docEl.setProperty('--primary', hex);
  docEl.setProperty('--brand-accent', hex);
  docEl.setProperty('--primary-hover', hoverHex);
  docEl.setProperty('--primary-active', activeHex);
  docEl.setProperty('--primary-light', lightRgba);
  docEl.setProperty('--primary-border', borderRgba);
  docEl.setProperty('--primary-glow', glowRgba);
}

function updatePageFavicon(faviconUrl) {
  let link = document.querySelector("link[rel~='icon']");
  if (!link) {
    link = document.createElement('link');
    link.rel = 'icon';
    document.head.appendChild(link);
  }
  if (faviconUrl) {
    const safe = sanitizeUrl(faviconUrl);
    if (safe !== '#') link.href = safe;
  }
}

function applyBrandProfile(profile) {
  if (!profile) return;
  window.activeBrandProfile = profile;

  // 1. Dynamic Theme Accent Engine (Updates CSS custom variables)
  applyThemeAccent(profile.accent_color || '#4f46e5');

  // 2. Browser Tab Title & Favicon
  const portalTitle = profile.portal_title || profile.brand_name || 'MessageSphere';
  document.title = `${portalTitle} | Enterprise Messaging Portal`;
  if (profile.favicon_url) {
    updatePageFavicon(profile.favicon_url);
  }

  // 3. Brand Text Elements
  document.querySelectorAll('.brand-title').forEach(el => { el.textContent = profile.brand_name || 'MessageSphere'; });
  const loginBrand = document.querySelector('#auth-screen .auth-brand span');
  if (loginBrand) loginBrand.textContent = profile.brand_name || 'MessageSphere';

  // 4. Logo Elements
  if (profile.logo_url) {
    const safeLogo = sanitizeUrl(profile.logo_url);
    if (safeLogo !== '#') {
      document.querySelectorAll('.brand-logo').forEach(img => {
        img.src = safeLogo;
        img.style.display = 'inline-block';
      });
      document.querySelectorAll('.brand-badge').forEach(badge => {
        badge.style.display = 'none';
      });
    }
  } else {
    document.querySelectorAll('.brand-logo').forEach(img => {
      img.style.display = 'none';
    });
    document.querySelectorAll('.brand-badge').forEach(badge => {
      badge.style.display = 'flex';
    });
  }

  // 5. White-label support footer links if defined
  if (profile.help_url) {
    document.querySelectorAll('.brand-help-link').forEach(a => { a.href = sanitizeUrl(profile.help_url); a.style.display = 'inline'; });
  }
  if (profile.terms_url) {
    document.querySelectorAll('.brand-terms-link').forEach(a => { a.href = sanitizeUrl(profile.terms_url); a.style.display = 'inline'; });
  }
  if (profile.privacy_url) {
    document.querySelectorAll('.brand-privacy-link').forEach(a => { a.href = sanitizeUrl(profile.privacy_url); a.style.display = 'inline'; });
  }
}

async function resolveHostBranding() {
  try {
    const urlParams = new URLSearchParams(window.location.search);
    const refCode = urlParams.get('ref') || urlParams.get('code') || urlParams.get('invite');
    const domainParam = urlParams.get('domain') || urlParams.get('host');
    let queryStr = '';
    if (refCode) queryStr = `?ref=${encodeURIComponent(refCode)}`;
    else if (domainParam) queryStr = `?domain=${encodeURIComponent(domainParam)}`;

    const res = await fetch(`/api/resellers/branding/resolve${queryStr}`);
    if (!res.ok) return;
    const data = await res.json();
    const refBanner = document.getElementById('auth-referral-banner');
    const accTypeGroup = document.getElementById('reg-account-type-group');

    if (data && data.custom_branding && data.branding) {
      applyBrandProfile(data.branding);
      if (data.branding.invite_code) {
        const inviteInput = document.getElementById('reg-invite-code');
        if (inviteInput && !inviteInput.value) inviteInput.value = data.branding.invite_code;
        const partnerNameEl = document.getElementById('auth-partner-name');
        if (refBanner && partnerNameEl) {
          partnerNameEl.textContent = data.branding.brand_name || 'Partner';
          refBanner.style.display = 'flex';
        }
        if (accTypeGroup) accTypeGroup.style.display = 'none';
        if (window.setRegAccountType) window.setRegAccountType('user');
      }
    } else {
      if (refBanner) refBanner.style.display = 'none';
      if (accTypeGroup) accTypeGroup.style.display = 'block';
    }
  } catch (_) {}
}

async function applyWhiteLabel() {
  const profile = await apiFetch('/resellers/me');
  applyBrandProfile(profile);
  return profile;
}

let resellersData = [];

async function loadResellerNetwork() {
  if (!currentUser || currentUser.role !== 'admin') return;
  const tbody = document.getElementById('reseller-network-tbody');
  try {
    resellersData = await apiFetch('/resellers');
    
    // Calculate and render top KPI metrics
    const totalPartners = resellersData.length;
    const totalClients = resellersData.reduce((sum, r) => sum + (Number(r.client_count) || 0), 0);
    const totalCampaigns = resellersData.reduce((sum, r) => sum + (Number(r.campaign_count) || 0), 0);
    const totalAudience = resellersData.reduce((sum, r) => sum + (Number(r.total_recipients) || 0), 0);
    const verifiedDomains = resellersData.filter(r => r.domain_status === 'Verified').length;
    const pendingDomains = resellersData.filter(r => r.domain_status === 'Pending verification').length;
    const totalDomainsWithHost = resellersData.filter(r => r.custom_domain).length;

    const elTotal = document.getElementById('reseller-stat-total');
    if (elTotal) elTotal.textContent = totalPartners.toLocaleString();

    const elClients = document.getElementById('reseller-stat-clients');
    if (elClients) elClients.textContent = totalClients.toLocaleString();

    const elCampaigns = document.getElementById('reseller-stat-campaigns');
    if (elCampaigns) elCampaigns.textContent = totalCampaigns.toLocaleString();

    const elAudience = document.getElementById('reseller-stat-audience');
    if (elAudience) elAudience.textContent = `${totalAudience.toLocaleString()} Recipients`;

    const elDomains = document.getElementById('reseller-stat-domains');
    if (elDomains) elDomains.textContent = `${verifiedDomains} / ${totalDomainsWithHost || totalPartners}`;

    const elDomainDesc = document.getElementById('reseller-stat-domain-desc');
    if (elDomainDesc) elDomainDesc.textContent = `${verifiedDomains} Verified · ${pendingDomains} Pending`;

    renderResellerNetworkTable();
  } catch (err) {
    if (tbody) tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;padding:24px;color:#dc2626;">${escapeHtml(err.message)}</td></tr>`;
  }
}

window.renderResellerNetworkTable = function() {
  const tbody = document.getElementById('reseller-network-tbody');
  if (!tbody) return;

  const searchInput = document.getElementById('reseller-search-input');
  const search = (searchInput ? searchInput.value : '').toLowerCase().trim();
  const domainFilter = document.getElementById('reseller-domain-filter') ? document.getElementById('reseller-domain-filter').value : 'all';
  const statusFilter = document.getElementById('reseller-status-filter') ? document.getElementById('reseller-status-filter').value : 'all';

  let filtered = (resellersData || []).filter(item => {
    if (search) {
      const matchText = [
        item.email, item.full_name, item.company_name, item.phone,
        item.brand_name, item.custom_domain, item.support_email
      ].filter(Boolean).join(' ').toLowerCase();
      if (!matchText.includes(search)) return false;
    }

    if (domainFilter !== 'all') {
      const dStatus = item.domain_status || 'Not configured';
      if (domainFilter === 'Verified' && dStatus !== 'Verified') return false;
      if (domainFilter === 'Pending verification' && dStatus !== 'Pending verification') return false;
      if (domainFilter === 'Not configured' && dStatus !== 'Not configured') return false;
    }

    if (statusFilter !== 'all') {
      if (statusFilter === 'active' && item.is_blocked) return false;
      if (statusFilter === 'blocked' && !item.is_blocked) return false;
    }

    return true;
  });

  const countShowing = document.getElementById('reseller-count-showing');
  if (countShowing) countShowing.textContent = filtered.length;

  if (!filtered.length) {
    tbody.innerHTML = `<tr>
      <td colspan="7" style="text-align:center;padding:36px;color:#64748b;">
        <i data-lucide="users" style="width:28px;height:28px;color:#94a3b8;margin-bottom:8px;"></i>
        <div>No reseller partners found matching current filters.</div>
      </td>
    </tr>`;
    if (window.lucide) setTimeout(() => lucide.createIcons(), 20);
    return;
  }

  tbody.innerHTML = filtered.map(item => {
    const initial = (item.full_name || item.brand_name || item.email || 'R').charAt(0).toUpperCase();
    const dStatus = item.domain_status || 'Not configured';
    let dBadgeClass = 'badge-submitted';
    let dBadgeBg = '#f1f5f9';
    let dBadgeColor = '#475569';
    if (dStatus === 'Verified') {
      dBadgeClass = 'badge-updated';
      dBadgeBg = '#ecfdf5';
      dBadgeColor = '#059669';
    } else if (dStatus === 'Pending verification') {
      dBadgeClass = 'badge-submitted';
      dBadgeBg = '#fffbeb';
      dBadgeColor = '#d97706';
    }

    const domCredits = Number(item.dom_credits || 0);
    const intlCredits = Number(item.intl_credits || 0);
    const clientCount = Number(item.client_count || 0);
    const campaignCount = Number(item.campaign_count || 0);
    const totalRecipients = Number(item.total_recipients || 0);

    return `
      <tr style="border-bottom:1px solid #f1f5f9;transition:background 0.15s;" onmouseover="this.style.background='#f8fafc'" onmouseout="this.style.background='transparent'">
        
        <!-- Partner / Reseller Profile -->
        <td style="padding:14px 16px;">
          <div style="display:flex;align-items:center;gap:12px;">
            <div style="width:38px;height:38px;border-radius:10px;background:#e0e7ff;color:#4338ca;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:0.95rem;flex-shrink:0;">
              ${escapeHtml(initial)}
            </div>
            <div>
              <div style="font-weight:700;color:#0f172a;font-size:0.9rem;display:flex;align-items:center;gap:6px;">
                ${escapeHtml(item.full_name || item.company_name || 'Reseller Partner')}
                ${item.company_name ? `<span style="font-size:0.7rem;font-weight:600;background:#f1f5f9;color:#475569;padding:1px 6px;border-radius:4px;">${escapeHtml(item.company_name)}</span>` : ''}
              </div>
              <div style="font-size:0.78rem;color:#475569;margin-top:2px;font-family:monospace;">
                ${escapeHtml(item.email)}
              </div>
              ${item.phone ? `<div style="font-size:0.73rem;color:#64748b;margin-top:1px;"><i data-lucide="phone" style="width:11px;height:11px;display:inline-block;vertical-align:-1px;"></i> ${escapeHtml(item.phone)}</div>` : ''}
            </div>
          </div>
        </td>

        <!-- Brand & Identity -->
        <td style="padding:14px 16px;">
          <div style="display:flex;align-items:center;gap:8px;">
            <div style="width:14px;height:14px;border-radius:50%;background:${escapeHtml(item.accent_color || '#4f46e5')};border:1px solid rgba(0,0,0,0.1);flex-shrink:0;" title="Theme Color: ${escapeHtml(item.accent_color || '#4f46e5')}"></div>
            <div>
              <div style="font-weight:700;color:#1e293b;font-size:0.85rem;">
                ${escapeHtml(item.brand_name || 'Not configured')}
              </div>
              <div style="font-size:0.72rem;color:#64748b;margin-top:1px;">
                ${item.support_email ? escapeHtml(item.support_email) : 'Default Support'}
              </div>
            </div>
          </div>
        </td>

        <!-- Credit Reserves -->
        <td style="padding:14px 16px;">
          <div>
            <div style="display:flex;align-items:center;gap:6px;">
              <span style="font-size:0.72rem;font-weight:700;color:#059669;background:#ecfdf5;padding:2px 6px;border-radius:4px;">
                DOM: ${domCredits.toLocaleString()}
              </span>
              <span style="font-size:0.72rem;font-weight:700;color:#0284c7;background:#f0f9ff;padding:2px 6px;border-radius:4px;">
                INTL: ${intlCredits.toLocaleString()}
              </span>
            </div>
            <button type="button" class="btn-action" data-action="open-allot-credits" data-user-id="${item.id}" data-email="${escapeHtml(item.email)}" style="margin-top:4px;background:#f8fafc;color:#475569;border:1px solid #cbd5e1;padding:2px 7px;border-radius:5px;font-size:0.7rem;display:inline-flex;align-items:center;gap:3px;font-weight:600;">
              <i data-lucide="plus" style="width:11px;height:11px;"></i> Allot Credits
            </button>
          </div>
        </td>

        <!-- Clients & Scale -->
        <td style="padding:14px 16px;">
          <div>
            <button type="button" class="btn-action" onclick="viewResellerClients(${item.id})" style="background:#eef2ff;color:#4f46e5;font-weight:700;border:1px solid #c7d2fe;padding:3px 9px;border-radius:6px;font-size:0.78rem;display:inline-flex;align-items:center;gap:5px;cursor:pointer;" title="Click to view and filter all clients of this reseller">
              <i data-lucide="users" style="width:13px;height:13px;"></i> ${clientCount.toLocaleString()} ${clientCount === 1 ? 'Client' : 'Clients'}
            </button>
            <div style="font-size:0.73rem;color:#64748b;margin-top:4px;">
              ${campaignCount.toLocaleString()} campaigns · ${totalRecipients.toLocaleString()} msgs
            </div>
          </div>
        </td>

        <!-- Custom Domain & DNS -->
        <td style="padding:14px 16px;">
          <div>
            <div style="font-size:0.83rem;font-weight:600;color:${item.custom_domain ? '#0f172a' : '#94a3b8'};">
              ${item.custom_domain ? `<a href="https://${escapeHtml(item.custom_domain)}" target="_blank" style="color:#2563eb;text-decoration:none;display:inline-flex;align-items:center;gap:4px;">${escapeHtml(item.custom_domain)} <i data-lucide="external-link" style="width:11px;height:11px;"></i></a>` : '—'}
            </div>
            <div style="margin-top:3px;">
              <span style="font-size:0.7rem;font-weight:700;padding:2px 8px;border-radius:10px;background:${dBadgeBg};color:${dBadgeColor};display:inline-block;">
                ${escapeHtml(dStatus)}
              </span>
            </div>
          </div>
        </td>

        <!-- Account Status -->
        <td style="padding:14px 16px;">
          <span class="status-badge ${item.is_blocked ? 'badge-failed' : 'badge-completed'}" style="font-size:0.74rem;">
            ${item.is_blocked ? 'Blocked' : 'Active'}
          </span>
        </td>

        <!-- Actions -->
        <td style="padding:14px 16px;text-align:right;">
          <div style="display:inline-flex;align-items:center;gap:6px;justify-content:flex-end;">
            
            <button type="button" class="btn-action btn-action-primary" onclick="openUser360Modal(${item.id}, event)" style="padding:5px 9px;font-size:0.76rem;display:inline-flex;align-items:center;gap:4px;font-weight:600;" title="View Reseller 360° Profile & Ledger">
              <i data-lucide="sparkles" style="width:13px;height:13px;"></i> 360°
            </button>

            <button type="button" class="btn-action btn-action-secondary" onclick="openAdminResellerBrandModal(${item.id})" style="padding:5px 9px;font-size:0.76rem;display:inline-flex;align-items:center;gap:4px;" title="Manage Brand Identity & DNS Domain">
              <i data-lucide="globe" style="width:13px;height:13px;"></i> Brand / DNS
            </button>

            <button type="button" class="btn-action btn-action-secondary" onclick="viewResellerClients(${item.id})" style="padding:5px 9px;font-size:0.76rem;display:inline-flex;align-items:center;gap:4px;" title="Filter & View All Sub-Clients">
              <i data-lucide="users" style="width:13px;height:13px;"></i> Clients
            </button>

          </div>
        </td>

      </tr>
    `;
  }).join('');

  if (window.lucide) setTimeout(() => lucide.createIcons(), 30);
};

window.resetResellerFilters = function() {
  const searchInput = document.getElementById('reseller-search-input');
  if (searchInput) searchInput.value = '';
  const domainFilter = document.getElementById('reseller-domain-filter');
  if (domainFilter) domainFilter.value = 'all';
  const statusFilter = document.getElementById('reseller-status-filter');
  if (statusFilter) statusFilter.value = 'all';
  renderResellerNetworkTable();
};

window.viewResellerClients = function(resellerId) {
  switchView('view-users');
  setTimeout(() => {
    const select = document.getElementById('user-reseller-filter');
    if (select) {
      select.value = `reseller_${resellerId}`;
      renderUsersTable();
    }
  }, 100);
};

function updateAdminLogoPreview(url) {
  const previewImg = document.getElementById('admin-reseller-logo-preview-img');
  const placeholder = document.getElementById('admin-reseller-logo-preview-placeholder');
  const btnRemove = document.getElementById('btn-admin-remove-logo');
  const safe = sanitizeUrl(url);
  if (url && safe !== '#') {
    if (previewImg) {
      previewImg.src = safe;
      previewImg.style.display = 'block';
    }
    if (placeholder) placeholder.style.display = 'none';
    if (btnRemove) btnRemove.style.display = 'inline-flex';
  } else {
    if (previewImg) {
      previewImg.src = '';
      previewImg.style.display = 'none';
    }
    if (placeholder) placeholder.style.display = 'block';
    if (btnRemove) btnRemove.style.display = 'none';
  }
}

function updateAdminFaviconPreview(url) {
  const previewImg = document.getElementById('admin-reseller-favicon-preview-img');
  const placeholder = document.getElementById('admin-reseller-favicon-preview-placeholder');
  const btnRemove = document.getElementById('btn-admin-remove-favicon');
  const safe = sanitizeUrl(url);
  if (url && safe !== '#') {
    if (previewImg) {
      previewImg.src = safe;
      previewImg.style.display = 'block';
    }
    if (placeholder) placeholder.style.display = 'none';
    if (btnRemove) btnRemove.style.display = 'inline-flex';
  } else {
    if (previewImg) {
      previewImg.src = '';
      previewImg.style.display = 'none';
    }
    if (placeholder) placeholder.style.display = 'block';
    if (btnRemove) btnRemove.style.display = 'none';
  }
}

function updateBrandLogoPreview(url) {
  const previewImg = document.getElementById('brand-logo-preview-img');
  const placeholder = document.getElementById('brand-logo-preview-placeholder');
  const btnRemove = document.getElementById('btn-remove-brand-logo');
  const safe = sanitizeUrl(url);
  if (url && safe !== '#') {
    if (previewImg) {
      previewImg.src = safe;
      previewImg.style.display = 'block';
    }
    if (placeholder) placeholder.style.display = 'none';
    if (btnRemove) btnRemove.style.display = 'inline-flex';
  } else {
    if (previewImg) {
      previewImg.src = '';
      previewImg.style.display = 'none';
    }
    if (placeholder) placeholder.style.display = 'block';
    if (btnRemove) btnRemove.style.display = 'none';
  }
  updateBrandLivePreview();
}

function updateBrandFaviconPreview(url) {
  const previewImg = document.getElementById('brand-favicon-preview-img');
  const placeholder = document.getElementById('brand-favicon-preview-placeholder');
  const btnRemove = document.getElementById('btn-remove-brand-favicon');
  const safe = sanitizeUrl(url);
  if (url && safe !== '#') {
    if (previewImg) {
      previewImg.src = safe;
      previewImg.style.display = 'block';
    }
    if (placeholder) placeholder.style.display = 'none';
    if (btnRemove) btnRemove.style.display = 'inline-flex';
  } else {
    if (previewImg) {
      previewImg.src = '';
      previewImg.style.display = 'none';
    }
    if (placeholder) placeholder.style.display = 'block';
    if (btnRemove) btnRemove.style.display = 'none';
  }
  updateBrandLivePreview();
}

function updateBrandLivePreview() {
  const brandName = document.getElementById('brand-name')?.value?.trim() || 'Partner Portal';
  const portalTitle = document.getElementById('brand-portal-title')?.value?.trim() || brandName;
  const accentColor = document.getElementById('brand-accent')?.value?.trim() || '#4f46e5';
  const logoUrl = document.getElementById('brand-logo-url')?.value?.trim() || '';
  const faviconUrl = document.getElementById('brand-favicon-url')?.value?.trim() || '';
  const customDomain = document.getElementById('brand-custom-domain')?.value?.trim() || 'portal.yourbrand.com';
  const supportEmail = document.getElementById('brand-support-email')?.value?.trim() || 'support@yourbrand.com';
  const supportPhone = document.getElementById('brand-support-phone')?.value?.trim() || '+91 9876543210';
  const supportWhatsapp = document.getElementById('brand-support-whatsapp')?.value?.trim() || '+91 9876543210';
  const legalName = document.getElementById('brand-legal-name')?.value?.trim() || brandName;

  // Browser Mockup
  const tabFavicon = document.getElementById('preview-tab-favicon');
  const tabFaviconPlaceholder = document.getElementById('preview-tab-favicon-placeholder');
  const safeFav = sanitizeUrl(faviconUrl);
  if (faviconUrl && safeFav !== '#') {
    if (tabFavicon) { tabFavicon.src = safeFav; tabFavicon.style.display = 'block'; }
    if (tabFaviconPlaceholder) tabFaviconPlaceholder.style.display = 'none';
  } else {
    if (tabFavicon) tabFavicon.style.display = 'none';
    if (tabFaviconPlaceholder) tabFaviconPlaceholder.style.display = 'block';
  }

  const tabTitle = document.getElementById('preview-tab-title');
  if (tabTitle) tabTitle.textContent = portalTitle;

  const tabDomain = document.getElementById('preview-tab-domain');
  if (tabDomain) tabDomain.textContent = customDomain.replace(/^https?:\/\//i, '');

  // Navbar Brand
  const previewBrand = document.getElementById('preview-brand-name');
  if (previewBrand) previewBrand.textContent = brandName;

  const logoImg = document.getElementById('preview-brand-logo-img');
  const logoInitial = document.getElementById('preview-brand-logo-initial');
  const safeLogo = sanitizeUrl(logoUrl);
  if (logoUrl && safeLogo !== '#') {
    if (logoImg) { logoImg.src = safeLogo; logoImg.style.display = 'block'; }
    if (logoInitial) logoInitial.style.display = 'none';
  } else {
    if (logoImg) logoImg.style.display = 'none';
    if (logoInitial) {
      logoInitial.style.display = 'block';
      logoInitial.textContent = brandName.charAt(0).toUpperCase();
    }
  }

  // Hero Card Accent
  const heroBox = document.getElementById('preview-hero-box');
  if (heroBox && /^#[0-9A-Fa-f]{6}$/.test(accentColor)) {
    heroBox.style.background = `linear-gradient(135deg, ${accentColor} 0%, #0f172a 100%)`;
  }
  const heroTitle = document.getElementById('preview-hero-title');
  if (heroTitle) heroTitle.textContent = `${brandName} Hub`;

  const pillBalance = document.getElementById('preview-pill-balance');
  if (pillBalance) {
    pillBalance.style.color = accentColor;
  }

  // Support Contacts
  const prevEmail = document.getElementById('preview-support-email');
  if (prevEmail) prevEmail.textContent = supportEmail;

  const prevPhone = document.getElementById('preview-support-phone');
  if (prevPhone) prevPhone.textContent = supportPhone;

  const prevWa = document.getElementById('preview-support-whatsapp');
  if (prevWa) prevWa.textContent = `WhatsApp: ${supportWhatsapp}`;

  // Legal Footer
  const prevLegal = document.getElementById('preview-legal-entity');
  if (prevLegal) prevLegal.textContent = legalName;

  if (window.lucide) setTimeout(() => lucide.createIcons(), 30);
}

window.openAdminResellerBrandModal = function(resellerId) {
  const item = (resellersData || []).find(r => Number(r.id) === Number(resellerId));
  if (!item) return;

  const modal = document.getElementById('modal-admin-reseller-brand');
  const idInput = document.getElementById('admin-reseller-brand-id');
  const emailEl = document.getElementById('admin-reseller-brand-email');
  const nameInput = document.getElementById('admin-reseller-brand-name');
  const portalTitleInput = document.getElementById('admin-reseller-brand-portal-title');
  const accentInput = document.getElementById('admin-reseller-brand-accent');
  const colorPicker = document.getElementById('admin-reseller-brand-color-picker');
  const logoInput = document.getElementById('admin-reseller-brand-logo');
  const faviconInput = document.getElementById('admin-reseller-brand-favicon');
  const domainInput = document.getElementById('admin-reseller-brand-domain');
  const statusSelect = document.getElementById('admin-reseller-brand-status');
  const emailInput = document.getElementById('admin-reseller-brand-support-email');
  const phoneInput = document.getElementById('admin-reseller-brand-support-phone');
  const waInput = document.getElementById('admin-reseller-brand-support-whatsapp');
  const legalNameInput = document.getElementById('admin-reseller-brand-legal-name');
  const gstinInput = document.getElementById('admin-reseller-brand-gstin');
  const statusPill = document.getElementById('admin-reseller-brand-status-pill');
  const btnVerify = document.getElementById('btn-admin-verify-domain');

  if (idInput) idInput.value = item.id;
  if (emailEl) emailEl.textContent = `${item.full_name || 'Partner'} (${item.email})`;
  if (nameInput) nameInput.value = item.brand_name || item.company_name || '';
  if (portalTitleInput) portalTitleInput.value = item.portal_title || '';
  if (accentInput) accentInput.value = item.accent_color || '#4f46e5';
  if (colorPicker) colorPicker.value = item.accent_color || '#4f46e5';
  if (logoInput) logoInput.value = item.logo_url || '';
  if (faviconInput) faviconInput.value = item.favicon_url || '';
  if (domainInput) domainInput.value = item.custom_domain || '';
  if (statusSelect) statusSelect.value = item.domain_status || 'Not configured';
  if (emailInput) emailInput.value = item.support_email || item.email || '';
  if (phoneInput) phoneInput.value = item.support_phone || item.phone || '';
  if (waInput) waInput.value = item.support_whatsapp || '';
  if (legalNameInput) legalNameInput.value = item.company_legal_name || '';
  if (gstinInput) gstinInput.value = item.company_gstin || '';

  updateAdminLogoPreview(item.logo_url);
  updateAdminFaviconPreview(item.favicon_url);

  if (statusPill) {
    const dStatus = item.domain_status || 'Not configured';
    statusPill.innerHTML = `<span class="status-badge ${dStatus === 'Verified' ? 'badge-updated' : 'badge-submitted'}">${escapeHtml(dStatus)}</span>`;
  }

  if (btnVerify) {
    btnVerify.style.display = (item.custom_domain && item.domain_status !== 'Verified') ? 'inline-flex' : 'none';
  }

  const btnForceVerify = document.getElementById('btn-admin-force-verify-domain');
  if (btnForceVerify) {
    btnForceVerify.style.display = (item.custom_domain && item.domain_status !== 'Verified') ? 'inline-flex' : 'none';
  }

  if (modal) modal.style.display = 'flex';
  if (window.lucide) setTimeout(() => lucide.createIcons(), 50);
};

// Admin logo file upload handlers
const btnAdminChooseLogo = document.getElementById('btn-admin-choose-logo');
const adminLogoFileInput = document.getElementById('admin-reseller-brand-logo-file');
const adminLogoInput = document.getElementById('admin-reseller-brand-logo');
const btnAdminRemoveLogo = document.getElementById('btn-admin-remove-logo');
const adminLogoStatus = document.getElementById('admin-reseller-logo-upload-status');

if (btnAdminChooseLogo && adminLogoFileInput) {
  btnAdminChooseLogo.addEventListener('click', () => adminLogoFileInput.click());
  adminLogoFileInput.addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    const resellerId = document.getElementById('admin-reseller-brand-id')?.value;
    if (!file || !resellerId) return;

    if (!file.type.startsWith('image/')) {
      showToast('error', 'Invalid File', 'Please select an image file (PNG, JPG, WebP, SVG).');
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      showToast('error', 'File Too Large', 'Maximum logo file size is 5 MB.');
      return;
    }

    const formData = new FormData();
    formData.append('logo', file);

    try {
      if (adminLogoStatus) adminLogoStatus.textContent = 'Uploading...';
      const res = await apiFetch(`/resellers/${resellerId}/logo`, {
        method: 'POST',
        body: formData
      });

      if (adminLogoInput) adminLogoInput.value = res.logo_url;
      updateAdminLogoPreview(res.logo_url);
      showToast('success', 'Logo Uploaded', 'Reseller brand logo updated successfully!');
      if (adminLogoStatus) adminLogoStatus.textContent = '';
      loadResellerNetwork();
    } catch (err) {
      if (adminLogoStatus) adminLogoStatus.textContent = '';
      showToast('error', 'Upload Failed', err.message);
    } finally {
      adminLogoFileInput.value = '';
    }
  });
}

if (btnAdminRemoveLogo) {
  btnAdminRemoveLogo.addEventListener('click', async () => {
    const resellerId = document.getElementById('admin-reseller-brand-id')?.value;
    if (!resellerId) return;
    try {
      await apiFetch(`/resellers/${resellerId}/logo`, { method: 'DELETE' });
      if (adminLogoInput) adminLogoInput.value = '';
      updateAdminLogoPreview('');
      showToast('success', 'Logo Removed', 'Reseller brand logo removed.');
      loadResellerNetwork();
    } catch (err) {
      showToast('error', 'Failed', err.message);
    }
  });
}

if (adminLogoInput) {
  adminLogoInput.addEventListener('input', () => {
    updateAdminLogoPreview(adminLogoInput.value.trim());
  });
}

// Admin favicon file upload handlers
const btnAdminChooseFavicon = document.getElementById('btn-admin-choose-favicon');
const adminFaviconFileInput = document.getElementById('admin-reseller-brand-favicon-file');
const adminFaviconInput = document.getElementById('admin-reseller-brand-favicon');
const btnAdminRemoveFavicon = document.getElementById('btn-admin-remove-favicon');

if (btnAdminChooseFavicon && adminFaviconFileInput) {
  btnAdminChooseFavicon.addEventListener('click', () => adminFaviconFileInput.click());
  adminFaviconFileInput.addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    const resellerId = document.getElementById('admin-reseller-brand-id')?.value;
    if (!file || !resellerId) return;

    const formData = new FormData();
    formData.append('favicon', file);

    try {
      const res = await apiFetch(`/resellers/${resellerId}/favicon`, {
        method: 'POST',
        body: formData
      });

      if (adminFaviconInput) adminFaviconInput.value = res.favicon_url;
      updateAdminFaviconPreview(res.favicon_url);
      showToast('success', 'Favicon Uploaded', 'Reseller favicon updated successfully!');
      loadResellerNetwork();
    } catch (err) {
      showToast('error', 'Favicon Failed', err.message);
    } finally {
      adminFaviconFileInput.value = '';
    }
  });
}

if (btnAdminRemoveFavicon) {
  btnAdminRemoveFavicon.addEventListener('click', async () => {
    const resellerId = document.getElementById('admin-reseller-brand-id')?.value;
    if (!resellerId) return;
    try {
      await apiFetch(`/resellers/${resellerId}/favicon`, { method: 'DELETE' });
      if (adminFaviconInput) adminFaviconInput.value = '';
      updateAdminFaviconPreview('');
      showToast('success', 'Favicon Removed', 'Reseller favicon removed.');
      loadResellerNetwork();
    } catch (err) {
      showToast('error', 'Failed', err.message);
    }
  });
}

if (adminFaviconInput) {
  adminFaviconInput.addEventListener('input', () => {
    updateAdminFaviconPreview(adminFaviconInput.value.trim());
  });
}

window.saveAdminResellerBrand = async function() {
  const resellerId = document.getElementById('admin-reseller-brand-id')?.value;
  if (!resellerId) return;

  const brandName = document.getElementById('admin-reseller-brand-name')?.value?.trim();
  const portalTitle = document.getElementById('admin-reseller-brand-portal-title')?.value?.trim() || '';
  const accentColor = document.getElementById('admin-reseller-brand-accent')?.value?.trim() || '#4f46e5';
  const logoUrl = document.getElementById('admin-reseller-brand-logo')?.value?.trim() || '';
  const faviconUrl = document.getElementById('admin-reseller-brand-favicon')?.value?.trim() || '';
  const customDomain = document.getElementById('admin-reseller-brand-domain')?.value?.trim() || '';
  const domainStatus = document.getElementById('admin-reseller-brand-status')?.value;
  const supportEmail = document.getElementById('admin-reseller-brand-support-email')?.value?.trim() || '';
  const supportPhone = document.getElementById('admin-reseller-brand-support-phone')?.value?.trim() || '';
  const supportWhatsapp = document.getElementById('admin-reseller-brand-support-whatsapp')?.value?.trim() || '';
  const companyLegalName = document.getElementById('admin-reseller-brand-legal-name')?.value?.trim() || '';
  const companyGstin = document.getElementById('admin-reseller-brand-gstin')?.value?.trim() || '';

  if (!brandName) {
    showToast('error', 'Brand Name Required', 'Please enter a brand name for this white-label partner.');
    return;
  }

  try {
    const btnSave = document.getElementById('btn-admin-save-reseller-brand');
    if (btnSave) {
      btnSave.disabled = true;
      btnSave.textContent = 'Saving...';
    }

    await apiFetch(`/resellers/${resellerId}`, {
      method: 'PUT',
      body: JSON.stringify({
        brand_name: brandName,
        portal_title: portalTitle,
        accent_color: accentColor,
        logo_url: logoUrl,
        favicon_url: faviconUrl,
        custom_domain: customDomain,
        domain_status: domainStatus,
        support_email: supportEmail,
        support_phone: supportPhone,
        support_whatsapp: supportWhatsapp,
        company_legal_name: companyLegalName,
        company_gstin: companyGstin
      })
    });

    showToast('success', 'White-Label Configured', 'Partner white-label branding & DNS settings saved successfully.');
    const modal = document.getElementById('modal-admin-reseller-brand');
    if (modal) modal.style.display = 'none';
    loadResellerNetwork();
  } catch (err) {
    showToast('error', 'Update Failed', err.message);
  } finally {
    const btnSave = document.getElementById('btn-admin-save-reseller-brand');
    if (btnSave) {
      btnSave.disabled = false;
      btnSave.textContent = 'Save White-Label Brand';
    }
  }
};

window.verifyCurrentResellerDomain = function() {
  const resellerId = document.getElementById('admin-reseller-brand-id')?.value;
  if (!resellerId) return;
  verifyResellerDomain(resellerId);
};

window.forceVerifyCurrentResellerDomain = async function() {
  const resellerId = document.getElementById('admin-reseller-brand-id')?.value;
  if (!resellerId) return;
  try {
    showToast('info', 'Activating...', 'Bypassing DNS check and activating domain...');
    const res = await apiFetch(`/resellers/${resellerId}/verify-dns`, {
      method: 'POST',
      body: JSON.stringify({ force: true })
    });
    if (res.verified) {
      showToast('success', 'Domain Force Activated!', 'Domain is now active and verified in database.');
      const modal = document.getElementById('modal-admin-reseller-brand');
      if (modal) modal.style.display = 'none';
      loadResellerNetwork();
    }
  } catch (err) {
    showToast('error', 'Force Activation Failed', err.message);
  }
};

async function openRenderCloudConfigModal() {
  const modal = document.getElementById('modal-render-cloud-config');
  if (!modal) return;

  const statusBadge = document.getElementById('render-config-status-badge');
  const statusDesc = document.getElementById('render-config-status-desc');
  const apiKeyInput = document.getElementById('render-api-key-input');
  const serviceIdInput = document.getElementById('render-service-id-input');

  if (statusBadge) {
    statusBadge.textContent = 'Checking...';
    statusBadge.className = 'status-badge badge-submitted';
  }
  if (statusDesc) statusDesc.textContent = 'Contacting api.render.com...';
  modal.style.display = 'flex';
  if (window.lucide) setTimeout(() => lucide.createIcons(), 30);

  try {
    const data = await apiFetch('/resellers/render/config');
    if (apiKeyInput && data.api_key_masked) apiKeyInput.placeholder = data.api_key_masked;
    if (serviceIdInput && data.service_id_raw) serviceIdInput.value = data.service_id_raw;

    if (data.configured && data.connection?.connected) {
      if (statusBadge) {
        statusBadge.textContent = 'Active & Connected ✓';
        statusBadge.className = 'status-badge badge-completed';
      }
      if (statusDesc) {
        statusDesc.innerHTML = `<span style="color:#059669;font-weight:700;">Connected to Web Service: "${escapeHtml(data.connection.serviceName)}"</span>. Automated domain registration and SSL certificates are active for all resellers.`;
      }
    } else if (data.configured) {
      if (statusBadge) {
        statusBadge.textContent = 'Authentication Error ⚠';
        statusBadge.className = 'status-badge badge-failed';
      }
      if (statusDesc) {
        statusDesc.textContent = `Saved credentials could not connect: ${data.connection?.error || 'Check API key permissions.'}`;
      }
    } else {
      if (statusBadge) {
        statusBadge.textContent = 'Not Configured';
        statusBadge.className = 'status-badge badge-submitted';
      }
      if (statusDesc) {
        statusDesc.textContent = 'Enter your Render API Key and Service ID below to enable 100% automated domain and SSL registration.';
      }
    }
  } catch (err) {
    if (statusBadge) {
      statusBadge.textContent = 'Error';
      statusBadge.className = 'status-badge badge-failed';
    }
    if (statusDesc) statusDesc.textContent = err.message;
  }
}
window.openRenderCloudConfigModal = openRenderCloudConfigModal;

const btnOpenRenderSslModal = document.getElementById('btn-open-render-ssl-modal');
if (btnOpenRenderSslModal) {
  btnOpenRenderSslModal.addEventListener('click', (e) => {
    e.preventDefault();
    openRenderCloudConfigModal();
  });
}

window.saveRenderCloudConfig = async function() {
  const apiKeyInput = document.getElementById('render-api-key-input');
  const serviceIdInput = document.getElementById('render-service-id-input');
  const btnSave = document.getElementById('btn-save-render-config');

  const apiKey = apiKeyInput?.value?.trim();
  const serviceId = serviceIdInput?.value?.trim();

  if (!apiKey || !serviceId) {
    showToast('error', 'Missing Information', 'Please enter both your Render Personal API Key and Service ID.');
    return;
  }

  try {
    if (btnSave) {
      btnSave.disabled = true;
      btnSave.innerHTML = '<i data-lucide="loader" class="spin" style="width:14px;height:14px;"></i> Verifying with Render...';
    }

    const res = await apiFetch('/resellers/render/config', {
      method: 'PUT',
      body: JSON.stringify({ api_key: apiKey, service_id: serviceId })
    });

    showToast('success', 'Render Connected!', res.message || 'Render automated SSL engine active.');
    const modal = document.getElementById('modal-render-cloud-config');
    if (modal) modal.style.display = 'none';
  } catch (err) {
    showToast('error', 'Connection Failed', err.message);
  } finally {
    if (btnSave) {
      btnSave.disabled = false;
      btnSave.innerHTML = '<i data-lucide="save" style="width:14px;height:14px;"></i> Connect &amp; Save';
      if (window.lucide) lucide.createIcons();
    }
  }
};

window.verifyResellerDomain = async function(resellerId) {
  try {
    showToast('info', 'Verifying DNS...', 'Running automated DNS resolution test...');
    const res = await apiFetch(`/resellers/${resellerId}/verify-dns`, { method: 'POST' });
    if (res.verified) {
      showToast('success', 'DNS Verified & Active!', res.message || 'Custom domain is mapped and verified.');
      const modal = document.getElementById('modal-admin-reseller-brand');
      if (modal) modal.style.display = 'none';
      loadResellerNetwork();
    } else {
      showToast('error', 'DNS Verification Failed', res.error || 'Domain could not be resolved.');
    }
  } catch (err) {
    showToast('error', 'DNS Check Error', err.message);
  }
};

// ==========================================
// RESELLER WHITE-LABEL STUDIO CONTROLS
// ==========================================
const brandForm = document.getElementById('reseller-brand-form');
const brandFields = {
  brand_name: document.getElementById('brand-name'),
  portal_title: document.getElementById('brand-portal-title'),
  accent_color: document.getElementById('brand-accent'),
  logo_url: document.getElementById('brand-logo-url'),
  favicon_url: document.getElementById('brand-favicon-url'),
  support_email: document.getElementById('brand-support-email'),
  support_phone: document.getElementById('brand-support-phone'),
  support_whatsapp: document.getElementById('brand-support-whatsapp'),
  help_url: document.getElementById('brand-help-url'),
  terms_url: document.getElementById('brand-terms-url'),
  privacy_url: document.getElementById('brand-privacy-url'),
  company_legal_name: document.getElementById('brand-legal-name'),
  company_gstin: document.getElementById('brand-gstin'),
  company_address: document.getElementById('brand-address'),
  custom_domain: document.getElementById('brand-custom-domain')
};

// Reseller logo file upload handlers
const btnChooseBrandLogo = document.getElementById('btn-choose-brand-logo');
const brandLogoFileInput = document.getElementById('brand-logo-file');
const brandLogoStatus = document.getElementById('brand-logo-upload-status');
const btnRemoveBrandLogo = document.getElementById('btn-remove-brand-logo');

if (btnChooseBrandLogo && brandLogoFileInput) {
  btnChooseBrandLogo.addEventListener('click', () => brandLogoFileInput.click());
  brandLogoFileInput.addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      showToast('error', 'Invalid File', 'Please select an image file (PNG, JPG, WebP, SVG).');
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      showToast('error', 'File Too Large', 'Maximum logo file size is 5 MB.');
      return;
    }

    const formData = new FormData();
    formData.append('logo', file);

    try {
      if (brandLogoStatus) brandLogoStatus.textContent = 'Uploading logo...';
      const res = await apiFetch('/resellers/logo', {
        method: 'POST',
        body: formData
      });

      if (brandFields.logo_url) brandFields.logo_url.value = res.logo_url;
      updateBrandLogoPreview(res.logo_url);
      applyBrandProfile(res.profile || { ...res, logo_url: res.logo_url });
      showToast('success', 'Logo Uploaded', 'Brand logo has been uploaded and applied successfully!');
      if (brandLogoStatus) brandLogoStatus.textContent = '';
    } catch (err) {
      if (brandLogoStatus) brandLogoStatus.textContent = '';
      showToast('error', 'Upload Failed', err.message);
    } finally {
      brandLogoFileInput.value = '';
    }
  });
}

if (btnRemoveBrandLogo) {
  btnRemoveBrandLogo.addEventListener('click', async () => {
    try {
      await apiFetch('/resellers/logo', { method: 'DELETE' });
      if (brandFields.logo_url) brandFields.logo_url.value = '';
      updateBrandLogoPreview('');
      showToast('success', 'Logo Removed', 'Brand logo reset to default.');
      applyBrandProfile({ brand_name: brandFields.brand_name?.value || 'MessageSphere', accent_color: brandFields.accent_color?.value || '#4f46e5', logo_url: null });
    } catch (err) {
      showToast('error', 'Failed', err.message);
    }
  });
}

if (brandFields.logo_url) {
  brandFields.logo_url.addEventListener('input', () => {
    updateBrandLogoPreview(brandFields.logo_url.value.trim());
  });
}

// Reseller favicon file upload handlers
const btnChooseBrandFavicon = document.getElementById('btn-choose-brand-favicon');
const brandFaviconFileInput = document.getElementById('brand-favicon-file');
const brandFaviconStatus = document.getElementById('brand-favicon-upload-status');
const btnRemoveBrandFavicon = document.getElementById('btn-remove-brand-favicon');

if (btnChooseBrandFavicon && brandFaviconFileInput) {
  btnChooseBrandFavicon.addEventListener('click', () => brandFaviconFileInput.click());
  brandFaviconFileInput.addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const formData = new FormData();
    formData.append('favicon', file);

    try {
      if (brandFaviconStatus) brandFaviconStatus.textContent = 'Uploading...';
      const res = await apiFetch('/resellers/favicon', {
        method: 'POST',
        body: formData
      });

      if (brandFields.favicon_url) brandFields.favicon_url.value = res.favicon_url;
      updateBrandFaviconPreview(res.favicon_url);
      applyBrandProfile(res.profile || { ...res, favicon_url: res.favicon_url });
      showToast('success', 'Favicon Uploaded', 'Browser favicon updated successfully!');
      if (brandFaviconStatus) brandFaviconStatus.textContent = '';
    } catch (err) {
      if (brandFaviconStatus) brandFaviconStatus.textContent = '';
      showToast('error', 'Upload Failed', err.message);
    } finally {
      brandFaviconFileInput.value = '';
    }
  });
}

if (btnRemoveBrandFavicon) {
  btnRemoveBrandFavicon.addEventListener('click', async () => {
    try {
      await apiFetch('/resellers/favicon', { method: 'DELETE' });
      if (brandFields.favicon_url) brandFields.favicon_url.value = '';
      updateBrandFaviconPreview('');
      showToast('success', 'Favicon Removed', 'Browser favicon reset to default.');
    } catch (err) {
      showToast('error', 'Failed', err.message);
    }
  });
}

if (brandFields.favicon_url) {
  brandFields.favicon_url.addEventListener('input', () => {
    updateBrandFaviconPreview(brandFields.favicon_url.value.trim());
  });
}

// Color picker & Palette Swatch bindings
const brandAccentInput = document.getElementById('brand-accent');
const brandColorPicker = document.getElementById('brand-accent-color-picker');

if (brandColorPicker && brandAccentInput) {
  brandColorPicker.addEventListener('input', () => {
    brandAccentInput.value = brandColorPicker.value;
    applyThemeAccent(brandColorPicker.value);
    updateBrandLivePreview();
  });
  brandAccentInput.addEventListener('input', () => {
    if (/^#[0-9A-Fa-f]{6}$/.test(brandAccentInput.value)) {
      brandColorPicker.value = brandAccentInput.value;
      applyThemeAccent(brandAccentInput.value);
      updateBrandLivePreview();
    }
  });
}

document.querySelectorAll('.brand-palette-chip').forEach(btn => {
  btn.addEventListener('click', () => {
    const col = btn.getAttribute('data-color');
    if (col) {
      if (brandAccentInput) brandAccentInput.value = col;
      if (brandColorPicker) brandColorPicker.value = col;
      applyThemeAccent(col);
      updateBrandLivePreview();
    }
  });
});

// Live preview binding on all form inputs
Object.values(brandFields).forEach(field => {
  if (field) {
    field.addEventListener('input', updateBrandLivePreview);
  }
});

// Self DNS Verification Button
const btnVerifyMyDomain = document.getElementById('btn-verify-my-domain');
const btnVerifyTxt = document.getElementById('btn-verify-my-domain-txt');
if (btnVerifyMyDomain) {
  btnVerifyMyDomain.addEventListener('click', async () => {
    const customDomain = document.getElementById('brand-custom-domain')?.value?.trim();
    if (!customDomain) {
      showToast('error', 'Domain Missing', 'Please enter a custom domain first before running DNS verification.');
      return;
    }
    try {
      btnVerifyMyDomain.disabled = true;
      if (btnVerifyTxt) btnVerifyTxt.textContent = 'Checking DNS...';
      const res = await apiFetch('/resellers/my-domain/verify', { method: 'POST' });
      if (res.verified) {
        showToast('success', 'Domain Verified!', res.message || 'Custom white-label domain is active!');
        const badge = document.getElementById('brand-domain-status-badge');
        if (badge) {
          badge.className = 'status-badge badge-updated';
          badge.textContent = 'Verified ✓';
        }
        const statusEl = document.getElementById('brand-domain-status');
        if (statusEl) {
          statusEl.innerHTML = `<span style="color:#059669;font-weight:700;"><i data-lucide="check-circle" style="width:14px;height:14px;display:inline-block;vertical-align:-2px;"></i> Active &amp; Verified:</span> Custom domain is live and serving your white-label portal.`;
        }
      } else {
        showToast('error', 'DNS Check Failed', res.error || 'DNS records did not resolve.');
      }
    } catch (err) {
      showToast('error', 'Verification Failed', err.message);
    } finally {
      btnVerifyMyDomain.disabled = false;
      if (btnVerifyTxt) btnVerifyTxt.textContent = 'Verify DNS Resolution Now';
      if (window.lucide) setTimeout(() => lucide.createIcons(), 30);
    }
  });
}

// 1-Click Copy CNAME Target
const btnCopyCname = document.getElementById('btn-copy-cname-target');
if (btnCopyCname) {
  btnCopyCname.addEventListener('click', async () => {
    const targetCode = document.getElementById('brand-cname-target-code')?.textContent || 'messagesphere.onrender.com';
    try {
      await navigator.clipboard.writeText(targetCode.trim());
      btnCopyCname.innerHTML = '<i data-lucide="check" style="width:12px;height:12px;"></i> Copied! ✓';
      if (window.lucide) lucide.createIcons();
      showToast('success', 'Target Copied', 'CNAME target copied to clipboard.');
      setTimeout(() => {
        btnCopyCname.innerHTML = '<i data-lucide="copy" style="width:12px;height:12px;"></i> Copy CNAME Target';
        if (window.lucide) lucide.createIcons();
      }, 2500);
    } catch (_) {
      showToast('info', 'CNAME Target', targetCode.trim());
    }
  });
}

async function loadMyBrandProfile() {
  if (!currentUser || currentUser.role !== 'reseller') return;
  const profile = await apiFetch('/resellers/me');
  Object.entries(brandFields).forEach(([key, field]) => { if (field) field.value = profile?.[key] || ''; });
  
  if (brandColorPicker && profile?.accent_color) {
    brandColorPicker.value = profile.accent_color;
  }
  
  updateBrandLogoPreview(profile?.logo_url);
  updateBrandFaviconPreview(profile?.favicon_url);

  const badge = document.getElementById('brand-domain-status-badge');
  const dStatus = profile?.domain_status || 'Not configured';
  if (badge) {
    badge.textContent = dStatus === 'Verified' ? 'Verified ✓' : (dStatus === 'Pending verification' ? 'Pending Verification ⏳' : 'Not Configured');
    badge.className = `status-badge ${dStatus === 'Verified' ? 'badge-updated' : 'badge-submitted'}`;
  }

  const status = document.getElementById('brand-domain-status');
  if (status) {
    if (dStatus === 'Verified') {
      status.innerHTML = `<span style="color:#059669;font-weight:700;"><i data-lucide="check-circle" style="width:14px;height:14px;display:inline-block;vertical-align:-2px;"></i> Active &amp; Verified:</span> Your custom domain <code>${escapeHtml(profile?.custom_domain || '')}</code> is active with automatic SSL.`;
    } else if (profile?.custom_domain) {
      status.innerHTML = `<span style="color:#d97706;font-weight:700;"><i data-lucide="clock" style="width:14px;height:14px;display:inline-block;vertical-align:-2px;"></i> Pending DNS Verification:</span> Add a CNAME pointing to the target above, then click <strong>Verify DNS Resolution Now</strong>.`;
    } else {
      status.textContent = 'Enter your custom subdomain above and save to configure DNS CNAME routing.';
    }
  }

  updateBrandLivePreview();
  await loadResellerInviteSettings();
}

async function loadResellerInviteSettings() {
  if (!currentUser || currentUser.role !== 'reseller') return;
  try {
    const data = await apiFetch('/resellers/invite-settings');
    const shareableInput = document.getElementById('invite-shareable-link');
    const previewLink = document.getElementById('invite-preview-link');
    const customSlugInput = document.getElementById('invite-custom-slug');
    const allowSelfRegToggle = document.getElementById('invite-allow-self-reg');

    if (shareableInput) shareableInput.value = data.shareable_url || '';
    if (previewLink) previewLink.href = data.shareable_url || '#';
    if (customSlugInput) customSlugInput.value = data.invite_code || '';
    if (allowSelfRegToggle) allowSelfRegToggle.checked = data.allow_self_registration !== false;

    const rates = data.default_rates || {};
    const rateFields = {
      'rate-normal-domestic': rates.normal_domestic ?? 0.1500,
      'rate-dp-domestic': rates.dp_domestic ?? 0.2800,
      'rate-cta-domestic': rates.cta_domestic ?? 0.2400,
      'rate-dp-cta-domestic': rates.dp_cta_domestic ?? 0.3500,
      'rate-gsm-sms-domestic': rates.gsm_sms_domestic ?? 0.1200,
      'rate-own-number-domestic': rates.own_number_domestic ?? 0.0800,
      'rate-normal-intl': rates.normal_international ?? 2.0000,
      'rate-gsm-sms-intl': rates.gsm_sms_international ?? 1.5000
    };

    for (const [id, val] of Object.entries(rateFields)) {
      const el = document.getElementById(id);
      if (el) el.value = parseFloat(val).toFixed(4);
    }
  } catch (err) {
    console.error('Failed to load reseller invite settings:', err);
  }
}

const btnCopyInvite = document.getElementById('btn-copy-invite-link');
if (btnCopyInvite) {
  btnCopyInvite.addEventListener('click', async () => {
    const input = document.getElementById('invite-shareable-link');
    if (!input || !input.value) return;
    try {
      await navigator.clipboard.writeText(input.value);
      btnCopyInvite.innerHTML = '<i data-lucide="check" style="width:14px;height:14px;"></i> Copied! ✓';
      if (window.lucide) window.lucide.createIcons();
      showToast('success', 'Link Copied', 'Invite signup link copied to clipboard.');
      setTimeout(() => {
        btnCopyInvite.innerHTML = '<i data-lucide="copy" style="width:14px;height:14px;"></i> Copy Link';
        if (window.lucide) window.lucide.createIcons();
      }, 2500);
    } catch (_) {
      input.select();
      document.execCommand('copy');
      showToast('success', 'Link Copied', 'Invite signup link copied to clipboard.');
    }
  });
}

const btnSaveInvite = document.getElementById('btn-save-invite-settings');
if (btnSaveInvite) {
  btnSaveInvite.addEventListener('click', async () => {
    const customSlug = document.getElementById('invite-custom-slug')?.value.trim();
    const allowSelfReg = document.getElementById('invite-allow-self-reg')?.checked;

    const default_rates = {
      normal_domestic: parseFloat(document.getElementById('rate-normal-domestic')?.value) || 0.1500,
      dp_domestic: parseFloat(document.getElementById('rate-dp-domestic')?.value) || 0.2800,
      cta_domestic: parseFloat(document.getElementById('rate-cta-domestic')?.value) || 0.2400,
      dp_cta_domestic: parseFloat(document.getElementById('rate-dp-cta-domestic')?.value) || 0.3500,
      gsm_sms_domestic: parseFloat(document.getElementById('rate-gsm-sms-domestic')?.value) || 0.1200,
      own_number_domestic: parseFloat(document.getElementById('rate-own-number-domestic')?.value) || 0.0800,
      normal_international: parseFloat(document.getElementById('rate-normal-intl')?.value) || 2.0000,
      gsm_sms_international: parseFloat(document.getElementById('rate-gsm-sms-intl')?.value) || 1.5000
    };

    try {
      await apiFetch('/resellers/invite-settings', {
        method: 'PUT',
        body: JSON.stringify({
          invite_code: customSlug,
          allow_self_registration: allowSelfReg,
          default_rates
        })
      });

      showToast('success', 'Invite Settings Saved', 'Your client invite link and default credit margins were updated successfully!');
      await loadResellerInviteSettings();
    } catch (err) {
      showToast('error', 'Update Failed', err.message);
    }
  });
}

async function saveResellerBrandProfile() {
  const brandName = brandFields.brand_name?.value?.trim();
  if (!brandName) {
    showToast('error', 'Brand Name Required', 'Please enter your brand name.');
    brandFields.brand_name?.focus();
    return;
  }

  const payload = Object.fromEntries(Object.entries(brandFields).map(([key, field]) => [key, field?.value?.trim() || '']));
  const btnSave = document.getElementById('btn-save-brand-identity');

  try {
    if (btnSave) {
      btnSave.disabled = true;
      btnSave.innerHTML = '<i data-lucide="loader" class="spin" style="width:16px;height:16px;"></i> Saving...';
    }
    const profile = await apiFetch('/resellers/me', { method: 'PUT', body: JSON.stringify(payload) });
    applyBrandProfile(profile);
    showToast('success', 'Brand Saved Successfully', 'Your white-label portal branding, theme, and domain settings are saved.');
    await loadMyBrandProfile();
  } catch (err) {
    showToast('error', 'Brand Save Failed', err.message);
  } finally {
    if (btnSave) {
      btnSave.disabled = false;
      btnSave.innerHTML = '<i data-lucide="save" style="width:16px;height:16px;"></i> Save Brand & Domain Settings';
      if (window.lucide) lucide.createIcons();
    }
  }
}

if (brandForm) {
  brandForm.addEventListener('submit', (event) => {
    event.preventDefault();
    saveResellerBrandProfile();
  });
}

const btnSaveBrandIdentity = document.getElementById('btn-save-brand-identity');
if (btnSaveBrandIdentity) {
  btnSaveBrandIdentity.addEventListener('click', (event) => {
    event.preventDefault();
    saveResellerBrandProfile();
  });
}


// ==========================================
// COMPOSER SELECTORS INTEGRATION
// ==========================================
async function populateComposerSelectors() {
  const templateSelect = document.getElementById('composer-template-select');
  const groupSelect = document.getElementById('composer-contact-group-select');

  try {
    // 1. Templates
    if (templateSelect) {
      const templates = await apiFetch('/templates').catch(() => []);
      const prevVal = templateSelect.value;
      templateSelect.innerHTML = '<option value="">Insert Template...</option>' + 
        templates.map(t => {
          const chIcon = (t.channel === 'sms') ? '[SMS]' : (t.template_type === 'cta' ? '[WA-CTA]' : '[WA]');
          const attTag = t.attachment_url ? ' (Attachment)' : '';
          return `<option value="${encodeURIComponent(t.content || t.body)}" data-id="${t.id}">${chIcon} ${escapeHtml(t.title)}${attTag}</option>`;
        }).join('');
      if (prevVal) templateSelect.value = prevVal;
      
      templateSelect.onchange = () => {
        if (templateSelect.value) {
          const selectedText = decodeURIComponent(templateSelect.value);
          composerText.value = selectedText;
          updateComposerCharLimit();
          if (previewBubbleText) previewBubbleText.innerHTML = formatLiveMessagePreview(composerText.value.trim());

          const selectedOption = templateSelect.options[templateSelect.selectedIndex];
          const tId = selectedOption?.dataset?.id;
          const matchedTpl = templates.find(item => String(item.id) === String(tId) || (item.content || item.body) === selectedText);

          if (matchedTpl) {
            const isSms = (matchedTpl.channel === 'sms');
            const isCta = (!isSms && matchedTpl.template_type === 'cta');

            if (isSms) {
              const routeRadio = document.querySelector('input[name="campaign-route"][value="domestic"]');
              if (routeRadio) routeRadio.checked = true;
            } else if (isCta) {
              const ctaRadio = document.querySelector('input[name="campaign-type-picker"][value="cta"]');
              if (ctaRadio) { ctaRadio.checked = true; ctaRadio.dispatchEvent(new Event('change')); }
              let cta = null;
              if (matchedTpl.cta_data) {
                try { cta = typeof matchedTpl.cta_data === 'string' ? JSON.parse(matchedTpl.cta_data) : matchedTpl.cta_data; } catch(e){}
              }
              if (cta) {
                const callTxt = document.getElementById('cta-call-text');
                const callNum = document.getElementById('cta-call-number');
                const urlTxt = document.getElementById('cta-url-text');
                const urlLnk = document.getElementById('cta-url-link');
                if (callTxt) { callTxt.value = cta.call_text || ''; callTxt.dispatchEvent(new Event('input')); }
                if (callNum) { callNum.value = cta.call_number || ''; callNum.dispatchEvent(new Event('input')); }
                if (urlTxt) { urlTxt.value = cta.url_text || ''; urlTxt.dispatchEvent(new Event('input')); }
                if (urlLnk) { urlLnk.value = cta.url_link || ''; urlLnk.dispatchEvent(new Event('input')); }
              }
            } else {
              const normalRadio = document.querySelector('input[name="campaign-type-picker"][value="normal"]');
              if (normalRadio) { normalRadio.checked = true; normalRadio.dispatchEvent(new Event('change')); }
            }
          }
          updateCostCalculator();
        }
      };
    }

    // 2. Contact Groups
    if (groupSelect) {
      const groups = await apiFetch('/contacts/groups').catch(() => []);
      const prevVal = groupSelect.value;
      const targetUserId = window.composerTargetUser ? window.composerTargetUser.id : (currentUser ? currentUser.id : null);
      let relevantGroups = groups;
      if (window.composerTargetUser && currentUser && window.composerTargetUser.id !== currentUser.id) {
        relevantGroups = groups.filter(g => Number(g.user_id) === Number(targetUserId));
      }
      groupSelect.innerHTML = '<option value="">Choose Contact Group from Phonebook...</option>' +
        relevantGroups.map(g => `<option value="${g.id}">${escapeHtml(g.name)} (${(parseInt(g.total_contacts || g.contact_count, 10) || 0).toLocaleString()} numbers)${g.owner_email && (!window.composerTargetUser || window.composerTargetUser.id === currentUser.id) && (currentUser.role === 'admin' || currentUser.role === 'reseller') ? ' — ' + escapeHtml(g.owner_email) : ''}</option>`).join('');
      if (prevVal && relevantGroups.some(g => String(g.id) === String(prevVal))) {
        groupSelect.value = prevVal;
      }
    }

    // 4. SMS Composer Contact Groups
    const smsGroupSelect = document.getElementById('sms-contact-group-select');
    if (smsGroupSelect) {
      const groups = await apiFetch('/contacts/groups').catch(() => []);
      const prevSmsVal = smsGroupSelect.value;
      smsGroupSelect.innerHTML = '<option value="">— Or select Audience Group from Phonebook —</option>' +
        groups.map(g => `<option value="${g.id}">${escapeHtml(g.name)} (${(parseInt(g.total_contacts || g.contact_count, 10) || 0).toLocaleString()} numbers)${g.owner_email && (currentUser && (currentUser.role === 'admin' || currentUser.role === 'reseller')) ? ' — ' + escapeHtml(g.owner_email) : ''}</option>`).join('');
      if (prevSmsVal && groups.some(g => String(g.id) === String(prevSmsVal))) {
        smsGroupSelect.value = prevSmsVal;
      }
    }

    // 5. Bulk SMS Composer Templates
    const smsTemplateSelect = document.getElementById('sms-template-select');
    if (smsTemplateSelect) {
      const templates = await apiFetch('/templates').catch(() => []);
      const smsTemplates = templates.filter(t => t.channel === 'sms');
      const prevTplVal = smsTemplateSelect.value;
      smsTemplateSelect.innerHTML = '<option value="">— Or insert saved SMS Template... —</option>' +
        smsTemplates.map(t => `<option value="${encodeURIComponent(t.content || t.body)}" data-title="${escapeHtml(t.title)}">[SMS] ${escapeHtml(t.title)} (${t.parts_count || 1} Part${(t.parts_count || 1) > 1 ? 's' : ''})</option>`).join('');
      if (prevTplVal) smsTemplateSelect.value = prevTplVal;
    }
  } catch (e) {
    console.error('Error populating composer selectors:', e);
  }
}

// ----------------------------------------------------
// CONTACT GROUP DIRECT INSERTION
// ----------------------------------------------------
const btnInsertGroupNumbers = document.getElementById('btn-insert-group-numbers');
if (btnInsertGroupNumbers) {
  btnInsertGroupNumbers.addEventListener('click', async () => {
    const groupSelect = document.getElementById('composer-contact-group-select');
    const groupId = groupSelect.value;
    if (!groupId) {
      showToast('warning', 'Select Group', 'Please select a contact group from the dropdown.');
      return;
    }
    const origHtml = btnInsertGroupNumbers.innerHTML;
    try {
      btnInsertGroupNumbers.disabled = true;
      btnInsertGroupNumbers.innerHTML = '<i data-lucide="loader-2" class="spin"></i> Loading...';
      if (window.lucide) lucide.createIcons();

      const data = await apiFetch(`/contacts/groups/${groupId}/all-numbers`);
      btnInsertGroupNumbers.disabled = false;
      btnInsertGroupNumbers.innerHTML = origHtml;
      if (window.lucide) lucide.createIcons();

      const numbersList = data.numbers || [];
      if (!numbersList.length) {
        showToast('warning', 'Empty Group', 'This contact group has no numbers.');
        return;
      }
      const numbersText = numbersList.join('\n');
      if (composerNumbers.value.trim()) {
        composerNumbers.value += '\n' + numbersText;
      } else {
        composerNumbers.value = numbersText;
      }
      updateCostCalculator();
      const { isCapped } = processContactInput(composerNumbers.value, selectedDestination);
      let toastMsg = `Loaded ${numbersList.length.toLocaleString()} numbers from "${data.group ? data.group.name : 'Group'}".`;
      if (isCapped) {
        toastMsg += ` (Total capped at 50,000 maximum campaign limit).`;
      }
      showToast('success', 'Contacts Loaded', toastMsg);
    } catch (err) {
      btnInsertGroupNumbers.disabled = false;
      btnInsertGroupNumbers.innerHTML = origHtml;
      if (window.lucide) lucide.createIcons();
      showToast('error', 'Error Loading Group', err.message);
    }
  });
}

window.insertGroupIntoSmsComposer = async function() {
  const groupSelect = document.getElementById('sms-contact-group-select');
  if (!groupSelect || !groupSelect.value) {
    showToast('warning', 'Select Group', 'Please select a contact group from the dropdown.');
    return;
  }
  const groupId = groupSelect.value;
  try {
    const data = await apiFetch(`/contacts/groups/${groupId}/all-numbers`);
    const numbersList = data.numbers || [];
    if (!numbersList.length) {
      showToast('warning', 'Empty Group', 'This contact group has no numbers.');
      return;
    }
    const numbersBox = document.getElementById('sms-numbers');
    if (!numbersBox) return;
    const numbersText = numbersList.join('\n');
    if (numbersBox.value.trim()) {
      numbersBox.value += '\n' + numbersText;
    } else {
      numbersBox.value = numbersText;
    }
    if (typeof updateSmsCreditsPreview === 'function') updateSmsCreditsPreview();
    showToast('success', 'Contacts Loaded', `Loaded ${numbersList.length.toLocaleString()} numbers from "${data.group ? data.group.name : 'Group'}" into SMS Campaign.`);
  } catch (err) {
    showToast('error', 'Error Loading Group', err.message);
  }
};

window.onSmsTemplateSelect = function() {
  const sel = document.getElementById('sms-template-select');
  if (!sel || !sel.value) return;
  const content = decodeURIComponent(sel.value);
  const msgBox = document.getElementById('sms-message');
  if (msgBox) {
    msgBox.value = content;
    if (typeof onSmsMessageInput === 'function') onSmsMessageInput();
  }
  const selectedOpt = sel.options[sel.selectedIndex];
  const title = selectedOpt ? selectedOpt.dataset.title : '';
  const titleBox = document.getElementById('sms-title');
  if (titleBox && !titleBox.value.trim() && title) {
    titleBox.value = title;
  }
  showToast('info', 'Template Inserted', 'Inserted template content into SMS composer.');
};

// ----------------------------------------------------
// OPERATOR BULK DISPATCH QUEUE & 1-CLICK EXPORT
// ----------------------------------------------------
let operatorQueueCampaigns = [];
let selectedOperatorCampaignIds = new Set();

const btnOpenOperatorQueue = document.getElementById('btn-open-operator-queue');
const modalOperatorDispatch = document.getElementById('modal-operator-dispatch');
const operatorCheckAll = document.getElementById('operator-check-all');
const btnOperatorDownloadAllZip = document.getElementById('btn-operator-download-all-zip');
const btnOperatorDownloadSelected = document.getElementById('btn-operator-download-selected');
const btnOperatorBulkApprove = document.getElementById('btn-operator-bulk-approve');
const btnOperatorBulkComplete = document.getElementById('btn-operator-bulk-complete');

if (btnOpenOperatorQueue) {
  btnOpenOperatorQueue.addEventListener('click', () => {
    if (modalOperatorDispatch) {
      modalOperatorDispatch.style.display = 'flex';
      loadOperatorQueue();
    }
  });
}

let currentOperatorFilter = 'all';

function renderOperatorQueueRows() {
  const tbody = document.getElementById('operator-queue-tbody');
  if (!tbody) return;

  const filtered = operatorQueueCampaigns.filter(c => {
    if (currentOperatorFilter === 'all') return true;
    if (currentOperatorFilter === 'pending') return c.status === 'Submitted' || c.status === 'Approved';
    if (currentOperatorFilter === 'Completed') return c.status === 'Completed' || c.status === 'Report Updated';
    return c.status === currentOperatorFilter;
  });

  if (!filtered.length) {
    tbody.innerHTML = `<tr><td colspan="9" style="text-align:center;padding:35px 20px;color:var(--slate-500);">
      <div style="font-weight:600;font-size:0.95rem;color:var(--slate-700);margin-bottom:4px;">No campaigns found in '${escapeHtml(currentOperatorFilter)}' queue.</div>
      <div style="font-size:0.8rem;color:var(--slate-400);margin-bottom:12px;">All campaigns on the platform are visible in the main Campaigns & Broadcasts Hub.</div>
      <button type="button" class="btn-action btn-action-primary" onclick="closeModal('modal-operator-dispatch'); switchView('view-campaigns');" style="padding:6px 14px;font-size:0.8rem;">
        Open Campaigns Hub
      </button>
    </td></tr>`;
    if (operatorCheckAll) operatorCheckAll.checked = false;
    return;
  }

  tbody.innerHTML = filtered.map(c => {
    const hasMediaAssets = Boolean(c.attachment_url || (Array.isArray(c.attachments) && c.attachments.length > 0) || (typeof c.attachments === 'string' && c.attachments !== '[]' && c.attachments !== 'null'));
    const hasMedia = hasMediaAssets ? `<span style="color:#059669;font-weight:600;"><i data-lucide="paperclip" style="width:13px;height:13px;vertical-align:middle;"></i> Yes</span>` : `<span style="color:var(--slate-400);">None</span>`;
    
    const isScheduled = Boolean(c.scheduled_at && new Date(c.scheduled_at) > new Date());
    let statusBadge = '';
    if (isScheduled) {
      statusBadge = `<span class="status-badge" style="background:#fef3c7;color:#b45309;border:1px solid #fde68a;font-size:0.72rem;display:inline-flex;align-items:center;gap:3px;"><i data-lucide="clock" style="width:11px;height:11px;"></i> Scheduled (${new Date(c.scheduled_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })})</span>`;
    } else if (c.status === 'Approved') {
      statusBadge = `<span class="status-badge status-approved">Approved</span>`;
    } else if (c.status === 'Submitted') {
      statusBadge = `<span class="status-badge status-submitted">Submitted</span>`;
    } else if (c.status === 'Completed' || c.status === 'Report Updated') {
      statusBadge = `<span class="status-badge" style="background:#e0f2fe;color:#0284c7;border:1px solid #bae6fd;font-size:0.72rem;">Dispatched</span>`;
    } else {
      statusBadge = `<span class="status-badge" style="font-size:0.72rem;">${escapeHtml(c.status || 'Pending')}</span>`;
    }
    const audience = (c.total_numbers || 0).toLocaleString();
    const dateStr = c.created_at ? new Date(c.created_at).toLocaleString() : '-';
    const isChecked = selectedOperatorCampaignIds.has(c.id);

    return `
      <tr data-campaign-id="${c.id}" ${isScheduled ? 'style="background:#fffdfa;"' : ''}>
        <td style="text-align:center;">
          <input type="checkbox" class="operator-row-checkbox" value="${c.id}" ${isChecked ? 'checked' : ''}>
        </td>
        <td style="font-weight:700;color:var(--slate-900);">#${c.id}</td>
        <td style="font-weight:600;color:var(--slate-800);">${escapeHtml(c.title || 'Untitled')}</td>
        <td>
          <div style="font-size:0.82rem;font-weight:600;color:var(--slate-800);">${escapeHtml(c.owner_email || 'User')}</div>
          <div style="font-size:0.75rem;color:var(--slate-400);">${escapeHtml(c.destination === 'international' ? 'International Route' : 'Domestic Direct Route')}</div>
        </td>
        <td><span class="route-badge">${escapeHtml(c.channel_type || 'normal')}</span></td>
        <td style="font-weight:700;color:#0f172a;">${audience}</td>
        <td>${hasMedia}</td>
        <td>${statusBadge}</td>
        <td style="font-size:0.75rem;color:var(--slate-500);">${dateStr}</td>
      </tr>
    `;
  }).join('');

  if (window.lucide) lucide.createIcons();

  // Checkbox events for visible items
  const checkboxes = document.querySelectorAll('.operator-row-checkbox');
  checkboxes.forEach(cb => {
    cb.addEventListener('change', () => {
      const id = parseInt(cb.value, 10);
      if (cb.checked) {
        selectedOperatorCampaignIds.add(id);
      } else {
        selectedOperatorCampaignIds.delete(id);
      }
      if (operatorCheckAll) {
        const visibleCheckboxes = document.querySelectorAll('.operator-row-checkbox');
        const allVisibleChecked = visibleCheckboxes.length > 0 && Array.from(visibleCheckboxes).every(c => c.checked);
        operatorCheckAll.checked = allVisibleChecked;
      }
      updateOperatorActionButtons();
    });
  });

  if (operatorCheckAll) {
    const visibleCheckboxes = document.querySelectorAll('.operator-row-checkbox');
    operatorCheckAll.checked = visibleCheckboxes.length > 0 && Array.from(visibleCheckboxes).every(c => c.checked);
  }
}

// Wire Operator Subfilter Pills once
const operatorPillContainer = document.getElementById('operator-subfilter-pills');
if (operatorPillContainer && !operatorPillContainer.dataset.wired) {
  operatorPillContainer.dataset.wired = 'true';
  operatorPillContainer.addEventListener('click', (e) => {
    const btn = e.target.closest('.tab-pill');
    if (!btn) return;
    operatorPillContainer.querySelectorAll('.tab-pill').forEach(p => p.classList.remove('active'));
    btn.classList.add('active');
    currentOperatorFilter = btn.getAttribute('data-op-filter') || 'all';
    renderOperatorQueueRows();
  });
}

async function loadOperatorQueue() {
  const tbody = document.getElementById('operator-queue-tbody');
  const countEl = document.getElementById('operator-queue-count');
  if (operatorCheckAll) operatorCheckAll.checked = false;
  selectedOperatorCampaignIds.clear();
  updateOperatorActionButtons();

  if (tbody) {
    tbody.innerHTML = '<tr><td colspan="9" style="text-align:center;padding:30px;color:var(--slate-400);"><i data-lucide="loader-2" class="spin"></i> Loading pending dispatch queue...</td></tr>';
    if (window.lucide) lucide.createIcons();
  }

  try {
    const data = await apiFetch('/campaigns/operator/queue');
    operatorQueueCampaigns = Array.isArray(data) ? data : [];
    if (countEl) countEl.textContent = operatorQueueCampaigns.length;
    const badge = document.getElementById('operator-queue-badge');
    if (badge) badge.textContent = operatorQueueCampaigns.length;

    // Update pill counters
    const subCount = operatorQueueCampaigns.filter(c => c.status === 'Submitted').length;
    const appCount = operatorQueueCampaigns.filter(c => c.status === 'Approved').length;
    const pendCount = subCount + appCount;
    const compCount = operatorQueueCampaigns.filter(c => c.status === 'Completed' || c.status === 'Report Updated').length;

    const pillAll = document.getElementById('op-filter-all-count');
    const pillPend = document.getElementById('op-filter-pend-count');
    const pillSub = document.getElementById('op-filter-sub-count');
    const pillApp = document.getElementById('op-filter-app-count');
    const pillComp = document.getElementById('op-filter-comp-count');
    if (pillAll) pillAll.textContent = operatorQueueCampaigns.length;
    if (pillPend) pillPend.textContent = pendCount;
    if (pillSub) pillSub.textContent = subCount;
    if (pillApp) pillApp.textContent = appCount;
    if (pillComp) pillComp.textContent = compCount;

    if (!operatorQueueCampaigns.length) {
      if (tbody) {
        tbody.innerHTML = `<tr><td colspan="9" style="text-align:center;padding:35px 20px;color:var(--slate-500);">
          <div style="font-weight:600;font-size:0.95rem;color:var(--slate-700);margin-bottom:4px;">No campaigns pending in dispatch queue.</div>
          <div style="font-size:0.8rem;color:var(--slate-400);margin-bottom:12px;">All platform campaigns are visible in the main Campaigns & Broadcasts Hub.</div>
          <button type="button" class="btn-action btn-action-primary" onclick="closeModal('modal-operator-dispatch'); switchView('view-campaigns');" style="padding:6px 14px;font-size:0.8rem;">
            Open Campaigns Hub
          </button>
        </td></tr>`;
      }
      return;
    }

    renderOperatorQueueRows();
  } catch (err) {
    if (tbody) tbody.innerHTML = `<tr><td colspan="9" style="text-align:center;padding:30px;color:#ef4444;">Failed to load queue: ${escapeHtml(err.message)}</td></tr>`;
    showToast('error', 'Queue Error', err.message);
  }
}

function updateOperatorActionButtons() {
  const count = selectedOperatorCampaignIds.size;
  const selCountEl = document.getElementById('operator-selected-count');
  if (selCountEl) selCountEl.textContent = count;

  if (btnOperatorDownloadSelected) btnOperatorDownloadSelected.disabled = (count === 0);
  if (btnOperatorBulkApprove) btnOperatorBulkApprove.disabled = (count === 0);
  if (btnOperatorBulkComplete) btnOperatorBulkComplete.disabled = (count === 0);
}

if (operatorCheckAll) {
  operatorCheckAll.addEventListener('change', () => {
    const isChecked = operatorCheckAll.checked;
    const checkboxes = document.querySelectorAll('.operator-row-checkbox');
    checkboxes.forEach(cb => {
      cb.checked = isChecked;
      const id = parseInt(cb.value, 10);
      if (isChecked) {
        selectedOperatorCampaignIds.add(id);
      } else {
        selectedOperatorCampaignIds.delete(id);
      }
    });
    updateOperatorActionButtons();
  });
}

async function triggerBulkExportDownload(campaignIds = null) {
  let url = '/campaigns/operator/bulk-export';
  if (campaignIds && campaignIds.length > 0) {
    url += `?campaign_ids=${encodeURIComponent(campaignIds.join(','))}`;
  }
  showToast('info', 'Preparing Package', 'Compiling clean numbers, captions, and media files into consolidated ZIP...');
  try {
    await downloadApiFile(url, 'MessageSphere_Operator_Dispatch.zip');
  } catch (err) {
    showToast('error', 'Export Failed', err.message);
  }
}

if (btnOperatorDownloadAllZip) {
  btnOperatorDownloadAllZip.addEventListener('click', () => {
    triggerBulkExportDownload(null);
  });
}

if (btnOperatorDownloadSelected) {
  btnOperatorDownloadSelected.addEventListener('click', () => {
    if (selectedOperatorCampaignIds.size === 0) {
      showToast('warning', 'No Campaign Selected', 'Please check at least one campaign from the queue table.');
      return;
    }
    triggerBulkExportDownload(Array.from(selectedOperatorCampaignIds));
  });
}

const modalBulkConfirm = document.getElementById('modal-bulk-confirm');
const bulkConfirmTitle = document.getElementById('bulk-confirm-title');
const bulkConfirmSub = document.getElementById('bulk-confirm-sub');
const bulkConfirmReason = document.getElementById('bulk-confirm-reason');
const bulkConfirmRef = document.getElementById('bulk-confirm-ref');
const bulkConfirmStatus = document.getElementById('bulk-confirm-target-status');
const btnModalSubmitBulk = document.getElementById('btn-modal-submit-bulk');

function openBulkConfirmModal(status) {
  if (selectedOperatorCampaignIds.size === 0) {
    showToast('warning', 'No Campaign Selected', 'Please check at least one campaign from the queue table.');
    return;
  }
  if (!modalBulkConfirm) return;

  if (status === 'Approved') {
    const nonSubmitted = operatorQueueCampaigns.filter(c => selectedOperatorCampaignIds.has(c.id) && c.status !== 'Submitted');
    if (nonSubmitted.length > 0) {
      showToast('warning', 'Selection Mismatch', `${nonSubmitted.length} selected campaign(s) are already Approved. Switch filter to "Submitted" tab to batch-approve.`);
      return;
    }
  } else if (status === 'Completed') {
    const nonApproved = operatorQueueCampaigns.filter(c => selectedOperatorCampaignIds.has(c.id) && c.status !== 'Approved');
    if (nonApproved.length > 0) {
      showToast('warning', 'Selection Mismatch', `${nonApproved.length} selected campaign(s) are still Submitted and not yet Approved. Only Approved campaigns can be marked Completed.`);
      return;
    }
  }

  bulkConfirmStatus.value = status;
  bulkConfirmTitle.textContent = `Mark ${selectedOperatorCampaignIds.size} Campaigns as ${status}`;
  bulkConfirmSub.textContent = `Update status of ${selectedOperatorCampaignIds.size} selected campaigns to '${status}'`;
  bulkConfirmReason.value = `Bulk marked as ${status} for offline operator batch`;
  bulkConfirmRef.value = '';

  const now = new Date();
  const scheduledItems = operatorQueueCampaigns.filter(c => 
    selectedOperatorCampaignIds.has(c.id) && c.scheduled_at && new Date(c.scheduled_at) > now
  );
  const warningEl = document.getElementById('bulk-confirm-warning');
  if (warningEl) {
    if (scheduledItems.length > 0) {
      warningEl.style.display = 'block';
      const sampleNames = scheduledItems.slice(0, 2).map(c => `#${c.id} (${new Date(c.scheduled_at).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })})`).join(', ');
      warningEl.innerHTML = `<i data-lucide="alert-triangle" style="width:14px;height:14px;color:#d97706;display:inline-block;vertical-align:-2px;margin-right:4px;"></i> <strong>Scheduled Campaign Alert:</strong> ${scheduledItems.length} selected campaign(s) [${sampleNames}${scheduledItems.length > 2 ? '...' : ''}] are scheduled for future release. Changing status to <strong>${status}</strong> will dispatch them ahead of time!`;
      if (window.lucide) setTimeout(() => lucide.createIcons(), 20);
    } else {
      warningEl.style.display = 'none';
      warningEl.innerHTML = '';
    }
  }

  modalBulkConfirm.style.display = 'flex';
}

if (btnModalSubmitBulk) {
  btnModalSubmitBulk.addEventListener('click', async () => {
    const status = bulkConfirmStatus.value;
    const reason = bulkConfirmReason.value.trim();
    const external_reference = bulkConfirmRef.value.trim();
    if (!reason) {
      showToast('warning', 'Reason Required', 'Please enter a dispatch log reason.');
      return;
    }

    const now = new Date();
    const scheduledItems = operatorQueueCampaigns.filter(c => 
      selectedOperatorCampaignIds.has(c.id) && c.scheduled_at && new Date(c.scheduled_at) > now
    );
    if (scheduledItems.length > 0 && (status === 'Completed' || status === 'Approved')) {
      const confirmEarly = confirm(`Warning: Your selection includes ${scheduledItems.length} campaign(s) scheduled for future release.\n\nAre you sure you want to mark them as "${status}" ahead of their scheduled release time?`);
      if (!confirmEarly) return;
    }

    const ids = Array.from(selectedOperatorCampaignIds);
    btnModalSubmitBulk.disabled = true;
    btnModalSubmitBulk.textContent = 'Updating...';
    try {
      const res = await apiFetch('/campaigns/operator/bulk-status', {
        method: 'POST',
        body: JSON.stringify({ campaign_ids: ids, status, reason, external_reference })
      });
      showToast('success', 'Status Updated', res.message || `Updated ${ids.length} campaigns to ${status}.`);
      modalBulkConfirm.style.display = 'none';
      await loadOperatorQueue();
      await loadCampaigns();
    } catch (err) {
      showToast('error', 'Update Failed', err.message);
    } finally {
      btnModalSubmitBulk.disabled = false;
      btnModalSubmitBulk.textContent = 'Confirm & Update';
    }
  });
}

if (btnOperatorBulkApprove) {
  btnOperatorBulkApprove.addEventListener('click', () => {
    openBulkConfirmModal('Approved');
  });
}

if (btnOperatorBulkComplete) {
  btnOperatorBulkComplete.addEventListener('click', () => {
    openBulkConfirmModal('Completed');
  });
}

// --- USER 360 PROFILE CONTROLLER ---
const modalUser360 = document.getElementById('modal-user-360');

window.openQuick360Picker = function() {
  if (allUsers && allUsers.length > 0) {
    const target = allUsers.find(u => u.role !== 'admin') || allUsers[0];
    openUser360Modal(target.id);
  } else if (currentUser) {
    openUser360Modal(currentUser.id);
  } else {
    showToast('info', '360 Profile', 'Please select a user to view 360° profile.');
  }
};

// Tab switching for 360 modal
document.querySelectorAll('.u360-tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const targetTab = btn.getAttribute('data-tab');
    document.querySelectorAll('.u360-tab-btn').forEach(b => {
      b.classList.remove('active');
      b.style.color = 'var(--slate-500)';
      b.style.borderBottomColor = 'transparent';
    });
    btn.classList.add('active');
    btn.style.color = '#4f46e5';
    btn.style.borderBottomColor = '#4f46e5';

    document.querySelectorAll('.u360-tab-pane').forEach(pane => {
      pane.style.display = pane.id === targetTab ? 'block' : 'none';
    });
    if (window.lucide) setTimeout(() => lucide.createIcons(), 20);
  });
});

window.openMy360Profile = function() {
  if (window.currentUser && window.currentUser.id) {
    openUser360Modal(window.currentUser.id);
  } else {
    showToast('info', 'Session Loading', 'Please wait while session initializes.');
  }
};

window.openUser360Modal = async function(userId, evt) {
  if (evt && evt.stopPropagation) evt.stopPropagation();
  const modal = document.getElementById('modal-user-360');
  if (!modal) {
    console.error('modal-user-360 element not found');
    return;
  }

  // Prevent background scroll
  document.body.style.overflow = 'hidden';
  modal.style.display = 'flex';

  const closeU360 = () => {
    modal.style.display = 'none';
    document.body.style.overflow = '';
  };

  // Attach fail-safe close handlers
  modal.querySelectorAll('[data-close="modal-user-360"]').forEach(b => {
    b.onclick = closeU360;
  });
  modal.onclick = (e) => {
    if (e.target === modal) closeU360();
  };
  const modalCard = modal.querySelector('.modal-card');
  if (modalCard) {
    modalCard.onclick = (e) => e.stopPropagation();
  }

  // Reset to first tab
  const firstTabBtn = document.querySelector('.u360-tab-btn[data-tab="u360-tab-credits"]');
  if (firstTabBtn) firstTabBtn.click();

  // Show loading skeleton / placeholder
  document.getElementById('u360-name').textContent = 'Loading profile...';
  document.getElementById('u360-email').innerHTML = '<i data-lucide="loader" style="width:13px;height:13px;"></i> Fetching data...';
  document.getElementById('u360-phone').textContent = '';
  document.getElementById('u360-company').textContent = '';
  document.getElementById('u360-reseller').style.display = 'none';
  document.getElementById('u360-credits-tbody').innerHTML = '<tr><td colspan="4" style="text-align:center;padding:20px;color:var(--slate-400);">Loading balances...</td></tr>';
  document.getElementById('u360-campaigns-tbody').innerHTML = '<tr><td colspan="6" style="text-align:center;padding:20px;color:var(--slate-400);">Loading campaigns...</td></tr>';
  document.getElementById('u360-ledger-tbody').innerHTML = '<tr><td colspan="5" style="text-align:center;padding:20px;color:var(--slate-400);">Loading passbook...</td></tr>';

  try {
    const data = await apiFetch(`/users/${userId}/360`);
    const user = data.user || {};
    const credits = data.credits || { balances: {} };
    credits.balances = credits.balances || {};
    const campaignStats = data.campaignStats || {};
    const recentCampaigns = data.recentCampaigns || [];
    const recentTransactions = data.recentTransactions || [];
    const assets = data.assets || {};

    // Header info
    const initial = (user.fullName || user.email || 'U').charAt(0).toUpperCase();
    document.getElementById('u360-avatar').textContent = initial;
    document.getElementById('u360-status-dot').style.background = user.isBlocked ? '#ef4444' : '#10b981';
    document.getElementById('u360-name').textContent = user.fullName || user.email;
    
    const roleBadge = document.getElementById('u360-role-badge');
    roleBadge.className = `role-badge role-${user.role}`;
    roleBadge.textContent = (user.role || 'user').toUpperCase();

    const statusBadge = document.getElementById('u360-status-badge');
    statusBadge.className = user.isBlocked ? 'status-badge badge-rejected' : 'status-badge badge-updated';
    statusBadge.innerHTML = user.isBlocked ? '<i data-lucide="ban" style="width:12px;height:12px;"></i> Blocked' : '<i data-lucide="check-circle" style="width:12px;height:12px;"></i> Active';

    document.getElementById('u360-email').innerHTML = `<i data-lucide="mail" style="width:13px;height:13px;display:inline;vertical-align:-1px;"></i> ${escapeHtml(user.email || '')}`;
    document.getElementById('u360-phone').innerHTML = user.phone ? `<i data-lucide="phone" style="width:13px;height:13px;display:inline;vertical-align:-1px;"></i> ${escapeHtml(user.phone)}` : '';
    document.getElementById('u360-company').innerHTML = user.companyName ? `<i data-lucide="building" style="width:13px;height:13px;display:inline;vertical-align:-1px;"></i> ${escapeHtml(user.companyName)}` : '';

    const resellerEl = document.getElementById('u360-reseller');
    if (currentUser && currentUser.role === 'admin') {
      if (user.resellerEmail) {
        resellerEl.style.display = 'inline-block';
        resellerEl.innerHTML = `<i data-lucide="network" style="width:12px;height:12px;display:inline;vertical-align:-1px;"></i> Associated Reseller: <strong>${escapeHtml(user.resellerName || user.resellerEmail)}</strong> (${escapeHtml(user.resellerEmail)})`;
      } else if (user.role === 'reseller') {
        resellerEl.style.display = 'inline-block';
        resellerEl.innerHTML = `<i data-lucide="award" style="width:12px;height:12px;display:inline;vertical-align:-1px;color:#7c3aed;"></i> Account Type: <strong>Reseller Partner Account</strong>`;
      } else {
        resellerEl.style.display = 'inline-block';
        resellerEl.innerHTML = `<i data-lucide="shield-check" style="width:12px;height:12px;display:inline;vertical-align:-1px;color:#0284c7;"></i> Account Origin: <strong>Direct Super Admin Root</strong>`;
      }
    } else {
      resellerEl.style.display = 'none';
    }

    // Header Quick Action Buttons (Admin / Reseller)
    const adminActionsContainer = document.getElementById('u360-admin-actions');
    const canManage = currentUser && (currentUser.role === 'admin' || (currentUser.role === 'reseller' && user.id !== currentUser.id));
    if (canManage && user.id !== currentUser.id) {
      adminActionsContainer.style.display = 'flex';
      const btnImpersonate = document.getElementById('u360-btn-impersonate');
      if (btnImpersonate) {
        if (user.role !== 'admin' && user.id !== currentUser.id) {
          btnImpersonate.style.display = 'inline-flex';
          btnImpersonate.onclick = () => {
            closeU360();
            impersonateUserAccount(user.id, user.email);
          };
        } else {
          btnImpersonate.style.display = 'none';
        }
      }

      const btnAllot = document.getElementById('u360-btn-allot');
      btnAllot.onclick = () => {
        closeU360();
        openAllotCreditsModal(user.id, user.email);
      };

      const btnResetPass = document.getElementById('u360-btn-reset-pass');
      btnResetPass.onclick = () => {
        closeU360();
        openResetPasswordModal(user.id, user.email);
      };

      const btnBlock = document.getElementById('u360-btn-block');
      btnBlock.className = user.isBlocked ? 'btn-action btn-action-success' : 'btn-action btn-action-secondary';
      btnBlock.innerHTML = `<i data-lucide="${user.isBlocked ? 'unlock' : 'lock'}" style="width:13px;height:13px;"></i> ${user.isBlocked ? 'Unblock' : 'Block'}`;
      btnBlock.onclick = async () => {
        await toggleBlockUser(user.id);
        openUser360Modal(user.id);
      };

      const btnRefundDest = document.getElementById('u360-btn-refund-dest');
      if (btnRefundDest) {
        if (user.role === 'user' && user.resellerEmail) {
          btnRefundDest.style.display = 'inline-flex';
          const isResellerRef = (user.refundDestination === 'reseller');
          const textEl = document.getElementById('u360-btn-refund-text');
          if (textEl) textEl.textContent = isResellerRef ? 'Refund: To Reseller' : 'Refund: To Client';
          btnRefundDest.style.borderColor = isResellerRef ? '#fde68a' : '#cbd5e1';
          btnRefundDest.style.background = isResellerRef ? '#fffbeb' : '#ffffff';
          btnRefundDest.style.color = isResellerRef ? '#b45309' : '#334155';
        } else {
          btnRefundDest.style.display = 'none';
        }
      }
    } else {
      adminActionsContainer.style.display = 'none';
    }

    // KPI Metrics
    document.getElementById('u360-dom-credits').textContent = (credits.totalDomestic || 0).toLocaleString();
    document.getElementById('u360-intl-credits').textContent = (credits.totalInternational || 0).toLocaleString();

    if (user.role === 'reseller') {
      const clientCount = (data.resellerClients || []).length;
      const netCampaigns = campaignStats.totalCampaigns || 0;
      const netNumbers = (campaignStats.totalNumbers || 0).toLocaleString();
      const rp = data.resellerProfile || {};
      
      document.getElementById('u360-sent-count').textContent = netNumbers;
      document.getElementById('u360-delivery-rate').innerHTML = `<span style="color:#4f46e5;font-weight:700;">${netCampaigns} Broadcasts</span> &bull; Network Audience`;
      
      document.getElementById('u360-contacts-count').textContent = `${clientCount} Clients`;
      document.getElementById('u360-groups-count').textContent = `Brand: ${escapeHtml(rp.brand_name || user.companyName || 'exhume')} • ${rp.custom_domain || 'No Domain'}`;
    } else {
      document.getElementById('u360-sent-count').textContent = (campaignStats.totalNumbers || 0).toLocaleString();
      const delivRate = campaignStats.deliveryRate || 0;
      const delivCount = (campaignStats.deliveredCount || 0).toLocaleString();
      document.getElementById('u360-delivery-rate').innerHTML = `<span style="color:#059669;font-weight:700;">${delivRate}% Delivery Success</span> &bull; ${delivCount} delivered`;
      document.getElementById('u360-contacts-count').textContent = (assets.totalContacts || 0).toLocaleString();
      document.getElementById('u360-groups-count').textContent = `${assets.totalGroups || 0} Groups • ${assets.approvedTemplates || 0} Templates`;
    }

    // Render Sub-Clients Tab if Reseller
    const clientsTbody = document.getElementById('u360-clients-tbody');
    const clientsBtn = document.getElementById('u360-tab-clients-btn');
    const clientsCountEl = document.getElementById('u360-tab-clients-count');

    if (user.role === 'reseller') {
      const clients = data.resellerClients || [];
      if (clientsBtn) clientsBtn.style.display = 'inline-flex';
      if (clientsCountEl) clientsCountEl.textContent = clients.length;

      if (clientsTbody) {
        if (clients.length === 0) {
          clientsTbody.innerHTML = `<tr><td colspan="6" style="text-align:center;padding:28px;color:#64748b;">No client accounts onboarded under this reseller yet.</td></tr>`;
        } else {
          clientsTbody.innerHTML = clients.map(cl => `
            <tr style="border-bottom:1px solid #f1f5f9;">
              <td style="padding:10px 14px;">
                <div style="font-weight:700;color:#0f172a;font-size:0.86rem;">${escapeHtml(cl.full_name || cl.company_name || 'Client Account')}</div>
                <div style="font-size:0.76rem;color:#475569;font-family:monospace;">${escapeHtml(cl.email)}</div>
              </td>
              <td style="padding:10px 14px;font-size:0.8rem;color:#64748b;">
                ${cl.phone ? `<i data-lucide="phone" style="width:11px;height:11px;display:inline-block;vertical-align:-1px;"></i> ${escapeHtml(cl.phone)}` : '—'}
                ${cl.company_name ? `<div style="font-size:0.72rem;color:#475569;font-weight:600;">${escapeHtml(cl.company_name)}</div>` : ''}
              </td>
              <td style="padding:10px 14px;">
                <span style="font-size:0.78rem;font-weight:700;color:#059669;background:#ecfdf5;padding:2px 7px;border-radius:4px;">
                  ${Number(cl.dom_balance || 0).toLocaleString()}
                </span>
              </td>
              <td style="padding:10px 14px;">
                <span style="font-size:0.78rem;font-weight:700;color:#0284c7;background:#f0f9ff;padding:2px 7px;border-radius:4px;">
                  ${Number(cl.intl_balance || 0).toLocaleString()}
                </span>
              </td>
              <td style="padding:10px 14px;font-size:0.8rem;color:#334155;font-weight:600;">
                ${Number(cl.campaign_count || 0)} broadcasts
              </td>
              <td style="padding:10px 14px;text-align:right;">
                <button type="button" class="btn-action btn-action-primary" onclick="openUser360Modal(${cl.id})" style="padding:3px 8px;font-size:0.72rem;font-weight:600;display:inline-flex;align-items:center;gap:3px;" title="Inspect Client 360° Profile">
                  <i data-lucide="sparkles" style="width:11px;height:11px;"></i> 360° Profile
                </button>
              </td>
            </tr>
          `).join('');
        }
      }
    } else {
      if (clientsBtn) clientsBtn.style.display = 'none';
    }

    // Tab 1: Credit Portfolio Table
    const channels = [
      { key: 'gsm_sms', name: 'GSM Bulk SMS (Cellular Telecom Route)', icon: 'radio' },
      { key: 'normal', name: 'Normal WhatsApp (Standard Text)', icon: 'message-circle' },
      { key: 'dp', name: 'WhatsApp Profile / Media (DP)', icon: 'image' },
      { key: 'cta', name: 'WhatsApp Call-to-Action (CTA Buttons)', icon: 'mouse-pointer' },
      { key: 'dp_cta', name: 'WhatsApp Combo (DP + CTA)', icon: 'layers' },
      { key: 'own_number', name: 'WhatsApp Own Dedicated SIM', icon: 'smartphone' }
    ];

    const creditsTbody = document.getElementById('u360-credits-tbody');
    creditsTbody.innerHTML = channels.map(ch => {
      const dom = credits.balances[`${ch.key}_domestic`] || 0;
      const intl = credits.balances[`${ch.key}_international`] || 0;
      const total = dom + intl;
      return `
        <tr>
          <td><strong style="display:inline-flex;align-items:center;gap:6px;"><i data-lucide="${ch.icon}" style="width:14px;height:14px;color:#4f46e5;"></i> ${ch.name}</strong></td>
          <td style="font-weight:600;color:#4f46e5;">${dom.toLocaleString()}</td>
          <td style="font-weight:600;color:#0891b2;">${intl.toLocaleString()}</td>
          <td><strong style="color:var(--slate-800);">${total.toLocaleString()}</strong></td>
        </tr>
      `;
    }).join('') + `
      <tr style="background:#f8fafc;font-weight:700;">
        <td>Total Channel Balance</td>
        <td style="color:#4f46e5;">${(credits.totalDomestic || 0).toLocaleString()}</td>
        <td style="color:#0891b2;">${(credits.totalInternational || 0).toLocaleString()}</td>
        <td style="color:var(--slate-900);font-size:0.95rem;">${(credits.totalBalance || 0).toLocaleString()}</td>
      </tr>
    `;

    // Tab 2: Recent Campaigns Table
    const campaignsTbody = document.getElementById('u360-campaigns-tbody');
    const totCamp = campaignStats.totalCampaigns || 0;
    const delivCamp = (campaignStats.deliveredCount || 0).toLocaleString();
    const failCamp = (campaignStats.failedCount || 0).toLocaleString();
    document.getElementById('u360-campaigns-stat').textContent = `${totCamp} Total Campaigns (${delivCamp} delivered / ${failCamp} failed)`;

    if (!recentCampaigns || recentCampaigns.length === 0) {
      campaignsTbody.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:24px;color:var(--slate-400);">No campaigns submitted yet.</td></tr>';
    } else {
      campaignsTbody.innerHTML = recentCampaigns.map(c => {
        let badge = '<span class="status-badge badge-pending">Submitted</span>';
        if (c.status === 'Approved') badge = '<span class="status-badge badge-approved">In Queue</span>';
        else if (c.status === 'Completed') badge = '<span class="status-badge" style="background:#e0f2fe;color:#0369a1;border:1px solid #bae6fd;">Dispatched</span>';
        else if (c.status === 'Report Updated') badge = '<span class="status-badge badge-updated">Report Updated</span>';
        else if (c.status === 'Rejected') badge = '<span class="status-badge badge-rejected">Rejected</span>';

        return `
          <tr>
            <td>
              <strong style="color:var(--slate-800);">${escapeHtml(c.title || 'Untitled Campaign')}</strong>
              <div style="font-size:0.75rem;color:var(--slate-400);">ID: #${c.id} ${c.user_email ? `&bull; ${escapeHtml(c.user_email)}` : ''}</div>
            </td>
            <td>
              <span style="text-transform:uppercase;font-size:0.75rem;font-weight:600;color:var(--slate-600);">${escapeHtml(c.campaign_type || 'normal')}</span>
              <span style="font-size:0.75rem;color:var(--slate-400);">(${escapeHtml(c.destination || 'domestic')})</span>
            </td>
            <td><strong>${(c.total_numbers || 0).toLocaleString()}</strong></td>
            <td>${badge}</td>
            <td>
              <span style="color:#16a34a;font-weight:600;">${(c.delivered_count || 0).toLocaleString()}</span> / 
              <span style="color:#dc2626;font-weight:600;">${(c.failed_count || 0).toLocaleString()}</span>
            </td>
            <td style="font-size:0.8rem;color:var(--slate-500);">${new Date(c.created_at).toLocaleDateString()}</td>
          </tr>
        `;
      }).join('');
    }

    // Tab 3: Passbook Ledger Table & Flow Categorization
    window.u360Transactions = recentTransactions || [];
    let u360Allot = 0;
    let u360Debit = 0;
    let u360Refund = 0;
    window.u360Transactions.forEach(t => {
      const amt = Math.abs(Number(t.amount) || 0);
      const isRef = t.category === 'refund' || Boolean(t.refund_campaign_id) || String(t.reason || '').toLowerCase().includes('refund');
      const isOut = t.category === 'allotment_out' || t.category === 'campaign_deduction' || !t.is_credit;
      if (isRef) {
        u360Refund += amt;
      } else if (isOut) {
        u360Debit += amt;
      } else {
        u360Allot += amt;
      }
    });

    const allotEl = document.getElementById('u360-ledger-total-allot');
    const debitEl = document.getElementById('u360-ledger-total-debit');
    const refundEl = document.getElementById('u360-ledger-total-refund');
    if (allotEl) allotEl.textContent = `+${u360Allot.toLocaleString()}`;
    if (debitEl) debitEl.textContent = `-${u360Debit.toLocaleString()}`;
    if (refundEl) refundEl.textContent = `+${u360Refund.toLocaleString()}`;

    // Reset filter pills to All
    const u360Pills = document.getElementById('u360-ledger-filter-pills');
    if (u360Pills) {
      u360Pills.querySelectorAll('.tab-pill').forEach((b, idx) => {
        if (idx === 0) b.classList.add('active');
        else b.classList.remove('active');
      });
    }

    window.renderU360LedgerTable('all');

    // Tab 5: Custom Rate Card & Pricing
    window.renderU360Rates(credits.rates || {});

    // Tab 4: Business & Security Details
    current360User = user;
    document.getElementById('u360-info-name').textContent = user.fullName || '—';
    document.getElementById('u360-info-company').textContent = user.companyName || '—';
    document.getElementById('u360-info-gstin').textContent = user.gstin || '—';
    document.getElementById('u360-info-phone').textContent = user.phone || '—';
    document.getElementById('u360-info-address').textContent = user.businessAddress || '—';

    document.getElementById('u360-info-id').textContent = `#${user.id}`;
    document.getElementById('u360-info-role').textContent = user.role.toUpperCase();
    
    const parentInfoEl = document.getElementById('u360-info-parent');
    if (parentInfoEl) {
      if (currentUser && currentUser.role === 'admin') {
        parentInfoEl.textContent = user.resellerEmail ? `Managed by ${user.resellerEmail} (${user.resellerName || 'Reseller'})` : 'Direct Platform Account (Super Admin)';
      } else {
        parentInfoEl.textContent = 'Direct Telecom Platform Account (Verified)';
      }
    }
    document.getElementById('u360-info-status').textContent = user.isBlocked ? 'Blocked / Suspended' : 'Active & Verified';
    document.getElementById('u360-info-created').textContent = new Date(user.createdAt).toLocaleString();

    const taxEl = document.getElementById('u360-info-tax-mode');
    if (taxEl) {
      const isWithGst = user.taxMode === 'with_gst';
      taxEl.textContent = isWithGst ? 'With GST (+18%)' : 'Non-GST (0%)';
      taxEl.style.background = isWithGst ? '#eff6ff' : '#ecfdf5';
      taxEl.style.color = isWithGst ? '#1d4ed8' : '#065f46';
      taxEl.style.borderColor = isWithGst ? '#bfdbfe' : '#bbf7d0';
    }

    const isClientWithReseller = Boolean(user.role === 'user' && user.resellerEmail);
    const destEl = document.getElementById('u360-info-refund-dest');
    const destLabel = document.getElementById('u360-info-refund-dest-label');
    const destWrap = document.getElementById('u360-info-refund-dest-wrap');
    if (destLabel) destLabel.style.display = isClientWithReseller ? '' : 'none';
    if (destWrap) destWrap.style.display = isClientWithReseller ? 'flex' : 'none';

    if (destEl && isClientWithReseller) {
      const isResellerRefund = user.refundDestination === 'reseller';
      destEl.textContent = isResellerRefund ? 'Reseller Wallet' : 'Client Wallet';
      destEl.style.background = isResellerRefund ? '#fffbeb' : '#f0fdf4';
      destEl.style.color = isResellerRefund ? '#b45309' : '#166534';
      destEl.style.borderColor = isResellerRefund ? '#fde68a' : '#bbf7d0';
    }

    document.getElementById('u360-footer-meta').textContent = `Account #${user.id} • Registered ${new Date(user.createdAt).toLocaleDateString()}`;

    if (window.lucide) {
      try { lucide.createIcons({ root: modal }); } catch (e) { lucide.createIcons(); }
    }
  } catch (err) {
    console.error('User 360 profile load error:', err);
    showToast('error', 'Profile Error', err.message);
  }
};

window.filterU360Ledger = function(flowFilter, btn) {
  const container = document.getElementById('u360-ledger-filter-pills');
  if (container) {
    container.querySelectorAll('.tab-pill').forEach(b => b.classList.remove('active'));
    if (btn) btn.classList.add('active');
  }
  window.renderU360LedgerTable(flowFilter);
};

window.renderU360LedgerTable = function(flowFilter = 'all') {
  const ledgerTbody = document.getElementById('u360-ledger-tbody');
  if (!ledgerTbody) return;
  const txs = window.u360Transactions || [];

  const filtered = txs.filter(t => {
    if (!flowFilter || flowFilter === 'all') return true;
    const isRef = t.category === 'refund' || Boolean(t.refund_campaign_id) || String(t.reason || '').toLowerCase().includes('refund');
    const isClientOut = t.category === 'allotment_out';
    const isDed = isClientOut || t.category === 'campaign_deduction' || (!isRef && (!t.is_credit || String(t.reason || '').toLowerCase().includes('deduction') || String(t.reason || '').toLowerCase().includes('debit')));

    if (flowFilter === 'refund') return isRef;
    if (flowFilter === 'campaign_deduction') return isDed;
    if (flowFilter === 'allotment') return !isRef && !isDed;
    return true;
  });

  window.currentFilteredUsers = filtered;

  if (filtered.length === 0) {
    ledgerTbody.innerHTML = `<tr>
      <td colspan="7" style="text-align:center;padding:32px;color:#64748b;">
        <i data-lucide="receipt" style="width:28px;height:28px;color:#94a3b8;margin-bottom:6px;"></i>
        <div style="font-weight:600;font-size:0.86rem;">No passbook transactions found under this category.</div>
        <div style="font-size:0.75rem;color:#94a3b8;margin-top:2px;">All allotments, client transfers, deductions and refunds are logged here.</div>
      </td>
    </tr>`;
    if (window.lucide) setTimeout(() => lucide.createIcons(), 20);
    return;
  }

  ledgerTbody.innerHTML = filtered.map(t => {
    const isRef = t.category === 'refund' || Boolean(t.refund_campaign_id) || String(t.reason || '').toLowerCase().includes('refund');
    const isClientOut = t.category === 'allotment_out';
    const isDed = !isRef && !isClientOut && (t.category === 'campaign_deduction' || !t.is_credit || String(t.reason || '').toLowerCase().includes('deduction') || String(t.reason || '').toLowerCase().includes('debit'));
    const amt = Math.abs(Number(t.amount) || 0);

    let amountBadge = '';
    let flowBadge = '';

    if (isRef) {
      amountBadge = `<span style="color:#0284c7;font-weight:700;background:#f0f9ff;padding:3px 8px;border-radius:6px;border:1px solid #bae6fd;">+${amt.toLocaleString()}</span>`;
      flowBadge = `<span class="status-badge" style="background:#f0f9ff;color:#0284c7;border:1px solid #bae6fd;font-size:0.72rem;font-weight:700;display:inline-flex;align-items:center;gap:3px;"><i data-lucide="rotate-ccw" style="width:11px;height:11px;"></i> Auto-Refund (+)</span>`;
    } else if (isClientOut) {
      amountBadge = `<span style="color:#b45309;font-weight:700;background:#fffbeb;padding:3px 8px;border-radius:6px;border:1px solid #fde68a;">-${amt.toLocaleString()}</span>`;
      flowBadge = `<span class="status-badge" style="background:#fffbeb;color:#b45309;border:1px solid #fde68a;font-size:0.72rem;font-weight:700;display:inline-flex;align-items:center;gap:3px;"><i data-lucide="arrow-up-right" style="width:11px;height:11px;"></i> Client Transfer (-)</span>`;
    } else if (isDed) {
      amountBadge = `<span style="color:#b91c1c;font-weight:700;background:#fef2f2;padding:3px 8px;border-radius:6px;border:1px solid #fecaca;">-${amt.toLocaleString()}</span>`;
      flowBadge = `<span class="status-badge" style="background:#fef2f2;color:#b91c1c;border:1px solid #fecaca;font-size:0.72rem;font-weight:700;display:inline-flex;align-items:center;gap:3px;"><i data-lucide="flame" style="width:11px;height:11px;"></i> Campaign Debit (-)</span>`;
    } else {
      amountBadge = `<span style="color:#15803d;font-weight:700;background:#ecfdf5;padding:3px 8px;border-radius:6px;border:1px solid #bbf7d0;">+${amt.toLocaleString()}</span>`;
      flowBadge = `<span class="status-badge" style="background:#ecfdf5;color:#15803d;border:1px solid #bbf7d0;font-size:0.72rem;font-weight:700;display:inline-flex;align-items:center;gap:3px;"><i data-lucide="arrow-down-left" style="width:11px;height:11px;"></i> Allotment (+)</span>`;
    }

    const rateNum = parseFloat(t.rate_inr || (t.destination === 'international' ? 2.50 : 0.15));
    const billedVal = amt * rateNum;

    let displayReason = String(t.reason || 'Credit allocation / adjustment');
    if (!currentUser || currentUser.role !== 'admin') {
      displayReason = displayReason
        .replace(/Allotted by (?:reseller|admin)\s*(?:\([^)]*\))?\s*:\s*/gi, 'Telecom Balance Allotment: ')
        .replace(/Deduction by (?:reseller|admin)\s*(?:\([^)]*\))?\s*:\s*/gi, 'Balance Adjustment: ')
        .replace(/\bby reseller\b/gi, 'via Telecom Gateway')
        .replace(/\[Created by [^\]]+ on behalf of account\]/gi, '');
    }

    let dateDisplay = '—';
    if (t.created_at) {
      try {
        const d = new Date(t.created_at);
        dateDisplay = d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) + ', ' + d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });
      } catch (e) {
        dateDisplay = String(t.created_at).slice(0, 16);
      }
    }

    const channelName = (t.credit_type === 'gsm_sms' ? 'GSM Bulk SMS' : (t.credit_type || 'NORMAL').toUpperCase());

    return `
      <tr style="border-bottom:1px solid #f1f5f9;transition:background 0.15s;" onmouseover="this.style.background='#f8fafc'" onmouseout="this.style.background='transparent'">
        <td style="font-size:0.8rem;color:#475569;white-space:nowrap;padding:10px 12px;font-weight:500;">
          ${escapeHtml(dateDisplay)}
        </td>
        <td style="padding:10px 12px;">${flowBadge}</td>
        <td style="padding:10px 12px;"><strong style="font-size:0.76rem;color:#334155;">${escapeHtml(channelName)}</strong></td>
        <td style="padding:10px 12px;"><span style="font-size:0.75rem;color:#64748b;text-transform:capitalize;font-weight:600;">${escapeHtml(t.destination || 'domestic')}</span></td>
        <td style="text-align:right;padding:10px 12px;white-space:nowrap;">
          ${amountBadge}
          <div style="font-size:0.65rem;color:#64748b;font-weight:700;margin-top:2px;">CREDITS</div>
        </td>
        <td style="text-align:right;padding:10px 12px;white-space:nowrap;">
          <strong style="color:#0f172a;font-size:0.84rem;font-family:monospace;">${isDed || isClientOut ? '-' : '+'}₹${billedVal.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong>
          <div style="font-size:0.65rem;color:#64748b;">@ ₹${rateNum.toFixed(4)}</div>
        </td>
        <td style="font-size:0.8rem;color:#475569;padding:10px 12px;max-width:320px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${escapeHtml(displayReason)}">
          ${escapeHtml(displayReason)}
        </td>
      </tr>
    `;
  }).join('');

  if (window.lucide) {
    try { lucide.createIcons({ root: ledgerTbody }); } catch (e) { lucide.createIcons(); }
  }
};

// --- USER 360 CUSTOM RATE CARD & PRICING CONTROLLER ---
const CHANNEL_RATE_DEFAULTS = [
  { key: 'gsm_sms', name: 'GSM Bulk SMS', icon: 'radio', defaultDom: 0.1200, defaultIntl: 0.2500, desc: 'SIM Gateway SMS (Single & Multi-line)' },
  { key: 'normal', name: 'WhatsApp Text (Normal)', icon: 'message-circle', defaultDom: 0.1500, defaultIntl: 0.3000, desc: 'Plain text & emoji WhatsApp message' },
  { key: 'dp', name: 'WhatsApp DP (Display Picture)', icon: 'image', defaultDom: 0.1800, defaultIntl: 0.3500, desc: 'Image attachment with caption' },
  { key: 'cta', name: 'WhatsApp CTA Button', icon: 'mouse-pointer', defaultDom: 0.2000, defaultIntl: 0.4000, desc: 'Interactive URL/Call action buttons' },
  { key: 'dp_cta', name: 'WhatsApp Combo (DP + CTA)', icon: 'layers', defaultDom: 0.2200, defaultIntl: 0.4500, desc: 'Rich media image + interactive buttons' },
  { key: 'own_number', name: 'Own Number Virtual Gateway', icon: 'smartphone', defaultDom: 0.0800, defaultIntl: 0.1800, desc: 'Client registered WhatsApp virtual sender' }
];

window.renderU360Rates = function(rates = {}) {
  const ratesTbody = document.getElementById('u360-rates-tbody');
  if (!ratesTbody) return;

  ratesTbody.innerHTML = CHANNEL_RATE_DEFAULTS.map(ch => {
    const domVal = (rates[`${ch.key}_domestic`] !== undefined && rates[`${ch.key}_domestic`] !== null) 
      ? parseFloat(rates[`${ch.key}_domestic`]) 
      : ch.defaultDom;
    const intlVal = (rates[`${ch.key}_international`] !== undefined && rates[`${ch.key}_international`] !== null) 
      ? parseFloat(rates[`${ch.key}_international`]) 
      : ch.defaultIntl;

    const isCustomDom = Math.abs(domVal - ch.defaultDom) > 0.0001;
    const isCustomIntl = Math.abs(intlVal - ch.defaultIntl) > 0.0001;

    return `
      <tr style="border-bottom:1px solid #f1f5f9;transition:background 0.15s;" onmouseover="this.style.background='#f8fafc'" onmouseout="this.style.background='transparent'">
        <td style="padding:10px 14px;">
          <div style="font-weight:700;color:var(--slate-800);display:flex;align-items:center;gap:6px;font-size:0.83rem;">
            <i data-lucide="${ch.icon}" style="width:14px;height:14px;color:#4f46e5;"></i>
            ${ch.name}
          </div>
          <div style="font-size:0.72rem;color:var(--slate-400);margin-top:2px;">${ch.desc}</div>
        </td>
        <td style="padding:10px 14px;color:#64748b;font-size:0.8rem;font-weight:600;">
          ₹${ch.defaultDom.toFixed(4)} <span style="font-size:0.7rem;color:#94a3b8;">(Dom)</span><br>
          <span style="font-size:0.75rem;color:#94a3b8;">₹${ch.defaultIntl.toFixed(4)} (Intl)</span>
        </td>
        <td style="padding:10px 14px;">
          <div style="display:flex;align-items:center;gap:6px;">
            <span style="font-weight:700;color:#64748b;font-size:0.8rem;">₹</span>
            <input type="number" step="0.0001" min="0" max="99" id="u360-rate-${ch.key}-domestic" value="${domVal.toFixed(4)}" style="width:105px;padding:5px 8px;font-size:0.82rem;font-weight:700;border:1px solid ${isCustomDom ? '#818cf8' : '#cbd5e1'};border-radius:6px;background:${isCustomDom ? '#f5f3ff' : '#ffffff'};color:#1e293b;" onchange="this.style.borderColor='#4f46e5';">
          </div>
        </td>
        <td style="padding:10px 14px;">
          <div style="display:flex;align-items:center;gap:6px;">
            <span style="font-weight:700;color:#64748b;font-size:0.8rem;">₹</span>
            <input type="number" step="0.0001" min="0" max="99" id="u360-rate-${ch.key}-international" value="${intlVal.toFixed(4)}" style="width:105px;padding:5px 8px;font-size:0.82rem;font-weight:700;border:1px solid ${isCustomIntl ? '#38bdf8' : '#cbd5e1'};border-radius:6px;background:${isCustomIntl ? '#f0f9ff' : '#ffffff'};color:#1e293b;" onchange="this.style.borderColor='#0284c7';">
          </div>
        </td>
        <td style="padding:10px 14px;">
          ${(isCustomDom || isCustomIntl) 
            ? '<span class="status-badge" style="background:#e0e7ff;color:#4338ca;border:1px solid #c7d2fe;font-size:0.7rem;font-weight:700;">Negotiated</span>' 
            : '<span class="status-badge" style="background:#f1f5f9;color:#64748b;border:1px solid #e2e8f0;font-size:0.7rem;">Default Base</span>'}
        </td>
      </tr>
    `;
  }).join('');

  if (window.lucide) {
    try { lucide.createIcons({ root: ratesTbody }); } catch (e) { lucide.createIcons(); }
  }
};

window.saveUser360Rates = async function() {
  if (!current360User || !current360User.id) {
    showToast('error', 'Error', 'No user selected.');
    return;
  }

  const btn = document.getElementById('btn-save-u360-rates');
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<i data-lucide="loader" style="width:13px;height:13px;"></i> Saving...';
  }

  const rates = {};
  CHANNEL_RATE_DEFAULTS.forEach(ch => {
    const domInp = document.getElementById(`u360-rate-${ch.key}-domestic`);
    const intlInp = document.getElementById(`u360-rate-${ch.key}-international`);
    if (domInp) rates[`${ch.key}_domestic`] = parseFloat(domInp.value) || ch.defaultDom;
    if (intlInp) rates[`${ch.key}_international`] = parseFloat(intlInp.value) || ch.defaultIntl;
  });

  try {
    const res = await apiFetch(`/users/${current360User.id}/rates`, {
      method: 'PATCH',
      body: JSON.stringify({ rates })
    });

    showToast('success', 'Rate Card Saved', `Negotiated rates updated successfully for ${current360User.email}.`);
    if (res && res.rates) {
      window.renderU360Rates(res.rates);
    }
  } catch (err) {
    showToast('error', 'Failed to Save Rates', err.message);
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = '<i data-lucide="check" style="width:13px;height:13px;"></i> Save Rate Card';
      if (window.lucide) lucide.createIcons({ root: btn });
    }
  }
};

window.triggerImpersonationFrom360 = function() {
  if (!current360User || !current360User.id) {
    showToast('warning', 'Impersonation', 'No user account currently loaded.');
    return;
  }
  const modal = document.getElementById('modal-user-360');
  if (modal) modal.style.display = 'none';
  window.impersonateUserAccount(current360User.id, current360User.email);
};

let current360User = null;

window.quickToggleTaxMode = async function() {
  if (!current360User) return;
  const newMode = current360User.taxMode === 'with_gst' ? 'non_gst' : 'with_gst';
  const label = newMode === 'with_gst' ? 'With GST (+18% B2B Tax Invoice)' : 'Non-GST (0% Retail Bill of Supply)';
  if (!confirm(`Switch tax mode for ${current360User.email} to:\n${label}?`)) return;

  try {
    await apiFetch(`/users/${current360User.id}/settings`, {
      method: 'PATCH',
      body: JSON.stringify({ tax_mode: newMode })
    });
    current360User.taxMode = newMode;
    showToast('success', 'Tax Invoicing Mode Updated', `Account is now configured as: ${label}`);
    
    const taxEl = document.getElementById('u360-info-tax-mode');
    if (taxEl) {
      taxEl.textContent = newMode === 'with_gst' ? 'With GST (+18%)' : 'Non-GST (0%)';
      taxEl.style.background = newMode === 'with_gst' ? '#eff6ff' : '#ecfdf5';
      taxEl.style.color = newMode === 'with_gst' ? '#1d4ed8' : '#065f46';
      taxEl.style.borderColor = newMode === 'with_gst' ? '#bfdbfe' : '#bbf7d0';
    }
    if (typeof loadUsers === 'function') loadUsers();
  } catch (err) {
    showToast('error', 'Update Failed', err.message);
  }
};

window.quickToggleRefundDestination = async function() {
  if (!current360User) return;
  const newDest = current360User.refundDestination === 'reseller' ? 'user' : 'reseller';
  const label = newDest === 'reseller' ? 'Route Refund to Reseller Wallet' : 'Refund to Client Wallet';
  const notice = newDest === 'reseller' 
    ? 'When routed to Reseller, refunds for undelivered messages are credited to your reseller stock. The client user will NOT see any refund notifications.'
    : 'When set to Client, refunds for undelivered messages are credited back to the client.';
  if (!confirm(`Switch auto-refund destination for ${current360User.email} to:\n${label}?\n\nNote: ${notice}`)) return;

  try {
    await apiFetch(`/users/${current360User.id}/settings`, {
      method: 'PATCH',
      body: JSON.stringify({ refund_destination: newDest })
    });
    current360User.refundDestination = newDest;
    showToast('success', 'Refund Rule Updated', `Auto-refunds will now go to: ${label}`);

    const destEl = document.getElementById('u360-info-refund-dest');
    if (destEl) {
      destEl.textContent = newDest === 'reseller' ? 'Reseller Wallet' : 'Client Wallet';
      destEl.style.background = newDest === 'reseller' ? '#fffbeb' : '#f0fdf4';
      destEl.style.color = newDest === 'reseller' ? '#b45309' : '#166534';
      destEl.style.borderColor = newDest === 'reseller' ? '#fde68a' : '#bbf7d0';
    }
    if (typeof loadUsers === 'function') loadUsers();
  } catch (err) {
    showToast('error', 'Update Failed', err.message);
  }
};

// INITIALIZE APP SESSION
checkSession();

// ============================================================
// GSM BULK SMS MODULE
// ============================================================

// --- GSM-7 Engine (mirrors backend services/telecom.js) ---
const GSM7_EXTENDED = new Set(['^', '{', '}', '\\', '[', '~', ']', '|', '€']);
const GSM7_REGEX = /^[A-Za-z0-9 \r\n@£$¥èéùìòÇØøÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ!"#¤%&'()*+,\-./:;<=>?¡¿ÄÖÑÜ§äöñüà\^{}\[~\]|€]*$/;

let smsManualEncoding = 'gsm7'; // 'gsm7' or 'unicode'

function computeSmsMetrics(text, forcedEncoding) {
  const content = String(text || '');
  const hasUnicodeChars = !GSM7_REGEX.test(content);
  const isUnicode = hasUnicodeChars || (forcedEncoding === 'unicode') || (smsManualEncoding === 'unicode');
  let effectiveLen = 0;
  if (isUnicode) {
    effectiveLen = Array.from(content).length;
  } else {
    for (const ch of content) effectiveLen += GSM7_EXTENDED.has(ch) ? 2 : 1;
  }
  let parts = 1;
  if (isUnicode) {
    // 3GPP Concatenation: 70 single, 67 multi
    parts = effectiveLen <= 70 ? (effectiveLen === 0 ? 0 : 1) : Math.ceil(effectiveLen / 67);
  } else {
    // 3GPP Concatenation: 160 single, 153 multi
    parts = effectiveLen <= 160 ? (effectiveLen === 0 ? 0 : 1) : Math.ceil(effectiveLen / 153);
  }
  let warning = null;
  if (parts >= 5) warning = `${parts} parts per number — carriers may throttle messages over 4 parts.`;
  return { effectiveLen, isUnicode, parts: parts || 1, warning, autoDetectedUnicode: hasUnicodeChars };
}

// --- State ---
let smsCampaignsData = [];
let smsFileNumbers = []; // numbers loaded from CSV/TXT file

// --- Composer Open/Close ---
window.onSmsDestChange = function(dest) {
  const destInput = document.getElementById('sms-destination');
  if (destInput) destInput.value = dest;
  const domLabel = document.getElementById('sms-dest-opt-dom');
  const intlLabel = document.getElementById('sms-dest-opt-intl');
  if (dest === 'domestic') {
    if (domLabel) {
      domLabel.style.border = '2px solid #6366f1';
      domLabel.style.background = '#eef2ff';
    }
    if (intlLabel) {
      intlLabel.style.border = '1.5px solid #cbd5e1';
      intlLabel.style.background = '#ffffff';
    }
  } else {
    if (intlLabel) {
      intlLabel.style.border = '2px solid #0284c7';
      intlLabel.style.background = '#f0f9ff';
    }
    if (domLabel) {
      domLabel.style.border = '1.5px solid #cbd5e1';
      domLabel.style.background = '#ffffff';
    }
  }
  updateSmsCreditsPreview();
};

window.onSmsEncodingToggle = function(enc) {
  smsManualEncoding = enc;
  onSmsMessageInput();
};

window.initSmsComposerView = function() {
  smsManualEncoding = 'gsm7';
  smsFileNumbers = [];
  const form = document.getElementById('form-compose-sms');
  if (form) form.reset();
  if (window.onSmsDestChange) window.onSmsDestChange('domestic');
  const errEl = document.getElementById('sms-form-error');
  if (errEl) errEl.style.display = 'none';
  const filePrev = document.getElementById('sms-file-preview');
  if (filePrev) filePrev.textContent = '';
  const warnEl = document.getElementById('sms-carrier-warning');
  if (warnEl) warnEl.style.display = 'none';
  const overlay = document.getElementById('sms-submitting-overlay');
  if (overlay) overlay.style.display = 'none';
  
  // Reset encoding radio
  const gsmRadio = document.querySelector('input[name="sms-compose-encoding"][value="gsm7"]');
  if (gsmRadio) gsmRadio.checked = true;

  onSmsMessageInput();
  updateSmsCreditsPreview();
  if (typeof populateComposerSelectors === 'function') {
    populateComposerSelectors();
  }

  // Admin: populate user selector
  const tug = document.getElementById('sms-target-user-group');
  const activeUser = currentUser || window.currentUser;
  if (activeUser && activeUser.role === 'admin') {
    if (tug) tug.style.display = 'block';
    populateSmsUserSelector();
  } else {
    if (tug) tug.style.display = 'none';
  }

  if (window.lucide) setTimeout(() => lucide.createIcons(), 50);
};

window.openSmsComposer = function() {
  switchView('view-sms-new');
};

window.closeSmsComposer = function() {
  const overlay = document.getElementById('sms-submitting-overlay');
  if (overlay) overlay.style.display = 'none';
  switchView('view-sms');
};

let smsAvailableUsers = [];

async function populateSmsUserSelector() {
  const sel = document.getElementById('sms-target-user');
  if (!sel) return;
  sel.innerHTML = '<option value="">— Select target beneficiary account —</option>';
  try {
    const data = await apiFetch('/users?limit=200');
    smsAvailableUsers = Array.isArray(data) ? data : (data.users || []);
    smsAvailableUsers.forEach(u => {
      const opt = document.createElement('option');
      opt.value = u.id;
      const bal = u.credits_gsm_sms_domestic || 0;
      opt.textContent = `${u.email} (${u.role}) — ${bal.toLocaleString()} GSM SMS credits`;
      sel.appendChild(opt);
    });
  } catch(e) { /* ignore */ }
}

window.onSmsTargetUserChange = function() {
  const sel = document.getElementById('sms-target-user');
  const pill = document.getElementById('sms-target-balance-pill');
  if (sel && pill) {
    if (sel.value && smsAvailableUsers.length > 0) {
      const u = smsAvailableUsers.find(x => Number(x.id) === Number(sel.value));
      if (u) {
        const bal = u.credits_gsm_sms_domestic || 0;
        pill.textContent = `Wallet: ${bal.toLocaleString()} SMS credits`;
        pill.style.background = '#dcfce7';
        pill.style.color = '#15803d';
        pill.style.borderColor = '#86efac';
      }
    } else {
      pill.textContent = 'Select Account to Verify Wallet';
      pill.style.background = '#e0e7ff';
      pill.style.color = '#3730a3';
      pill.style.borderColor = '#c7d2fe';
    }
  }
  updateSmsCreditsPreview();
};

// --- Live GSM counter ---
window.onSmsMessageInput = function() {
  const msgEl = document.getElementById('sms-message');
  const msg = msgEl ? msgEl.value : '';
  const { effectiveLen, isUnicode, parts, warning, autoDetectedUnicode } = computeSmsMetrics(msg);

  // Detect specific non-GSM characters causing Unicode
  const nonGsmChars = [];
  for (const ch of msg) {
    if (!GSM7_REGEX.test(ch) && !nonGsmChars.includes(ch)) {
      nonGsmChars.push(ch);
    }
  }

  const hintEl = document.getElementById('sms-unicode-hint');
  const hintTextEl = document.getElementById('sms-unicode-hint-text');
  if (hintEl && hintTextEl) {
    if (nonGsmChars.length > 0) {
      hintEl.style.display = 'flex';
      const formattedChars = nonGsmChars.map(c => `<code>${escapeHtml(c)}</code>`).join(' ');
      hintTextEl.innerHTML = `Non-GSM characters detected: ${formattedChars}. In cellular GSM telecom, these characters force <strong>Unicode encoding (75 chars/part)</strong>.`;
      if (window.lucide) lucide.createIcons();
    } else {
      hintEl.style.display = 'none';
    }
  }

  // If text has unicode characters, automatically reflect in manual selector state
  if (autoDetectedUnicode) {
    smsManualEncoding = 'unicode';
    const uniRadio = document.querySelector('input[name="sms-compose-encoding"][value="unicode"]');
    if (uniRadio) uniRadio.checked = true;
  }

  // Update visual state of radio labels
  const gsmLbl = document.getElementById('sms-compose-enc-gsm-lbl');
  const uniLbl = document.getElementById('sms-compose-enc-uni-lbl');
  if (gsmLbl && uniLbl) {
    if (isUnicode) {
      gsmLbl.style.borderColor = '#cbd5e1';
      gsmLbl.style.background = '#ffffff';
      uniLbl.style.borderColor = '#d97706';
      uniLbl.style.background = '#fffbeb';
    } else {
      gsmLbl.style.borderColor = '#16a34a';
      gsmLbl.style.background = '#f0fdf4';
      uniLbl.style.borderColor = '#cbd5e1';
      uniLbl.style.background = '#ffffff';
    }
  }

  const charEl = document.getElementById('sms-char-count');
  if (charEl) charEl.textContent = effectiveLen;
  const encLabel = document.getElementById('sms-encoding-label');
  if (encLabel) {
    encLabel.textContent = isUnicode ? 'Unicode (70 single / 67 multi chars)' : 'GSM-7 (160 single / 153 multi chars)';
    encLabel.style.color = isUnicode ? '#d97706' : '#10b981';
  }
  const partsEl = document.getElementById('sms-parts-count');
  if (partsEl) partsEl.textContent = parts;
  const credEl = document.getElementById('sms-cred-per-num');
  if (credEl) credEl.textContent = parts;
  const warnEl = document.getElementById('sms-carrier-warning');
  if (warnEl) {
    if (warning) { warnEl.textContent = warning; warnEl.style.display = 'inline'; }
    else { warnEl.style.display = 'none'; }
  }

  // Update live mobile phone screen preview
  const phoneText = document.getElementById('sms-phone-preview-text');
  if (phoneText) {
    phoneText.textContent = msg || 'Your SMS broadcast message will appear here in real time as you compose...';
  }
  const phoneMeta = document.getElementById('sms-phone-preview-meta');
  if (phoneMeta) {
    phoneMeta.textContent = `${effectiveLen} chars • ${parts} part${parts > 1 ? 's' : ''} • ${isUnicode ? 'Unicode' : 'GSM-7'}`;
  }

  updateSmsCreditsPreview();
};

window.cleanSmsTextToGsm = function() {
  const textarea = document.getElementById('sms-message');
  if (!textarea) return;
  let text = textarea.value;
  // Replace Rupee symbol with Rs.
  text = text.replace(/₹/g, 'Rs.');
  // Replace en-dash, em-dash with standard hyphen
  text = text.replace(/[\u2013\u2014]/g, '-');
  // Replace smart quotes with standard ASCII quotes
  text = text.replace(/[\u201C\u201D\u201E\u201F]/g, '"');
  text = text.replace(/[\u2018\u2019\u201A\u201B]/g, "'");
  // Replace non-breaking spaces with normal space
  text = text.replace(/\u00A0/g, ' ');
  // Replace ellipsis
  text = text.replace(/\u2026/g, '...');
  
  textarea.value = text;
  smsManualEncoding = 'gsm7';
  const gsmRadio = document.querySelector('input[name="sms-compose-encoding"][value="gsm7"]');
  if (gsmRadio) gsmRadio.checked = true;
  window.onSmsMessageInput();
  if (window.showToast) {
    showToast('success', 'Converted to GSM-7!', 'Replaced non-GSM symbols (₹ → Rs., – → -). Message is now GSM-7 (160 chars/part)!');
  }
};

// --- Parse numbers from textarea ---
function parseSmsNumbers(raw) {
  return [...new Set(
    raw.split(/[\n,]+/)
      .map(n => n.trim().replace(/\s+/g, ''))
      .filter(n => n.length >= 7 && /\d{7,}/.test(n))
  )];
}

// --- File select handler ---
window.onSmsFileSelect = function() {
  const fileInput = document.getElementById('sms-numbers-file');
  const preview = document.getElementById('sms-file-preview');
  smsFileNumbers = [];
  if (!fileInput.files || !fileInput.files[0]) { preview.textContent = ''; updateSmsCreditsPreview(); return; }
  const file = fileInput.files[0];
  const reader = new FileReader();
  reader.onload = function(e) {
    const raw = e.target.result;
    smsFileNumbers = parseSmsNumbers(raw);
    preview.innerHTML = `<i data-lucide="file-check" style="width:13px;height:13px;color:#4f46e5;display:inline-block;vertical-align:-1px;margin-right:4px;"></i> File loaded: ${smsFileNumbers.length.toLocaleString()} numbers found`;
    if (window.lucide) setTimeout(() => lucide.createIcons(), 20);
    updateSmsCreditsPreview();
  };
  reader.readAsText(file);
};

// --- Credit estimate ---
window.updateSmsCreditsPreview = function() {
  const parts = parseInt(document.getElementById('sms-parts-count').textContent) || 1;
  const textNumbers = parseSmsNumbers(document.getElementById('sms-numbers').value || '');
  const allNumbers = smsFileNumbers.length > 0 ? smsFileNumbers : textNumbers;
  const numCount = allNumbers.length;
  const totalCost = numCount * parts;
  document.getElementById('sms-est-numbers').textContent = numCount.toLocaleString();
  document.getElementById('sms-est-parts').textContent = parts;
  document.getElementById('sms-est-total-credits').textContent = totalCost.toLocaleString();

  const dest = document.getElementById('sms-destination') ? document.getElementById('sms-destination').value : 'domestic';
  
  // Check if proxy target user is selected by Admin/Reseller
  let userBal = 0;
  let accountLabel = 'Available';
  const activeUser = currentUser || window.currentUser;
  const destination = document.getElementById('sms-destination')?.value || 'domestic';
  const targetSel = document.getElementById('sms-target-user');
  if (targetSel && targetSel.value && smsAvailableUsers.length > 0) {
    const targetId = parseInt(targetSel.value, 10);
    const foundUser = smsAvailableUsers.find(u => Number(u.id) === targetId);
    if (foundUser) {
      userBal = destination === 'international'
        ? Number(foundUser.credits_gsm_sms_international || 0)
        : Number(foundUser.credits_gsm_sms_domestic || 0);
      accountLabel = `${foundUser.email.split('@')[0]} Available`;
    }
  } else if (activeUser) {
    userBal = destination === 'international'
      ? Number(activeUser.credits_gsm_sms_international || 0)
      : Number(activeUser.credits_gsm_sms_domestic || 0);
  }

  const balCheckEl = document.getElementById('sms-est-balance-check');
  if (balCheckEl) {
    if (userBal >= totalCost) {
      balCheckEl.innerHTML = `<span style="color:#059669;font-weight:700;margin-left:8px;display:inline-flex;align-items:center;gap:4px;"><i data-lucide="check-circle" style="width:14px;height:14px;"></i> ${accountLabel}: ${userBal.toLocaleString()} credits</span>`;
    } else {
      balCheckEl.innerHTML = `<span style="color:#dc2626;font-weight:700;margin-left:8px;display:inline-flex;align-items:center;gap:4px;"><i data-lucide="alert-circle" style="width:14px;height:14px;"></i> Insufficient: ${accountLabel} has ${userBal.toLocaleString()} credits (need ${totalCost.toLocaleString()})</span>`;
    }
    if (window.lucide) setTimeout(() => lucide.createIcons(), 20);
  }
};

// --- Submit ---
window.submitSmsCampaign = async function(e) {
  e.preventDefault();
  const errEl = document.getElementById('sms-form-error');
  const btn = document.getElementById('sms-submit-btn');
  errEl.style.display = 'none';

  const title = document.getElementById('sms-title').value.trim();
  const destination = document.getElementById('sms-destination').value;
  const message = document.getElementById('sms-message').value.trim();
  const scheduledAt = document.getElementById('sms-scheduled-at').value;
  const targetUserId = document.getElementById('sms-target-user') ? document.getElementById('sms-target-user').value : '';

  const textNumbers = parseSmsNumbers(document.getElementById('sms-numbers').value || '');
  const allNumbers = smsFileNumbers.length > 0 ? smsFileNumbers : textNumbers;

  if (!title) { errEl.textContent = 'Campaign title required.'; errEl.style.display = 'block'; return; }
  if (!message) { errEl.textContent = 'Message text required.'; errEl.style.display = 'block'; return; }
  if (allNumbers.length === 0) { errEl.textContent = 'At least one valid phone number required.'; errEl.style.display = 'block'; return; }
  const activeSubmitUser = currentUser || window.currentUser;
  if (activeSubmitUser && activeSubmitUser.role === 'admin' && !targetUserId) {
    errEl.textContent = 'Admin must select a target user account.'; errEl.style.display = 'block'; return;
  }

  btn.disabled = true;
  btn.innerHTML = '<i data-lucide="loader-2" style="width:15px;height:15px;animation:spin 1s linear infinite;"></i> Submitting...';
  if (window.lucide) lucide.createIcons();

  // Show High-Volume Submitting Overlay with Smooth Animations
  const overlay = document.getElementById('sms-submitting-overlay');
  const overlayTitle = document.getElementById('sms-overlay-title');
  const overlayDesc = document.getElementById('sms-overlay-desc');
  const overlayStep = document.getElementById('sms-overlay-status-step');
  const overlayIcon = document.getElementById('sms-overlay-icon');

  if (overlay) {
    overlay.style.display = 'flex';
    if (overlayTitle) overlayTitle.textContent = 'Queueing SMS Broadcast...';
    if (overlayDesc) overlayDesc.textContent = `Verifying ${allNumbers.length.toLocaleString()} recipients, filtering DND blacklist & locking credits...`;
    if (overlayStep) {
      overlayStep.textContent = 'Uploading Recipient List & Processing Handshake...';
      overlayStep.style.background = '#eef2ff';
      overlayStep.style.color = '#4f46e5';
      overlayStep.style.borderColor = '#c7d2fe';
    }
    if (overlayIcon) {
      overlayIcon.setAttribute('data-lucide', 'radio');
      overlayIcon.style.animation = 'pulseSubtle 1.8s ease-in-out infinite';
    }
    if (window.lucide) lucide.createIcons({ root: overlay });
  }

  let stepIdx = 0;
  const steps = [
    'Parsing & verifying recipient numbers...',
    'Checking DND Blacklist registry...',
    'Deducting credits & allocating gateway batch slots...',
    'Finalizing carrier dispatch queue...'
  ];
  const stepTimer = setInterval(() => {
    stepIdx = (stepIdx + 1) % steps.length;
    if (overlayStep) overlayStep.textContent = steps[stepIdx];
  }, 1200);

  try {
    const payload = {
      title,
      destination,
      message,
      numbers: allNumbers.join('\n'),
    };
    if (scheduledAt) payload.scheduled_at = scheduledAt;
    if (targetUserId) payload.target_user_id = targetUserId;

    const data = await apiFetch('/sms', {
      method: 'POST',
      body: JSON.stringify(payload)
    });

    clearInterval(stepTimer);

    // Success State animation in overlay
    if (overlay) {
      if (overlayTitle) overlayTitle.innerHTML = '<i data-lucide="check-circle" style="width:22px;height:22px;color:#10b981;display:inline-block;vertical-align:-4px;margin-right:6px;"></i> Campaign Queued Successfully!';
      if (overlayDesc) overlayDesc.textContent = `${(data.total_numbers || allNumbers.length).toLocaleString()} recipients successfully queued for dispatch.`;
      if (overlayStep) {
        overlayStep.textContent = 'Ready for Carrier Broadcast';
        overlayStep.style.background = '#ecfdf5';
        overlayStep.style.color = '#059669';
        overlayStep.style.borderColor = '#a7f3d0';
      }
      if (overlayIcon) {
        overlayIcon.setAttribute('data-lucide', 'check-circle-2');
        overlayIcon.style.animation = 'none';
      }
      if (window.lucide) lucide.createIcons({ root: overlay });
    }

    await new Promise(r => setTimeout(r, 650));

    closeSmsComposer();
    showToast('success', 'SMS Campaign Submitted', `Campaign "${title}" submitted! ${data.total_numbers ? data.total_numbers.toLocaleString() : ''} numbers queued.`);
    loadSmsCampaigns();
  } catch(err) {
    clearInterval(stepTimer);
    if (overlay) overlay.style.display = 'none';
    errEl.textContent = err.message;
    errEl.style.display = 'block';
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<i data-lucide="send" style="width:16px;height:16px;"></i> Dispatch SMS Campaign';
    if (window.lucide) lucide.createIcons();
  }
};

smsCampaignsData = [];
let currentSmsStatusFilter = 'all';
let currentSmsDateFilter = 'all';
let currentSmsFormatFilter = 'all';
let currentSmsDlrFilter = 'all';
let smsCurrentPage = 1;
let smsPageSize = 25;

window.setSmsStatusFilter = function(status, btn) {
  currentSmsStatusFilter = status;
  const container = document.getElementById('sms-status-filter-pills');
  if (container) {
    container.querySelectorAll('.tab-pill').forEach(p => p.classList.remove('active'));
  }
  if (btn) btn.classList.add('active');
  smsCurrentPage = 1;
  filterSmsCampaigns();
};

window.onSmsDateFilterChange = function() {
  const sel = document.getElementById('sms-date-filter');
  currentSmsDateFilter = sel ? sel.value : 'all';
  const customBox = document.getElementById('sms-custom-date-box');
  if (customBox) {
    customBox.style.display = currentSmsDateFilter === 'custom' ? 'inline-flex' : 'none';
  }
  smsCurrentPage = 1;
  filterSmsCampaigns();
};

window.clearSmsCustomDate = function() {
  const fromEl = document.getElementById('sms-from-date');
  const toEl = document.getElementById('sms-to-date');
  if (fromEl) fromEl.value = '';
  if (toEl) toEl.value = '';
  const sel = document.getElementById('sms-date-filter');
  if (sel) sel.value = 'all';
  currentSmsDateFilter = 'all';
  const customBox = document.getElementById('sms-custom-date-box');
  if (customBox) customBox.style.display = 'none';
  smsCurrentPage = 1;
  filterSmsCampaigns();
};

window.onSmsPageSizeChange = function() {
  const sel = document.getElementById('sms-page-size');
  const val = sel ? sel.value : '25';
  smsPageSize = val === 'all' ? 'all' : (parseInt(val, 10) || 25);
  smsCurrentPage = 1;
  renderSmsCampaignsTable();
};

window.setSmsPage = function(p) {
  smsCurrentPage = p;
  renderSmsCampaignsTable();
};

window.resetSmsFilters = function() {
  const searchInput = document.getElementById('sms-search-input');
  if (searchInput) searchInput.value = '';

  const dateSel = document.getElementById('sms-date-filter');
  if (dateSel) dateSel.value = 'all';
  currentSmsDateFilter = 'all';

  const customBox = document.getElementById('sms-custom-date-box');
  if (customBox) customBox.style.display = 'none';
  const fromEl = document.getElementById('sms-from-date');
  const toEl = document.getElementById('sms-to-date');
  if (fromEl) fromEl.value = '';
  if (toEl) toEl.value = '';

  const fmtSel = document.getElementById('sms-format-filter');
  if (fmtSel) fmtSel.value = 'all';

  const dlrSel = document.getElementById('sms-dlr-filter');
  if (dlrSel) dlrSel.value = 'all';

  const userSel = document.getElementById('sms-user-filter');
  if (userSel) userSel.value = '';

  const resSel = document.getElementById('sms-reseller-filter');
  if (resSel) resSel.value = '';

  currentSmsStatusFilter = 'all';
  const container = document.getElementById('sms-status-filter-pills');
  if (container) {
    container.querySelectorAll('.tab-pill').forEach((p, idx) => {
      if (idx === 0) p.classList.add('active');
      else p.classList.remove('active');
    });
  }

  smsCurrentPage = 1;
  filterSmsCampaigns();
  showToast('info', 'Filters Cleared', 'All SMS broadcast filters have been reset.');
};

window.filterSmsCampaigns = function() {
  renderSmsCampaignsTable();
};

// --- Load SMS Campaigns ---
window.loadSmsCampaigns = async function() {
  const tbody = document.getElementById('sms-campaigns-tbody');
  if (!tbody) return;
  if (!smsCampaignsData || smsCampaignsData.length === 0) {
    if (typeof window.renderTableSkeleton === 'function') {
      window.renderTableSkeleton(tbody, 8, 3);
    }
  }

  // Always sync fresh user balance in background
  try {
    const me = await apiFetch('/auth/me');
    if (me) {
      currentUser = me;
      window.currentUser = me;
      updateCreditDisplays();
    }
  } catch(e) {}

  try {
    const data = await apiFetch('/sms');
    smsCampaignsData = Array.isArray(data) ? data : (data.campaigns || []);

    // Setup Reseller & User Filters for Admin & Reseller
    const isAdmin = currentUser && currentUser.role === 'admin';
    const isReseller = currentUser && currentUser.role === 'reseller';

    const resellerFilter = document.getElementById('sms-reseller-filter');
    if (resellerFilter) {
      if (isAdmin) {
        resellerFilter.style.display = 'inline-block';
        const resellersMap = new Map();
        smsCampaignsData.forEach(c => {
          if (c.reseller_id && (c.reseller_email || c.reseller_name)) {
            resellersMap.set(String(c.reseller_id), c.reseller_name ? `${c.reseller_name} (${c.reseller_email})` : c.reseller_email);
          }
        });
        const curResVal = resellerFilter.value;
        let resOptions = '<option value="">All Resellers</option>';
        resellersMap.forEach((label, id) => {
          resOptions += `<option value="${id}">${escHtml(label)}</option>`;
        });
        resellerFilter.innerHTML = resOptions;
        if (resellersMap.has(curResVal)) resellerFilter.value = curResVal;
      } else {
        resellerFilter.style.display = 'none';
      }
    }

    const userFilter = document.getElementById('sms-user-filter');
    if (userFilter) {
      if (isAdmin || isReseller) {
        userFilter.style.display = 'inline-block';
        const ownersMap = new Map();
        smsCampaignsData.forEach(c => {
          if (c.owner_email) {
            const label = c.owner_company ? `${c.owner_email} (${c.owner_company})` : (c.owner_name ? `${c.owner_name} (${c.owner_email})` : c.owner_email);
            ownersMap.set(c.owner_email, label);
          }
        });
        const currentVal = userFilter.value;
        let uOptions = '<option value="">All Accounts</option>';
        ownersMap.forEach((label, email) => {
          uOptions += `<option value="${escHtml(email)}">${escHtml(label)}</option>`;
        });
        userFilter.innerHTML = uOptions;
        if (ownersMap.has(currentVal)) {
          userFilter.value = currentVal;
        }
      } else {
        userFilter.style.display = 'none';
      }
    }

    // Update KPIs from real backend enriched data
    const total = smsCampaignsData.length;
    const totalNumbers = smsCampaignsData.reduce((s, c) => s + (parseInt(c.total_numbers, 10) || 0), 0);
    const totalCredits = smsCampaignsData.reduce((s, c) => s + (parseInt(c.credits_used, 10) || 0), 0);
    const completed = smsCampaignsData.filter(c => c.status === 'Completed' || c.status === 'Report Updated').length;

    const totalEl = document.getElementById('sms-kpi-total');
    if (totalEl) totalEl.textContent = total.toLocaleString();
    const numbersEl = document.getElementById('sms-kpi-numbers');
    if (numbersEl) numbersEl.textContent = totalNumbers.toLocaleString();
    const credEl = document.getElementById('sms-kpi-credits');
    if (credEl) credEl.textContent = totalCredits.toLocaleString();
    const compEl = document.getElementById('sms-kpi-completed');
    if (compEl) compEl.textContent = completed.toLocaleString();

    const activeUser = currentUser || window.currentUser;
    const balEl = document.getElementById('sms-kpi-balance');
    if (balEl && activeUser) {
      const smsBal = Number(activeUser.credits_gsm_sms_domestic || 0);
      balEl.textContent = smsBal.toLocaleString();
    }

    updateSmsFilterCounts();
    renderSmsCampaignsTable();
  } catch(err) {
    tbody.innerHTML = `<tr><td colspan="10" style="text-align:center;padding:40px;color:var(--danger);">Error: ${escHtml(err.message)}</td></tr>`;
  }
};

function updateSmsFilterCounts() {
  const now = new Date();
  const counts = {
    all: smsCampaignsData.length,
    submitted: 0,
    approved: 0,
    completed: 0,
    reported: 0,
    scheduled: 0,
    rejected: 0
  };

  smsCampaignsData.forEach(c => {
    const isScheduledFuture = Boolean(c.scheduled_at && new Date(c.scheduled_at) > now);
    if (isScheduledFuture) counts.scheduled++;

    if (c.status === 'Report Updated') counts.reported++;
    else if (c.status === 'Completed') counts.completed++;
    else if (c.status === 'Approved') counts.approved++;
    else if (c.status === 'Submitted') {
      if (!isScheduledFuture) counts.submitted++;
    } else if (c.status === 'Rejected') counts.rejected++;
  });

  const setCnt = (id, val) => {
    const el = document.getElementById(id);
    if (el) el.textContent = val.toLocaleString();
  };
  setCnt('sms-cnt-all', counts.all);
  setCnt('sms-cnt-submitted', counts.submitted);
  setCnt('sms-cnt-approved', counts.approved);
  setCnt('sms-cnt-completed', counts.completed);
  setCnt('sms-cnt-reported', counts.reported);
  setCnt('sms-cnt-scheduled', counts.scheduled);
  setCnt('sms-cnt-rejected', counts.rejected);
}

function getFilteredSmsCampaigns() {
  const now = new Date();
  const q = (document.getElementById('sms-search-input')?.value || '').toLowerCase().trim();
  const selectedUser = (document.getElementById('sms-user-filter')?.value || '').trim();
  const selectedReseller = (document.getElementById('sms-reseller-filter')?.value || '').trim();
  const formatFilter = document.getElementById('sms-format-filter')?.value || 'all';
  const dlrFilter = document.getElementById('sms-dlr-filter')?.value || 'all';
  const fromDateVal = document.getElementById('sms-from-date')?.value;
  const toDateVal = document.getElementById('sms-to-date')?.value;

  return smsCampaignsData.filter(c => {
    const isScheduledFuture = Boolean(c.scheduled_at && new Date(c.scheduled_at) > now);

    // 1. Status Filter
    if (currentSmsStatusFilter === 'Scheduled') {
      if (!isScheduledFuture) return false;
    } else if (currentSmsStatusFilter === 'Submitted') {
      if (c.status !== 'Submitted' || isScheduledFuture) return false;
    } else if (currentSmsStatusFilter !== 'all') {
      if (c.status !== currentSmsStatusFilter) return false;
    }

    // 2. Account Filter
    if (selectedUser && c.owner_email !== selectedUser) return false;

    // 3. Reseller Filter (Admin only)
    if (selectedReseller && String(c.reseller_id) !== selectedReseller) return false;

    // 4. Message Format / Encoding Filter
    const parts = c.sms_parts || 1;
    if (formatFilter === 'single' && (parts > 1 || c.is_unicode)) return false;
    if (formatFilter === 'multi' && parts <= 1) return false;
    if (formatFilter === 'unicode' && !c.is_unicode) return false;
    if (formatFilter === 'gsm7' && c.is_unicode) return false;

    // 5. DLR Outcome Filter
    const deliv = parseInt(c.delivered_count, 10) || 0;
    const failed = parseInt(c.failed_count, 10) || 0;
    const totalNums = parseInt(c.total_numbers, 10) || 0;

    if (dlrFilter === 'reported' && c.status !== 'Report Updated') return false;
    if (dlrFilter === 'dispatched' && c.status !== 'Completed') return false;
    if (dlrFilter === 'perfect') {
      if (c.status !== 'Report Updated' || failed > 0 || deliv === 0) return false;
    }
    if (dlrFilter === 'failures') {
      if (failed <= 0) return false;
    }

    // 6. Date Filter
    if (currentSmsDateFilter !== 'all' && c.created_at) {
      const cDate = new Date(c.created_at);
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      if (currentSmsDateFilter === 'today') {
        if (cDate < today) return false;
      } else if (currentSmsDateFilter === 'yesterday') {
        const yesterday = new Date(today);
        yesterday.setDate(yesterday.getDate() - 1);
        if (cDate < yesterday || cDate >= today) return false;
      } else if (currentSmsDateFilter === 'last7') {
        const sevenDaysAgo = new Date(today);
        sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
        if (cDate < sevenDaysAgo) return false;
      } else if (currentSmsDateFilter === 'thisMonth') {
        const firstOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
        if (cDate < firstOfMonth) return false;
      } else if (currentSmsDateFilter === 'custom') {
        if (fromDateVal) {
          const fromD = new Date(fromDateVal);
          fromD.setHours(0, 0, 0, 0);
          if (cDate < fromD) return false;
        }
        if (toDateVal) {
          const toD = new Date(toDateVal);
          toD.setHours(23, 59, 59, 999);
          if (cDate > toD) return false;
        }
      }
    }

    // 7. Full-text Search
    if (q) {
      const cleanQ = q.replace(/^#/, '');
      const matchId = String(c.id).includes(cleanQ);
      const matchTitle = (c.title || '').toLowerCase().includes(q);
      const matchText = (c.message_text || '').toLowerCase().includes(q);
      const matchEmail = (c.owner_email || '').toLowerCase().includes(q);
      const matchName = (c.owner_name || '').toLowerCase().includes(q);
      const matchComp = (c.owner_company || '').toLowerCase().includes(q);
      const matchPhone = (c.owner_phone || '').toLowerCase().includes(q);
      if (!matchId && !matchTitle && !matchText && !matchEmail && !matchName && !matchComp && !matchPhone) return false;
    }

    return true;
  });
}

function renderSmsCampaignsTable() {
  const tbody = document.getElementById('sms-campaigns-tbody');
  if (!tbody) return;

  const filtered = getFilteredSmsCampaigns();

  // Update Summary Counts
  const filterCountEl = document.getElementById('sms-filtered-count');
  const filterNumbersEl = document.getElementById('sms-filtered-numbers');
  const filterCreditsEl = document.getElementById('sms-filtered-credits');
  const totNums = filtered.reduce((s, c) => s + (parseInt(c.total_numbers, 10) || 0), 0);
  const totCreds = filtered.reduce((s, c) => s + (parseInt(c.credits_used, 10) || 0), 0);

  if (filterCountEl) filterCountEl.textContent = filtered.length.toLocaleString();
  if (filterNumbersEl) filterNumbersEl.textContent = totNums.toLocaleString();
  if (filterCreditsEl) filterCreditsEl.textContent = totCreds.toLocaleString();

  // Pagination Elements
  const pageInfoEl = document.getElementById('sms-pagination-info');
  const pagesContainer = document.getElementById('sms-pagination-controls');

  if (filtered.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="10" style="text-align: center; padding: 48px 20px;">
          <div style="display: inline-flex; flex-direction: column; align-items: center; justify-content: center; max-width: 360px;">
            <div style="width: 52px; height: 52px; border-radius: 50%; background: #f1f5f9; color: #94a3b8; display: flex; align-items: center; justify-content: center; margin-bottom: 12px;">
              <i data-lucide="radio" style="width: 24px; height: 24px;"></i>
            </div>
            <div style="font-size: 1rem; font-weight: 700; color: #1e293b; margin-bottom: 4px;">No Broadcasts Found</div>
            <div style="font-size: 0.8rem; color: #64748b; line-height: 1.45; margin-bottom: 16px;">
              No SMS broadcasts match your current search criteria or date filters.
            </div>
            <button type="button" class="btn-action btn-action-secondary" onclick="resetSmsFilters()" style="font-size: 0.8rem; padding: 6px 14px;">
              Clear Filters
            </button>
          </div>
        </td>
      </tr>
    `;
    if (pageInfoEl) pageInfoEl.innerHTML = 'Showing <strong>0</strong> of <strong>0</strong> broadcasts';
    if (pagesContainer) pagesContainer.innerHTML = '';
    if (window.lucide) setTimeout(() => lucide.createIcons(), 50);
    return;
  }

  // Handle Pagination
  const totalCount = filtered.length;
  let paged = filtered;

  if (smsPageSize !== 'all') {
    const size = parseInt(smsPageSize, 10) || 25;
    const totalPages = Math.ceil(totalCount / size) || 1;
    if (smsCurrentPage > totalPages) smsCurrentPage = totalPages;
    if (smsCurrentPage < 1) smsCurrentPage = 1;

    const startIdx = (smsCurrentPage - 1) * size;
    paged = filtered.slice(startIdx, startIdx + size);

    if (pageInfoEl) {
      const endIdx = Math.min(startIdx + paged.length, totalCount);
      pageInfoEl.innerHTML = `Showing <strong>${startIdx + 1}–${endIdx}</strong> of <strong>${totalCount}</strong> broadcasts`;
    }

    if (pagesContainer) {
      let pageBtns = '';
      if (totalPages > 1) {
        pageBtns += `<button type="button" class="btn-action btn-action-secondary" ${smsCurrentPage === 1 ? 'disabled style="opacity:0.4;cursor:not-allowed;"' : 'onclick="setSmsPage(' + (smsCurrentPage - 1) + ')"'} style="padding:4px 8px;font-size:0.75rem;">Prev</button>`;
        for (let p = 1; p <= totalPages; p++) {
          if (p === 1 || p === totalPages || (p >= smsCurrentPage - 1 && p <= smsCurrentPage + 1)) {
            const activeStyle = p === smsCurrentPage ? 'background:#4f46e5;color:#fff;font-weight:700;border-color:#4f46e5;' : '';
            pageBtns += `<button type="button" class="btn-action btn-action-secondary" onclick="setSmsPage(${p})" style="padding:4px 9px;font-size:0.75rem;min-width:28px;${activeStyle}">${p}</button>`;
          } else if (p === smsCurrentPage - 2 || p === smsCurrentPage + 2) {
            pageBtns += `<span style="padding:0 3px;color:var(--slate-400);font-size:0.75rem;">...</span>`;
          }
        }
        pageBtns += `<button type="button" class="btn-action btn-action-secondary" ${smsCurrentPage === totalPages ? 'disabled style="opacity:0.4;cursor:not-allowed;"' : 'onclick="setSmsPage(' + (smsCurrentPage + 1) + ')"'} style="padding:4px 8px;font-size:0.75rem;">Next</button>`;
      }
      pagesContainer.innerHTML = pageBtns;
    }
  } else {
    if (pageInfoEl) pageInfoEl.innerHTML = `Showing all <strong>${totalCount}</strong> broadcasts`;
    if (pagesContainer) pagesContainer.innerHTML = '';
  }

  const isAdmin = currentUser && currentUser.role === 'admin';
  const now = new Date();

  tbody.innerHTML = paged.map(c => {
    const isScheduledFuture = Boolean(c.scheduled_at && new Date(c.scheduled_at) > now);
    const scheduledDisplay = c.scheduled_at ? new Date(c.scheduled_at).toLocaleString('en-IN', { dateStyle: 'short', timeStyle: 'short' }) : '—';
    const createdDisplay = c.created_at ? new Date(c.created_at).toLocaleString('en-IN', { dateStyle: 'short', timeStyle: 'short' }) : '—';
    const parts = c.sms_parts || 1;
    const totalNums = parseInt(c.total_numbers, 10) || 0;
    const creditsUsed = c.credits_used !== undefined ? c.credits_used : (totalNums * parts);
    const deliv = parseInt(c.delivered_count, 10) || 0;
    const failed = parseInt(c.failed_count, 10) || 0;
    const rate = c.delivery_rate || (totalNums > 0 && (deliv + failed > 0) ? Math.min(100, Math.round((deliv / totalNums) * 1000) / 10) : 0);

    const canDelete = c.status === 'Submitted' && !isScheduledFuture;

    // Delivery Progress / DLR Column HTML
    let deliveryColHtml = '';
    if (c.status === 'Report Updated') {
      deliveryColHtml = `
        <div>
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:3px;">
            <span style="font-weight:700;font-size:0.78rem;color:#15803d;display:inline-flex;align-items:center;gap:3px;">
              <i data-lucide="check-circle" style="width:12px;height:12px;"></i> ${rate}% Delivered
            </span>
            <span style="font-size:0.7rem;color:#64748b;">${deliv.toLocaleString()} / ${totalNums.toLocaleString()}</span>
          </div>
          <div style="width:100%;height:6px;background:#fee2e2;border-radius:10px;overflow:hidden;display:flex;">
            <div style="width:${rate}%;height:100%;background:#16a34a;border-radius:10px;"></div>
          </div>
          ${failed > 0 ? `<div style="font-size:0.68rem;color:#b91c1c;margin-top:2px;">${failed.toLocaleString()} failed • auto-refunded</div>` : ''}
        </div>
      `;
    } else if (c.status === 'Completed') {
      deliveryColHtml = `
        <div>
          <span style="background:#e0f2fe;color:#0369a1;border:1px solid #bae6fd;padding:3px 9px;border-radius:14px;font-size:0.73rem;font-weight:600;display:inline-flex;align-items:center;gap:4px;white-space:nowrap;">
            <i data-lucide="radio" style="width:11px;height:11px;"></i> Dispatched • Awaiting DLR
          </span>
          <div style="font-size:0.7rem;color:#64748b;margin-top:2px;">Carrier delivery in progress</div>
        </div>
      `;
    } else if (c.status === 'Approved') {
      deliveryColHtml = `
        <span style="background:#ecfdf5;color:#059669;border:1px solid #a7f3d0;padding:3px 8px;border-radius:14px;font-size:0.73rem;font-weight:600;display:inline-flex;align-items:center;gap:4px;">
          <i data-lucide="package-check" style="width:11px;height:11px;"></i> In Dispatch Queue
        </span>
      `;
    } else if (isScheduledFuture) {
      deliveryColHtml = `
        <span style="background:#f5f3ff;color:#7c3aed;border:1px solid #ddd6fe;padding:3px 8px;border-radius:14px;font-size:0.73rem;font-weight:600;display:inline-flex;align-items:center;gap:4px;">
          <i data-lucide="calendar" style="width:11px;height:11px;"></i> Scheduled: ${scheduledDisplay}
        </span>
      `;
    } else if (c.status === 'Rejected') {
      deliveryColHtml = `
        <span style="background:#fee2e2;color:#b91c1c;border:1px solid #fecaca;padding:3px 8px;border-radius:14px;font-size:0.73rem;font-weight:600;display:inline-flex;align-items:center;gap:4px;">
          <i data-lucide="x-circle" style="width:11px;height:11px;"></i> Cancelled / Rejected
        </span>
      `;
    } else {
      deliveryColHtml = `
        <span style="color:#94a3b8;font-size:0.75rem;display:inline-flex;align-items:center;gap:4px;">
          <i data-lucide="clock" style="width:12px;height:12px;"></i> Pending Dispatch
        </span>
      `;
    }

    // Status Badge
    let statusBadgeHtml = '';
    if (c.status === 'Report Updated') {
      statusBadgeHtml = `<span style="background:#dcfce7;color:#15803d;border:1px solid #bbf7d0;padding:3px 9px;border-radius:20px;font-size:0.74rem;font-weight:700;white-space:nowrap;display:inline-flex;align-items:center;gap:4px;"><i data-lucide="check-check" style="width:11px;height:11px;"></i> Reported</span>`;
    } else if (c.status === 'Completed') {
      statusBadgeHtml = `<span style="background:#e0f2fe;color:#0284c7;border:1px solid #bae6fd;padding:3px 9px;border-radius:20px;font-size:0.74rem;font-weight:700;white-space:nowrap;display:inline-flex;align-items:center;gap:4px;"><i data-lucide="send" style="width:11px;height:11px;"></i> Completed</span>`;
    } else if (c.status === 'Submitted') {
      statusBadgeHtml = `<span style="background:#fef3c7;color:#92400e;border:1px solid #fde68a;padding:3px 9px;border-radius:20px;font-size:0.74rem;font-weight:700;white-space:nowrap;display:inline-flex;align-items:center;gap:4px;"><i data-lucide="clock" style="width:11px;height:11px;"></i> Submitted</span>`;
    } else if (c.status === 'Approved') {
      statusBadgeHtml = `<span style="background:#ecfdf5;color:#059669;border:1px solid #a7f3d0;padding:3px 9px;border-radius:20px;font-size:0.74rem;font-weight:700;white-space:nowrap;display:inline-flex;align-items:center;gap:4px;"><i data-lucide="package-check" style="width:11px;height:11px;"></i> Approved</span>`;
    } else if (c.status === 'Rejected') {
      statusBadgeHtml = `<span style="background:#fee2e2;color:#dc2626;border:1px solid #fecaca;padding:3px 9px;border-radius:20px;font-size:0.74rem;font-weight:700;white-space:nowrap;display:inline-flex;align-items:center;gap:4px;"><i data-lucide="x-circle" style="width:11px;height:11px;"></i> Rejected</span>`;
    } else {
      statusBadgeHtml = `<span style="background:#f1f5f9;color:#475569;border:1px solid #e2e8f0;padding:3px 9px;border-radius:20px;font-size:0.74rem;font-weight:700;white-space:nowrap;">${c.status}</span>`;
    }

    // Owner Account Info
    const ownerName = c.owner_name || '';
    const ownerCompany = c.owner_company || '';
    const ownerEmail = c.owner_email || '—';
    const resellerBadge = (isAdmin && c.reseller_email)
      ? `<div style="margin-top:3px;"><span style="font-size:0.68rem;background:#eef2ff;color:#4338ca;padding:1px 6px;border-radius:4px;font-weight:700;display:inline-flex;align-items:center;gap:3px;"><i data-lucide="network" style="width:10px;height:10px;"></i> Under: ${escHtml(c.reseller_name || c.reseller_email)}</span></div>`
      : '';

    return `
      <tr>
        <td>
          <a href="javascript:void(0)" onclick="openCampaignDetailModal(${c.id})" style="font-family:monospace;font-size:0.84rem;font-weight:800;color:#4f46e5;text-decoration:none;display:inline-block;padding:2px 6px;background:#eef2ff;border-radius:5px;border:1px solid #c7d2fe;">
            #${c.id}
          </a>
        </td>
        <td>
          <a href="javascript:void(0)" onclick="openCampaignDetailModal(${c.id})" style="font-weight:800;color:var(--slate-800);text-decoration:none;font-size:0.9rem;display:inline-block;margin-bottom:3px;">
            ${escHtml(c.title || 'SMS Broadcast #' + c.id)}
          </a>
          <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-bottom:4px;">
            <span style="font-size:0.68rem;font-weight:700;background:#f0fdf4;color:#166534;border:1px solid #bbf7d0;padding:1px 5px;border-radius:4px;text-transform:uppercase;">GSM SMS</span>
            <span style="font-size:0.68rem;color:#64748b;">${c.destination ? c.destination.toUpperCase() : 'DOMESTIC'}</span>
            ${c.is_unicode ? '<span style="color:#b45309;font-size:0.68rem;font-weight:700;background:#fef3c7;padding:1px 6px;border-radius:4px;border:1px solid #fde68a;">Unicode (Regional)</span>' : ''}
          </div>
          <div style="max-width:360px;min-width:230px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:7px 11px;">
            <div id="sms-msg-preview-${c.id}" style="font-size:0.78rem;color:#334155;line-height:1.45;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;word-break:break-word;white-space:pre-wrap;">
              ${escHtml(c.message_text || '—')}
            </div>
            <div style="display:flex;align-items:center;gap:8px;margin-top:5px;padding-top:4px;border-top:1px dashed #e2e8f0;font-size:0.72rem;">
              ${c.message_text && c.message_text.length > 55 ? `
                <button type="button" onclick="window.toggleSmsMessageExpand(event, ${c.id})" id="sms-msg-btn-${c.id}" style="border:none;background:none;padding:0;font-size:0.72rem;color:#4f46e5;font-weight:700;cursor:pointer;display:inline-flex;align-items:center;gap:2px;">
                  <span>Show More ▼</span>
                </button>
                <span style="color:#cbd5e1;">•</span>
              ` : ''}
              <button type="button" onclick="openCampaignDetailModal(${c.id})" style="border:none;background:none;padding:0;font-size:0.72rem;color:#0284c7;font-weight:700;cursor:pointer;display:inline-flex;align-items:center;gap:3px;" title="View complete campaign delivery metrics">
                <i data-lucide="eye" style="width:11px;height:11px;"></i> Full Details
              </button>
            </div>
          </div>
        </td>
        <td>
          <div style="font-size:0.83rem;font-weight:700;color:var(--slate-800);">${escHtml(ownerName || ownerCompany || ownerEmail)}</div>
          <div style="font-size:0.73rem;color:var(--slate-500);word-break:break-all;">${escHtml(ownerEmail)}</div>
          ${ownerCompany && ownerName ? `<div style="font-size:0.7rem;color:#64748b;">${escHtml(ownerCompany)}</div>` : ''}
          ${resellerBadge}
        </td>
        <td style="text-align:right;">
          <strong style="color:#0f172a;font-size:0.92rem;font-family:monospace;">${totalNums.toLocaleString()}</strong>
        </td>
        <td style="text-align:center;">
          <span style="font-weight:700;color:${parts > 1 ? '#d97706' : '#166534'};background:${parts > 1 ? '#fef3c7' : '#ecfdf5'};border:1px solid ${parts > 1 ? '#fde68a' : '#bbf7d0'};padding:2px 8px;border-radius:12px;font-size:0.74rem;white-space:nowrap;">
            ${parts} Part${parts > 1 ? 's' : ''}
          </span>
        </td>
        <td style="text-align:right;">
          <strong style="color:#4f46e5;font-size:0.95rem;font-family:monospace;font-weight:800;">${creditsUsed.toLocaleString()}</strong>
        </td>
        <td>
          ${deliveryColHtml}
        </td>
        <td>${statusBadgeHtml}</td>
        <td style="font-size:0.78rem;color:var(--slate-500);white-space:nowrap;">${createdDisplay}</td>
        <td>
          <div style="display:flex;gap:5px;justify-content:center;align-items:center;">
            <button type="button" class="btn-action btn-action-secondary" onclick="openCampaignDetailModal(${c.id})" style="padding:4px 7px;font-size:0.74rem;border-radius:6px;" title="View Detailed Delivery Report">
              <i data-lucide="eye" style="width:13px;height:13px;color:#0284c7;"></i>
            </button>
            <button type="button" class="btn-action btn-action-secondary" onclick="downloadCampaignNumbers(${c.id}, 'csv')" style="padding:4px 7px;font-size:0.74rem;border-radius:6px;" title="Download Recipient Numbers CSV">
              <i data-lucide="download" style="width:13px;height:13px;color:#16a34a;"></i>
            </button>
            <button type="button" class="btn-action btn-action-secondary" onclick="resendSmsCampaign(${c.id})" style="padding:4px 7px;font-size:0.74rem;border-radius:6px;" title="Duplicate & Re-send Broadcast">
              <i data-lucide="copy" style="width:13px;height:13px;color:#7c3aed;"></i>
            </button>
            ${canDelete ? `
              <button type="button" class="btn-action" onclick="deleteSmsCampaign(${c.id})" style="padding:4px 7px;font-size:0.74rem;background:#fee2e2;color:#dc2626;border-color:#fecaca;border-radius:6px;" title="Cancel Broadcast & Refund Credits">
                <i data-lucide="trash-2" style="width:13px;height:13px;"></i>
              </button>
            ` : ''}
          </div>
        </td>
      </tr>
    `;
  }).join('');

  if (window.lucide) setTimeout(() => lucide.createIcons(), 50);
}

window.resendSmsCampaign = function(id) {
  const c = (smsCampaignsData || []).find(x => Number(x.id) === Number(id));
  if (!c) return;
  switchView('view-sms-new');
  setTimeout(() => {
    const titleEl = document.getElementById('sms-title');
    const msgEl = document.getElementById('sms-message');
    if (titleEl) titleEl.value = (c.title ? c.title + ' (Copy)' : 'SMS Broadcast Copy');
    if (msgEl) {
      msgEl.value = c.message_text || '';
      if (typeof onSmsMessageInput === 'function') onSmsMessageInput();
    }
    showToast('info', 'Broadcast Loaded', `Campaign #${id} text pre-filled into composer. Add numbers and dispatch.`);
  }, 100);
};

window.exportSmsCampaignsCsv = function() {
  const filtered = getFilteredSmsCampaigns();
  if (!filtered || filtered.length === 0) {
    showToast('warning', 'No Broadcasts', 'No broadcasts to export under current filters.');
    return;
  }

  showToast('info', 'Exporting CSV', `Generating CSV for ${filtered.length} SMS broadcasts...`);

  const headers = ['Campaign ID', 'Title', 'Message Text', 'Owner Email', 'Owner Name', 'Company', 'Recipients', 'Parts', 'Credits Used', 'Status', 'Delivered Count', 'Failed Count', 'Delivery Rate (%)', 'Created At'];
  const rows = filtered.map(c => [
    c.id,
    c.title || '',
    (c.message_text || '').replace(/\r?\n/g, ' '),
    c.owner_email || '',
    c.owner_name || '',
    c.owner_company || '',
    c.total_numbers || 0,
    c.sms_parts || 1,
    c.credits_used || 0,
    c.status || '',
    c.delivered_count || 0,
    c.failed_count || 0,
    c.delivery_rate || 0,
    c.created_at || ''
  ]);

  const csvContent = [headers.join(','), ...rows.map(r => r.map(cell => `"${String(cell || '').replace(/"/g, '""')}"`).join(','))].join('\n');
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.setAttribute('href', url);
  link.setAttribute('download', `MessageSphere_SMS_Broadcasts_${new Date().toISOString().slice(0, 10)}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
  showToast('success', 'Export Complete', `${filtered.length} broadcasts exported to CSV.`);
};

window.toggleSmsMessageExpand = function(event, id) {
  if (event) event.stopPropagation();
  const el = document.getElementById(`sms-msg-preview-${id}`);
  const btn = document.getElementById(`sms-msg-btn-${id}`);
  if (!el || !btn) return;
  const isExpanded = el.dataset.expanded === 'true';
  if (isExpanded) {
    el.style.display = '-webkit-box';
    el.style.webkitLineClamp = '2';
    el.dataset.expanded = 'false';
    btn.innerHTML = '<span>Show More ▼</span>';
  } else {
    el.style.display = 'block';
    el.style.webkitLineClamp = 'unset';
    el.dataset.expanded = 'true';
    btn.innerHTML = '<span>Show Less ▲</span>';
  }
};

// --- Delete/Cancel ---
window.deleteSmsCampaign = async function(id) {
  if (!confirm('Cancel this SMS campaign and refund credits?')) return;
  try {
    await apiFetch(`/sms/${id}`, { method: 'DELETE' });
    showToast('success', 'Campaign Cancelled', 'SMS campaign cancelled and credits refunded.');
    loadSmsCampaigns();
  } catch(err) {
    showToast('error', 'Delete Failed', err.message);
  }
};

// ==========================================
// CREDIT PLANS & PRICING PACKAGES
// ==========================================
let cachedCreditPlans = [];
let currentPlanCategory = 'all';
let currentPlanChannelFilter = 'all';
window.cachedCreditPlans = cachedCreditPlans;
window.currentPlanCategory = currentPlanCategory;
window.currentPlanChannelFilter = currentPlanChannelFilter;

function getPlanChannelLabel(type) {
  const map = {
    'gsm_sms': 'GSM Bulk SMS',
    'normal': 'WhatsApp Normal Text',
    'cta': 'WhatsApp Interactive CTA',
    'dp': 'WhatsApp DP Media',
    'dp_cta': 'WhatsApp DP + CTA Combo',
    'own_number': 'Dedicated Virtual SIM'
  };
  return map[type] || type || 'Messaging';
}

function getPlanChannelIcon(type) {
  const map = {
    'gsm_sms': 'radio',
    'normal': 'message-circle',
    'cta': 'mouse-pointer-click',
    'dp': 'image',
    'dp_cta': 'sparkles',
    'own_number': 'smartphone'
  };
  return map[type] || 'package';
}

window.filterPlansByChannel = function(ch, btn) {
  currentPlanChannelFilter = ch || 'all';
  window.currentPlanChannelFilter = currentPlanChannelFilter;
  document.querySelectorAll('.plan-filter-pill').forEach(b => {
    b.classList.remove('active');
    b.style.fontWeight = '600';
    b.style.background = '#ffffff';
    b.style.color = '#475569';
    b.style.border = '1.5px solid #e2e8f0';
    b.style.boxShadow = 'none';
  });
  if (btn) {
    btn.classList.add('active');
    btn.style.fontWeight = '700';
    btn.style.background = '#0f172a';
    btn.style.color = '#ffffff';
    btn.style.border = '1.5px solid #0f172a';
    btn.style.boxShadow = '0 2px 4px rgba(15, 23, 42, 0.15)';
  }
  renderCreditPlansGrid();
};

window.switchPlanCategory = function(cat) {
  currentPlanCategory = cat || 'all';
  window.currentPlanCategory = currentPlanCategory;
  const btns = document.querySelectorAll('.plan-scope-btn');
  btns.forEach(b => {
    if (b.dataset.scope === currentPlanCategory) {
      b.style.background = '#0f172a';
      b.style.color = '#ffffff';
      b.style.fontWeight = '700';
      b.style.boxShadow = '0 2px 6px rgba(15, 23, 42, 0.2)';
    } else {
      b.style.background = 'transparent';
      b.style.color = '#64748b';
      b.style.fontWeight = '600';
      b.style.boxShadow = 'none';
    }
  });

  const hintEl = document.getElementById('plans-scope-hint');
  if (hintEl) {
    if (currentUser?.role === 'admin') {
      if (cat === 'all') hintEl.innerHTML = '<i data-lucide="info" style="width: 14px; height: 14px; color: #6366f1;"></i> Showing all configured retail & wholesale credit plans.';
      else if (cat === 'user') hintEl.innerHTML = '<i data-lucide="info" style="width: 14px; height: 14px; color: #6366f1;"></i> Retail credit packages available for direct client accounts.';
      else if (cat === 'reseller') hintEl.innerHTML = '<i data-lucide="info" style="width: 14px; height: 14px; color: #6366f1;"></i> Wholesale volume packs for Reseller Partners (Min 1,00,000 qty).';
    } else if (currentUser?.role === 'reseller') {
      if (cat === 'wholesale') hintEl.innerHTML = '<i data-lucide="info" style="width: 14px; height: 14px; color: #6366f1;"></i> Wholesale credit packages provided by Super Admin to stock your partner wallet.';
      else if (cat === 'client_plans') hintEl.innerHTML = '<i data-lucide="info" style="width: 14px; height: 14px; color: #6366f1;"></i> Custom credit plans created for your downstream clients.';
    }
    if (window.lucide) window.lucide.createIcons();
  }

  renderCreditPlansGrid();
};

window.loadCreditPlans = async function() {
  if (!currentUser) return;
  const container = document.getElementById('plans-grid-container');
  if (!container) return;

  const btnCreate = document.getElementById('btn-create-plan-modal');
  const scopeStrip = document.getElementById('plans-scope-strip');
  const scopeButtons = document.getElementById('plans-scope-buttons');

  const isAdmin = currentUser.role === 'admin';
  const isReseller = currentUser.role === 'reseller';

  if (btnCreate) {
    btnCreate.style.display = (isAdmin || isReseller) ? 'inline-flex' : 'none';
  }

  if (scopeStrip && scopeButtons) {
    if (isAdmin) {
      scopeStrip.style.display = 'flex';
      scopeButtons.innerHTML = `
        <button type="button" class="plan-scope-btn" data-scope="all" onclick="switchPlanCategory('all')" style="padding: 6px 14px; font-size: 0.76rem; font-weight: ${currentPlanCategory === 'all' ? '700' : '600'}; background: ${currentPlanCategory === 'all' ? '#0f172a' : 'transparent'}; color: ${currentPlanCategory === 'all' ? '#fff' : '#64748b'}; border-radius: 8px; border: none; cursor: pointer; transition: all 0.2s;">
          All Plans
        </button>
        <button type="button" class="plan-scope-btn" data-scope="user" onclick="switchPlanCategory('user')" style="padding: 6px 14px; font-size: 0.76rem; font-weight: ${currentPlanCategory === 'user' ? '700' : '600'}; background: ${currentPlanCategory === 'user' ? '#0f172a' : 'transparent'}; color: ${currentPlanCategory === 'user' ? '#fff' : '#64748b'}; border-radius: 8px; border: none; cursor: pointer; transition: all 0.2s;">
          Direct Clients (Retail)
        </button>
        <button type="button" class="plan-scope-btn" data-scope="reseller" onclick="switchPlanCategory('reseller')" style="padding: 6px 14px; font-size: 0.76rem; font-weight: ${currentPlanCategory === 'reseller' ? '700' : '600'}; background: ${currentPlanCategory === 'reseller' ? '#0f172a' : 'transparent'}; color: ${currentPlanCategory === 'reseller' ? '#fff' : '#64748b'}; border-radius: 8px; border: none; cursor: pointer; transition: all 0.2s;">
          Reseller Wholesale (1L+)
        </button>
      `;
    } else if (isReseller) {
      scopeStrip.style.display = 'flex';
      if (currentPlanCategory === 'all' || currentPlanCategory === 'user' || currentPlanCategory === 'reseller') {
        currentPlanCategory = 'wholesale';
        window.currentPlanCategory = 'wholesale';
      }
      scopeButtons.innerHTML = `
        <button type="button" class="plan-scope-btn" data-scope="wholesale" onclick="switchPlanCategory('wholesale')" style="padding: 6px 14px; font-size: 0.76rem; font-weight: ${currentPlanCategory === 'wholesale' ? '700' : '600'}; background: ${currentPlanCategory === 'wholesale' ? '#0f172a' : 'transparent'}; color: ${currentPlanCategory === 'wholesale' ? '#fff' : '#64748b'}; border-radius: 8px; border: none; cursor: pointer; transition: all 0.2s;">
          Wholesale Plans (From Admin)
        </button>
        <button type="button" class="plan-scope-btn" data-scope="client_plans" onclick="switchPlanCategory('client_plans')" style="padding: 6px 14px; font-size: 0.76rem; font-weight: ${currentPlanCategory === 'client_plans' ? '700' : '600'}; background: ${currentPlanCategory === 'client_plans' ? '#0f172a' : 'transparent'}; color: ${currentPlanCategory === 'client_plans' ? '#fff' : '#64748b'}; border-radius: 8px; border: none; cursor: pointer; transition: all 0.2s;">
          My Client Plans
        </button>
      `;
    } else {
      scopeStrip.style.display = 'none';
    }
  }

  container.innerHTML = `<div style="grid-column: 1 / -1; text-align: center; padding: 40px; color: var(--slate-400);">Loading available plans...</div>`;

  try {
    const plansData = await apiFetch('/billing/plans');
    cachedCreditPlans = plansData;
    window.cachedCreditPlans = plansData;

    // Dynamically calculate and update Enterprise KPI metrics
    try {
      const plansList = Array.isArray(plansData) ? plansData : [...(plansData.wholesale_plans || []), ...(plansData.my_client_plans || [])];
      const totalEl = document.getElementById('plans-kpi-total');
      const smsRateEl = document.getElementById('plans-kpi-sms-rate');
      const waRateEl = document.getElementById('plans-kpi-wa-rate');

      if (totalEl) totalEl.textContent = plansList.length || 0;

      const smsPlans = plansList.filter(p => p.credit_type === 'gsm_sms');
      if (smsRateEl && smsPlans.length > 0) {
        const minSms = Math.min(...smsPlans.map(p => parseFloat(p.rate_per_credit)));
        smsRateEl.textContent = `₹${minSms.toFixed(4)}`;
      }

      const waPlans = plansList.filter(p => ['normal', 'cta', 'dp', 'dp_cta'].includes(p.credit_type));
      if (waRateEl && waPlans.length > 0) {
        const minWa = Math.min(...waPlans.map(p => parseFloat(p.rate_per_credit)));
        waRateEl.textContent = `₹${minWa.toFixed(4)}`;
      }
    } catch (e) {
      console.warn('KPI calculation error:', e);
    }

    renderCreditPlansGrid();
  } catch (err) {
    container.innerHTML = `<div style="grid-column: 1 / -1; text-align: center; padding: 40px; color: #ef4444;">Failed to load credit plans: ${escapeHtml(err.message)}</div>`;
  }
};

window.renderCreditPlansGrid = function() {
  const container = document.getElementById('plans-grid-container');
  if (!container) return;

  const isAdmin = currentUser && currentUser.role === 'admin';
  const isReseller = currentUser && currentUser.role === 'reseller';

  let listToDisplay = [];

  if (isAdmin) {
    const all = Array.isArray(cachedCreditPlans) ? cachedCreditPlans : [];
    if (currentPlanCategory === 'user') {
      listToDisplay = all.filter(p => p.target_role === 'user');
    } else if (currentPlanCategory === 'reseller') {
      listToDisplay = all.filter(p => p.target_role === 'reseller');
    } else {
      listToDisplay = all;
    }
  } else if (isReseller) {
    const wholesale = (cachedCreditPlans && cachedCreditPlans.wholesale_plans) || [];
    const myClient = (cachedCreditPlans && cachedCreditPlans.my_client_plans) || [];
    if (currentPlanCategory === 'client_plans') {
      listToDisplay = myClient;
    } else {
      listToDisplay = wholesale;
    }
  } else {
    listToDisplay = Array.isArray(cachedCreditPlans) ? cachedCreditPlans : [];
  }

  if (currentPlanChannelFilter && currentPlanChannelFilter !== 'all') {
    listToDisplay = listToDisplay.filter(p => p.credit_type === currentPlanChannelFilter);
  }

  if (listToDisplay.length === 0) {
    container.innerHTML = `
      <div style="grid-column: 1 / -1; text-align: center; padding: 60px 20px; background: #ffffff; border-radius: 16px; border: 1.5px dashed #cbd5e1;">
        <div style="width: 52px; height: 52px; border-radius: 50%; background: #eef2ff; color: #6366f1; display: inline-flex; align-items: center; justify-content: center; margin-bottom: 14px;">
          <i data-lucide="package-open" style="width: 26px; height: 26px;"></i>
        </div>
        <h4 style="font-size: 1.1rem; font-weight: 800; color: #0f172a; margin: 0 0 6px 0;">No credit plans found</h4>
        <p style="font-size: 0.82rem; color: #64748b; margin: 0 0 18px 0; max-width: 420px; margin-inline: auto; line-height: 1.45;">
          ${(isAdmin || isReseller) ? 'No packages found matching this category or channel filter. Create custom plans to give clients or resellers pre-configured credit packs.' : 'No credit plans currently available. Please contact your account manager for custom volume allocations.'}
        </p>
        ${(isAdmin || isReseller) ? `
          <button type="button" class="btn-action btn-action-primary" onclick="openCreatePlanModal()" style="padding: 9px 20px; font-weight: 700; border-radius: 8px; background: #4f46e5; color: #fff;">
            <i data-lucide="plus-circle" style="width: 15px; height: 15px;"></i> Create New Plan
          </button>
        ` : ''}
      </div>
    `;
    if (window.lucide) window.lucide.createIcons();
    return;
  }

  // Theme configuration for each messaging channel
  const themeStyles = {
    'gsm_sms': {
      accent: 'linear-gradient(90deg, #3b82f6, #6366f1)',
      iconBg: 'linear-gradient(135deg, #eff6ff, #dbeafe)',
      iconColor: '#2563eb',
      iconBorder: '#bfdbfe',
      channelBadgeText: '#1e40af'
    },
    'cta': {
      accent: 'linear-gradient(90deg, #10b981, #059669)',
      iconBg: 'linear-gradient(135deg, #ecfdf5, #d1fae5)',
      iconColor: '#059669',
      iconBorder: '#a7f3d0',
      channelBadgeText: '#065f46'
    },
    'dp_cta': {
      accent: 'linear-gradient(90deg, #8b5cf6, #ec4899)',
      iconBg: 'linear-gradient(135deg, #faf5ff, #f3e8ff)',
      iconColor: '#7c3aed',
      iconBorder: '#e9d5ff',
      channelBadgeText: '#6b21a8'
    },
    'normal': {
      accent: 'linear-gradient(90deg, #0284c7, #38bdf8)',
      iconBg: 'linear-gradient(135deg, #f0f9ff, #e0f2fe)',
      iconColor: '#0284c7',
      iconBorder: '#bae6fd',
      channelBadgeText: '#0369a1'
    },
    'dp': {
      accent: 'linear-gradient(90deg, #a855f7, #6366f1)',
      iconBg: 'linear-gradient(135deg, #f5f3ff, #ede9fe)',
      iconColor: '#7c3aed',
      iconBorder: '#ddd6fe',
      channelBadgeText: '#5b21b6'
    },
    'own_number': {
      accent: 'linear-gradient(90deg, #0d9488, #14b8a6)',
      iconBg: 'linear-gradient(135deg, #f0fdfa, #ccfbf1)',
      iconColor: '#0d9488',
      iconBorder: '#99f6e4',
      channelBadgeText: '#115e59'
    }
  };

  container.innerHTML = listToDisplay.map(plan => {
    const isWholesale = plan.target_role === 'reseller';
    const isOwner = currentUser && (currentUser.id === plan.created_by || isAdmin);
    const channelIcon = getPlanChannelIcon(plan.credit_type);
    const channelLabel = getPlanChannelLabel(plan.credit_type);
    const destLabel = plan.destination === 'international' ? 'International Route' : 'Domestic Route (India +91)';
    const ratePaise = (Number(plan.rate_per_credit) * 100).toFixed(1);
    const formattedTotal = Number(plan.total_amount).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const formattedCredits = Number(plan.credits).toLocaleString('en-IN');

    const theme = themeStyles[plan.credit_type] || themeStyles['gsm_sms'];
    const topAccent = isWholesale ? 'linear-gradient(90deg, #9333ea, #ec4899)' : theme.accent;

    return `
      <div class="card premium-plan-card" style="border-radius: 18px; border: 1.5px solid #e2e8f0; background: #ffffff; display: flex; flex-direction: column; justify-content: space-between; transition: all 0.25s cubic-bezier(0.16, 1, 0.3, 1); box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.04), 0 2px 4px -2px rgba(0, 0, 0, 0.03); position: relative; overflow: hidden;">
        
        <!-- Top Gradient Accent Bar -->
        <div style="height: 5px; width: 100%; background: ${topAccent};"></div>

        <div style="padding: 24px 24px 18px 24px;">
          
          <!-- Top Row: Icon + Channel + Badge -->
          <div style="display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-bottom: 14px;">
            <div style="display: flex; align-items: center; gap: 10px;">
              <div style="width: 42px; height: 42px; border-radius: 10px; background: ${theme.iconBg}; border: 1px solid ${theme.iconBorder}; color: ${theme.iconColor}; display: flex; align-items: center; justify-content: center; flex-shrink: 0; box-shadow: 0 2px 5px rgba(0,0,0,0.03);">
                <i data-lucide="${channelIcon}" style="width: 20px; height: 20px;"></i>
              </div>
              <div>
                <span style="font-size: 0.72rem; font-weight: 800; color: ${theme.channelBadgeText}; text-transform: uppercase; letter-spacing: 0.5px; display: block;">
                  ${escapeHtml(channelLabel)}
                </span>
                <span style="font-size: 0.7rem; font-weight: 600; color: ${isWholesale ? '#9333ea' : '#475569'}; display: inline-flex; align-items: center; gap: 3px;">
                  <i data-lucide="${isWholesale ? 'network' : 'user'}" style="width: 11px; height: 11px;"></i>
                  ${isWholesale ? 'Wholesale Partner Tier' : 'Direct Client Retail'}
                </span>
              </div>
            </div>

            <!-- Single Sleek Badge / Dot -->
            <div style="display: flex; align-items: center; gap: 6px;">
              ${plan.badge_text ? `
                <span style="font-size: 0.68rem; font-weight: 800; background: linear-gradient(135deg, #fef3c7, #fde68a); color: #92400e; padding: 4px 9px; border-radius: 20px; border: 1px solid #fcd34d; text-transform: uppercase; letter-spacing: 0.4px;">
                  ${escapeHtml(plan.badge_text)}
                </span>
              ` : ''}
              
              <span style="display: inline-flex; align-items: center; gap: 4px; font-size: 0.68rem; font-weight: 700; padding: 3px 8px; border-radius: 20px; ${plan.is_active ? 'background: #ecfdf5; color: #059669; border: 1px solid #a7f3d0;' : 'background: #fef2f2; color: #dc2626; border: 1px solid #fecaca;'}">
                <span style="width: 6px; height: 6px; border-radius: 50%; background: ${plan.is_active ? '#10b981' : '#ef4444'};"></span>
                ${plan.is_active ? 'Active' : 'Paused'}
              </span>
            </div>
          </div>

          <!-- Plan Title & Description -->
          <h3 style="font-size: 1.2rem; font-weight: 800; color: #0f172a; margin: 0 0 6px 0; letter-spacing: -0.3px; line-height: 1.3;">
            ${escapeHtml(plan.plan_name)}
          </h3>
          <p style="font-size: 0.78rem; color: #64748b; margin: 0 0 16px 0; min-height: 36px; line-height: 1.45;">
            ${escapeHtml(plan.description || `${destLabel} with carrier telecom routing, instant DLR report reconciliation, and fast gateway priority.`)}
          </p>

          <!-- Pricing Block (Stripe/Linear-grade) -->
          <div style="background: ${isWholesale ? 'linear-gradient(135deg, #faf5ff, #f3e8ff)' : 'linear-gradient(135deg, #f8fafc, #f1f5f9)'}; border-radius: 12px; border: 1px solid ${isWholesale ? '#e9d5ff' : '#e2e8f0'}; padding: 16px 18px; margin-bottom: 16px;">
            <div style="display: flex; align-items: baseline; justify-content: space-between;">
              <div style="display: flex; align-items: baseline; gap: 2px;">
                <span style="font-size: 1.15rem; font-weight: 800; color: #64748b;">₹</span>
                <span style="font-size: 1.85rem; font-weight: 900; color: #0f172a; letter-spacing: -0.8px;">${formattedTotal}</span>
                <span style="font-size: 0.76rem; font-weight: 600; color: #64748b; margin-left: 3px;">/ package</span>
              </div>
              <div style="text-align: right;">
                <span style="display: inline-block; font-size: 0.8rem; font-weight: 800; color: ${isWholesale ? '#7c3aed' : '#4338ca'}; background: ${isWholesale ? '#f3e8ff' : '#e0e7ff'}; padding: 3px 9px; border-radius: 6px; border: 1px solid ${isWholesale ? '#ddd6fe' : '#c7d2fe'};">
                  ₹${Number(plan.rate_per_credit).toFixed(4)} <span style="font-size: 0.68rem; font-weight: 600; color: #64748b;">/ msg</span>
                </span>
                <div style="font-size: 0.68rem; color: #64748b; margin-top: 2px; font-weight: 500;">(${ratePaise} paise)</div>
              </div>
            </div>

            <!-- 2-Chip Metadata Grid -->
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-top: 12px; padding-top: 12px; border-top: 1px dashed ${isWholesale ? '#ddd6fe' : '#cbd5e1'};">
              <div>
                <span style="font-size: 0.68rem; font-weight: 700; color: #64748b; text-transform: uppercase;">Volume:</span>
                <div style="font-size: 0.95rem; font-weight: 800; color: #0f172a; margin-top: 1px;">
                  ${formattedCredits} Credits
                </div>
              </div>
              <div style="text-align: right;">
                <span style="font-size: 0.68rem; font-weight: 700; color: #64748b; text-transform: uppercase;">Route:</span>
                <div style="font-size: 0.85rem; font-weight: 700; color: #0f172a; margin-top: 1px;">
                  ${plan.destination === 'international' ? 'International' : 'Domestic (India +91)'}
                </div>
              </div>
            </div>
          </div>

          <!-- Feature Bullets (World-class checkmarks) -->
          <div style="display: flex; flex-direction: column; gap: 8px; margin-bottom: 18px; font-size: 0.78rem; color: #334155;">
            <div style="display: flex; align-items: center; gap: 8px;">
              <i data-lucide="check-circle-2" style="width: 15px; height: 15px; color: #10b981; flex-shrink: 0;"></i>
              <span>Direct carrier telecom routing &amp; real-time DLR</span>
            </div>
            <div style="display: flex; align-items: center; gap: 8px;">
              <i data-lucide="check-circle-2" style="width: 15px; height: 15px; color: #10b981; flex-shrink: 0;"></i>
              <span>Intelligent DND scrubbing &amp; compliance filtering</span>
            </div>
            <div style="display: flex; align-items: center; gap: 8px;">
              <i data-lucide="check-circle-2" style="width: 15px; height: 15px; color: #10b981; flex-shrink: 0;"></i>
              <span>Instant wallet credit &amp; verified GST tax invoice</span>
            </div>
          </div>

          ${(isAdmin && plan.creator_email) ? `
            <div style="font-size: 0.68rem; color: #94a3b8; margin-bottom: 12px; display: flex; align-items: center; gap: 5px;">
              <i data-lucide="shield-check" style="width: 12px; height: 12px; color: #6366f1;"></i>
              Created by: <strong>${escapeHtml(plan.creator_email)}</strong> (${escapeHtml(plan.creator_role || 'admin')})
            </div>
          ` : ''}

        </div>

        <!-- Action Footer -->
        <div style="padding: 14px 24px 20px 24px; background: #ffffff; border-top: 1px solid #f1f5f9;">
          ${(!isOwner && (currentUser.role === 'user' || (isReseller && isWholesale))) ? `
            <button type="button" class="btn-action btn-action-primary" onclick="orderCreditPlan(${plan.id})" style="width: 100%; justify-content: center; font-weight: 800; font-size: 0.88rem; padding: 11px 16px; border-radius: 10px; ${isWholesale ? 'background: linear-gradient(135deg, #7c3aed, #6d28d9);' : 'background: linear-gradient(135deg, #4f46e5, #4338ca);'} color: #fff; box-shadow: 0 4px 12px ${isWholesale ? 'rgba(124, 58, 237, 0.3)' : 'rgba(79, 70, 229, 0.3)'}; transition: all 0.2s;">
              <i data-lucide="${isWholesale ? 'coins' : 'zap'}" style="width: 16px; height: 16px;"></i>
              ${isWholesale ? 'Order Wholesale Pack' : 'Order Now & Top-up'}
            </button>
          ` : ''}

          ${(isOwner) ? `
            <div style="display: flex; gap: 8px; align-items: center;">
              <button type="button" class="btn-action btn-action-secondary" onclick="openCreatePlanModal(${plan.id})" style="flex: 1; justify-content: center; font-size: 0.8rem; padding: 8px 12px; font-weight: 700; border-radius: 8px;">
                <i data-lucide="edit-3" style="width: 14px; height: 14px;"></i> Edit Plan
              </button>
              
              <button type="button" class="btn-action btn-action-secondary" onclick="toggleCreditPlanStatus(${plan.id})" title="${plan.is_active ? 'Pause Plan' : 'Activate Plan'}" style="padding: 8px 12px; font-size: 0.8rem; font-weight: 700; border-radius: 8px; color: ${plan.is_active ? '#475569' : '#059669'};">
                <i data-lucide="${plan.is_active ? 'pause' : 'play'}" style="width: 14px; height: 14px;"></i>
              </button>

              <button type="button" class="btn-action btn-action-danger" onclick="deleteCreditPlan(${plan.id})" title="Delete Plan" style="padding: 8px 12px; border-radius: 8px;">
                <i data-lucide="trash-2" style="width: 14px; height: 14px;"></i>
              </button>

              <button type="button" class="btn-action btn-action-primary" onclick="orderCreditPlan(${plan.id})" title="Order / Test Top-up" style="padding: 8px 12px; border-radius: 8px; background: #4f46e5; color: #fff;">
                <i data-lucide="shopping-cart" style="width: 14px; height: 14px;"></i>
              </button>
            </div>
          ` : ''}
        </div>

      </div>
    `;
  }).join('');

  if (window.lucide) {
    window.lucide.createIcons();
  }
};

window.openCreatePlanModal = function(planId = null) {
  const modal = document.getElementById('modal-create-plan');
  if (!modal) return;

  const role = currentUser ? currentUser.role : 'user';
  if (role !== 'admin' && role !== 'reseller') {
    showToast('error', 'Access Denied', 'Only administrators and resellers can create plans.');
    return;
  }

  const targetGroup = document.getElementById('plan-target-audience-group');
  const radioUser = document.querySelector('input[name="plan_target_role"][value="user"]');
  const radioReseller = document.querySelector('input[name="plan_target_role"][value="reseller"]');
  const titleEl = document.getElementById('modal-plan-title');

  if (role === 'reseller') {
    if (targetGroup) targetGroup.style.display = 'none';
    if (radioUser) radioUser.checked = true;
    if (radioReseller) radioReseller.checked = false;
  } else {
    if (targetGroup) targetGroup.style.display = 'block';
  }

  if (planId) {
    let plan = null;
    if (Array.isArray(cachedCreditPlans)) {
      plan = cachedCreditPlans.find(p => p.id === planId);
    } else if (cachedCreditPlans && typeof cachedCreditPlans === 'object') {
      const all = [...(cachedCreditPlans.wholesale_plans || []), ...(cachedCreditPlans.my_client_plans || [])];
      plan = all.find(p => p.id === planId);
    }
    if (!plan) {
      showToast('error', 'Error', 'Plan not found.');
      return;
    }

    if (titleEl) titleEl.textContent = 'Edit Credit Plan';
    document.getElementById('plan-form-id').value = plan.id;
    document.getElementById('plan-form-name').value = plan.plan_name || '';
    document.getElementById('plan-form-channel').value = plan.credit_type || 'gsm_sms';
    document.getElementById('plan-form-dest').value = plan.destination || 'domestic';
    document.getElementById('plan-form-credits').value = plan.credits || 50000;
    document.getElementById('plan-form-rate').value = plan.rate_per_credit || '0.1200';
    document.getElementById('plan-form-badge').value = plan.badge_text || '';
    document.getElementById('plan-form-status').value = plan.is_active ? 'true' : 'false';
    document.getElementById('plan-form-desc').value = plan.description || '';

    if (plan.target_role === 'reseller' && radioReseller) {
      radioReseller.checked = true;
      if (radioUser) radioUser.checked = false;
    } else {
      if (radioUser) radioUser.checked = true;
      if (radioReseller) radioReseller.checked = false;
    }
  } else {
    if (titleEl) titleEl.textContent = 'Create Credit Plan';
    document.getElementById('plan-form-id').value = '';
    document.getElementById('plan-form-name').value = '';
    document.getElementById('plan-form-channel').value = 'gsm_sms';
    document.getElementById('plan-form-dest').value = 'domestic';
    
    if (role === 'admin' && radioReseller && radioReseller.checked) {
      document.getElementById('plan-form-credits').value = 100000;
      document.getElementById('plan-form-rate').value = '0.0900';
    } else {
      document.getElementById('plan-form-credits').value = 50000;
      document.getElementById('plan-form-rate').value = '0.1200';
    }
    document.getElementById('plan-form-badge').value = '';
    document.getElementById('plan-form-status').value = 'true';
    document.getElementById('plan-form-desc').value = '';
  }

  onPlanTargetRoleChange();
  calculatePlanTotal();
  modal.style.display = 'flex';
  if (window.lucide) window.lucide.createIcons();
};

window.onPlanTargetRoleChange = function() {
  const radioReseller = document.querySelector('input[name="plan_target_role"][value="reseller"]');
  const isResellerTarget = radioReseller && radioReseller.checked;
  const creditsInput = document.getElementById('plan-form-credits');
  const hintEl = document.getElementById('plan-qty-hint');
  const lblUser = document.getElementById('lbl-plan-target-user');
  const lblReseller = document.getElementById('lbl-plan-target-reseller');

  if (isResellerTarget) {
    if (lblReseller) {
      lblReseller.style.border = '2px solid #4f46e5';
      lblReseller.style.background = '#f5f3ff';
      lblReseller.style.boxShadow = '0 0 0 1px #4f46e5';
    }
    if (lblUser) {
      lblUser.style.border = '1.5px solid #e2e8f0';
      lblUser.style.background = '#ffffff';
      lblUser.style.boxShadow = 'none';
    }
    if (creditsInput) {
      creditsInput.min = 100000;
      if (parseInt(creditsInput.value, 10) < 100000) {
        creditsInput.value = 100000;
      }
    }
    if (hintEl) hintEl.textContent = 'Wholesale package: Minimum 1,00,000 credits';
  } else {
    if (lblUser) {
      lblUser.style.border = '2px solid #4f46e5';
      lblUser.style.background = '#f5f3ff';
      lblUser.style.boxShadow = '0 0 0 1px #4f46e5';
    }
    if (lblReseller) {
      lblReseller.style.border = '1.5px solid #e2e8f0';
      lblReseller.style.background = '#ffffff';
      lblReseller.style.boxShadow = 'none';
    }
    if (creditsInput) {
      creditsInput.min = 100;
    }
    if (hintEl) hintEl.textContent = 'Standard retail package';
  }
  calculatePlanTotal();
};

window.onPlanChannelChange = function() {
  const channel = document.getElementById('plan-form-channel')?.value;
  const rateInput = document.getElementById('plan-form-rate');
  const radioReseller = document.querySelector('input[name="plan_target_role"][value="reseller"]');
  const isWholesale = radioReseller && radioReseller.checked;

  const retailRates = {
    'gsm_sms': 0.12,
    'normal': 0.10,
    'cta': 0.15,
    'dp': 0.18,
    'dp_cta': 0.22,
    'own_number': 0.08
  };
  const wholesaleRates = {
    'gsm_sms': 0.09,
    'normal': 0.08,
    'cta': 0.11,
    'dp': 0.14,
    'dp_cta': 0.16,
    'own_number': 0.06
  };

  const currentRate = parseFloat(rateInput?.value);
  if (rateInput && (!currentRate || [0.12, 0.10, 0.15, 0.18, 0.22, 0.08, 0.09, 0.11, 0.14, 0.16, 0.06].includes(currentRate))) {
    const table = isWholesale ? wholesaleRates : retailRates;
    rateInput.value = (table[channel] || 0.12).toFixed(4);
  }

  calculatePlanTotal();
};

window.calculatePlanTotal = function() {
  const qty = parseInt(document.getElementById('plan-form-credits')?.value || 0, 10);
  const rate = parseFloat(document.getElementById('plan-form-rate')?.value || 0);
  const total = Math.round(qty * rate * 100) / 100;

  const previewQty = document.getElementById('calc-preview-qty');
  const previewRate = document.getElementById('calc-preview-rate');
  const previewTotal = document.getElementById('calc-preview-total');

  if (previewQty) previewQty.textContent = Number(qty || 0).toLocaleString();
  if (previewRate) previewRate.textContent = Number(rate || 0).toFixed(4);
  if (previewTotal) previewTotal.textContent = `₹${Number(total || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};

window.saveCreditPlan = async function() {
  const btn = document.getElementById('btn-save-plan');
  const planId = document.getElementById('plan-form-id')?.value;
  const planName = document.getElementById('plan-form-name')?.value.trim();
  const channel = document.getElementById('plan-form-channel')?.value;
  const destination = document.getElementById('plan-form-dest')?.value;
  const credits = parseInt(document.getElementById('plan-form-credits')?.value, 10);
  const rate = parseFloat(document.getElementById('plan-form-rate')?.value);
  const badge = document.getElementById('plan-form-badge')?.value.trim();
  const isActive = document.getElementById('plan-form-status')?.value === 'true';
  const description = document.getElementById('plan-form-desc')?.value.trim();

  const radioReseller = document.querySelector('input[name="plan_target_role"][value="reseller"]');
  const targetRole = (currentUser.role === 'admin' && radioReseller && radioReseller.checked) ? 'reseller' : 'user';

  if (!planName) {
    showToast('error', 'Validation Error', 'Please enter a plan title.');
    return;
  }
  if (isNaN(credits) || credits < 100) {
    showToast('error', 'Validation Error', 'Credits quantity must be at least 100.');
    return;
  }
  if (targetRole === 'reseller' && credits < 100000) {
    showToast('error', 'Validation Error', 'Wholesale plans for resellers require a minimum of 1,00,000 credits.');
    return;
  }
  if (isNaN(rate) || rate <= 0) {
    showToast('error', 'Validation Error', 'Please enter a valid rate per message.');
    return;
  }

  const payload = {
    plan_name: planName,
    credit_type: channel,
    destination: destination,
    credits: credits,
    rate_per_credit: rate,
    total_amount: Math.round(credits * rate * 100) / 100,
    badge_text: badge || null,
    is_active: isActive,
    description: description || null,
    target_role: targetRole
  };

  try {
    if (btn) { btn.disabled = true; btn.textContent = 'Saving Plan...'; }

    let res;
    if (planId) {
      res = await apiFetch(`/billing/plans/${planId}`, {
        method: 'PUT',
        body: JSON.stringify(payload)
      });
      showToast('success', 'Plan Updated', res.message || 'Plan updated successfully.');
    } else {
      res = await apiFetch('/billing/plans', {
        method: 'POST',
        body: JSON.stringify(payload)
      });
      showToast('success', 'Plan Created', res.message || 'Plan created successfully.');
    }

    const modal = document.getElementById('modal-create-plan');
    if (modal) modal.style.display = 'none';
    await loadCreditPlans();

  } catch (err) {
    showToast('error', 'Save Failed', err.message);
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Save Plan'; }
  }
};

window.toggleCreditPlanStatus = async function(planId) {
  try {
    const res = await apiFetch(`/billing/plans/${planId}/toggle`, { method: 'PATCH' });
    showToast('success', 'Plan Status Updated', res.message || 'Status toggled');
    loadCreditPlans();
  } catch (err) {
    showToast('error', 'Status Change Failed', err.message);
  }
};

window.deleteCreditPlan = function(planId) {
  window.openActionDialog({
    title: `Delete Credit Plan #${planId}`,
    message: 'Are you sure you want to delete this credit plan? Existing top-up invoices will remain intact.',
    icon: 'trash-2',
    iconColor: '#dc2626',
    iconBg: '#fee2e2',
    confirmText: 'Delete Plan',
    confirmClass: 'btn-action-danger',
    onConfirm: async () => {
      try {
        const res = await apiFetch(`/billing/plans/${planId}`, { method: 'DELETE' });
        showToast('success', 'Plan Deleted', res.message || 'Plan deleted');
        loadCreditPlans();
      } catch (err) {
        showToast('error', 'Delete Failed', err.message);
      }
    }
  });
};

window.orderCreditPlan = function(planId) {
  let plan = null;
  if (Array.isArray(cachedCreditPlans)) {
    plan = cachedCreditPlans.find(p => p.id === planId);
  } else if (cachedCreditPlans && typeof cachedCreditPlans === 'object') {
    const all = [...(cachedCreditPlans.wholesale_plans || []), ...(cachedCreditPlans.my_client_plans || [])];
    plan = all.find(p => p.id === planId);
  }

  if (!plan) {
    showToast('error', 'Error', 'Plan not found');
    return;
  }

  window.openActionDialog({
    title: `Order Plan: ${plan.plan_name}`,
    message: `Book ${Number(plan.credits).toLocaleString()} ${getPlanChannelLabel(plan.credit_type)} credits at ₹${Number(plan.rate_per_credit).toFixed(4)}/credit.\n\nTotal Plan Price: ₹${Number(plan.total_amount).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} (Tax calculated at settlement based on GST profile).`,
    icon: 'shopping-cart',
    iconColor: '#4f46e5',
    iconBg: '#e0e7ff',
    confirmText: 'Confirm & Place Order',
    confirmClass: 'btn-action-primary',
    showInput: true,
    inputLabel: 'Payment Reference / Bank UTR / Note (Optional)',
    inputValue: 'ONLINE_TOPUP',
    onConfirm: async ({ input: notes }) => {
      try {
        const res = await apiFetch(`/billing/plans/${plan.id}/order`, {
          method: 'POST',
          body: JSON.stringify({ notes: notes || 'PLAN_ORDER' })
        });
        showToast('success', 'Order Submitted', res.message || 'Credit top-up order generated.');
        if (typeof switchView === 'function') {
          switchView('view-billing');
        }
      } catch (err) {
        showToast('error', 'Order Failed', err.message);
      }
    }
  });
};

// Helper to escape HTML
function escHtml(str) {
  return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ============================================================================
// SUB-USER TEAM ACCOUNTS & ROLE-BASED ACCESS CONTROL (RBAC) CONTROLLER
// ============================================================================

let teamMembersCache = [];

const TEAM_ROLE_PRESETS = {
  campaign_manager: {
    label: 'Campaign Manager',
    color: '#4f46e5',
    bg: '#eef2ff',
    permissions: {
      can_send_campaigns: true,
      can_view_campaigns: true,
      can_manage_templates: true,
      can_manage_contacts: true,
      can_export_contacts: false,
      can_view_billing: false,
      can_recharge_wallet: false,
      can_manage_team: false,
      can_manage_users: false,
      can_manage_resellers: false,
      can_view_operations_audit: false,
      can_allot_credits: false
    }
  },
  support_agent: {
    label: 'Support / Chat Agent',
    color: '#0284c7',
    bg: '#e0f2fe',
    permissions: {
      can_send_campaigns: false,
      can_view_campaigns: true,
      can_manage_templates: false,
      can_manage_contacts: false,
      can_export_contacts: false,
      can_view_billing: false,
      can_recharge_wallet: false,
      can_manage_team: false,
      can_manage_users: false,
      can_manage_resellers: false,
      can_view_operations_audit: false,
      can_allot_credits: false
    }
  },
  accountant: {
    label: 'Accountant / Finance',
    color: '#16a34a',
    bg: '#f0fdf4',
    permissions: {
      can_send_campaigns: false,
      can_view_campaigns: false,
      can_manage_templates: false,
      can_manage_contacts: false,
      can_export_contacts: false,
      can_view_billing: true,
      can_recharge_wallet: true,
      can_manage_team: false,
      can_manage_users: false,
      can_manage_resellers: false,
      can_view_operations_audit: false,
      can_allot_credits: false
    }
  },
  viewer: {
    label: 'Viewer / Auditor',
    color: '#64748b',
    bg: '#f1f5f9',
    permissions: {
      can_send_campaigns: false,
      can_view_campaigns: true,
      can_manage_templates: false,
      can_manage_contacts: false,
      can_export_contacts: false,
      can_view_billing: false,
      can_recharge_wallet: false,
      can_manage_team: false,
      can_manage_users: false,
      can_manage_resellers: false,
      can_view_operations_audit: false,
      can_allot_credits: false
    }
  },
  team_admin: {
    label: 'Team Administrator',
    color: '#9333ea',
    bg: '#faf5ff',
    permissions: {
      can_send_campaigns: true,
      can_view_campaigns: true,
      can_manage_templates: true,
      can_manage_contacts: true,
      can_export_contacts: true,
      can_view_billing: true,
      can_recharge_wallet: true,
      can_manage_team: true,
      can_manage_users: false,
      can_manage_resellers: false,
      can_view_operations_audit: false,
      can_allot_credits: false
    }
  },
  // Platform Super-Admin Delegated Employee Roles
  sub_admin: {
    label: 'Platform Sub-Admin',
    color: '#7c3aed',
    bg: '#f5f3ff',
    permissions: {
      can_manage_users: true,
      can_manage_resellers: true,
      can_view_operations_audit: true,
      can_allot_credits: true,
      can_view_billing: true,
      can_manage_team: true,
      can_send_campaigns: true,
      can_view_campaigns: true,
      can_manage_templates: true,
      can_manage_contacts: true,
      can_export_contacts: true,
      can_recharge_wallet: true
    }
  },
  platform_ops: {
    label: 'Platform Operations Admin',
    color: '#0284c7',
    bg: '#f0f9ff',
    permissions: {
      can_manage_users: true,
      can_manage_resellers: true,
      can_view_operations_audit: true,
      can_allot_credits: false,
      can_view_billing: true,
      can_manage_team: false,
      can_send_campaigns: false,
      can_view_campaigns: true,
      can_manage_templates: true,
      can_manage_contacts: true,
      can_export_contacts: false,
      can_recharge_wallet: false
    }
  },
  billing_admin: {
    label: 'Platform Finance & Billing Lead',
    color: '#059669',
    bg: '#ecfdf5',
    permissions: {
      can_manage_users: true,
      can_manage_resellers: false,
      can_view_operations_audit: false,
      can_allot_credits: true,
      can_view_billing: true,
      can_manage_team: false,
      can_send_campaigns: false,
      can_view_campaigns: false,
      can_manage_templates: false,
      can_manage_contacts: false,
      can_export_contacts: false,
      can_recharge_wallet: true
    }
  },
  support_admin: {
    label: 'Platform Tech & Support Lead',
    color: '#d97706',
    bg: '#fffbeb',
    permissions: {
      can_manage_users: true,
      can_manage_resellers: false,
      can_view_operations_audit: true,
      can_allot_credits: false,
      can_view_billing: false,
      can_manage_team: false,
      can_send_campaigns: false,
      can_view_campaigns: true,
      can_manage_templates: true,
      can_manage_contacts: false,
      can_export_contacts: false,
      can_recharge_wallet: false
    }
  },
  platform_auditor: {
    label: 'Platform Auditor (Read-Only)',
    color: '#475569',
    bg: '#f8fafc',
    permissions: {
      can_manage_users: false,
      can_manage_resellers: false,
      can_view_operations_audit: true,
      can_allot_credits: false,
      can_view_billing: true,
      can_manage_team: false,
      can_send_campaigns: false,
      can_view_campaigns: true,
      can_manage_templates: false,
      can_manage_contacts: false,
      can_export_contacts: false,
      can_recharge_wallet: false
    }
  }
};

window.applyRolePreset = function(presetKey) {
  const preset = TEAM_ROLE_PRESETS[presetKey];
  if (!preset) return;
  const p = preset.permissions;
  document.getElementById('perm-send-campaigns').checked = Boolean(p.can_send_campaigns);
  document.getElementById('perm-view-campaigns').checked = Boolean(p.can_view_campaigns);
  document.getElementById('perm-manage-templates').checked = Boolean(p.can_manage_templates);
  document.getElementById('perm-manage-contacts').checked = Boolean(p.can_manage_contacts);
  document.getElementById('perm-export-contacts').checked = Boolean(p.can_export_contacts);
  document.getElementById('perm-view-billing').checked = Boolean(p.can_view_billing);
  document.getElementById('perm-recharge-wallet').checked = Boolean(p.can_recharge_wallet);
  document.getElementById('perm-manage-team').checked = Boolean(p.can_manage_team);

  const elUsers = document.getElementById('perm-manage-users');
  if (elUsers) elUsers.checked = Boolean(p.can_manage_users);
  const elResellers = document.getElementById('perm-manage-resellers');
  if (elResellers) elResellers.checked = Boolean(p.can_manage_resellers);
  const elAudit = document.getElementById('perm-view-operations-audit');
  if (elAudit) elAudit.checked = Boolean(p.can_view_operations_audit);
  const elAllot = document.getElementById('perm-allot-credits');
  if (elAllot) elAllot.checked = Boolean(p.can_allot_credits);
};

window.populateTeamRoleSelect = function(selectedRole = null) {
  const select = document.getElementById('team-role-select');
  if (!select) return;
  const isPlatformAdmin = Boolean(currentUser && currentUser.role === 'admin');
  const platformSection = document.getElementById('platform-admin-perms-section');
  if (platformSection) {
    platformSection.style.display = isPlatformAdmin ? 'block' : 'none';
  }

  let html = '';
  if (isPlatformAdmin) {
    html = `
      <option value="sub_admin">Platform Sub-Admin (Full Delegated Operations)</option>
      <option value="platform_ops">Platform Operations Admin (Users, Resellers & Audit)</option>
      <option value="billing_admin">Platform Finance & Billing Lead (Credits & Invoices)</option>
      <option value="support_admin">Platform Tech & Support Lead (Users & Audit)</option>
      <option value="platform_auditor">Platform Auditor (Read-Only Analytics)</option>
      <option value="team_admin">Team Administrator (Full Access)</option>
      <option value="campaign_manager">Campaign Manager</option>
      <option value="support_agent">Support / Chat Agent</option>
      <option value="accountant">Accountant / Finance</option>
      <option value="viewer">Viewer (Read-Only)</option>
      <option value="custom">Custom Permissions (Manually toggle below)</option>
    `;
  } else {
    html = `
      <option value="campaign_manager">Campaign Manager (Broadcasts & Templates, No Billing, No Data Export)</option>
      <option value="support_agent">Support / Chat Agent (Customer Replies & Live Chat, No Blasting)</option>
      <option value="accountant">Accountant / Finance (Wallet Recharges, Invoices, Ledgers Only)</option>
      <option value="viewer">Viewer / Auditor (Read-Only Analytics & Reports)</option>
      <option value="team_admin">Team Administrator (Full Delegated Access)</option>
      <option value="custom">Custom Permissions (Manually toggle below)</option>
    `;
  }
  select.innerHTML = html;
  if (selectedRole) {
    select.value = selectedRole;
  }
};

window.onPermCheckboxChanged = function() {
  const select = document.getElementById('team-role-select');
  if (select && select.value !== 'custom') {
    select.value = 'custom';
  }
};

window.loadTeamMembers = async function() {
  const tbody = document.getElementById('team-members-tbody');
  if (!tbody) return;
  tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:30px;color:#94a3b8;">Loading team directory...</td></tr>';

  try {
    const res = await apiFetch('/team');
    teamMembersCache = res.members || [];
    renderTeamMembersTable(teamMembersCache);
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;padding:30px;color:#ef4444;">Failed to load team: ${escapeHtml(err.message)}</td></tr>`;
  }
};

window.renderTeamMembersTable = function(members) {
  const tbody = document.getElementById('team-members-tbody');
  if (!tbody) return;

  const totalEl = document.getElementById('metric-team-total');
  const activeEl = document.getElementById('metric-team-active');
  if (totalEl) totalEl.textContent = members.length;
  if (activeEl) activeEl.textContent = members.filter(m => m.status === 'active' && !m.is_blocked && !m.is_on_leave).length;

  if (members.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="7" style="text-align:center;padding:40px;color:#64748b;">
          <div style="font-size:1.05rem;font-weight:600;color:#334155;">No Staff Members Added Yet</div>
          <p style="margin-top:6px;font-size:0.86rem;color:#64748b;">Add team members to delegate campaign dispatches, live chat support, and accounting securely.</p>
          <button type="button" class="btn btn-primary" onclick="openAddTeamModal()" style="margin-top:12px;background:var(--primary);color:#fff;padding:8px 18px;border-radius:6px;font-weight:600;border:none;cursor:pointer;">+ Add First Staff Member</button>
        </td>
      </tr>
    `;
    return;
  }

  const pill = (label, active, warn = false) => `
    <span style="font-size:0.7rem;padding:2px 7px;border-radius:4px;font-weight:600;display:inline-block;margin:2px;${
      active 
        ? (warn ? 'background:#fee2e2;color:#b91c1c;border:1px solid #fca5a5;' : 'background:#e0e7ff;color:#3730a3;border:1px solid #c7d2fe;') 
        : 'background:#f1f5f9;color:#94a3b8;text-decoration:line-through;'
    }">${label}</span>
  `;

  tbody.innerHTML = members.map(m => {
    const meta = TEAM_ROLE_PRESETS[m.role_title] || { label: m.role_title || 'Custom', color: '#475569', bg: '#f8fafc' };
    const p = m.permissions || {};
    const isActive = m.status === 'active' && !m.is_blocked;
    const initial = (m.full_name || m.email || 'S').charAt(0).toUpperCase();
    const assignedCount = Number(m.assigned_clients_count) || 0;
    const assignedResellers = Number(m.assigned_resellers_count) || 0;
    const coverageCount = Number(m.coverage_clients_count) || 0;

    let countText = `${assignedCount} Client${assignedCount === 1 ? '' : 's'}`;
    if (assignedResellers > 0) {
      countText = `${assignedResellers} Reseller${assignedResellers === 1 ? '' : 's'} · ${assignedCount} Accounts`;
    }

    // Managed clients badge
    const canManageTeam = Boolean(currentUser && (currentUser.role === 'admin' || currentUser.role === 'reseller' || currentUser.permissions?.can_manage_team));
    const clientsBadgeHtml = `
      <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;">
        <span style="background:#e0e7ff;color:#3730a3;font-weight:700;font-size:0.75rem;padding:3px 9px;border-radius:12px;border:1px solid #c7d2fe;">
          ${countText}
        </span>
        ${coverageCount > 0 ? `
          <span style="background:#fef3c7;color:#92400e;font-weight:700;font-size:0.72rem;padding:2px 7px;border-radius:10px;border:1px solid #fde68a;" title="Temporarily covering for colleagues on leave">
            +${coverageCount} Covering
          </span>
        ` : ''}
        ${canManageTeam ? `
          <button type="button" onclick="openPortfolioManagerModal(${m.user_id}, '${escapeHtml(m.full_name || m.email)}')" title="Manage Account Portfolio for ${escapeHtml(m.full_name || m.email)}" style="padding:2px 8px;font-size:0.72rem;font-weight:600;background:#eff6ff;border:1px solid #c7d2fe;border-radius:6px;color:#4f46e5;cursor:pointer;display:inline-flex;align-items:center;gap:3px;">
            <i data-lucide="plus-circle" style="width:11px;height:11px;"></i> Manage
          </button>
        ` : ''}
      </div>
    `;

    // Duty & Leave Status badge
    let dutyStatusHtml = '';
    if (m.is_on_leave) {
      const backupName = escapeHtml(m.backup_agent_name || m.backup_agent_email || 'Unassigned');
      dutyStatusHtml = `
        <div>
          <span style="padding:3px 8px;border-radius:12px;font-size:0.75rem;font-weight:700;background:#fef3c7;color:#92400e;border:1px solid #fde68a;display:inline-flex;align-items:center;gap:4px;">
            <span>🏖️ On Leave</span>
          </span>
          <div style="font-size:0.73rem;color:#64748b;margin-top:3px;line-height:1.3;">
            Covered by: <strong style="color:#1e293b;">${backupName}</strong>
            ${m.leave_end_date ? `<div style="color:#94a3b8;">Until ${new Date(m.leave_end_date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}</div>` : ''}
          </div>
        </div>
      `;
    } else {
      dutyStatusHtml = `
        <span style="padding:4px 10px;border-radius:20px;font-size:0.75rem;font-weight:600;background:${isActive ? '#dcfce7' : '#fee2e2'};color:${isActive ? '#15803d' : '#b91c1c'};display:inline-flex;align-items:center;gap:4px;">
          <i data-lucide="${isActive ? 'check-circle-2' : 'x-circle'}" style="width:12px;height:12px;"></i> ${isActive ? 'Active On Duty' : 'Suspended'}
        </span>
      `;
    }

    return `
      <tr style="border-bottom:1px solid #e2e8f0;">
        <td style="padding:14px 16px;">
          <div style="display:flex;align-items:center;gap:12px;">
            <div style="width:36px;height:36px;border-radius:50%;background:#e0e7ff;color:var(--primary);display:flex;align-items:center;justify-content:center;font-weight:700;font-size:0.95rem;">
              ${initial}
            </div>
            <div>
              <div style="font-weight:600;color:#1e293b;font-size:0.92rem;">${escapeHtml(m.full_name || 'Staff Member')}</div>
              <div style="font-size:0.8rem;color:#64748b;">${escapeHtml(m.email)}</div>
            </div>
          </div>
        </td>
        <td style="padding:14px 16px;">
          <span style="padding:4px 10px;border-radius:20px;font-size:0.78rem;font-weight:600;background:${meta.bg};color:${meta.color};border:1px solid ${meta.color}33;">
            ${meta.label}
          </span>
        </td>
        <td style="padding:14px 16px;">
          ${clientsBadgeHtml}
        </td>
        <td style="padding:14px 16px;">
          ${dutyStatusHtml}
        </td>
        <td style="padding:14px 16px;max-width:260px;">
          ${p.can_manage_users ? pill('Users', true) : ''}
          ${p.can_manage_resellers ? pill('Resellers', true) : ''}
          ${p.can_view_operations_audit ? pill('Audit', true) : ''}
          ${p.can_allot_credits ? pill('Credits', true) : ''}
          ${pill('Campaigns', p.can_send_campaigns)}
          ${pill('Contacts', p.can_manage_contacts)}
          ${pill('Export CSV 🔒', p.can_export_contacts, true)}
          ${pill('Billing', p.can_view_billing)}
        </td>
        <td style="padding:14px 16px;font-size:0.82rem;color:#64748b;">
          ${new Date(m.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
        </td>
        <td style="padding:14px 16px;text-align:right;">
          <div style="display:inline-flex;gap:6px;">
            <button onclick="openEditTeamModal(${m.id})" title="Edit Permissions" style="padding:6px 9px;border:1px solid #cbd5e1;background:#fff;border-radius:5px;cursor:pointer;color:#334155;">
              <i data-lucide="sliders-horizontal" style="width:14px;height:14px;"></i>
            </button>
            <button onclick="openTeamLeaveModal(${m.id})" title="${m.is_on_leave ? 'Resume Duty / End Leave' : 'Leave Handover / Set Backup'}" style="padding:6px 9px;border:1px solid ${m.is_on_leave ? '#fde68a' : '#cbd5e1'};background:${m.is_on_leave ? '#fffbeb' : '#fff'};border-radius:5px;cursor:pointer;color:${m.is_on_leave ? '#d97706' : '#64748b'};">
              <i data-lucide="${m.is_on_leave ? 'sun' : 'palmtree'}" style="width:14px;height:14px;"></i>
            </button>
            <button onclick="openTeamReassignModal(${m.user_id}, '${escapeHtml(m.full_name || m.email)}')" title="Transfer Client Portfolio to Another Agent" style="padding:6px 9px;border:1px solid #cbd5e1;background:#fff;border-radius:5px;cursor:pointer;color:#4f46e5;">
              <i data-lucide="arrow-right-left" style="width:14px;height:14px;"></i>
            </button>
            <button onclick="openResetPasswordModal(${m.id}, '${escapeHtml(m.email)}')" title="Reset Password" style="padding:6px 9px;border:1px solid #cbd5e1;background:#fff;border-radius:5px;cursor:pointer;color:#d97706;">
              <i data-lucide="key-round" style="width:14px;height:14px;"></i>
            </button>
            <button onclick="toggleTeamMemberStatus(${m.id}, '${m.status}')" title="${isActive ? 'Suspend Staff' : 'Activate Staff'}" style="padding:6px 9px;border:1px solid #cbd5e1;background:#fff;border-radius:5px;cursor:pointer;color:${isActive ? '#b91c1c' : '#15803d'};">
              <i data-lucide="${isActive ? 'user-x' : 'user-check'}" style="width:14px;height:14px;"></i>
            </button>
            <button onclick="deleteTeamMember(${m.id}, '${escapeHtml(m.email)}')" title="Delete Staff Account" style="padding:6px 9px;border:1px solid #fee2e2;background:#fff5f5;border-radius:5px;cursor:pointer;color:#dc2626;">
              <i data-lucide="trash-2" style="width:14px;height:14px;"></i>
            </button>
          </div>
        </td>
      </tr>
    `;
  }).join('');

  if (window.lucide) lucide.createIcons();
};

window.filterTeamTable = function() {
  const query = (document.getElementById('team-search-input')?.value || '').toLowerCase().trim();
  if (!query) {
    renderTeamMembersTable(teamMembersCache);
    return;
  }
  const filtered = teamMembersCache.filter(m => 
    (m.full_name || '').toLowerCase().includes(query) ||
    (m.email || '').toLowerCase().includes(query) ||
    (m.role_title || '').toLowerCase().includes(query)
  );
  renderTeamMembersTable(filtered);
};

window.openAddTeamModal = function() {
  const isPlatformAdmin = Boolean(currentUser && currentUser.role === 'admin');
  document.getElementById('modal-team-title').innerHTML = `<i data-lucide="${isPlatformAdmin ? 'shield-check' : 'user-plus'}" style="width:20px;height:20px;color:var(--primary);"></i> ${isPlatformAdmin ? 'Add Platform Sub-Admin / Staff' : 'Add Team Member'}`;
  document.getElementById('team-member-edit-id').value = '';
  document.getElementById('team-input-name').value = '';
  document.getElementById('team-input-email').value = '';
  document.getElementById('team-input-email').readOnly = false;
  document.getElementById('team-input-password').value = '';
  document.getElementById('team-password-group').style.display = 'block';
  document.getElementById('team-input-password').required = true;

  const defaultRole = isPlatformAdmin ? 'sub_admin' : 'campaign_manager';
  populateTeamRoleSelect(defaultRole);
  applyRolePreset(defaultRole);

  const modal = document.getElementById('modal-team-member');
  if (modal) {
    modal.style.display = 'flex';
    if (window.lucide) lucide.createIcons();
  }
};

window.openEditTeamModal = function(id) {
  const member = teamMembersCache.find(m => m.id === id);
  if (!member) return;
  const isPlatformAdmin = Boolean(currentUser && currentUser.role === 'admin');
  document.getElementById('modal-team-title').innerHTML = '<i data-lucide="sliders-horizontal" style="width:20px;height:20px;color:var(--primary);"></i> Edit Staff Permissions';
  document.getElementById('team-member-edit-id').value = member.id;
  document.getElementById('team-input-name').value = member.full_name || '';
  document.getElementById('team-input-email').value = member.email || '';
  document.getElementById('team-input-email').readOnly = true;
  document.getElementById('team-password-group').style.display = 'none';
  document.getElementById('team-input-password').required = false;

  populateTeamRoleSelect(TEAM_ROLE_PRESETS[member.role_title] ? member.role_title : 'custom');

  const p = member.permissions || {};
  document.getElementById('perm-send-campaigns').checked = Boolean(p.can_send_campaigns);
  document.getElementById('perm-view-campaigns').checked = Boolean(p.can_view_campaigns);
  document.getElementById('perm-manage-templates').checked = Boolean(p.can_manage_templates);
  document.getElementById('perm-manage-contacts').checked = Boolean(p.can_manage_contacts);
  document.getElementById('perm-export-contacts').checked = Boolean(p.can_export_contacts);
  document.getElementById('perm-view-billing').checked = Boolean(p.can_view_billing);
  document.getElementById('perm-recharge-wallet').checked = Boolean(p.can_recharge_wallet);
  document.getElementById('perm-manage-team').checked = Boolean(p.can_manage_team);

  const elUsers = document.getElementById('perm-manage-users');
  if (elUsers) elUsers.checked = Boolean(p.can_manage_users);
  const elResellers = document.getElementById('perm-manage-resellers');
  if (elResellers) elResellers.checked = Boolean(p.can_manage_resellers);
  const elAudit = document.getElementById('perm-view-operations-audit');
  if (elAudit) elAudit.checked = Boolean(p.can_view_operations_audit);
  const elAllot = document.getElementById('perm-allot-credits');
  if (elAllot) elAllot.checked = Boolean(p.can_allot_credits);

  const modal = document.getElementById('modal-team-member');
  if (modal) {
    modal.style.display = 'flex';
    if (window.lucide) lucide.createIcons();
  }
};

window.closeTeamModal = function() {
  const modal = document.getElementById('modal-team-member');
  if (modal) modal.style.display = 'none';
};

window.handleTeamFormSubmit = async function(e) {
  e.preventDefault();
  const editId = document.getElementById('team-member-edit-id').value;
  const full_name = document.getElementById('team-input-name').value.trim();
  const email = document.getElementById('team-input-email').value.trim();
  const password = document.getElementById('team-input-password').value;
  const role_title = document.getElementById('team-role-select').value;

  const permissions = {
    can_send_campaigns: document.getElementById('perm-send-campaigns').checked,
    can_view_campaigns: document.getElementById('perm-view-campaigns').checked,
    can_manage_templates: document.getElementById('perm-manage-templates').checked,
    can_manage_contacts: document.getElementById('perm-manage-contacts').checked,
    can_export_contacts: document.getElementById('perm-export-contacts').checked,
    can_view_billing: document.getElementById('perm-view-billing').checked,
    can_recharge_wallet: document.getElementById('perm-recharge-wallet').checked,
    can_manage_team: document.getElementById('perm-manage-team').checked,
    can_manage_users: Boolean(document.getElementById('perm-manage-users')?.checked),
    can_manage_resellers: Boolean(document.getElementById('perm-manage-resellers')?.checked),
    can_view_operations_audit: Boolean(document.getElementById('perm-view-operations-audit')?.checked),
    can_allot_credits: Boolean(document.getElementById('perm-allot-credits')?.checked)
  };

  const btn = document.getElementById('btn-save-team-member');
  btn.disabled = true;
  btn.textContent = 'Saving...';

  try {
    let res;
    if (editId) {
      res = await apiFetch(`/team/${editId}`, {
        method: 'PUT',
        body: JSON.stringify({ full_name, role_title, permissions })
      });
    } else {
      res = await apiFetch('/team', {
        method: 'POST',
        body: JSON.stringify({ email, password, full_name, role_title, permissions })
      });
    }

    showToast('success', 'Staff Member Saved', res.message || 'Staff permissions configured.');
    closeTeamModal();
    loadTeamMembers();
  } catch (err) {
    showToast('error', 'Action Failed', err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Save Member';
  }
};

window.toggleTeamMemberStatus = async function(id, currentStatus) {
  const newStatus = currentStatus === 'active' ? 'suspended' : 'active';
  const confirmMsg = newStatus === 'suspended'
    ? 'Are you sure you want to suspend this staff member? Their access will be immediately blocked and active sessions revoked.'
    : 'Activate this staff member account?';
  if (!confirm(confirmMsg)) return;

  try {
    const res = await apiFetch(`/team/${id}`, {
      method: 'PUT',
      body: JSON.stringify({ status: newStatus })
    });
    showToast('success', 'Status Updated', res.message || 'Member status updated.');
    loadTeamMembers();
  } catch (err) {
    showToast('error', 'Status Update Failed', err.message);
  }
};

window.deleteTeamMember = async function(id, email) {
  if (!confirm(`Are you sure you want to permanently remove staff member: ${email}? This action cannot be undone.`)) {
    return;
  }
  try {
    const res = await apiFetch(`/team/${id}`, { method: 'DELETE' });
    showToast('success', 'Staff Removed', res.message || 'Staff member deleted.');
    loadTeamMembers();
  } catch (err) {
    showToast('error', 'Deletion Failed', err.message);
  }
};

window.openResetPasswordModal = function(id, email) {
  document.getElementById('reset-team-member-id').value = id;
  document.getElementById('reset-team-email-display').innerHTML = `Resetting credentials for: <strong>${escapeHtml(email)}</strong>`;
  document.getElementById('reset-team-new-password').value = '';
  const modal = document.getElementById('modal-reset-team-password');
  if (modal) {
    modal.style.display = 'flex';
    if (window.lucide) lucide.createIcons();
  }
};

window.closeResetTeamPasswordModal = function() {
  const modal = document.getElementById('modal-reset-team-password');
  if (modal) modal.style.display = 'none';
};

window.handleResetTeamPasswordSubmit = async function(e) {
  e.preventDefault();
  const id = document.getElementById('reset-team-member-id').value;
  const new_password = document.getElementById('reset-team-new-password').value;
  try {
    const res = await apiFetch(`/team/${id}/reset-password`, {
      method: 'POST',
      body: JSON.stringify({ new_password })
    });
    showToast('success', 'Password Updated', res.message || 'Password updated and sessions revoked.');
    closeResetTeamPasswordModal();
  } catch (err) {
    showToast('error', 'Password Reset Failed', err.message);
  }
};

// ============================================================================
// ACCOUNT MANAGER CLIENT PORTFOLIO & LEAVE COVERAGE ENGINE
// ============================================================================

window.populateUserAgentFilter = async function() {
  const select = document.getElementById('user-agent-filter');
  if (!select) return;
  const currentVal = select.value || 'all';
  try {
    const agents = await apiFetch('/team/agents');
    let opts = '<option value="all">All Account Managers</option><option value="unassigned">Unassigned Clients</option>';
    (agents || []).forEach(ag => {
      opts += `<option value="${ag.id}">${escapeHtml(ag.full_name || ag.email)} (${ag.assigned_clients_count || 0})</option>`;
    });
    select.innerHTML = opts;
    if (Array.from(select.options).some(o => o.value === currentVal)) {
      select.value = currentVal;
    }
  } catch (_) {}
};

window.openAssignAgentModal = async function(userId, clientEmail, currentAgentId) {
  document.getElementById('assign-agent-user-id').value = userId;
  document.getElementById('assign-agent-client-display').innerHTML = `Assigning dedicated manager for: <strong>${escapeHtml(clientEmail)}</strong>`;
  const select = document.getElementById('assign-agent-select');
  select.innerHTML = '<option value="">Loading active agents...</option>';
  
  const modal = document.getElementById('modal-assign-agent');
  if (modal) {
    modal.style.display = 'flex';
    if (window.lucide) lucide.createIcons();
  }

  try {
    const agents = await apiFetch('/team/agents');
    let opts = '<option value="">— Unassigned (No Dedicated Agent) —</option>';
    (agents || []).forEach(ag => {
      const isSelected = String(ag.id) === String(currentAgentId);
      const leaveTag = ag.is_on_leave ? ' [On Leave - Backup: ' + (ag.backup_agent_name || 'Assigned') + ']' : '';
      opts += `<option value="${ag.id}" ${isSelected ? 'selected' : ''}>${escapeHtml(ag.full_name || ag.email)} (${ag.role_title || 'Agent'}) — ${ag.assigned_clients_count || 0} Clients${leaveTag}</option>`;
    });
    select.innerHTML = opts;
  } catch (err) {
    select.innerHTML = `<option value="">Failed to load agents: ${escapeHtml(err.message)}</option>`;
  }
};

window.closeAssignAgentModal = function() {
  const modal = document.getElementById('modal-assign-agent');
  if (modal) modal.style.display = 'none';
};

window.handleAssignAgentSubmit = async function(e) {
  e.preventDefault();
  const userId = document.getElementById('assign-agent-user-id').value;
  const agentId = document.getElementById('assign-agent-select').value || null;
  const btn = document.getElementById('btn-save-assign-agent');
  btn.disabled = true;
  btn.textContent = 'Saving...';
  try {
    const res = await apiFetch(`/users/${userId}/assign-agent`, {
      method: 'PATCH',
      body: JSON.stringify({ agent_id: agentId })
    });
    showToast('success', 'Account Manager Assigned', res.message || 'Client portfolio updated.');
    closeAssignAgentModal();
    if (typeof loadUsers === 'function') loadUsers();
    if (typeof loadTeamMembers === 'function') loadTeamMembers();
  } catch (err) {
    showToast('error', 'Assignment Failed', err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Update Assignment';
  }
};

window.openTeamLeaveModal = async function(memberId) {
  const member = (teamMembersCache || []).find(m => m.id === memberId);
  if (!member) return;

  document.getElementById('leave-member-id').value = member.id;
  document.getElementById('leave-member-name-display').textContent = member.full_name || member.email;
  document.getElementById('leave-member-email-display').textContent = member.email;
  const assigned = member.assigned_clients_count || 0;
  document.getElementById('leave-member-clients-count').textContent = `Currently managing ${assigned} client account${assigned === 1 ? '' : 's'}`;

  const statusSelect = document.getElementById('leave-status-select');
  statusSelect.value = member.is_on_leave ? 'leave' : 'active';

  const backupSelect = document.getElementById('leave-backup-agent-select');
  backupSelect.innerHTML = '<option value="">Loading colleagues...</option>';

  const dateInput = document.getElementById('leave-end-date');
  if (dateInput) {
    dateInput.value = member.leave_end_date ? new Date(member.leave_end_date).toISOString().split('T')[0] : '';
  }
  const noteInput = document.getElementById('leave-note');
  if (noteInput) {
    noteInput.value = member.leave_note || '';
  }

  toggleLeaveFieldsVisibility();

  const modal = document.getElementById('modal-team-leave');
  if (modal) {
    modal.style.display = 'flex';
    if (window.lucide) lucide.createIcons();
  }

  try {
    const agents = await apiFetch('/team/agents');
    let opts = '<option value="">— Select Colleague / Backup Agent —</option>';
    (agents || []).forEach(ag => {
      if (ag.id !== member.user_id) {
        const isSel = String(ag.id) === String(member.backup_agent_id);
        opts += `<option value="${ag.id}" ${isSel ? 'selected' : ''}>${escapeHtml(ag.full_name || ag.email)} (${ag.role_title || 'Staff'}) — ${ag.assigned_clients_count || 0} Clients</option>`;
      }
    });
    backupSelect.innerHTML = opts;
  } catch (err) {
    backupSelect.innerHTML = `<option value="">Failed to load colleagues</option>`;
  }
};

window.closeTeamLeaveModal = function() {
  const modal = document.getElementById('modal-team-leave');
  if (modal) modal.style.display = 'none';
};

window.toggleLeaveFieldsVisibility = function() {
  const statusSelect = document.getElementById('leave-status-select');
  const detailsDiv = document.getElementById('leave-details-container');
  const btn = document.getElementById('btn-save-team-leave');
  if (statusSelect && detailsDiv) {
    const isLeave = statusSelect.value === 'leave';
    detailsDiv.style.display = isLeave ? 'block' : 'none';
    if (btn) {
      btn.textContent = isLeave ? 'Mark On Leave & Delegate' : 'Resume Normal Duty';
      btn.style.background = isLeave ? '#f59e0b' : '#16a34a';
    }
  }
};

window.handleTeamLeaveSubmit = async function(e) {
  e.preventDefault();
  const memberId = document.getElementById('leave-member-id').value;
  const status = document.getElementById('leave-status-select').value;
  const is_on_leave = (status === 'leave');
  const backup_agent_id = is_on_leave ? (document.getElementById('leave-backup-agent-select').value || null) : null;
  const leave_end_date = is_on_leave ? (document.getElementById('leave-end-date').value || null) : null;
  const leave_note = is_on_leave ? (document.getElementById('leave-note').value || null) : null;

  const btn = document.getElementById('btn-save-team-leave');
  btn.disabled = true;
  btn.textContent = 'Saving...';

  try {
    const res = await apiFetch(`/team/${memberId}/leave-status`, {
      method: 'POST',
      body: JSON.stringify({ is_on_leave, backup_agent_id, leave_end_date, leave_note })
    });
    showToast('success', is_on_leave ? 'Leave Delegated' : 'Duty Resumed', res.message);
    closeTeamLeaveModal();
    loadTeamMembers();
    if (typeof loadUsers === 'function') loadUsers();
  } catch (err) {
    showToast('error', 'Status Update Failed', err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Save Status';
  }
};

window.openTeamReassignModal = async function(userId, userName) {
  document.getElementById('reassign-from-user-id').value = userId;
  document.getElementById('reassign-from-name-display').textContent = userName || 'Staff Member';

  const select = document.getElementById('reassign-to-agent-select');
  select.innerHTML = '<option value="">Loading available agents...</option>';

  const modal = document.getElementById('modal-team-reassign');
  if (modal) {
    modal.style.display = 'flex';
    if (window.lucide) lucide.createIcons();
  }

  try {
    const agents = await apiFetch('/team/agents');
    let opts = '<option value="">— Select Target Account Manager —</option><option value="null">— Clear Assignment (Make Clients Unassigned) —</option>';
    (agents || []).forEach(ag => {
      if (ag.id !== userId) {
        opts += `<option value="${ag.id}">${escapeHtml(ag.full_name || ag.email)} (${ag.role_title || 'Agent'}) — Currently ${ag.assigned_clients_count || 0} Clients</option>`;
      }
    });
    select.innerHTML = opts;
  } catch (err) {
    select.innerHTML = `<option value="">Failed to load agents</option>`;
  }
};

window.closeTeamReassignModal = function() {
  const modal = document.getElementById('modal-team-reassign');
  if (modal) modal.style.display = 'none';
};

window.handleTeamReassignSubmit = async function(e) {
  e.preventDefault();
  const from_agent_id = document.getElementById('reassign-from-user-id').value;
  const toVal = document.getElementById('reassign-to-agent-select').value;
  const to_agent_id = toVal === 'null' ? null : (toVal || null);

  const btn = document.getElementById('btn-save-team-reassign');
  btn.disabled = true;
  btn.textContent = 'Transferring...';

  try {
    const res = await apiFetch('/team/reassign-clients', {
      method: 'POST',
      body: JSON.stringify({ from_agent_id, to_agent_id })
    });
    showToast('success', 'Portfolio Transferred', res.message || 'Client portfolio successfully reassigned.');
    closeTeamReassignModal();
    loadTeamMembers();
    if (typeof loadUsers === 'function') loadUsers();
  } catch (err) {
    showToast('error', 'Reassignment Failed', err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Transfer Clients';
  }
};

// ============================================================================
// BATCH CLIENT & RESELLER PORTFOLIO MANAGER MODAL
// ============================================================================
let portfolioModalAgentUserId = null;
let portfolioClientsCache = [];
let portfolioModalTypeFilter = 'all';

window.openPortfolioManagerModal = async function(agentUserId, agentName) {
  portfolioModalAgentUserId = agentUserId;
  portfolioModalTypeFilter = 'all';
  const nameDisp = document.getElementById('portfolio-agent-name-display');
  if (nameDisp) nameDisp.innerHTML = `Assigning accounts to: <strong>${escapeHtml(agentName)}</strong>`;

  const searchInput = document.getElementById('portfolio-client-search');
  if (searchInput) searchInput.value = '';

  // Reset filter tabs UI
  document.querySelectorAll('.btn-portfolio-tab').forEach(t => {
    if (t.dataset.type === 'all') {
      t.style.background = '#e0e7ff';
      t.style.color = '#3730a3';
      t.style.borderColor = '#c7d2fe';
    } else {
      t.style.background = '#fff';
      t.style.color = '#475569';
      t.style.borderColor = '#cbd5e1';
    }
  });

  const listContainer = document.getElementById('portfolio-clients-list');
  if (listContainer) {
    listContainer.innerHTML = '<div style="text-align:center;padding:24px;color:#94a3b8;">Loading accounts...</div>';
  }

  const modal = document.getElementById('modal-portfolio-manager');
  if (modal) {
    modal.style.display = 'flex';
    if (window.lucide) lucide.createIcons();
  }

  try {
    const res = await apiFetch(`/team/${agentUserId}/assignable-clients`);
    portfolioClientsCache = res.clients || [];
    renderPortfolioClientsList();
  } catch (err) {
    if (listContainer) {
      listContainer.innerHTML = `<div style="text-align:center;padding:24px;color:#ef4444;">Failed to load accounts: ${escapeHtml(err.message)}</div>`;
    }
  }
};

window.closePortfolioManagerModal = function() {
  const modal = document.getElementById('modal-portfolio-manager');
  if (modal) modal.style.display = 'none';
  portfolioModalAgentUserId = null;
  portfolioClientsCache = [];
  portfolioModalTypeFilter = 'all';
};

window.setPortfolioTypeFilter = function(type, btn) {
  portfolioModalTypeFilter = type;
  document.querySelectorAll('.btn-portfolio-tab').forEach(t => {
    t.style.background = '#fff';
    t.style.color = '#475569';
    t.style.borderColor = '#cbd5e1';
  });
  if (btn) {
    btn.style.background = '#e0e7ff';
    btn.style.color = '#3730a3';
    btn.style.borderColor = '#c7d2fe';
  }
  renderPortfolioClientsList();
};

function renderPortfolioClientsList() {
  const listContainer = document.getElementById('portfolio-clients-list');
  if (!listContainer) return;

  const query = (document.getElementById('portfolio-client-search')?.value || '').toLowerCase().trim();

  let filtered = portfolioClientsCache.filter(c => {
    if (portfolioModalTypeFilter === 'reseller' && c.role !== 'reseller') return false;
    if (portfolioModalTypeFilter === 'direct' && (c.role !== 'user' || c.reseller_id)) return false;
    if (query) {
      const match = (c.email || '').toLowerCase().includes(query) ||
                    (c.full_name || '').toLowerCase().includes(query) ||
                    (c.company_name || '').toLowerCase().includes(query);
      if (!match) return false;
    }
    return true;
  });

  if (!filtered || filtered.length === 0) {
    listContainer.innerHTML = `
      <div style="text-align:center;padding:32px;color:#94a3b8;">
        <i data-lucide="inbox" style="width:32px;height:32px;opacity:0.4;display:block;margin:0 auto 8px;"></i>
        No matching accounts found.
      </div>
    `;
    updatePortfolioSelectedCount();
    if (window.lucide) lucide.createIcons();
    return;
  }

  listContainer.innerHTML = filtered.map(c => {
    const isAssignedToThis = Number(c.assigned_agent_id) === Number(portfolioModalAgentUserId);
    const hasOtherAgent = c.assigned_agent_id && !isAssignedToThis;
    const isReseller = (c.role === 'reseller');

    let typeBadge = '';
    if (isReseller) {
      typeBadge = `<span style="font-size:0.72rem;padding:2px 8px;border-radius:12px;background:#eef2ff;color:#4f46e5;font-weight:700;border:1px solid #c7d2fe;">🏢 Reseller Partner · ${c.downstream_clients_count || 0} Clients</span>`;
    } else if (c.reseller_id) {
      typeBadge = `<span style="font-size:0.7rem;padding:2px 7px;border-radius:10px;background:#f8fafc;color:#64748b;border:1px solid #e2e8f0;">Client of: ${escapeHtml(c.parent_reseller_name || c.parent_reseller_email || 'Reseller')}</span>`;
    } else {
      typeBadge = `<span style="font-size:0.7rem;padding:2px 7px;border-radius:10px;background:#ecfdf5;color:#047857;font-weight:600;border:1px solid #a7f3d0;">👤 Direct Client</span>`;
    }

    let statusBadge = '';
    if (isAssignedToThis) {
      statusBadge = '<span style="font-size:0.7rem;padding:2px 7px;border-radius:10px;background:#dcfce7;color:#15803d;font-weight:700;">Managed by this agent</span>';
    } else if (hasOtherAgent) {
      statusBadge = `<span style="font-size:0.7rem;padding:2px 7px;border-radius:10px;background:#f1f5f9;color:#64748b;">Assigned: ${escapeHtml(c.current_agent_name || c.current_agent_email || 'Other')}</span>`;
    } else {
      statusBadge = '<span style="font-size:0.7rem;padding:2px 7px;border-radius:10px;background:#fffbeb;color:#b45309;">Unassigned</span>';
    }

    return `
      <label style="display:flex;align-items:flex-start;justify-content:space-between;padding:12px 14px;border:1px solid ${isAssignedToThis ? '#c7d2fe' : '#e2e8f0'};border-radius:9px;margin-bottom:8px;background:${isAssignedToThis ? '#f5f7ff' : (isReseller ? '#faf5ff' : '#fff')};cursor:pointer;transition:all 0.15s ease;">
        <div style="display:flex;align-items:flex-start;gap:12px;flex:1;min-width:0;">
          <input type="checkbox" class="portfolio-client-chk" value="${c.id}" ${isAssignedToThis ? 'checked' : ''} onchange="updatePortfolioSelectedCount()" style="width:18px;height:18px;accent-color:var(--primary);cursor:pointer;margin-top:2px;">
          <div style="min-width:0;flex:1;">
            <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
              <span style="font-weight:700;font-size:0.9rem;color:#1e293b;">
                ${escapeHtml(c.company_name || c.full_name || c.email)}
              </span>
              ${typeBadge}
            </div>
            <div style="font-size:0.8rem;color:#64748b;margin-top:2px;">
              ${escapeHtml(c.email)}
            </div>
            ${isReseller ? `
              <div style="font-size:0.74rem;color:#4f46e5;font-weight:600;margin-top:4px;">
                ✦ Assigning this reseller will automatically grant this agent management access to all ${c.downstream_clients_count || 0} downstream clients!
              </div>
            ` : ''}
          </div>
        </div>
        <div style="margin-left:10px;flex-shrink:0;">
          ${statusBadge}
        </div>
      </label>
    `;
  }).join('');

  updatePortfolioSelectedCount();
  if (window.lucide) lucide.createIcons();
}

function updatePortfolioSelectedCount() {
  const checkboxes = document.querySelectorAll('.portfolio-client-chk:checked');
  const countDisp = document.getElementById('portfolio-selected-count');
  if (countDisp) {
    countDisp.textContent = `${checkboxes.length} account${checkboxes.length === 1 ? '' : 's'} selected`;
  }
}

window.filterPortfolioClientsList = function() {
  renderPortfolioClientsList();
};

window.toggleAllPortfolioCheckboxes = function(check) {
  const visibleCheckboxes = document.querySelectorAll('.portfolio-client-chk');
  visibleCheckboxes.forEach(chk => {
    chk.checked = Boolean(check);
  });
  updatePortfolioSelectedCount();
};

window.savePortfolioManagerChanges = async function() {
  if (!portfolioModalAgentUserId) return;
  const checkboxes = document.querySelectorAll('.portfolio-client-chk:checked');
  const selectedClientIds = Array.from(checkboxes).map(chk => parseInt(chk.value, 10)).filter(n => !isNaN(n));

  const btn = document.getElementById('btn-save-portfolio');
  btn.disabled = true;
  btn.textContent = 'Saving...';

  try {
    const res = await apiFetch(`/team/${portfolioModalAgentUserId}/bulk-assign-clients`, {
      method: 'POST',
      body: JSON.stringify({ client_ids: selectedClientIds })
    });
    showToast('success', 'Portfolio Saved', res.message || 'Account portfolio updated.');
    closePortfolioManagerModal();
    loadTeamMembers();
    if (typeof loadUsers === 'function') loadUsers();
    if (typeof loadResellerNetwork === 'function') loadResellerNetwork();
  } catch (err) {
    showToast('error', 'Update Failed', err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Save Portfolio';
  }
};

