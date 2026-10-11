// Docs are one page: each <article> is a doc, the hash picks which one is shown.
// The article's data-* attributes (data-h1 overrides the heading) drive the sidebar, header, pager and title.
const main = document.querySelector('.docs-main');
const articles = [...main.querySelectorAll(':scope > article')];
const sidebar = document.querySelector('.docs-nav');
const sideNav = sidebar.querySelector('nav');
const search = sidebar.querySelector('input');
const toc = document.querySelector('.docs-toc nav');
const mobile = matchMedia('(max-width: 860px)');
const icons = document.querySelector('#docs-icons').content;
const icon = (name) => icons.querySelector(`[data-icon="${name}"] svg`).cloneNode(true);

const el = (tag, props = {}, ...children) => {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
};

// Sidebar, grouped in article order.
const links = new Map();
for (const article of articles) {
  const group = article.dataset.group;
  let section = [...sideNav.children].find((s) => s.dataset.group === group);
  if (!section) {
    section = el('div', { className: 'docs-group' });
    section.dataset.group = group;
    section.append(el('p', { className: 'docs-eyebrow' }, group));
    sideNav.append(section);
  }
  const link = el('a', { href: `#${article.id}` }, article.dataset.title);
  section.append(link);
  links.set(article, link);
}
const noResults = el('p', { className: 'docs-empty', hidden: true }, 'No results');
sideNav.append(noResults);

// Header, code blocks, callouts, pager.
articles.forEach((article, i) => {
  const { title, h1, group, lede, meta } = article.dataset;
  // Section ids are scoped to the page so "#cli-install" can't collide with "#install".
  for (const h of article.querySelectorAll('h2[id], h3[id]')) {
    h.id = `${article.id}-${h.id}`;
  }
  const crumbs = el(
    'nav',
    { className: 'docs-crumbs', ariaLabel: 'Breadcrumb' },
    el('span', {}, 'Docs'),
    icon('chevron'),
    el('span', {}, group),
    icon('chevron'),
    el('span', {}, title),
  );
  const header = [crumbs, el('h1', {}, h1 ?? title)];
  if (lede) header.push(el('p', { className: 'docs-lede' }, lede));
  if (meta) {
    header.push(el('div', { className: 'docs-meta' }, ...meta.split('|').map((m) => el('span', {}, m))));
  }
  article.prepend(...header);

  for (const pre of article.querySelectorAll('pre')) {
    const code = pre.querySelector('code') ?? pre;
    const text = code.textContent;
    code.replaceChildren(
      ...text.split('\n').flatMap((line, n) => {
        const out = /^\s*(#|\/\/)/.test(line) ? [el('span', { className: 'c' }, line)] : [line];
        return n ? ['\n', ...out] : out;
      }),
    );
    const copy = el('button', { type: 'button' }, icon('copy'), el('span', {}, 'Copy'));
    copy.addEventListener('click', async () => {
      await navigator.clipboard.writeText(text.replace(/^\s*(#|\/\/).*\n?/gm, '').trim());
      copy.lastChild.textContent = 'Copied';
      setTimeout(() => (copy.lastChild.textContent = 'Copy'), 1600);
    });
    const box = el('div', { className: 'docs-code' });
    pre.replaceWith(box);
    box.append(el('div', { className: 'docs-code-bar' }, el('span', {}, pre.dataset.lang ?? 'text'), copy), pre);
  }

  for (const callout of article.querySelectorAll('aside.callout')) {
    callout.replaceChildren(icon('shield'), el('div', {}, ...callout.childNodes));
  }

  const pager = el('nav', { className: 'docs-pager', ariaLabel: 'Pages' });
  const prev = articles[i - 1];
  const next = articles[i + 1];
  if (prev) {
    pager.append(el('a', { href: `#${prev.id}`, rel: 'prev' }, el('small', {}, 'Previous'), `← ${prev.dataset.title}`));
  }
  if (next) {
    pager.append(el('a', { href: `#${next.id}`, rel: 'next' }, el('small', {}, 'Next'), `${next.dataset.title} →`));
  }
  const answer = el('div');
  for (const [name, label] of [
    ['up', 'Yes'],
    ['down', 'No'],
  ]) {
    const button = el('button', { type: 'button' }, icon(name), label);
    button.addEventListener('click', () => {
      answer.replaceChildren(
        el('a', { href: 'https://github.com/nekidaz/.bonk/issues/new' }, 'Thanks! Tell us more on GitHub →'),
      );
    });
    answer.append(button);
  }
  article.append(pager, el('div', { className: 'docs-feedback' }, el('span', {}, 'Was this page helpful?'), answer));
});

// Routing: "#slug" opens a page, "#slug-section" opens it at that section.
let current;
let headings = [];
function route() {
  const id = decodeURIComponent(location.hash.slice(1));
  const target = id ? document.getElementById(id) : null;
  const article = target?.closest('.docs-main > article') ?? articles[0];
  if (article !== current) {
    current?.classList.remove('is-current');
    links.get(current)?.removeAttribute('aria-current');
    current = article;
    article.classList.add('is-current');
    links.get(article).setAttribute('aria-current', 'page');
    document.title = `${article.dataset.title} — bonk docs`;
    headings = [...article.querySelectorAll('h2[id]')];
    toc.replaceChildren(...headings.map((h) => el('a', { href: `#${h.id}` }, h.textContent)));
  }
  // Keep the current page's link visible in the (scrollable) sidebar.
  const link = links.get(article).getBoundingClientRect();
  const box = sidebar.getBoundingClientRect();
  if (link.top < box.top || link.bottom > Math.min(box.bottom, innerHeight)) {
    sidebar.scrollTop += link.top - box.top - box.height / 3;
  }
  if (target && target !== article) target.scrollIntoView();
  else scrollTo(0, 0);
  if (mobile.matches) sidebar.open = false;
  spy();
}

function spy() {
  let active = headings[0];
  for (const h of headings) if (h.getBoundingClientRect().top < 120) active = h;
  for (const a of toc.children) a.classList.toggle('is-active', a.hash === `#${active?.id}`);
}

// Search filters the sidebar by title and page text.
search.addEventListener('input', () => {
  const q = search.value.trim().toLowerCase();
  let shown = 0;
  for (const [article, link] of links) {
    const hit = !q || article.dataset.title.toLowerCase().includes(q) || article.textContent.toLowerCase().includes(q);
    link.hidden = !hit;
    shown += hit;
  }
  for (const group of sideNav.querySelectorAll('.docs-group')) {
    group.hidden = !group.querySelector('a:not([hidden])');
  }
  noResults.hidden = shown > 0;
});
search.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') sideNav.querySelector('a:not([hidden])')?.click();
  if (event.key === 'Escape') {
    search.value = '';
    search.dispatchEvent(new Event('input'));
    search.blur();
  }
});
addEventListener('keydown', (event) => {
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
    event.preventDefault();
    sidebar.open = true;
    search.focus();
  }
});

if (mobile.matches) sidebar.open = false;
addEventListener('hashchange', route);
addEventListener('scroll', spy, { passive: true });
route();
