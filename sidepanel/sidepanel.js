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
  btnStopCrawl: document.getElementById('btn-stop-crawl'),
  crawlMaxScreens: document.getElementById('crawl-max-screens'),
  crawlDelay: document.getElementById('crawl-delay'),
  crawlStayPrefix: document.getElementById('crawl-stay-prefix'),
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
 * Capture current active tab screen & extract context
 */
async function performCapture(customSlug = null) {
  setBusy(true, 'Capturing...');

  try {
    // 1. Get active tab
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !tab.id) {
      throw new Error('No active browser tab found.');
    }

    // 2. Inject context extractor script
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ['content/extractor.js']
    });

    const redactPII = dom.settingRedactPII ? dom.settingRedactPII.checked : true;

    // 3. Extract DOM metadata and apply visual blur if requested
    const [execResult] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
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
        tabId: tab.id,
        options: captureOptions
      });
    } finally {
      // Immediately restore DOM visuals so the user's active page is untouched
      if (redactPII) {
        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
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
    state.visitedUrls.add(contextData.metadata.url);

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
 * Auto-Crawl Engine
 */
async function runAutoCrawl() {
  state.isCrawling = true;
  dom.btnStartCrawl.disabled = true;
  dom.btnStopCrawl.disabled = false;
  dom.connectionStatus.textContent = 'Crawling...';
  dom.connectionStatus.classList.add('busy');

  const maxScreens = parseInt(dom.crawlMaxScreens.value, 10) || 15;
  const delaySec = parseInt(dom.crawlDelay.value, 10) || 2;
  const stayPrefix = dom.crawlStayPrefix.checked;

  try {
    const [initialTab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!initialTab) throw new Error('No active tab.');

    const initialUrl = new URL(initialTab.url);
    const prefix = stayPrefix ? initialUrl.pathname : '/';

    // First capture: capture current screen
    const firstResult = await performCapture();
    if (!firstResult.success) return;

    // Seed queue with safe internal links from the first screen
    let queue = (firstResult.contextData.crawlerLinks || [])
      .filter(l => !state.visitedUrls.has(l.url))
      .filter(l => !stayPrefix || new URL(l.url).pathname.startsWith(prefix));

    while (state.isCrawling && queue.length > 0 && state.manifest.steps.length < maxScreens) {
      const nextTarget = queue.shift();
      if (!nextTarget || state.visitedUrls.has(nextTarget.url)) continue;

      showToast(`Navigating to: ${nextTarget.label}...`);

      // Navigate tab
      await chrome.runtime.sendMessage({
        type: 'NAVIGATE_TAB',
        tabId: initialTab.id,
        url: nextTarget.url
      });

      // Wait for page load and delay
      await new Promise(r => setTimeout(r, (delaySec * 1000) + 1000));

      // Capture screen
      const captureRes = await performCapture(slugify(nextTarget.label));
      if (captureRes.success && captureRes.contextData) {
        // Enqueue newly discovered links
        const newLinks = (captureRes.contextData.crawlerLinks || [])
          .filter(l => !state.visitedUrls.has(l.url))
          .filter(l => !stayPrefix || new URL(l.url).pathname.startsWith(prefix));

        queue.push(...newLinks);
      }
    }

    showToast(`Crawl finished. Captured ${state.manifest.steps.length} screens.`);
  } catch (err) {
    console.error('Crawl Error:', err);
    showToast(`Crawl stopped: ${err.message}`);
  } finally {
    state.isCrawling = false;
    dom.btnStartCrawl.disabled = false;
    dom.btnStopCrawl.disabled = true;
    setBusy(false);
  }
}

dom.btnStartCrawl.addEventListener('click', runAutoCrawl);
dom.btnStopCrawl.addEventListener('click', () => {
  state.isCrawling = false;
  showToast('Stopping crawl after current step...');
});
