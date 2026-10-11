const downloadBase = 'https://github.com/nekidaz/.bonk/releases';
const platform = navigator.userAgentData?.platform || navigator.platform || '';
const downloadUrl = /win/i.test(platform)
  ? `${downloadBase}/download/v0.2.0/bonk_0.2.0_x64-setup.exe`
  : /mac/i.test(platform)
    ? `${downloadBase}/download/v0.2.0/bonk_0.2.0_aarch64.dmg`
    : `${downloadBase}/latest`;
const sendDownload = document.querySelector('[data-platform-download="auto"]');
if (sendDownload) sendDownload.href = downloadUrl;

document.querySelectorAll('[data-copy]').forEach((button) => {
  let timer;
  const icon = button.querySelector('svg');
  const status = document.querySelector('#copy-status');
  const originalLabel = button.getAttribute('aria-label');
  const visibleLabel = [...button.children].find((item) => item.textContent.trim() === 'Copy');
  button.addEventListener('click', async () => {
    clearTimeout(timer);
    try {
      await navigator.clipboard.writeText(button.dataset.copy);
      button.classList.add('copy-feedback');
      button.setAttribute('aria-label', 'Command copied');
      if (visibleLabel) visibleLabel.textContent = 'Copied';
      if (icon) icon.classList.add('copy-feedback');
      status.textContent = 'Install command copied.';
    } catch {
      const command = document.createElement('textarea');
      command.value = button.dataset.copy;
      command.setAttribute('readonly', '');
      command.className = 'sr-only';
      document.body.append(command);
      command.select();
      let copied = false;
      try {
        copied = document.execCommand('copy');
      } finally {
        command.remove();
      }
      status.textContent = copied
        ? 'Install command copied.'
        : 'Select the visible install command and copy it with your keyboard.';
    }
    timer = setTimeout(() => {
      button.classList.remove('copy-feedback');
      button.setAttribute('aria-label', originalLabel);
      if (visibleLabel) visibleLabel.textContent = 'Copy';
      icon?.classList.remove('copy-feedback');
    }, 1800);
  });
});

document.querySelector('.download-request')?.addEventListener('keydown', (event) => {
  if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
    event.preventDefault();
    sendDownload?.click();
  }
});

// 02 / Demo: a tab (or a thumbnail below) shows its screen; the thumbnails list the others.
const demoTabs = [...document.querySelectorAll('.demo-tabs [role="tab"]')];
const showDemo = (key, focus = false) => {
  for (const tab of demoTabs) {
    const on = tab.id === `demo-tab-${key}`;
    tab.setAttribute('aria-selected', on);
    tab.tabIndex = on ? 0 : -1;
    document.getElementById(tab.getAttribute('aria-controls')).hidden = !on;
    if (on && focus) tab.focus();
  }
  for (const thumb of document.querySelectorAll('.demo-more [data-demo]')) {
    thumb.hidden = thumb.dataset.demo === key;
  }
};
demoTabs.forEach((tab, i) => {
  const key = tab.id.replace('demo-tab-', '');
  tab.addEventListener('click', () => showDemo(key));
  tab.addEventListener('keydown', (event) => {
    const step = { ArrowRight: 1, ArrowLeft: -1 }[event.key];
    if (!step) return;
    const next = demoTabs[(i + step + demoTabs.length) % demoTabs.length];
    showDemo(next.id.replace('demo-tab-', ''), true);
  });
});
document.querySelectorAll('.demo-more [data-demo]').forEach((thumb) => {
  thumb.addEventListener('click', () => {
    showDemo(thumb.dataset.demo);
    document.querySelector('.demo-tabs').scrollIntoView({ block: 'start' });
  });
});

