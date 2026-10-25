/**
 * ScreenGrabber for Context - Side Panel Controller
 * Handles user interactions, capture orchestration, auto-crawling loop,
 * and direct streaming to the chosen directory via FileSystemManager.
 */

import { FileSystemManager } from '../lib/fs-manager.js';

// Application State
const state = {
  fsManager: new FileSystemManager(),
  isBusy: false,
  isCrawling: false,
  crawlQueue: [],
  visitedUrls: new Set(),
  stepIndex: 1,
  manifest: {
    sessionId: `run_${Date.now()}`,
    startTime: new Date().toISOString(),
    steps: []
  }
};

// DOM Elements
const dom = {
  connectionStatus: document.getElementById('connection-status'),
  btnSelectFolder: document.getElementById('btn-select-folder'),
  folderPathText: document.getElementById('folder-path-text'),
  storageModePill: document.getElementById('storage-mode-pill'),
  tabBtns: document.querySelectorAll('.tab-btn'),
  tabPanels: document.querySelectorAll('.tab-content'),
  btnCaptureNow: document.getElementById('btn-capture-now'),
  stepCustomName: document.getElementById('step-custom-name'),
  btnStartCrawl: document.getElementById('btn-start-crawl'),
  btnInspectPage: document.getElementById('btn-inspect-page'),
  btnStopCrawl: document.getElementById('btn-stop-crawl'),
  crawlMaxScreens: document.getElementById('crawl-max-screens'),
  crawlDelay: document.getElementById('crawl-delay'),
  crawlPathPrefix: document.getElementById('crawl-path-prefix'),
  crawlAllowSubdomains: document.getElementById('crawl-allow-subdomains'),
  crawlStatusBox: document.getElementById('crawl-status-box'),
  crawlStatusText: document.getElementById('crawl-status-text'),
  crawlLogList: document.getElementById('crawl-log-list'),
  btnClearCrawlLog: document.getElementById('btn-clear-crawl-log'),
  settingScale: document.getElementById('setting-scale'),
  settingFormat: document.getElementById('setting-format'),
  settingFullPage: document.getElementById('setting-full-page'),
  settingRedactPII: document.getElementById('setting-redact-pii'),
  capturedCount: document.getElementById('captured-count'),
  capturedList: document.getElementById('captured-list'),
  emptyState: document.getElementById('empty-state'),
  btnClearSession: document.getElementById('btn-clear-session'),
  toast: document.getElementById('toast')
};

// Helpers
function showToast(message, duration = 3000) {
  dom.toast.textContent = message;
  dom.toast.classList.remove('hidden');
  setTimeout(() => {
    dom.toast.classList.add('hidden');
  }, duration);
}

function setBusy(busy, text = 'Processing...') {
  state.isBusy = busy;
  dom.btnCaptureNow.disabled = busy;
  dom.btnSelectFolder.disabled = busy;
  if (busy) {
    dom.connectionStatus.textContent = text;
    dom.connectionStatus.classList.add('busy');
  } else {
    dom.connectionStatus.textContent = state.isCrawling ? 'Crawling...' : 'Ready';
    if (!state.isCrawling) dom.connectionStatus.classList.remove('busy');
  }
}

function slugify(text) {
  if (!text) return 'screen';
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/[\s_-]+/g, '_')
    .substring(0, 32);
}

/**
 * Generate aggregate summary.md across all captured steps
 */
function generateSessionSummary() {
  let md = `# Product Screen Walkthrough Summary\n\n`;
  md += `**Session ID:** \`${state.manifest.sessionId}\`  \n`;
  md += `**Started:** ${state.manifest.startTime}  \n`;
  md += `**Screens Captured:** ${state.manifest.steps.length}  \n\n`;

  md += `## Screen Index & Navigation Flow\n\n`;
  state.manifest.steps.forEach((step, idx) => {
    md += `### ${idx + 1}. ${step.title || 'Untitled Screen'}\n`;
    md += `- **Slug:** \`${step.slug}\`\n`;
    md += `- **Route:** \`${step.route}\`\n`;
    md += `- **Screenshot:** [\`screenshots/${step.screenshotFile}\`](./screenshots/${step.screenshotFile})\n`;
    md += `- **Context Metadata:** [\`context/${step.contextJsonFile}\`](./context/${step.contextJsonFile}) | [\`context/${step.contextMdFile}\`](./context/${step.contextMdFile})\n\n`;
  });

  return md;
}

