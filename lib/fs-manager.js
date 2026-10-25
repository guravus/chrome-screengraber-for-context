/**
 * ScreenGrabber for Context - File System Manager
 * Manages streaming persistence directly to a user-selected local folder via the
 * File System Access API (showDirectoryPicker), with chrome.downloads fallback.
 */

export class FileSystemManager {
  constructor() {
    this.directoryHandle = null;
    this.folderName = null;
    this.screenshotsDir = null;
    this.contextDir = null;
  }

  /**
   * Check if File System Access API is supported
   */
  static isSupported() {
    return typeof window.showDirectoryPicker === 'function';
  }

  /**
   * Prompts user to select an output folder and establishes directory handles
   */
  async selectDirectory() {
    if (!FileSystemManager.isSupported()) {
      throw new Error('File System Access API is not supported in this environment.');
    }

    try {
      this.directoryHandle = await window.showDirectoryPicker({
        id: 'screengrabber-output',
        mode: 'readwrite',
        startIn: 'documents'
      });

      this.folderName = this.directoryHandle.name;

      // Ensure /screenshots and /context subfolders exist
      this.screenshotsDir = await this.directoryHandle.getDirectoryHandle('screenshots', { create: true });
      this.contextDir = await this.directoryHandle.getDirectoryHandle('context', { create: true });

      return {
        success: true,
        folderName: this.folderName
      };
    } catch (err) {
      if (err.name === 'AbortError') {
        return { success: false, aborted: true };
      }
      throw err;
    }
  }

  /**
   * Check if directory handle is connected and has write permissions
   */
  async hasPermission() {
    if (!this.directoryHandle) return false;
    try {
      const opts = { mode: 'readwrite' };
      if ((await this.directoryHandle.queryPermission(opts)) === 'granted') {
        return true;
      }
      return (await this.directoryHandle.requestPermission(opts)) === 'granted';
    } catch (_) {
      return false;
    }
  }

  /**
   * Writes text content (e.g. JSON, Markdown) to a file in a specified directory handle
   */
  async writeTextFile(targetDirHandle, fileName, textContent) {
    const fileHandle = await targetDirHandle.getFileHandle(fileName, { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(textContent);
    await writable.close();
  }

  /**
   * Writes binary base64 content (PNG screenshot) to a file in a specified directory handle
   */
  async writeBase64Image(targetDirHandle, fileName, base64Data) {
    const cleanBase64 = base64Data.replace(/^data:image\/\w+;base64,/, '');
    const byteCharacters = atob(cleanBase64);
    const byteNumbers = new Array(byteCharacters.length);
    for (let i = 0; i < byteCharacters.length; i++) {
      byteNumbers[i] = byteCharacters.charCodeAt(i);
    }
    const byteArray = new Uint8Array(byteNumbers);
    const blob = new Blob([byteArray], { type: 'image/png' });

    const fileHandle = await targetDirHandle.getFileHandle(fileName, { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(blob);
    await writable.close();
  }

  /**
   * Persists a captured screen step:
   * 1. saves screenshot PNG in /screenshots/<index>_<slug>.png
   * 2. saves JSON metadata in /context/<index>_<slug>.json
   * 3. saves Markdown in /context/<index>_<slug>.md
   * 4. updates manifest.json and summary.md at the root
   */
  async saveCaptureStep(stepIndex, slug, captureData, sessionManifest, sessionSummary) {
    const indexStr = String(stepIndex).padStart(2, '0');
    const baseName = `${indexStr}_${slug}`;

    if (this.directoryHandle) {
      // 1. Write screenshot PNG
      if (captureData.screenshot && captureData.screenshot.base64) {
        await this.writeBase64Image(this.screenshotsDir, `${baseName}.png`, captureData.screenshot.base64);
      }

      // 2. Write Context JSON
      const jsonContent = JSON.stringify(captureData.context, null, 2);
      await this.writeTextFile(this.contextDir, `${baseName}.json`, jsonContent);

      // 3. Write Markdown file
      if (captureData.context.markdown) {
        await this.writeTextFile(this.contextDir, `${baseName}.md`, captureData.context.markdown);
      }

      // 4. Update manifest.json and summary.md at root
      await this.writeTextFile(this.directoryHandle, 'manifest.json', JSON.stringify(sessionManifest, null, 2));
      await this.writeTextFile(this.directoryHandle, 'summary.md', sessionSummary);

      return {
        mode: 'filesystem',
        filesSaved: [
          `screenshots/${baseName}.png`,
          `context/${baseName}.json`,
          `context/${baseName}.md`,
          'manifest.json',
          'summary.md'
        ]
      };
    } else {
      // Fallback: Use chrome.downloads API
      return this.downloadFallback(baseName, captureData, sessionManifest);
    }
  }

  /**
   * Fallback using chrome.downloads to save files in Downloads folder
   */
  async downloadFallback(baseName, captureData, sessionManifest) {
    const timestamp = sessionManifest.sessionId || 'run';
    const folder = `ScreenGrabber_${timestamp}`;

    // Download PNG
    if (captureData.screenshot && captureData.screenshot.dataUrl) {
      await chrome.downloads.download({
        url: captureData.screenshot.dataUrl,
        filename: `${folder}/screenshots/${baseName}.png`,
        saveAs: false
      });
    }

    // Download JSON
    const jsonBlob = new Blob([JSON.stringify(captureData.context, null, 2)], { type: 'application/json' });
    const jsonUrl = URL.createObjectURL(jsonBlob);
    await chrome.downloads.download({
      url: jsonUrl,
      filename: `${folder}/context/${baseName}.json`,
      saveAs: false
    });

    // Download MD
    if (captureData.context.markdown) {
      const mdBlob = new Blob([captureData.context.markdown], { type: 'text/markdown' });
      const mdUrl = URL.createObjectURL(mdBlob);
      await chrome.downloads.download({
        url: mdUrl,
        filename: `${folder}/context/${baseName}.md`,
        saveAs: false
      });
    }

    return {
      mode: 'downloads',
      folder
    };
  }
}
