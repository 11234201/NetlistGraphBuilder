import { searchDesignIndex } from "../search/designSearch.js";
import { escapeAttr, escapeHtml } from "./html.js";

export function createSearchControls({ elements, getIndex, onActivate, onAdd, onChange }) {
  const state = { searchQuery: "", searchResults: [], activeSearchResult: -1 };
  function handleSearchInput() {
    const query = elements.searchInput.value;
    state.searchQuery = query;
    state.searchResults = searchDesignIndex(getIndex(), query);
    state.activeSearchResult = state.searchResults.length > 0 ? 0 : -1;
    onChange(state);
    renderSearchResults();
  }

  function handleSearchKeydown(event) {
    if (event.key === "Escape") {
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
      onActivate(state.searchResults[Math.max(0, state.activeSearchResult)]);
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
    const addButton = event.target.closest("[data-search-add-index]");
    if (addButton) {
      onAdd(state.searchResults[Number(addButton.dataset.searchAddIndex)]);
      return;
    }
    const button = event.target.closest("[data-search-index]");
    if (!button) {
      return;
    }
    onActivate(state.searchResults[Number(button.dataset.searchIndex)]);
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
      elements.searchResults.innerHTML = `<div class="search-empty">No matches</div>`;
      return;
    }

    elements.searchResults.innerHTML = state.searchResults
      .map((result, index) => {
        const active = index === state.activeSearchResult;
        const context = result.kind === "module"
          ? result.detail
          : `${result.detail} / ${result.moduleName}`;
        const addAction = result.kind === "net" || result.target?.kind === "cell"
          ? `<button class="search-result-add" type="button" data-search-add-index="${escapeAttr(index)}" title="Add ${escapeAttr(result.label)} to Focused roots">+ Focus</button>`
          : "";
        return `<div class="search-result${active ? " is-active" : ""}" role="option" aria-selected="${active}" title="${escapeAttr(result.label)}">
          <button class="search-result-main" type="button" data-search-index="${escapeAttr(index)}">
            <span class="search-result-kind">${escapeHtml(result.kind)}</span>
            <span class="search-result-label">${escapeHtml(result.label)}</span>
            <span class="search-result-context">${escapeHtml(context)}</span>
          </button>
          ${addAction}
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