/**
 * Update UI list with new captured item
 */
function appendCaptureToUI(step) {
  if (dom.emptyState) {
    dom.emptyState.style.display = 'none';
  }

  dom.capturedCount.textContent = state.manifest.steps.length;

  const item = document.createElement('div');
  item.className = 'capture-item';
  item.innerHTML = `
    <img class="capture-thumb" src="${step.thumbnail}" alt="${step.title}">
    <div class="capture-info">
      <div class="capture-title">${step.title}</div>
      <div class="capture-route">${step.route}</div>
    </div>
    <span class="capture-badge">#${step.stepIndex}</span>
  `;

  dom.capturedList.prepend(item);
}

/**
 * Connect to output directory
 */
dom.btnSelectFolder.addEventListener('click', async () => {
  try {
    const res = await state.fsManager.selectDirectory();
    if (res.success) {
      dom.folderPathText.textContent = `📁 ${res.folderName} (Ready for streaming)`;
      dom.folderPathText.classList.add('active');
      dom.storageModePill.textContent = 'Direct Folder';
      dom.storageModePill.classList.add('connected');
      showToast(`Connected to folder: ${res.folderName}`);
    }
  } catch (err) {
    console.error('Directory Picker Error:', err);
    showToast(`Failed: ${err.message}`);
  }
});

/**
 * Tab switching
 */
dom.tabBtns.forEach(btn => {
  btn.addEventListener('click', () => {
    dom.tabBtns.forEach(b => b.classList.remove('active'));
    dom.tabPanels.forEach(p => p.classList.remove('active'));

    btn.classList.add('active');
    const tabName = btn.dataset.tab;
    document.getElementById(`panel-${tabName}`).classList.add('active');
  });
});

/**
 * Normalize URLs for visited set and deduplication
 */
function normalizeUrl(rawUrl) {
  try {
    const u = new URL(rawUrl);
    const cleanPath = u.pathname.replace(/\/+$/, '') || '/';
    return `${u.origin}${cleanPath}${u.search}${u.hash}`;
  } catch (_) {
    return rawUrl;
  }
}

/**
 * Capture current active tab screen & extract context
 */
async function performCapture(customSlug = null, explicitTabId = null) {
  setBusy(true, 'Capturing...');

  try {
    // 1. Get target tab
    let tabId = explicitTabId;
    if (!tabId) {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab || !tab.id) {
        throw new Error('No active browser tab found.');
      }
      tabId = tab.id;
    }

    // 2. Inject context extractor script
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ['content/extractor.js']
    });

    const redactPII = dom.settingRedactPII ? dom.settingRedactPII.checked : true;

    // 3. Extract DOM metadata and apply visual blur if requested
    const [execResult] = await chrome.scripting.executeScript({
      target: { tabId },
      func: (redact) => window.__SCREEN_GRABBER_EXTRACT__({ redactPII: redact }),
      args: [redactPII]
    });

    const contextData = execResult.result;

    // 4. Capture High-Res Screenshot via background service worker
    const captureOptions = {
      fullPage: dom.settingFullPage.checked,
      scale: parseFloat(dom.settingScale.value) || 2,
      format: dom.settingFormat.value || 'png'
    };

    let shotResponse;
    try {
      shotResponse = await chrome.runtime.sendMessage({
        type: 'CAPTURE_SCREEN',
        tabId,
        options: captureOptions
      });
    } finally {
      // Immediately restore DOM visuals so the user's active page is untouched
      if (redactPII) {
        await chrome.scripting.executeScript({
          target: { tabId },
          func: () => {
            if (typeof window.__SCREEN_GRABBER_RESTORE_VISUALS__ === 'function') {
              window.__SCREEN_GRABBER_RESTORE_VISUALS__();
            }
          }
        }).catch(() => {});
      }
    }

    if (!shotResponse || !shotResponse.success) {
      throw new Error(shotResponse?.error || 'Screenshot capture failed');
    }

    // 5. Determine slug & filenames
    const currentStepIndex = state.stepIndex++;
    const slug = customSlug || slugify(dom.stepCustomName.value || contextData.metadata.title || `screen_${currentStepIndex}`);
    const indexStr = String(currentStepIndex).padStart(2, '0');
    const screenshotFile = `${indexStr}_${slug}.${captureOptions.format}`;
    const contextJsonFile = `${indexStr}_${slug}.json`;
    const contextMdFile = `${indexStr}_${slug}.md`;

    // 6. Record step in session manifest
    const stepRecord = {
      stepIndex: currentStepIndex,
      slug,
      title: contextData.metadata.title,
      route: contextData.metadata.pathname,
      url: contextData.metadata.url,
      timestamp: new Date().toISOString(),
      dimensions: {
        width: shotResponse.width,
        height: shotResponse.height,
        scale: shotResponse.scale
      },
      screenshotFile,
      contextJsonFile,
      contextMdFile,
      thumbnail: shotResponse.dataUrl
    };

    state.manifest.steps.push(stepRecord);
    state.visitedUrls.add(normalizeUrl(contextData.metadata.url));

    // 7. Stream and persist directly to disk
    const sessionSummary = generateSessionSummary();
    const saveResult = await state.fsManager.saveCaptureStep(
      currentStepIndex,
      slug,
      {
        screenshot: shotResponse,
        context: contextData
      },
      state.manifest,
      sessionSummary
    );

    // 8. Update UI
    appendCaptureToUI(stepRecord);
    dom.stepCustomName.value = '';
    showToast(`Saved Step #${currentStepIndex}: ${slug}`);

    return {
      success: true,
      contextData,
      stepRecord
    };
  } catch (err) {
    console.error('Capture Error:', err);
    showToast(`Error: ${err.message}`);
    return { success: false, error: err.message };
  } finally {
    setBusy(false);
  }
}

