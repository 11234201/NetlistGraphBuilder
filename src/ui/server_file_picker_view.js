// Static, dependency-free dialog shell. The controller owns navigation and imports.
export function createServerFilePickerView(document) {
  const dialog = document.createElement("dialog");
  dialog.className = "server-file-dialog";
  dialog.setAttribute("aria-labelledby", "serverFilePickerTitle");
  dialog.innerHTML = `
    <form class="server-file-form" data-form>
      <header class="server-file-header">
        <div>
          <h2 id="serverFilePickerTitle">Open from server</h2>
          <p data-context></p>
        </div>
        <button class="dialog-close" type="button" data-close aria-label="Close server files" title="Close">×</button>
      </header>
      <div class="server-file-content">
      <div class="server-file-navigation">
        <div class="server-file-root">
          <label data-root-field hidden>Browse root <select data-roots aria-label="Browse root"></select></label>
          <span data-root-label hidden></span>
        </div>
        <div class="server-file-location">
          <button class="dialog-button server-file-up" type="button" data-up aria-label="Parent directory" title="Parent directory">↑</button>
          <nav class="server-file-breadcrumbs" data-breadcrumbs aria-label="Current directory"></nav>
          <button class="server-file-text-button" type="button" data-edit-path aria-expanded="false" aria-controls="serverFilePathEditor">Edit path</button>
        </div>
        <div class="server-file-path-editor" id="serverFilePathEditor" data-path-editor hidden>
          <label class="sr-only" for="serverFilePath">Directory</label>
          <input id="serverFilePath" data-path spellcheck="false" autocomplete="off">
          <button class="dialog-button" type="button" data-go>Go</button>
        </div>
        <div class="server-file-filter">
          <label class="sr-only" for="serverFileFilter">Filter files in this directory</label>
          <span class="server-file-search-mark" aria-hidden="true"></span>
          <input id="serverFileFilter" type="search" data-filter placeholder="Filter files in this directory…" autocomplete="off" spellcheck="false">
          <button class="server-file-text-button" type="button" data-filter-clear aria-label="Clear file filter" hidden>Clear</button>
        </div>
      </div>
      <section class="server-file-list-region" data-list-region aria-label="Server directory contents">
        <div class="server-file-list-heading" aria-hidden="true"><span>Name</span><span>Type</span></div>
        <div class="server-file-list-feedback">
          <p data-list-state role="status" hidden></p>
          <button class="server-file-text-button" type="button" data-retry hidden>Retry</button>
        </div>
        <div class="server-file-entries" data-entries></div>
      </section>
      <div class="server-file-pagination">
        <span data-count></span>
        <button class="dialog-button" type="button" data-prev aria-label="Previous page" title="Previous page">‹</button>
        <button class="dialog-button" type="button" data-next aria-label="Next page" title="Next page">›</button>
      </div>
      <div class="server-file-feedback">
        <p class="server-file-status" data-status role="status" aria-live="polite"></p>
        <ul class="server-file-results" data-results aria-label="Import results"></ul>
      </div>
      <section class="server-file-selection" aria-label="Selected files">
        <div class="server-file-selection-heading">
          <span data-selection-count aria-live="polite">No files selected</span>
          <div>
            <button class="server-file-text-button" type="button" data-selection-toggle aria-expanded="false" aria-controls="serverFileSelectionPanel">View selected</button>
            <button class="server-file-text-button" type="button" data-selection-clear>Clear</button>
          </div>
        </div>
        <div id="serverFileSelectionPanel" class="server-file-selection-panel" data-selection-panel hidden>
          <ul data-selected-list aria-label="Selected file paths"></ul>
        </div>
      </section>
      <div class="server-file-options">
        <div class="server-file-mode">
          <details class="server-file-advanced" data-advanced>
            <summary aria-label="Advanced" aria-describedby="serverFileActionSummary">
              <span class="server-file-mode-label">Import mode</span>
              <span id="serverFileActionSummary" data-action-summary>Auto detect</span>
              <span class="server-file-advanced-label" aria-hidden="true">Advanced</span>
            </summary>
            <div class="server-file-advanced-fields">
              <label>Import action <select data-action aria-describedby="serverFileActionHelp"></select></label>
              <p id="serverFileActionHelp" data-action-help></p>
            </div>
          </details>
        </div>
        <label class="server-file-side" data-side-field hidden>Target <select data-side><option value="">Page</option><option value="A">Side A</option><option value="B">Side B</option></select></label>
      </div>
      </div>
      <footer class="server-file-footer">
        <button class="dialog-button" type="button" data-cancel>Cancel</button>
        <button class="dialog-button primary" type="button" data-submit disabled>Import files</button>
      </footer>
    </form>`;
  document.body.append(dialog);
  return {dialog, el: name => dialog.querySelector("[data-" + name + "]")};
}
