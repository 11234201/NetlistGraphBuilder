import { searchDesignIndex } from "../search/designSearch.js";
import { escapeAttr, escapeHtml } from "./html.js";

export function createSearchControls({ elements, getIndex, onActivate, onAdd, onChange, search = searchDesignIndex }) {
  const state = { searchQuery: "", searchResults: [], activeSearchResult: -1 };
  function handleSearchInput({ openResults = true } = {}) {
    const query = elements.searchInput.value;
    state.searchQuery = query;
    state.searchResults = search(getIndex(), query);
    state.activeSearchResult = state.searchResults.length > 0 ? 0 : -1;
    onChange(state);
    renderSearchResults();
    if (!openResults) elements.searchResults.hidden = true;
  }

  function handleSearchKeydown(event) {
    if (event.isComposing) return;
    if (event.key === "Escape") {
      if (!elements.searchResults.hidden) event.preventDefault();
      elements.searchResults.hidden = true;
      state.activeSearchResult = -1;
      return;
    }
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp" && event.key !== "Enter") {
      return;
    }
    if (state.searchResults.length === 0) {
      return;
    }

    event.preventDefault();
    if (event.key === "Enter") {
      activateResult(state.searchResults[Math.max(0, state.activeSearchResult)]);
      return;
    }

    const direction = event.key === "ArrowDown" ? 1 : -1;
    state.activeSearchResult = (
      state.activeSearchResult + direction + state.searchResults.length
    ) % state.searchResults.length;
    renderSearchResults();
    elements.searchResults.querySelector(".search-result.is-active")?.scrollIntoView({ block: "nearest" });
  }

  function handleSearchResultClick(event) {
    const toggle = event.target.closest("[data-search-actions]");
    if (toggle?.dataset.searchActions !== undefined) {
      const expanded = toggle.getAttribute("aria-expanded") === "true";
      for (const item of elements.searchResults.querySelectorAll("[data-search-actions]")) {
        const open = item === toggle && !expanded;
        item.setAttribute("aria-expanded", String(open));
        item.nextElementSibling.hidden = !open;
      }
      return;
    }
    const pathButton = event.target.closest("[data-search-path]");
    if (pathButton?.dataset.searchPath) {
      elements.searchResults.hidden = true;
      pathButton.dispatchEvent(new CustomEvent("show-path-add", { bubbles: true, detail: {
        side: pathButton.dataset.searchPath, result: state.searchResults[Number(pathButton.dataset.resultIndex)] } }));
      return;
    }
    const addButton = event.target.closest("[data-search-add-index]");
    if (addButton) {
      onAdd(state.searchResults[Number(addButton.dataset.searchAddIndex)]);
      return;
    }
    const button = event.target.closest("[data-search-index]");
    if (!button) {
      return;
    }
    activateResult(state.searchResults[Number(button.dataset.searchIndex)]);
  }

  function activateResult(result) {
    if (!result) return;
    elements.searchResults.hidden = true;
    onActivate(result);
  }

  function renderSearchResults() {
    const hasQuery = elements.searchInput.value.trim() !== "";
    elements.searchClearButton.hidden = !hasQuery;
    if (!hasQuery) {
      elements.searchResults.hidden = true;
      elements.searchResults.innerHTML = "";
      return;
    }

    elements.searchResults.hidden = false;
    if (state.searchResults.length === 0) {
      elements.searchResults.innerHTML = `<div class="search-empty">No matches in the loaded design. Search by module, cell, cell type, net or port name.</div>`;
      return;
    }

    elements.searchResults.innerHTML = state.searchResults
      .map((result, index) => {
        const active = index === state.activeSearchResult;
        const context = result.kind === "module"
          ? result.detail
          : `${result.detail || ""}${result.moduleName ? ` / ${result.moduleName}` : ""}`;
        const addAction = result.canFocus || result.kind === "net" || result.target?.kind === "cell"
          ? `<button class="search-result-add" type="button" data-search-add-index="${escapeAttr(index)}" title="Add ${escapeAttr(result.label)} to Focused roots">Add to Focused</button>`
          : "";
        return `<div class="search-result${active ? " is-active" : ""}" role="listitem" aria-current="${active}" title="${escapeAttr(result.label)}">
          <button class="search-result-main" type="button" data-search-index="${escapeAttr(index)}">
            <span class="search-result-kind">${escapeHtml(result.kind)}</span>
            <span class="search-result-label">${escapeHtml(result.label)}</span>
            <span class="search-result-context">${escapeHtml(context)}</span>
          </button>
          ${result.kind === "module" && !addAction ? "" : `<button class="search-action-toggle" type="button" data-search-actions="${index}" aria-expanded="false" aria-controls="search-actions-${index}" aria-label="Add ${escapeAttr(result.label)} to a view">Add…</button>
          <div class="search-row-actions" id="search-actions-${index}" hidden>${addAction}${result.kind === "module" ? "" : `<button type="button" data-search-path="starts" data-result-index="${index}">Add as start</button><button type="button" data-search-path="ends" data-result-index="${index}">Add as end</button>`}</div>`}
        </div>`;
      })
      .join("");
  }

  function clearSearch() {
    elements.searchInput.value = "";
    state.searchQuery = "";
    state.searchResults = [];
    state.activeSearchResult = -1;
    onChange(state);
    renderSearchResults();
  }
  return { handleSearchInput, handleSearchKeydown, handleSearchResultClick, clearSearch };
}