// Guided Capture Button
dom.btnCaptureNow.addEventListener('click', () => {
  performCapture();
});

// Clear Session
dom.btnClearSession.addEventListener('click', () => {
  if (confirm('Clear current session history in the side panel?')) {
    state.manifest.steps = [];
    state.stepIndex = 1;
    state.visitedUrls.clear();
    dom.capturedCount.textContent = '0';
    dom.capturedList.innerHTML = '';
    if (dom.emptyState) {
      dom.capturedList.appendChild(dom.emptyState);
      dom.emptyState.style.display = 'flex';
    }
    showToast('Session cleared.');
  }
});

/**
 * Diagnostic logger for Auto-Crawl
 */
function addCrawlLog(msg, type = 'info') {
  if (!dom.crawlLogList) return;
  const empty = dom.crawlLogList.querySelector('.crawl-log-empty');
  if (empty) empty.remove();

  const time = new Date().toTimeString().split(' ')[0];
  const entry = document.createElement('div');
  entry.className = `crawl-log-entry ${type}`;
  entry.textContent = `[${time}] ${msg}`;
  dom.crawlLogList.appendChild(entry);
  dom.crawlLogList.scrollTop = dom.crawlLogList.scrollHeight;
}

if (dom.btnClearCrawlLog) {
  dom.btnClearCrawlLog.addEventListener('click', () => {
    if (dom.crawlLogList) {
      dom.crawlLogList.innerHTML = '<div class="crawl-log-empty">Logs cleared.</div>';
    }
  });
}

/**
 * Auto-Crawl Engine
 */
