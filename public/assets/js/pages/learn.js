import { ARTICLES, articleIndex, getArticle } from '../data/learn.js';
import { GLOSSARY } from '../data/glossary.js';
import { REVIEWED_AT } from '../data/versions.js';
import { getCurrent } from '../storage.js';
import { copyText, esc, formatDate, icon, toast } from '../ui.js';

function inline(text) {
  return esc(text)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\[([^\]]+)\]\((#[^)\s]+|https?:\/\/[^)\s]+)\)/g, '<a href="$2">$1</a>');
}

function renderBlock(block) {
  switch (block.t) {
    case 'p':
      return `<p>${inline(block.text)}</p>`;
    case 'h3':
      return `<h3>${inline(block.text)}</h3>`;
    case 'ul':
      return `<ul>${block.items.map((item) => `<li>${inline(item)}</li>`).join('')}</ul>`;
    case 'ol':
      return `<ol>${block.items.map((item) => `<li>${inline(item)}</li>`).join('')}</ol>`;
    case 'code':
      return `<div class="article-code"><div class="code-head"><span>${esc(block.label || 'example')}</span><button class="btn btn-ghost btn-xs" type="button" data-copy-code>${icon('copy')}Copy</button></div><pre><code>${esc(block.code)}</code></pre></div>`;
    case 'note':
      return `<div class="callout ${block.tone || 'info'}">${icon(block.tone === 'danger' ? 'error' : block.tone === 'warn' ? 'warning' : block.tone === 'ok' ? 'check' : 'info')}<div>${block.title ? `<strong>${inline(block.title)}</strong>` : ''}<p>${inline(block.text)}</p></div></div>`;
    case 'table':
      return `<div class="table-scroll"><table class="data-table"><thead><tr>${block.head.map((cell) => `<th>${inline(cell)}</th>`).join('')}</tr></thead><tbody>${block.rows.map((row) => `<tr>${row.map((cell) => `<td>${inline(cell)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
    case 'checklist':
      return `<ul class="article-checklist">${block.items.map((item) => `<li>${icon('check')}<span>${inline(item)}</span></li>`).join('')}</ul>`;
    case 'kv':
      return `<dl class="article-kv">${block.items.map((item) => `<div><dt>${inline(item.k)}</dt><dd>${inline(item.v)}</dd></div>`).join('')}</dl>`;
    default:
      return '';
  }
}

function articleCard(article, index) {
  return `<a class="article-card" href="#/learn/${encodeURIComponent(article.slug)}" data-article-search="${esc(`${article.title} ${article.description} ${article.tags.join(' ')} ${article.eyebrow}`.toLowerCase())}">
    <div class="article-number">${String(index + 1).padStart(2, '0')}</div>
    <div class="article-copy">
      <span class="eyebrow">${esc(article.eyebrow)}</span>
      <h3>${esc(article.title)}</h3>
      <p>${esc(article.description)}</p>
      <div class="article-meta"><span>${esc(article.level)}</span><span>${article.minutes} min read</span></div>
    </div>
    <span class="article-arrow">${icon('arrow')}</span>
  </a>`;
}

function learnIndexHTML() {
  const list = articleIndex();
  const current = getCurrent();
  const topics = [...new Set(ARTICLES.flatMap((article) => article.tags))].slice(0, 12);
  return `
    <header class="page-head learn-head">
      <div class="page-head-copy">
        <span class="eyebrow">Learn</span>
        <h1>Read the config. Then change it.</h1>
        <p class="page-lede">Practical, opinionated explanations for HAProxy administrators: how requests flow, where TLS boundaries really are, why health checks silently do nothing, and what a 3.x upgrade actually changes.</p>
        <div class="hero-actions"><a class="btn btn-primary" href="#/learn/config-anatomy">${icon('book')}Start with the mental model</a><a class="btn btn-ghost" href="#/glossary">Open the glossary</a></div>
      </div>
      <div class="learn-side">
        <div class="reference-card"><span class="eyebrow">Reference</span><h3>HAProxy 2.x → 3.x</h3><p>LTS branches, removals, runtime API changes and a config-specific upgrade checklist.</p><a class="btn btn-ghost btn-sm" href="#/versions">${icon('layers')}Version guide</a></div>
        <div class="reference-card"><span class="eyebrow">Reference</span><h3>Admin glossary</h3><p>${GLOSSARY.length} terms from SNI and stick tables to 421, OCSP, ALPN and PROXY protocol.</p><a class="btn btn-ghost btn-sm" href="#/glossary">${icon('book')}Browse terms</a></div>
      </div>
    </header>

    ${current ? `<section class="learn-config-cta">
      <div class="learn-config-cta-icon">${icon('code')}</div>
      <div><span class="eyebrow">Your imported configuration</span><h2>Learn every row in <code>${esc(current.filename || 'haproxy.cfg')}</code></h2><p>Open the line-by-line walkthrough. It explains each directive in its section, what it does, why it matters and where to find the deeper guide.</p></div>
      <a class="btn btn-primary" href="#/workbench?tab=learn">${icon('book')}Explain my config</a>
    </section>` : `<section class="learn-config-cta">
      <div class="learn-config-cta-icon">${icon('book')}</div>
      <div><span class="eyebrow">Hands-on learning</span><h2>Import a config, then learn every row</h2><p>The Workbench includes a line-by-line walkthrough of your own configuration, not just generic examples.</p></div>
      <a class="btn btn-ghost" href="#/">Import a config</a>
    </section>`}

    <div class="learn-filter">
      <label class="search-field">${icon('search')}<input type="search" placeholder="Search articles and topics…" data-article-filter aria-label="Search articles"></label>
      <span class="filter-result" data-article-result>${list.length} articles</span>
    </div>
    <div class="article-grid" data-article-grid>${list.map(articleCard).join('')}</div>
    <div class="empty-filter" data-article-empty hidden>${icon('search')}No article matches that search.</div>

    <section class="section-block learn-topics">
      <div class="section-head"><div><span class="eyebrow">Topics</span><h2>Terms that connect the articles</h2></div><p>Jump into the glossary or let an article explain the architecture around the term.</p></div>
      <div class="tag-cloud">${topics.map((topic) => `<a class="chip" href="#/glossary?q=${encodeURIComponent(topic)}">${esc(topic)}</a>`).join('')}</div>
    </section>

    <div class="callout info">${icon('info')}<p><strong>Opinionated, not official.</strong> These guides are written to be practical and are reviewed ${esc(formatDate(REVIEWED_AT))}. Always confirm version-specific syntax in the official HAProxy configuration manual for the binary you run.</p></div>`;
}

function articleHTML(article) {
  const index = ARTICLES.findIndex((entry) => entry.slug === article.slug);
  const previous = ARTICLES[index - 1];
  const next = ARTICLES[index + 1];
  const sections = article.sections.map((section) => `
    <section class="article-section" id="${esc(section.id)}">
      <h2>${esc(section.title)}</h2>
      ${section.blocks.map(renderBlock).join('')}
    </section>`).join('');
  const toc = article.sections.map((section, sectionIndex) => `<a href="#/learn/${encodeURIComponent(article.slug)}#${esc(section.id)}" data-toc-${section.id}>${String(sectionIndex + 1).padStart(2, '0')} ${esc(section.title)}</a>`).join('');
  return `
    <div class="article-breadcrumb"><a href="#/learn">${icon('arrow')}All articles</a><span>${esc(article.eyebrow)}</span></div>
    <header class="article-head">
      <span class="eyebrow">${esc(article.eyebrow)}</span>
      <h1>${esc(article.title)}</h1>
      <p class="page-lede">${esc(article.description)}</p>
      <div class="article-head-meta">
        <span>${icon('clock')}${article.minutes} min read</span>
        <span>${esc(article.level)}</span>
        ${article.tags.map((tag) => `<span class="pill tiny">${esc(tag)}</span>`).join('')}
      </div>
    </header>
    <div class="article-layout">
      <article class="article-body">${sections}
        <div class="article-next">
          ${previous ? `<a class="prev-next" href="#/learn/${encodeURIComponent(previous.slug)}"><span>Previous</span><strong>${esc(previous.title)}</strong></a>` : '<span></span>'}
          ${next ? `<a class="prev-next next" href="#/learn/${encodeURIComponent(next.slug)}"><span>Next</span><strong>${esc(next.title)}</strong></a>` : '<span></span>'}
        </div>
        <div class="article-review">Reviewed ${esc(formatDate(REVIEWED_AT))}. This is an independent guide, not official HAProxy documentation. Validate syntax and behaviour against your deployed branch.</div>
      </article>
      <aside class="article-toc">
        <div class="toc-card">
          <span class="eyebrow">On this page</span>
          ${toc}
        </div>
        <div class="toc-card toc-cta">
          <span class="eyebrow">Practice</span>
          <p>Apply this to your own config. Import it locally and see the routes and warnings.</p>
          <a class="btn btn-ghost btn-sm" href="#/workbench">${icon('edit')}Open workbench</a>
        </div>
      </aside>
    </div>`;
}

export async function renderLearn(view, param) {
  view.classList.toggle('narrow', false);
  if (!param) {
    view.innerHTML = learnIndexHTML();
    const search = view.querySelector('[data-article-filter]');
    const cards = view.querySelectorAll('.article-card');
    const result = view.querySelector('[data-article-result]');
    const empty = view.querySelector('[data-article-empty]');
    search?.addEventListener('input', () => {
      const query = search.value.trim().toLowerCase();
      let shown = 0;
      cards.forEach((card) => {
        const match = !query || card.dataset.articleSearch.includes(query);
        card.hidden = !match;
        if (match) shown += 1;
      });
      result.textContent = `${shown} article${shown === 1 ? '' : 's'}`;
      empty.hidden = shown > 0;
    });
    return null;
  }

  const article = getArticle(param);
  if (!article) {
    view.innerHTML = `<section class="empty-state"><div class="empty-icon">${icon('search')}</div><h2>Article not found</h2><p>No learning article matches “${esc(param)}”.</p><div class="empty-actions"><a class="btn btn-primary" href="#/learn">Browse articles</a></div></section>`;
    return null;
  }

  document.title = `${article.title} · HAProxy Workbench`;
  view.innerHTML = articleHTML(article);

  // Code copy buttons live only as long as the rendered article.
  view.querySelectorAll('[data-copy-code]').forEach((button) => {
    button.addEventListener('click', () => {
      const code = button.closest('.article-code')?.querySelector('code')?.textContent || '';
      copyText(code, 'Example copied.');
    });
  });

  // Support direct #/learn/slug#section links by scrolling to the section.
  const hashPart = location.hash.split('#')[2];
  if (hashPart) {
    setTimeout(() => document.getElementById(hashPart)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 60);
  }

  return null;
}
