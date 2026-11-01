import { GLOSSARY, GLOSSARY_CATEGORIES } from '../data/glossary.js';
import { esc, icon } from '../ui.js';

function termCard(term) {
  const initial = term.term[0].toUpperCase();
  return `<article class="term-card" data-term="${esc(term.term)}" data-term-search="${esc(`${term.term} ${term.short} ${term.detail} ${term.aliases.join(' ')} ${term.category}`.toLowerCase())}" data-term-category="${esc(term.category)}">
    <div class="term-head">
      <span class="term-initial">${esc(initial)}</span>
      <div><h3>${esc(term.term)}</h3><span class="pill tiny">${esc(term.category)}</span></div>
    </div>
    <p class="term-short">${esc(term.short)}</p>
    <details><summary>Deep explanation</summary><p>${esc(term.detail)}</p>${term.aliases.length ? `<p class="term-aliases">Also: ${term.aliases.map((alias) => `<code>${esc(alias)}</code>`).join(' ')}</p>` : ''}</details>
  </article>`;
}

function groupedHTML() {
  const sorted = [...GLOSSARY].sort((a, b) => a.term.localeCompare(b.term));
  const groups = new Map();
  for (const term of sorted) {
    const letter = term.term[0].toUpperCase();
    if (!groups.has(letter)) groups.set(letter, []);
    groups.get(letter).push(term);
  }
  return [...groups.entries()].map(([letter, terms]) => `<section class="term-group" data-term-group>
    <h2 class="term-letter">${esc(letter)}</h2>
    <div class="term-grid">${terms.map(termCard).join('')}</div>
  </section>`).join('');
}

export async function renderGlossary(view, query) {
  const initialQuery = query.get('q') || '';
  view.innerHTML = `
    <header class="page-head glossary-head">
      <div class="page-head-copy">
        <span class="eyebrow">Admin glossary</span>
        <h1>The words behind the config.</h1>
        <p class="page-lede">${GLOSSARY.length} practical definitions for HAProxy operators: routing, TLS, health checks, timeouts, performance, operations and the version changes that affect them.</p>
      </div>
      <div class="page-actions"><a class="btn btn-ghost" href="#/learn">${icon('book')}Learning articles</a></div>
    </header>

    <div class="glossary-toolbar">
      <label class="search-field">${icon('search')}<input type="search" value="${esc(initialQuery)}" placeholder="Search a term, alias or definition…" data-glossary-search aria-label="Search glossary"></label>
      <span class="filter-result" data-glossary-result>${GLOSSARY.length} terms</span>
    </div>
    <div class="filter-chips glossary-categories" role="group" aria-label="Filter glossary by category">
      <button class="chip active" type="button" data-glossary-category="all">All</button>
      ${GLOSSARY_CATEGORIES.map((category) => `<button class="chip" type="button" data-glossary-category="${esc(category)}">${esc(category)}</button>`).join('')}
    </div>

    <div class="glossary-body">${groupedHTML()}</div>
    <div class="empty-filter" data-glossary-empty hidden>${icon('search')}No term matches that search.</div>

    <div class="callout info">${icon('info')}<p><strong>Version-specific terms change.</strong> This glossary explains the common operator vocabulary; exact directive syntax belongs in the configuration manual for the branch you run. The Workbench analyzer and version guide connect terms to concrete findings.</p></div>
  `;

  const search = view.querySelector('[data-glossary-search]');
  const result = view.querySelector('[data-glossary-result]');
  const empty = view.querySelector('[data-glossary-empty]');
  const cards = [...view.querySelectorAll('.term-card')];
  const groups = [...view.querySelectorAll('[data-term-group]')];
  let category = 'all';

  const apply = () => {
    const query = search.value.trim().toLowerCase();
    let shown = 0;
    cards.forEach((card) => {
      const visible = (category === 'all' || card.dataset.termCategory === category)
        && (!query || card.dataset.termSearch.includes(query));
      card.hidden = !visible;
      if (visible) shown += 1;
    });
    groups.forEach((group) => {
      group.hidden = ![...group.querySelectorAll('.term-card')].some((card) => !card.hidden);
    });
    result.textContent = `${shown} term${shown === 1 ? '' : 's'}`;
    empty.hidden = shown > 0;
    view.querySelectorAll('[data-glossary-category]').forEach((button) => {
      button.classList.toggle('active', button.dataset.glossaryCategory === category);
    });
    const params = new URLSearchParams();
    if (query) params.set('q', search.value.trim());
    if (category !== 'all') params.set('category', category);
    const suffix = params.toString();
    history.replaceState(null, '', `#/glossary${suffix ? `?${suffix}` : ''}`);
  };

  search?.addEventListener('input', apply);
  view.querySelectorAll('[data-glossary-category]').forEach((button) => {
    button.addEventListener('click', () => {
      category = button.dataset.glossaryCategory;
      apply();
    });
  });

  const initialCategory = query.get('category');
  if (initialCategory && GLOSSARY_CATEGORIES.includes(initialCategory)) {
    category = initialCategory;
  }
  apply();

  return null;
}