async function runAutoCrawl() {
  state.isCrawling = true;
  dom.btnStartCrawl.disabled = true;
  dom.btnStopCrawl.disabled = false;
  dom.connectionStatus.textContent = 'Crawling...';
  dom.connectionStatus.classList.add('busy');
  dom.crawlStatusBox.classList.add('active');

  const maxScreens = parseInt(dom.crawlMaxScreens.value, 10) || 15;
  const delaySec = parseInt(dom.crawlDelay.value, 10) || 2;
  const customPrefix = (dom.crawlPathPrefix.value || '').trim();
  const allowSubdomains = dom.crawlAllowSubdomains ? dom.crawlAllowSubdomains.checked : true;

  try {
    const [initialTab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!initialTab || !initialTab.id) throw new Error('No active browser tab found to crawl.');

    const initialUrl = new URL(initialTab.url);

    // Filter helper: domain boundary + optional path prefix
    const isAllowedTarget = (targetUrl) => {
      if (!targetUrl) return true; // In-app navigation actions (e.g. Org, Time, Docs) are always allowed
      try {
        const u = new URL(targetUrl);
        if (allowSubdomains) {
          const tParts = u.hostname.split('.');
          const iParts = initialUrl.hostname.split('.');
          const tBase = tParts.slice(-2).join('.');
          const iBase = iParts.slice(-2).join('.');
          if (tBase !== iBase) return false;
        } else {
          if (u.origin !== initialUrl.origin) return false;
        }
        if (customPrefix && !u.pathname.startsWith(customPrefix)) return false;
        return true;
      } catch (_) {
        return false;
      }
    };

    addCrawlLog(`Starting crawl on ${initialUrl.hostname}...`, 'info');
    dom.crawlStatusText.textContent = 'Capturing starting screen...';

    // 1. Capture current starting screen
    const firstResult = await performCapture(null, initialTab.id);
    if (!firstResult.success) {
      throw new Error(firstResult.error || 'Failed to capture starting screen.');
    }

    addCrawlLog(`Screen #1 captured (${firstResult.stepRecord.title || 'Start'}).`, 'success');

    // 2. Discover and queue internal links
    const rawLinks = firstResult.contextData.crawlerLinks || [];
    let queue = rawLinks
      .filter(l => !state.visitedUrls.has(normalizeUrl(l.url)))
      .filter(l => isAllowedTarget(l.url));

    addCrawlLog(`Discovered ${rawLinks.length} links on starting screen (${queue.length} new queued).`, 'info');
    dom.crawlStatusText.textContent = `Found ${queue.length} links queued. Crawling...`;

    if (queue.length === 0) {
      addCrawlLog('No additional unvisited internal links found on starting page.', 'warn');
    }

    // 3. Sequential crawling loop
    while (state.isCrawling && queue.length > 0 && state.manifest.steps.length < maxScreens) {
      const nextTarget = queue.shift();
      const targetIdentifier = nextTarget.targetKey || (nextTarget.url ? normalizeUrl(nextTarget.url) : nextTarget.label);

      if (state.visitedUrls.has(targetIdentifier)) {
        addCrawlLog(`Skipping ${nextTarget.label} (already captured).`, 'info');
        continue;
      }

      const screenNum = state.manifest.steps.length + 1;
      const progressMsg = `[Screen ${screenNum}/${maxScreens}] ${nextTarget.label}`;
      dom.crawlStatusText.textContent = `Navigating: ${nextTarget.label}... (${queue.length} left)`;
      showToast(progressMsg);

      if (nextTarget.type === 'click') {
        // Execute click on primary navigation button
        addCrawlLog(`Opening menu action #${screenNum}: ${nextTarget.label}`, 'info');
        await chrome.scripting.executeScript({
          target: { tabId: initialTab.id },
          files: ['content/extractor.js']
        });

        await chrome.scripting.executeScript({
          target: { tabId: initialTab.id },
          func: (actionData) => {
            if (typeof window.__SCREEN_GRABBER_TRIGGER_NAV_ACTION__ === 'function') {
              return window.__SCREEN_GRABBER_TRIGGER_NAV_ACTION__(actionData);
            }
          },
          args: [{ selector: nextTarget.selector, label: nextTarget.label, ariaLabel: nextTarget.ariaLabel }]
        });
      } else {
        // Navigate tab to target URL
        addCrawlLog(`Navigating to #${screenNum}: ${nextTarget.label || nextTarget.pathname}`, 'info');
        await chrome.runtime.sendMessage({
          type: 'NAVIGATE_TAB',
          tabId: initialTab.id,
          url: nextTarget.url
        });
      }

      // Allow dynamic renders, flyouts & hydration to settle
      await new Promise(r => setTimeout(r, (delaySec * 1000) + 800));

      // Capture newly loaded/revealed screen
      const captureRes = await performCapture(slugify(nextTarget.label), initialTab.id);
      state.visitedUrls.add(targetIdentifier);

      if (captureRes.success && captureRes.contextData) {
        addCrawlLog(`Screen #${screenNum} (${nextTarget.label}) captured successfully.`, 'success');

        // Enqueue newly discovered links on this new page or flyout
        const newDiscovered = (captureRes.contextData.crawlerLinks || [])
          .filter(l => {
            const key = l.targetKey || (l.url ? normalizeUrl(l.url) : l.label);
            return !state.visitedUrls.has(key);
          })
          .filter(l => isAllowedTarget(l.url));

        let addedCount = 0;
        newDiscovered.forEach(newLink => {
          const key = newLink.targetKey || (newLink.url ? normalizeUrl(newLink.url) : newLink.label);
          if (!queue.some(q => (q.targetKey || (q.url ? normalizeUrl(q.url) : q.label)) === key)) {
            queue.push(newLink);
            addedCount++;
          }
        });

        if (addedCount > 0) {
          addCrawlLog(`Found ${addedCount} new views/links on this screen. (Queue: ${queue.length})`, 'info');
        }

        dom.crawlStatusText.textContent = `Saved ${state.manifest.steps.length} screens. (${queue.length} in queue)`;
      } else {
        addCrawlLog(`Failed capturing ${nextTarget.label}: ${captureRes.error}`, 'error');
      }
    }

    const finalCount = state.manifest.steps.length;
    if (queue.length === 0) {
      addCrawlLog(`Queue empty. All discoverable links visited (${finalCount} screens total).`, 'success');
    } else if (finalCount >= maxScreens) {
      addCrawlLog(`Reached maximum screen limit (${maxScreens}).`, 'info');
    }

    dom.crawlStatusText.textContent = `Crawl complete. Captured ${finalCount} screens.`;
    showToast(`Crawl finished: ${finalCount} screens captured.`);
  } catch (err) {
    console.error('Crawl Error:', err);
    addCrawlLog(`Fatal error: ${err.message}`, 'error');
    dom.crawlStatusText.textContent = `Crawl halted: ${err.message}`;
    showToast(`Crawl error: ${err.message}`);
  } finally {
    state.isCrawling = false;
    dom.btnStartCrawl.disabled = false;
    dom.btnStopCrawl.disabled = true;
    dom.crawlStatusBox.classList.remove('active');
    setBusy(false);
  }
}

