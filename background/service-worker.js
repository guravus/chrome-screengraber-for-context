/**
 * ScreenGrabber for Context - Background Service Worker
 * Handles Side Panel activation, CDP (Chrome DevTools Protocol) high-resolution screenshots,
 * and tab orchestration.
 */

// Configure side panel to open on action click
chrome.runtime.onInstalled.addListener(() => {
  if (chrome.sidePanel && chrome.sidePanel.setPanelBehavior) {
    chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch((err) => {
      console.warn('Failed to set side panel behavior:', err);
    });
  }
});

/**
 * Captures high-resolution screenshot via Chrome DevTools Protocol (CDP)
 * Supports full-page captures beyond viewport with customizable deviceScaleFactor (e.g. 2x Retina).
 */
async function captureHighResScreenshot(tabId, options = {}) {
  const {
    fullPage = true,
    scale = 2,
    format = 'png',
    quality = 100
  } = options;

  const target = { tabId };

  // Ensure any previous or dangling debugger connection on this tab is cleanly released
  try {
    await chrome.debugger.detach(target);
  } catch (_) {}

  try {
    // 1. Attach debugger to target tab
    await chrome.debugger.attach(target, '1.3');

    // 2. Enable necessary CDP domains
    await chrome.debugger.sendCommand(target, 'Page.enable');
    await chrome.debugger.sendCommand(target, 'DOM.enable');

    // 3. Get true layout metrics of the page
    const layoutMetrics = await chrome.debugger.sendCommand(target, 'Page.getLayoutMetrics');
    
    // Determine dimensions
    const contentSize = layoutMetrics.cssContentSize || layoutMetrics.contentSize;
    const visualViewport = layoutMetrics.cssVisualViewport || layoutMetrics.visualViewport;

    const width = Math.ceil(fullPage ? contentSize.width : visualViewport.clientWidth);
    const height = Math.ceil(fullPage ? contentSize.height : visualViewport.clientHeight);

    // 4. Override device metrics to capture full content at desired DPI scale
    if (fullPage) {
      await chrome.debugger.sendCommand(target, 'Emulation.setDeviceMetricsOverride', {
        width: Math.max(width, 1280),
        height: Math.max(height, 800),
        deviceScaleFactor: scale,
        mobile: false
      });

      // Brief sleep to allow layout/render to settle
      await new Promise(resolve => setTimeout(resolve, 250));
    }

    // 5. Execute captureScreenshot
    const captureParams = {
      format: format,
      fromSurface: true,
      captureBeyondViewport: fullPage
    };

    if (format === 'jpeg') {
      captureParams.quality = quality;
    }

    const screenshotResult = await chrome.debugger.sendCommand(target, 'Page.captureScreenshot', captureParams);

    // 6. Reset emulation override
    if (fullPage) {
      await chrome.debugger.sendCommand(target, 'Emulation.clearDeviceMetricsOverride');
    }

    // 7. Detach debugger
    await chrome.debugger.detach(target);

    return {
      success: true,
      dataUrl: `data:image/${format};base64,${screenshotResult.data}`,
      base64: screenshotResult.data,
      width,
      height,
      scale
    };
  } catch (error) {
    console.error('CDP Capture Error:', error);
    // Ensure debugger is detached if an error occurs
    try {
      await chrome.debugger.detach(target);
    } catch (_) {}

    // Fallback to standard tab capture if debugger fails (e.g. restricted page)
    try {
      const fallbackDataUrl = await chrome.tabs.captureVisibleTab({ format: 'png' });
      return {
        success: true,
        dataUrl: fallbackDataUrl,
        base64: fallbackDataUrl.replace(/^data:image\/png;base64,/, ''),
        fallback: true
      };
    } catch (fallbackError) {
      return {
        success: false,
        error: error.message || fallbackError.message || 'Screenshot capture failed'
      };
    }
  }
}

// Handle messages from Side Panel
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'CAPTURE_SCREEN') {
    captureHighResScreenshot(message.tabId, message.options)
      .then(result => sendResponse(result))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true; // Keep channel open for async response
  }

  if (message.type === 'GET_ACTIVE_TAB') {
    chrome.tabs.query({ active: true, currentWindow: true }).then(([tab]) => {
      sendResponse({ tab });
    }).catch(err => sendResponse({ error: err.message }));
    return true;
  }

  if (message.type === 'NAVIGATE_TAB') {
    const tabId = message.tabId;
    let responded = false;

    const cleanup = () => {
      chrome.tabs.onUpdated.removeListener(updateListener);
    };

    const finish = (res) => {
      if (responded) return;
      responded = true;
      cleanup();
      sendResponse(res);
    };

    const updateListener = (updatedTabId, changeInfo) => {
      if (updatedTabId === tabId && changeInfo.status === 'complete') {
        finish({ success: true, status: 'complete' });
      }
    };

    chrome.tabs.onUpdated.addListener(updateListener);

    // Timeout safety fallback (e.g. SPAs that do not trigger full page reload)
    setTimeout(() => {
      finish({ success: true, status: 'timeout' });
    }, 6000);

    chrome.tabs.update(tabId, { url: message.url }).catch((err) => {
      finish({ success: false, error: err.message });
    });

    return true;
  }
});
