# ScreenGrabber for Context

A Chrome Extension (Manifest V3) that captures authenticated web applications and SaaS screens in high-resolution (Retina/full-page) alongside rich semantic context (DOM hierarchy, headings, interactive controls, and LLM-ready markdown documentation).

All captured assets are streamed in real-time to a local folder chosen by the user, making it ideal for downstream AI agents producing explainer videos, walkthroughs, or test automations.

---

## Key Features

- **Direct Local File Streaming:** Uses the modern **File System Access API** (`window.showDirectoryPicker`). You pick any folder on your computer (e.g. `~/Desktop/Product-Captures`), and the extension writes PNGs, JSON, and Markdown continuously.
- **Zero Memory Bloat:** Screenshots and context are written to disk step-by-step rather than held in browser memory.
- **🛡️ Automated PII Redaction & Visual Blurring:**
  - Automatically identifies sensitive data: Emails, Phone numbers, Credit cards, SSNs, and API keys / Bearer tokens.
  - **Visual Blur:** Applies a temporary `filter: blur(7px)` mask to sensitive DOM elements during screenshot capture, then immediately restores the live DOM state.
  - **Context Sanitization:** Replaces PII with clean replacement tokens (`[REDACTED_EMAIL]`, `[REDACTED_CARD]`, etc.) in all `.json` and `.md` files.
- **Retina & Full-Page High-Res Captures:** Leverages the **Chrome DevTools Protocol (CDP)** (`chrome.debugger`) to capture full-page heights beyond the fold at 2x or 3x device pixel ratio.
- **Deep Semantic Context Extraction:** Content scripts inspect the DOM, ARIA roles, headings, interactive buttons, forms, and navigation to synthesize structured metadata and clear Markdown.
- **Dual Capture Modes:**
  - **Guided Capture (Recommended):** You navigate your product flows (handling any 2FA/SSO/modals naturally). Click **"Capture Current Screen"** (or provide custom slugs) at key steps.
  - **Auto-Crawl:** Discovers internal links within domain and path boundaries, systematically capturing pages while strictly skipping destructive actions (e.g., *Delete*, *Logout*, *Sign Out*).
- **Graceful Fallback:** If the browser environment restricts direct directory access, it automatically falls back to `chrome.downloads`.

---

## Directory Output Structure

When capturing a product flow, your chosen folder will look like this:

```
/Your-Selected-Folder/
  ├── manifest.json                # Master index of the walkthrough (routes, dimensions, order)
  ├── summary.md                   # Consolidated walkthrough document for LLMs / video agents
  ├── /screenshots/
  │   ├── 01_dashboard.png         # Full-page high-resolution PNG (with PII blurred if enabled)
  │   ├── 02_deployments.png
  │   └── 03_billing_invoices.png
  └── /context/
      ├── 01_dashboard.json        # Machine-readable DOM, bounding boxes, buttons, inputs (sanitized)
      ├── 01_dashboard.md          # Human & LLM-readable screen explanation & actions
      ├── 02_deployments.json
      ├── 02_deployments.md
      ├── 03_billing_invoices.json
      └── 03_billing_invoices.md
```

---

## Security & Privacy Guidelines

- **Sensitive Data Notice:** Always review captured screenshots and context files before sharing them publicly or uploading them into third-party AI models. The built-in **Auto-Redact PII** toggle is enabled by default to protect customer data, cards, and credentials.
- **Why `chrome.debugger` is Used:** High-resolution full-page screenshots beyond the viewport require the Chrome DevTools Protocol. When active, Chrome will show a standard banner stating that debugging has started. No remote connections are made—everything runs 100% locally on your machine.
- **Local Isolation:** The extension does not transmit any screenshots, metadata, or browsing history to external servers. All data is saved strictly to your local filesystem.

---

## Installation Guide

1. Clone or download this repository:
   ```bash
   git clone https://github.com/your-username/chrome-screengraber-for-context.git
   ```
2. Open Google Chrome and go to `chrome://extensions/`.
3. Enable **Developer mode** using the toggle switch in the top-right corner.
4. Click **Load unpacked** in the top-left corner.
5. Select this project directory.
6. The **ScreenGrabber for Context** icon will appear in your Chrome toolbar.

---

## How to Use

### 1. Open the Side Panel
- Click the **ScreenGrabber** icon in your Chrome toolbar.

### 2. Choose Output Directory
- Under **Output Directory**, click **"Select Destination Folder"**.
- Pick any folder on your machine (e.g., `~/Desktop/Product-Captures`).
- Confirm Chrome's native directory permission prompt.

### 3. Log In & Capture
1. Log into your product or application normally.
2. In the Side Panel:
   - **Guided Mode:** Go to any screen you wish to capture, optionally type a friendly name (e.g. `billing_plans`), and click **Capture Current Screen**.
   - **Auto-Crawl Mode:** Switch to the **Auto-Crawl** tab, configure the max screens and delay, and click **Start Crawl**.
3. Watch the screens, structured JSON, and Markdown appear in your local folder in real time.

---

## Downstream Agent Consumption

### Video Generation Agents
Feed `manifest.json` and `/screenshots/` into your video agent:
- `manifest.json` provides the chronological sequence of screens, route URLs, and image dimensions.
- Each `0X_<slug>.png` serves as the high-res frame for panning, zooming, or video rendering.

### Explainer & Documentation Agents
Feed `summary.md` and `/context/*.md` into LLMs (e.g., Gemini 1.5 Pro, Claude, GPT-4o):
- Every Markdown file details the screen's core purpose, heading hierarchy, available interactive buttons, and primary call-to-actions.

---

## Running Automated Tests

To run the offline unit test suite:
```bash
node --test tests/extractor.test.js
```

---

## License

This project is licensed under the [MIT License](LICENSE).
