document.querySelectorAll('[data-copy]').forEach((button) => {
  const status = document.querySelector('#copy-status');
  button.addEventListener('click', async () => {
    const command = button.getAttribute('data-copy');
    try {
      await navigator.clipboard.writeText(command);
      if (status) status.textContent = 'Homebrew command copied.';
    } catch {
      if (status) status.textContent = 'Select the command above and copy it with your keyboard.';
    }
  });
});
