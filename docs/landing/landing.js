const features = {
  http: {
    title: "The details that make debugging easier.",
    description:
      "Params, headers, inherited auth, JSON, multipart, binary, and GraphQL bodies. Read responses with syntax highlighting, JSONPath filters, folding, and a side-by-side layout.",
    caption: "HTTP request · query parameters · formatted JSON response",
    alt: "Bonk HTTP request editor and formatted response",
  },
  grpc: {
    title: "A service browser, right beside your message.",
    description:
      "Use server reflection or load your .proto files. Browse methods, generate message templates, set metadata and TLS options, and inspect unary or streaming responses.",
    caption: "gRPC service · reflected methods · request message and response",
    alt: "Bonk gRPC editor with reflected methods and a successful response",
  },
  scripts: {
    title: "Turn “looks right” into a repeatable check.",
    description:
      "Write pre-request and response tests in sandboxed JavaScript. Use familiar pm.* helpers, work with variables, and see test results and console output alongside the response.",
    caption: "Response tests · sandboxed JavaScript · pm.* helpers",
    alt: "Bonk scripts editor with JavaScript assertions for a response",
  },
  runner: {
    title: "One collection. A whole run of answers.",
    description:
      "Run HTTP and gRPC requests together. Choose an environment, iterations, delays, and CSV or JSON data. Inspect results, use saved presets, and export a JSON report.",
    caption:
      "Collection runner · iteration results · timing and failed-test details",
    alt: "Bonk collection runner showing iteration results, timing, and failed-test details",
  },
  environments: {
    title: "Same request. A different environment.",
    description:
      "Switch between local, staging, and production with {{variables}}. Manage environments and globals, mark secret values, and add confirmation for protected environments.",
    caption: "Environment manager · reusable variables · secret values",
    alt: "Bonk environments manager showing variables for different API targets",
  },
};
const tabs = [...document.querySelectorAll("[data-feature]")];
const panel = document.querySelector("#feature-panel");
function selectFeature(tab, focus = false) {
  const feature = features[tab.dataset.feature];
  if (!feature || !panel) return;
  tabs.forEach((item) => {
    const active = item === tab;
    item.setAttribute("aria-selected", String(active));
    item.tabIndex = active ? 0 : -1;
  });
  panel.setAttribute("aria-labelledby", tab.id);
  document.querySelector("#feature-title").textContent = feature.title;
  document.querySelector("#feature-description").textContent =
    feature.description;
  document.querySelector("#feature-caption").textContent = feature.caption;
  const image = document.querySelector("#feature-image");
  image.src = `screenshots/${tab.dataset.feature}.jpg`;
  image.alt = feature.alt;
  document.querySelector("#feature-image-link").href = image.src;
  if (focus) tab.focus();
}
tabs.forEach((tab, index) => {
  tab.addEventListener("click", () => selectFeature(tab));
  tab.addEventListener("keydown", (event) => {
    let next;
    if (event.key === "ArrowRight") next = (index + 1) % tabs.length;
    if (event.key === "ArrowLeft")
      next = (index + tabs.length - 1) % tabs.length;
    if (event.key === "Home") next = 0;
    if (event.key === "End") next = tabs.length - 1;
    if (next === undefined) return;
    event.preventDefault();
    selectFeature(tabs[next], true);
  });
});
document.querySelectorAll("[data-copy]").forEach((button) => {
  let timer;
  button.addEventListener("click", async () => {
    const status = document.querySelector(".copy-status");
    clearTimeout(timer);
    try {
      await navigator.clipboard.writeText(button.dataset.copy);
      button.textContent = "Copied";
      status.textContent = "Install command copied.";
    } catch {
      button.textContent = "Select";
      const range = document.createRange();
      range.selectNodeContents(button.parentElement.querySelector("code"));
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      status.textContent =
        "Copy is unavailable. The command is selected; copy it with your keyboard.";
    }
    timer = setTimeout(() => {
      button.textContent = "Copy";
    }, 2000);
  });
});
const platform = navigator.userAgentData?.platform || navigator.platform || "";
const key = /mac/i.test(platform)
  ? "mac"
  : /win/i.test(platform)
    ? "windows"
    : /linux/i.test(platform)
      ? "linux"
      : null;
if (key)
  document
    .querySelector(`[data-platform="${key}"]`)
    ?.classList.add("recommended");
