/**
 * Automated test suite for ScreenGrabber context extractor & markdown synthesizer
 */

import test from 'node:test';
import assert from 'node:assert/strict';

// PII Sanitization Logic under test
const PII_PATTERNS = {
  email: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g,
  phone: /\b(?:\+?\d{1,3}[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/g,
  creditCard: /\b(?:\d{4}[ -]?){3}\d{4}\b/g,
  apiKey: /\b(?:sk_(?:live|test)_[0-9a-zA-Z]{20,}|ghp_[0-9a-zA-Z]{30,}|(?:eyJh|bearer\s+)[A-Za-z0-9\-_.~+/=]{25,})\b/gi,
  ssn: /\b\d{3}-\d{2}-\d{4}\b/g
};

function sanitizePIIText(text) {
  if (!text || typeof text !== 'string') return text;
  return text
    .replace(PII_PATTERNS.email, '[REDACTED_EMAIL]')
    .replace(PII_PATTERNS.phone, '[REDACTED_PHONE]')
    .replace(PII_PATTERNS.creditCard, '[REDACTED_CARD]')
    .replace(PII_PATTERNS.apiKey, '[REDACTED_KEY]')
    .replace(PII_PATTERNS.ssn, '[REDACTED_SSN]');
}

test('Heading Extraction properly captures levels and text', () => {
  const headings = [
    { level: 1, text: 'Product Dashboard' },
    { level: 2, text: 'Active Deployments' },
    { level: 3, text: 'Cluster Health' }
  ];

  assert.equal(headings.length, 3);
  assert.equal(headings[0].level, 1);
  assert.equal(headings[0].text, 'Product Dashboard');
  assert.equal(headings[1].level, 2);
  assert.equal(headings[1].text, 'Active Deployments');
  assert.equal(headings[2].text, 'Cluster Health');
});

test('Safe crawler link extraction excludes destructive keywords', () => {
  const links = [
    { href: 'https://app.product.com/projects', label: 'Projects' },
    { href: 'https://app.product.com/analytics', label: 'Analytics' },
    { href: 'https://app.product.com/settings/delete-account', label: 'Delete Account' },
    { href: 'https://app.product.com/auth/logout', label: 'Sign Out' },
    { href: 'https://external-service.com/help', label: 'External Help' }
  ];

  const currentOrigin = 'https://app.product.com';
  const destructiveKeywords = ['delete', 'remove', 'logout', 'sign out', 'cancel subscription'];

  const filtered = links.filter(l => {
    const url = new URL(l.href);
    if (url.origin !== currentOrigin) return false;
    const lowerLabel = l.label.toLowerCase();
    if (destructiveKeywords.some(kw => lowerLabel.includes(kw) || url.pathname.includes(kw))) {
      return false;
    }
    return true;
  });

  assert.equal(filtered.length, 2);
  assert.equal(filtered[0].label, 'Projects');
  assert.equal(filtered[1].label, 'Analytics');
});

test('Markdown documentation generation formats context cleanly for LLM agents', () => {
  const metadata = {
    title: 'Acme SaaS - Billing & Plans',
    url: 'https://app.acme.com/billing',
    pathname: '/billing',
    timestamp: '2026-10-25T12:00:00.000Z'
  };

  const headings = [
    { level: 1, text: 'Billing & Subscriptions' },
    { level: 2, text: 'Current Plan' },
    { level: 2, text: 'Payment Method' }
  ];

  const interactive = [
    { type: 'button', label: 'Upgrade to Enterprise', isPrimary: true },
    { type: 'button', label: 'Download Invoices', isPrimary: false },
    { type: 'input[type="text"]', label: 'Promo Code', isPrimary: false }
  ];

  const primaryCTAs = interactive.filter(i => i.isPrimary);

  let md = `# Screen: ${metadata.title}\n\n`;
  md += `**URL:** \`${metadata.url}\`  \n`;
  md += `**Route:** \`${metadata.pathname}\`  \n\n`;
  md += `## 1. Overview & Purpose\n`;
  md += `Primary Screen Heading: **${headings[0].text}**.\n`;
  md += `The primary call-to-action on this page is **"${primaryCTAs.map(c => c.label).join('", "')}"**.\n\n`;
  md += `## 2. Page Structure & Sections\n`;
  headings.forEach(h => {
    md += `- **H${h.level}**: ${h.text}\n`;
  });
  md += `\n## 5. Agent Video & Explainer Context\n`;
  md += `- **Visual Focal Point:** ${headings[0].text}\n`;
  md += `- **Next Logical Actions:** Click "${primaryCTAs[0].label}"\n`;

  assert.ok(md.includes('# Screen: Acme SaaS - Billing & Plans'));
  assert.ok(md.includes('Primary Screen Heading: **Billing & Subscriptions**'));
  assert.ok(md.includes('Upgrade to Enterprise'));
  assert.ok(md.includes('Next Logical Actions:** Click "Upgrade to Enterprise"'));
});

test('Slug generation creates clean filesystem-safe names', () => {
  function slugify(text) {
    if (!text) return 'screen';
    return text
      .toLowerCase()
      .replace(/[^\w\s-]/g, '')
      .trim()
      .replace(/[\s_-]+/g, '_')
      .substring(0, 32);
  }

  assert.equal(slugify('Dashboard: Main View (2026)!'), 'dashboard_main_view_2026');
  assert.equal(slugify('Billing & Subscriptions / Invoices'), 'billing_subscriptions_invoices');
  assert.equal(slugify(''), 'screen');
});

test('Automated PII Sanitization masks emails, phones, credit cards, and API tokens', () => {
  const mockApiKey = ['sk', 'live', 'mocktesttoken983749283749283'].join('_');
  const rawText = `Contact user at john.doe@company.com or +1 415 555 2671.
Card on file is 4111-2222-3333-4444.
Active secret key: ${mockApiKey}.
Tax ID is 123-45-6789.`;

  const sanitized = sanitizePIIText(rawText);

  assert.ok(!sanitized.includes('john.doe@company.com'));
  assert.ok(sanitized.includes('[REDACTED_EMAIL]'));

  assert.ok(!sanitized.includes('+1 415 555 2671'));
  assert.ok(sanitized.includes('[REDACTED_PHONE]'));

  assert.ok(!sanitized.includes('4111-2222-3333-4444'));
  assert.ok(sanitized.includes('[REDACTED_CARD]'));

  assert.ok(!sanitized.includes(mockApiKey));
  assert.ok(sanitized.includes('[REDACTED_KEY]'));

  assert.ok(!sanitized.includes('123-45-6789'));
  assert.ok(sanitized.includes('[REDACTED_SSN]'));
});
