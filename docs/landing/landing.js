const downloadBase = "https://github.com/nekidaz/.bonk/releases";
const platform = navigator.userAgentData?.platform || navigator.platform || "";
const downloadUrl = /win/i.test(platform)
  ? `${downloadBase}/download/v0.1.7/bonk_0.1.7_x64-setup.exe`
  : /mac/i.test(platform)
    ? `${downloadBase}/download/v0.1.7/bonk_0.1.7_aarch64.dmg`
    : `${downloadBase}/latest`;
const sendDownload = document.querySelector('[data-platform-download="auto"]');
if (sendDownload) sendDownload.href = downloadUrl;

document.querySelectorAll("[data-copy]").forEach((button) => {
  let timer;
  const icon = button.querySelector("svg");
  const status = document.querySelector("#copy-status");
  const originalLabel = button.getAttribute("aria-label");
  const visibleLabel = [...button.children].find(
    (item) => item.textContent.trim() === "Copy",
  );
  button.addEventListener("click", async () => {
    clearTimeout(timer);
    try {
      await navigator.clipboard.writeText(button.dataset.copy);
      button.classList.add("copy-feedback");
      button.setAttribute("aria-label", "Command copied");
      if (visibleLabel) visibleLabel.textContent = "Copied";
      if (icon) icon.classList.add("copy-feedback");
      status.textContent = "Install command copied.";
    } catch {
      const command = document.createElement("textarea");
      command.value = button.dataset.copy;
      command.setAttribute("readonly", "");
      command.className = "sr-only";
      document.body.append(command);
      command.select();
      let copied = false;
      try {
        copied = document.execCommand("copy");
      } finally {
        command.remove();
      }
      status.textContent = copied
        ? "Install command copied."
        : "Select the visible install command and copy it with your keyboard.";
    }
    timer = setTimeout(() => {
      button.classList.remove("copy-feedback");
      button.setAttribute("aria-label", originalLabel);
      if (visibleLabel) visibleLabel.textContent = "Copy";
      icon?.classList.remove("copy-feedback");
    }, 1800);
  });
});

document
  .querySelector(".download-request")
  ?.addEventListener("keydown", (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
      event.preventDefault();
      sendDownload?.click();
    }
  });
