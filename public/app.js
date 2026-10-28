(() => {
  const form = document.querySelector('#searchForm');
  const input = document.querySelector('#searchInput');
  const clearButton = document.querySelector('#clearButton');
  const resultsSection = document.querySelector('#resultsSection');
  const resultList = document.querySelector('#resultList');
  const resultsTitle = document.querySelector('#resultsTitle');
  const resultsMeta = document.querySelector('#resultsMeta');
  const resultsFooter = document.querySelector('#resultsFooter');
  const loadingSection = document.querySelector('#loadingSection');
  const emptyState = document.querySelector('#emptyState');
  const emptyTitle = document.querySelector('#emptyTitle');
  const emptyMessage = document.querySelector('#emptyMessage');
  const hero = document.querySelector('#hero');
  const quickSearches = document.querySelector('#quickSearches');
  const tryAgainButton = document.querySelector('#tryAgainButton');
  const aboutDialog = document.querySelector('#aboutDialog');

  let currentController = null;
  let requestNumber = 0;
  const params = new URLSearchParams(window.location.search);
  const firstQuery = params.get('q');

  const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[char]);

  const formatDomain = (href) => {
    try { return new URL(href).hostname.replace(/^www\./i, ''); }
    catch { return href; }
  };

  const faviconLetter = (domain) => {
    const first = (domain || 'W').replace(/^www\./i, '').charAt(0).toUpperCase();
    return /^[A-Z0-9]$/.test(first) ? first : '↗';
  };

  function setView(view) {
    loadingSection.hidden = view !== 'loading';
    resultsSection.hidden = view !== 'results';
    emptyState.hidden = view !== 'empty';
    document.body.classList.toggle('has-results', view === 'results' || view === 'loading' || view === 'empty');
    if (view !== 'results') resultsFooter.hidden = true;
  }

  function renderResults(data, query, duration) {
    const results = Array.isArray(data.results) ? data.results : [];
    if (!results.length) {
      setView('empty');
      emptyTitle.textContent = 'No results found';
      emptyMessage.textContent = `We couldn't find pages for “${query}”. Try a different phrase or use fewer words.`;
      return;
    }

    resultsTitle.textContent = `“${query}”`;
    resultsMeta.textContent = `${results.length} RESULTS · ${(duration / 1000).toFixed(1)}S`;
    resultList.innerHTML = results.map((item, index) => {
      const title = escapeHtml(item.title || item.url || 'Untitled result');
      const url = escapeHtml(item.url || '#');
      const snippet = escapeHtml(item.snippet || 'Open this page to read more.');
      const domain = escapeHtml(formatDomain(item.url || ''));
      return `<article class="result-card" style="animation-delay:${Math.min(index * 45, 270)}ms">
        <div class="result-topline"><span class="result-favicon" aria-hidden="true">${escapeHtml(faviconLetter(domain))}</span><span class="result-domain">${domain}</span><span class="result-type">WEB RESULT ${String(index + 1).padStart(2, '0')}</span></div>
        <a class="result-title" href="${url}" target="_blank" rel="noopener noreferrer">${title}</a>
        <p class="result-snippet">${snippet}</p>
        <a class="result-open" href="${url}" target="_blank" rel="noopener noreferrer">OPEN WEBSITE <span aria-hidden="true">↗</span></a>
      </article>`;
    }).join('');
    resultsFooter.hidden = results.length < 5;
    setView('results');
  }

  async function search(query, updateAddress = true) {
    const cleaned = query.trim().replace(/\s+/g, ' ').slice(0, 250);
    if (!cleaned) {
      input.focus();
      return;
    }
    input.value = cleaned;
    clearButton.hidden = false;
    const thisRequest = ++requestNumber;
    if (currentController) currentController.abort();
    currentController = new AbortController();
    setView('loading');
    resultsTitle.textContent = `“${cleaned}”`;
    resultList.replaceChildren();
    if (updateAddress) {
      const next = new URL(window.location.href);
      next.searchParams.set('q', cleaned);
      history.replaceState({}, '', next);
    }

    const startedAt = performance.now();
    try {
      const response = await fetch(`/api/search?q=${encodeURIComponent(cleaned)}`, {
        method: 'GET',
        headers: { 'Accept': 'application/json' },
        signal: currentController.signal
      });
      const data = await response.json().catch(() => ({}));
      if (thisRequest !== requestNumber) return;
      if (!response.ok) throw new Error(data.error || 'Search is temporarily unavailable. Please try again.');
      renderResults(data, cleaned, performance.now() - startedAt);
      if (window.matchMedia('(max-width: 900px)').matches) {
        resultsSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    } catch (error) {
      if (error.name === 'AbortError' || thisRequest !== requestNumber) return;
      setView('empty');
      emptyTitle.textContent = 'Search is temporarily unavailable';
      emptyMessage.textContent = error.message || 'Something went wrong. Please check your connection and try again.';
    }
  }

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    search(input.value);
  });

  input.addEventListener('input', () => {
    clearButton.hidden = input.value.length === 0;
  });

  clearButton.addEventListener('click', () => {
    if (currentController) currentController.abort();
    input.value = '';
    clearButton.hidden = true;
    const next = new URL(window.location.href);
    next.searchParams.delete('q');
    history.replaceState({}, '', next);
    resultList.replaceChildren();
    setView('idle');
    document.body.classList.remove('has-results');
    input.focus();
  });

  document.querySelectorAll('[data-query]').forEach((button) => {
    button.addEventListener('click', () => search(button.dataset.query));
  });

  tryAgainButton.addEventListener('click', () => {
    setView('idle');
    document.body.classList.remove('has-results');
    input.focus();
  });

  document.querySelector('#aboutButton').addEventListener('click', () => aboutDialog.showModal());
  document.querySelector('#closeAboutButton').addEventListener('click', () => aboutDialog.close());
  document.querySelector('#doneAboutButton').addEventListener('click', () => aboutDialog.close());
  aboutDialog.addEventListener('click', (event) => {
    if (event.target === aboutDialog) aboutDialog.close();
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === '/' && document.activeElement !== input && !event.ctrlKey && !event.metaKey && !event.altKey) {
      event.preventDefault(); input.focus();
    }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
      event.preventDefault(); input.focus(); input.select();
    }
    if (event.key === 'Escape' && document.activeElement === input && input.value) {
      input.value = ''; clearButton.hidden = true;
    }
  });

  // A query string lets a shared Nova URL restore the search without a redirect.
  if (firstQuery) search(firstQuery, false);
  else setView('idle');
  input.focus({ preventScroll: true });
})();