// Motion: section blocks rise in as they scroll into view (siblings staggered by --i).
document.documentElement.classList.add('motion');
const revealTargets = [];
for (const section of document.querySelectorAll('main section:not(.hero, .product-stage)')) {
  for (const child of section.children) {
    if (child.matches('.demo-stage')) continue; // tab panels animate on switch instead
    const group = child.matches('.proof-row, [class*="feature-row"], .demo-more, [data-design-id="NHCrS"]')
      ? [...child.children]
      : [child];
    group.forEach((el, i) => {
      el.dataset.reveal = '';
      el.style.setProperty('--i', i);
      revealTargets.push(el);
    });
  }
}
// Sequenced pieces: runner bars and the agent session play when they appear.
for (const id of ['tdnat', 'Zg19c']) {
  const el = document.querySelector(`[data-design-id="${id}"]`);
  if (el) revealTargets.push(el);
}
document.querySelectorAll('[data-design-id="tdnat"] > *').forEach((bar, i) => {
  bar.style.transitionDelay = `${300 + i * 40}ms`;
});
[
  ...document.querySelectorAll('[data-design-id="LeTzS"], [data-design-id="tb0RA"] > *, [data-design-id="Oec9z"]'),
].forEach((step, i) => {
  step.style.transitionDelay = `${400 + i * 450}ms`;
});
const revealer = new IntersectionObserver(
  (entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      entry.target.classList.add('is-in');
      revealer.unobserve(entry.target);
    }
  },
  { rootMargin: '0px 0px -10% 0px' },
);
revealTargets.forEach((el) => revealer.observe(el));

// Live demo (desktop with a mouse): the tabs drive the real app in an iframe instead of screenshots.
const demoSection = document.querySelector(".demo");
const liveToggle = document.querySelector(".demo-live-toggle");
const live = document.querySelector(".demo-live");
const liveFrame = live?.querySelector(".demo-live-frame");
const liveIframe = live?.querySelector("iframe");
const canLive = matchMedia("(min-width: 1100px) and (pointer: fine)");
const liveQuery = { git: "&git=1", grpc: "&grpc=streams" };
let liveTimer;
const loadLive = (key) => {
  live.classList.remove("is-ready");
  liveFrame.style.setProperty("--shot", `url("screenshots/demo-${key}.jpg")`);
  liveIframe.src = `demo/?view=${key}${liveQuery[key] ?? ""}`;
  clearInterval(liveTimer);
  const started = Date.now();
  // The demo marks <html data-demo-ready> once it has clicked through to the screen.
  liveTimer = setInterval(() => {
    let ready = false;
    try {
      ready = !!liveIframe.contentDocument?.documentElement.dataset.demoReady;
    } catch {}
    if (ready || Date.now() - started > 6000) {
      live.classList.add("is-ready");
      clearInterval(liveTimer);
    }
  }, 100);
};
const currentDemo = () =>
  demoTabs.find((tab) => tab.getAttribute("aria-selected") === "true").id.replace("demo-tab-", "");
const setLive = (on) => {
  demoSection.classList.toggle("is-live", on);
  live.hidden = !on;
  liveToggle.setAttribute("aria-pressed", on);
  liveToggle.lastElementChild.textContent = on ? "Back to screenshots" : "Try it live";
  if (on) loadLive(currentDemo());
  else liveIframe.src = "about:blank";
};
if (liveToggle) {
  const syncLive = () => {
    liveToggle.hidden = !canLive.matches;
    if (!canLive.matches && demoSection.classList.contains("is-live")) setLive(false);
  };
  syncLive();
  canLive.addEventListener("change", syncLive);
  liveToggle.addEventListener("click", () => setLive(!demoSection.classList.contains("is-live")));
  new ResizeObserver(() => {
    // 24px: the .demo-live padding around the frame.
    liveFrame.style.setProperty("--s", Math.min(1, (live.clientWidth - 24) / 1280));
  }).observe(live);
  // Switching tabs while live opens that screen in the app.
  for (const el of [...demoTabs, ...document.querySelectorAll(".demo-more [data-demo]")]) {
    el.addEventListener("click", () => {
      if (demoSection.classList.contains("is-live")) loadLive(currentDemo());
    });
  }
}