dom.btnStartCrawl.addEventListener('click', runAutoCrawl);
dom.btnStopCrawl.addEventListener('click', () => {
  state.isCrawling = false;
  showToast('Stopping crawl after current step...');
});

if (dom.btnInspectPage) {
  dom.btnInspectPage.addEventListener('click', async () => {
    try {
      addCrawlLog('Inspecting active page for discoverable links...', 'info');
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab || !tab.id) throw new Error('No active tab found.');

      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ['content/extractor.js']
      });

      const [res] = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => window.__SCREEN_GRABBER_DIAGNOSE_LINKS__()
      });

      const diag = res.result;
      addCrawlLog(`Scanned ${diag.totalElements} elements across page (${diag.shadowRootsCount} Shadow Roots, ${diag.iframesCount} iframes).`, 'info');
      addCrawlLog(`Discovered ${diag.crawlerLinksCount} router links on ${diag.hostname}:`, diag.crawlerLinksCount > 0 ? 'success' : 'warn');

      if (diag.crawlerLinksCount > 0) {
        diag.crawlerLinks.slice(0, 15).forEach((link, idx) => {
          const typeTag = link.type === 'click' ? '🔘 Nav Button' : '🔗 URL';
          addCrawlLog(`  ${idx + 1}. ${typeTag} "${link.label}" -> ${link.pathname}`, 'info');
        });
        if (diag.crawlerLinksCount > 15) {
          addCrawlLog(`  ...and ${diag.crawlerLinksCount - 15} more links`, 'info');
        }
      }

      if (diag.navContainers && diag.navContainers.length > 0) {
        diag.navContainers.forEach(c => {
          addCrawlLog(`Found Nav Container: <${c.container}> with ${c.itemsCount} interactive items:`, 'info');
          c.sampleItems.slice(0, 5).forEach(it => {
            const attrSummary = Object.keys(it.attrs).map(k => `${k}="${it.attrs[k]}"`).join(' ');
            addCrawlLog(`  • <${it.tag}> "${it.text}" [${attrSummary.substring(0, 80)}]`, 'info');
          });
        });
      } else {
        addCrawlLog('No distinct nav/sidebar containers found. Elements may be rendered via custom elements.', 'warn');
      }
    } catch (err) {
      console.error('Inspect Error:', err);
      addCrawlLog(`Inspect failed: ${err.message}`, 'error');
    }
  });
}
