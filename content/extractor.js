/**
 * ScreenGrabber for Context - Semantic Content Extractor with PII Redaction
 * Injected into the active page to extract:
 * 1. Page metadata (route, title, meta)
 * 2. Visual layout & heading hierarchy
 * 3. Interactive controls (buttons, forms, links, inputs, dialogs)
 * 4. Navigational links for auto-crawler
 * 5. Synthesized LLM-ready screen documentation markdown
 * 6. Automated PII masking & visual blurring
 */

(() => {
  // PII Regex Patterns
  const PII_PATTERNS = {
    email: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g,
    phone: /\b(?:\+?\d{1,3}[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/g,
    creditCard: /\b(?:\d{4}[ -]?){3}\d{4}\b/g,
    apiKey: /\b(?:sk_(?:live|test)_[0-9a-zA-Z]{20,}|ghp_[0-9a-zA-Z]{30,}|(?:eyJh|bearer\s+)[A-Za-z0-9\-_.~+/=]{25,})\b/gi,
    ssn: /\b\d{3}-\d{2}-\d{4}\b/g
  };

  /**
   * Sanitizes text by replacing sensitive PII patterns with tokens
   */
  function sanitizePIIText(text) {
    if (!text || typeof text !== 'string') return text;
    return text
      .replace(PII_PATTERNS.email, '[REDACTED_EMAIL]')
      .replace(PII_PATTERNS.phone, '[REDACTED_PHONE]')
      .replace(PII_PATTERNS.creditCard, '[REDACTED_CARD]')
      .replace(PII_PATTERNS.apiKey, '[REDACTED_KEY]')
      .replace(PII_PATTERNS.ssn, '[REDACTED_SSN]');
  }

  /**
   * Checks if a string contains any PII
   */
  function containsPII(text) {
    if (!text || typeof text !== 'string') return false;
    return (
      PII_PATTERNS.email.test(text) ||
      PII_PATTERNS.phone.test(text) ||
      PII_PATTERNS.creditCard.test(text) ||
      PII_PATTERNS.apiKey.test(text) ||
      PII_PATTERNS.ssn.test(text)
    );
  }

  /**
   * Applies visual blurring to DOM elements containing PII before screenshot
   * Returns a cleanup function that restores original DOM state.
   */
  function applyVisualPIIRedaction() {
    const styleId = '__screengrabber_redact_style__';
    let styleEl = document.getElementById(styleId);
    if (!styleEl) {
      styleEl = document.createElement('style');
      styleEl.id = styleId;
      styleEl.textContent = `
        .sg-redacted-blur {
          filter: blur(7px) !important;
          user-select: none !important;
          transition: none !important;
        }
      `;
      document.head.appendChild(styleEl);
    }

    const modifiedElements = [];

    // Traverse all text nodes and inputs
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let currentNode;
    while ((currentNode = walker.nextNode())) {
      const parent = currentNode.parentElement;
      if (!parent || parent.tagName === 'SCRIPT' || parent.tagName === 'STYLE') continue;

      if (containsPII(currentNode.nodeValue)) {
        parent.classList.add('sg-redacted-blur');
        modifiedElements.push(parent);
      }
    }

    // Inspect inputs/textareas
    const formFields = document.querySelectorAll('input, textarea');
    formFields.forEach(field => {
      if (containsPII(field.value) || containsPII(field.placeholder)) {
        field.classList.add('sg-redacted-blur');
        modifiedElements.push(field);
      }
    });

    // Cleanup function
    return function removeVisualPIIRedaction() {
      modifiedElements.forEach(el => el.classList.remove('sg-redacted-blur'));
      if (styleEl && styleEl.parentNode) {
        styleEl.parentNode.removeChild(styleEl);
      }
    };
  }

  /**
   * Helper to determine if an element is visible
   */
  function isVisible(el) {
    if (!el || el.nodeType !== Node.ELEMENT_NODE) return false;
    const style = window.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  /**
   * Clean, normalize, and optionally sanitize text
   */
  function cleanText(text, redactPII = false) {
    if (!text) return '';
    let cleaned = text.replace(/\s+/g, ' ').trim();
    if (redactPII) {
      cleaned = sanitizePIIText(cleaned);
    }
    return cleaned;
  }

  /**
   * Extract heading hierarchy (H1 - H6)
   */
  function extractHeadings(redactPII = false) {
    const headings = [];
    const elements = document.querySelectorAll('h1, h2, h3, h4, h5, h6, [role="heading"]');
    elements.forEach(el => {
      if (!isVisible(el)) return;
      const level = el.tagName.startsWith('H') ? parseInt(el.tagName[1], 10) : parseInt(el.getAttribute('aria-level') || '2', 10);
      const text = cleanText(el.innerText || el.textContent, redactPII);
      if (text) {
        headings.push({ level, text });
      }
    });
    return headings;
  }

  /**
   * Extract navigation bars, menus, and sidebars
   */
  function extractNavigation(redactPII = false) {
    const navItems = [];
    const navContainers = document.querySelectorAll('nav, [role="navigation"], aside, header');
    navContainers.forEach(container => {
      if (!isVisible(container)) return;
      const links = container.querySelectorAll('a, button, [role="button"], [role="tab"]');
      links.forEach(link => {
        if (!isVisible(link)) return;
        const text = cleanText(link.innerText || link.getAttribute('aria-label') || link.title, redactPII);
        const href = link.getAttribute('href') || null;
        if (text && text.length < 60) {
          navItems.push({
            text,
            href,
            type: link.tagName.toLowerCase() === 'a' ? 'link' : 'action',
            role: link.getAttribute('role') || 'link'
          });
        }
      });
    });

    const seen = new Set();
    return navItems.filter(item => {
      const key = `${item.text}::${item.href}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  /**
   * Extract interactive controls (buttons, inputs, selects, CTAs)
   */
  function extractInteractiveElements(redactPII = false) {
    const elements = [];
    const candidates = document.querySelectorAll('button, input, select, textarea, [role="button"], [role="switch"], [role="checkbox"], [role="combobox"]');

    candidates.forEach(el => {
      if (!isVisible(el)) return;
      const tag = el.tagName.toLowerCase();
      const rect = el.getBoundingClientRect();
      const rawText = el.innerText || el.value || el.placeholder || el.getAttribute('aria-label') || el.title;
      const text = cleanText(rawText, redactPII);

      let type = tag;
      if (tag === 'input') {
        type = `input[type="${el.type || 'text'}"]`;
      } else if (el.getAttribute('role')) {
        type = el.getAttribute('role');
      }

      const isPrimary = el.classList.contains('primary') ||
                        el.getAttribute('data-variant') === 'primary' ||
                        /primary|cta|confirm|submit/i.test(el.className || '');

      elements.push({
        type,
        label: text || '(unlabeled)',
        isPrimary,
        disabled: el.disabled || el.getAttribute('aria-disabled') === 'true',
        position: {
          x: Math.round(rect.x),
          y: Math.round(rect.y),
          width: Math.round(rect.width),
          height: Math.round(rect.height)
        }
      });
    });

    return elements;
  }

  /**
   * Helper to determine if target hostname belongs to the same domain or subdomain
   */
  function isSameOrSubdomain(targetHostname, currentHostname) {
    if (targetHostname === currentHostname) return true;
    const tParts = targetHostname.split('.');
    const cParts = currentHostname.split('.');
    if (tParts.length >= 2 && cParts.length >= 2) {
      const tBase = tParts.slice(-2).join('.');
      const cBase = cParts.slice(-2).join('.');
      return tBase === cBase;
    }
    return false;
  }

  /**
   * Normalizes path string from Angular routerLink, React to, or data attributes
   */
  function extractPathFromAttribute(val) {
    if (!val || typeof val !== 'string') return null;
    let cleaned = val.trim();
    if (cleaned === '#' || cleaned.startsWith('javascript:')) return null;

    // Handle Angular array syntax, e.g. ['/people'] or ['time-off'] or ['/employee', id]
    if (cleaned.startsWith('[') && cleaned.endsWith(']')) {
      cleaned = cleaned.slice(1, -1)
        .replace(/['"]/g, '')
        .split(',')
        .map(s => s.trim())
        .filter(Boolean)
        .join('/');
    }

    cleaned = cleaned.trim();
    if (!cleaned) return null;

    // Direct path or hash
    if (cleaned.startsWith('/') || cleaned.startsWith('#') || cleaned.startsWith('http://') || cleaned.startsWith('https://')) {
      return cleaned;
    }

    // Relative slug, e.g. "people", "time-off", "payroll"
    if (/^[a-zA-Z0-9_\-\/]+$/.test(cleaned) && !cleaned.includes(' ') && cleaned.length > 1 && cleaned.length < 80) {
      return `/${cleaned.replace(/^\/+/, '')}`;
    }

    return null;
  }

  /**
   * Recursively gathers all elements in the page, piercing open Shadow DOM trees
   */
  function collectAllElementsDeep(root = document) {
    const elements = [];
    const stack = [root];
    let shadowCount = 0;

    while (stack.length > 0) {
      const current = stack.pop();
      if (!current) continue;

      if (current.shadowRoot) {
        shadowCount++;
        stack.push(current.shadowRoot);
      }

      if (current.nodeType === Node.ELEMENT_NODE) {
        elements.push(current);
      }

      const children = current.children || [];
      for (let i = children.length - 1; i >= 0; i--) {
        stack.push(children[i]);
      }
    }

    return { elements, shadowCount };
  }

  /**
   * Extract discoverable internal links for crawler
   */
  function extractCrawlerLinks() {
    const currentHostname = window.location.hostname;
    const currentHref = window.location.href.replace(/\/+$/, '');
    const currentPath = window.location.pathname.replace(/\/+$/, '') || '/';
    const currentHash = window.location.hash;

    const links = [];
    const destructiveKeywords = ['delete', 'remove', 'logout', 'log out', 'sign out', 'disconnect', 'cancel subscription', 'terminate'];

    // Traverse all DOM elements including inside Shadow Roots
    const { elements } = collectAllElementsDeep(document);

    // List of attributes commonly holding router destinations
    const ROUTE_ATTRIBUTES = [
      'href',
      'ng-reflect-router-link',
      'routerlink',
      'router-link',
      'to',
      'data-href',
      'data-route',
      'data-path',
      'data-url',
      'data-nav',
      'data-target',
      'data-link'
    ];

    elements.forEach(el => {
      try {
        let rawDest = null;
        for (const attr of ROUTE_ATTRIBUTES) {
          const val = el.getAttribute(attr);
          if (val) {
            const parsed = extractPathFromAttribute(val);
            if (parsed) {
              rawDest = parsed;
              break;
            }
          }
        }

        // If no explicit route attribute, check if element is a menuitem or nav item with a route in any attribute
        if (!rawDest) {
          const role = el.getAttribute('role');
          const isNavItem = role === 'menuitem' || role === 'tab' || role === 'link' || el.tagName === 'A';
          if (isNavItem) {
            for (let i = 0; i < el.attributes.length; i++) {
              const attr = el.attributes[i];
              if (attr.value && (attr.value.startsWith('/') || attr.value.startsWith('#/'))) {
                const parsed = extractPathFromAttribute(attr.value);
                if (parsed) {
                  rawDest = parsed;
                  break;
                }
              }
            }
          }
        }

        if (!rawDest) return;

        const url = new URL(rawDest, window.location.href);

        // Enforce same domain or product subdomain
        if (!isSameOrSubdomain(url.hostname, currentHostname)) return;

        // Skip exact duplicate of the current page
        const cleanUrlHref = url.href.replace(/\/+$/, '');
        if (cleanUrlHref === currentHref) return;

        // Handle same pathname with hash:
        // Ignore generic in-page scroll jumps like #top, #main, #content
        const cleanUrlPath = url.pathname.replace(/\/+$/, '') || '/';
        if (cleanUrlPath === currentPath) {
          if (!url.hash || url.hash === '#' || url.hash === '#top' || url.hash === '#main' || url.hash === '#content' || url.hash === currentHash) {
            return;
          }
        }

        const label = cleanText(el.innerText || el.getAttribute('aria-label') || el.title || el.getAttribute('data-qa') || el.getAttribute('data-bob-qa'));
        const lowerLabel = label.toLowerCase();
        const lowerPath = url.pathname.toLowerCase();

        // Skip destructive actions
        if (destructiveKeywords.some(kw => lowerLabel.includes(kw) || lowerPath.includes(kw))) {
          return;
        }

        // Avoid common file asset downloads (PDF, CSV, ZIP, PNG, etc.)
        if (/\.(pdf|csv|zip|tar|gz|exe|dmg|png|jpg|jpeg|gif|svg)$/i.test(url.pathname)) {
          return;
        }

        links.push({
          url: url.href,
          pathname: url.pathname + url.search + url.hash,
          label: label || url.pathname
        });
      } catch (_) {}
    });

    // Deduplicate by normalized URL
    const uniqueMap = new Map();
    links.forEach(l => {
      const key = l.url.replace(/\/+$/, '');
      if (!uniqueMap.has(key)) {
        uniqueMap.set(key, l);
      }
    });

    return Array.from(uniqueMap.values());
  }

  /**
   * Generates high-level summary and Markdown description tailored for AI Video / Explainer Agents
   */
  function generateScreenMarkdown(metadata, headings, nav, interactive) {
    const primaryCTAs = interactive.filter(i => i.isPrimary && i.label !== '(unlabeled)');
    const buttons = interactive.filter(i => (i.type === 'button' || i.type === 'link') && i.label !== '(unlabeled)');
    const inputs = interactive.filter(i => i.type.startsWith('input') || i.type === 'select' || i.type === 'textarea');

    let md = `# Screen: ${metadata.title || 'Untitled Page'}\n\n`;
    md += `**URL:** \`${metadata.url}\`  \n`;
    md += `**Route:** \`${metadata.pathname}\`  \n`;
    md += `**Timestamp:** ${metadata.timestamp}  \n\n`;

    md += `## 1. Overview & Purpose\n`;
    const h1 = headings.find(h => h.level === 1);
    if (h1) {
      md += `Primary Screen Heading: **${h1.text}**.\n\n`;
    }
    md += `This screen represents the \`${metadata.pathname}\` view in the application. `;
    if (primaryCTAs.length > 0) {
      md += `The primary call-to-action on this page is **"${primaryCTAs.map(c => c.label).join('", "')}"**.\n\n`;
    } else {
      md += `It provides content inspection, configuration, or analytical views.\n\n`;
    }

    if (headings.length > 0) {
      md += `## 2. Page Structure & Sections\n`;
      headings.forEach(h => {
        const indent = '  '.repeat(Math.max(0, h.level - 1));
        md += `${indent}- **H${h.level}**: ${h.text}\n`;
      });
      md += `\n`;
    }

    if (nav.length > 0) {
      md += `## 3. Visible Navigation Options\n`;
      const navList = nav.slice(0, 15).map(n => `\`${n.text}\``).join(', ');
      md += `Available navigation links: ${navList}${nav.length > 15 ? ` (and ${nav.length - 15} more)` : ''}.\n\n`;
    }

    if (interactive.length > 0) {
      md += `## 4. Key Interactive Elements\n`;
      if (buttons.length > 0) {
        md += `- **Actions / Buttons (${buttons.length}):** ${buttons.slice(0, 12).map(b => `[${b.label}]`).join(' ')}\n`;
      }
      if (inputs.length > 0) {
        md += `- **Form Fields / Inputs (${inputs.length}):** ${inputs.slice(0, 8).map(i => `\`${i.label || i.type}\``).join(', ')}\n`;
      }
      md += `\n`;
    }

    md += `## 5. Agent Video & Explainer Context\n`;
    md += `- **Visual Focal Point:** ${h1 ? h1.text : metadata.title}\n`;
    md += `- **Next Logical Actions:** ${buttons.slice(0, 3).map(b => `Click "${b.label}"`).join(' or ') || 'Review displayed content'}.\n`;

    return md;
  }

  /**
   * Main capture invocation
   */
  window.__SCREEN_GRABBER_EXTRACT__ = function(options = {}) {
    const redactPII = !!options.redactPII;

    // Apply visual redaction before capture if requested
    let restoreVisuals = null;
    if (redactPII) {
      restoreVisuals = applyVisualPIIRedaction();
    }

    const metadata = {
      title: cleanText(document.title || 'Untitled', redactPII),
      url: window.location.href,
      origin: window.location.origin,
      pathname: window.location.pathname,
      search: window.location.search,
      timestamp: new Date().toISOString(),
      redactedPII: redactPII,
      viewport: {
        width: window.innerWidth,
        height: window.innerHeight,
        scrollWidth: document.documentElement.scrollWidth,
        scrollHeight: document.documentElement.scrollHeight
      }
    };

    const headings = extractHeadings(redactPII);
    const navigation = extractNavigation(redactPII);
    const interactive = extractInteractiveElements(redactPII);
    const crawlerLinks = extractCrawlerLinks();
    const markdown = generateScreenMarkdown(metadata, headings, navigation, interactive);

    return {
      metadata,
      headings,
      navigation,
      interactive,
      crawlerLinks,
      markdown,
      hasVisualRedaction: !!restoreVisuals,
      // Provide restore function handler to clean up DOM after screenshot
      _restoreHook: () => {
        if (restoreVisuals) restoreVisuals();
      }
    };
  };

  // Expose live diagnostic inspector for live testing
  window.__SCREEN_GRABBER_DIAGNOSE_LINKS__ = function() {
    const { elements, shadowCount } = collectAllElementsDeep(document);
    const crawlerLinks = extractCrawlerLinks();
    return {
      url: window.location.href,
      hostname: window.location.hostname,
      totalElements: elements.length,
      shadowRootsCount: shadowCount,
      crawlerLinksCount: crawlerLinks.length,
      crawlerLinks: crawlerLinks
    };
  };

  // Expose explicit cleanup method
  window.__SCREEN_GRABBER_RESTORE_VISUALS__ = function() {
    const styleEl = document.getElementById('__screengrabber_redact_style__');
    if (styleEl && styleEl.parentNode) {
      styleEl.parentNode.removeChild(styleEl);
    }
    document.querySelectorAll('.sg-redacted-blur').forEach(el => {
      el.classList.remove('sg-redacted-blur');
    });
  };

  return true;
})();
