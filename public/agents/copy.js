// The copy buttons on this page: each copies the text of the element named in its data-copy attribute.
document.querySelectorAll('button[data-copy]').forEach((b) => {
  b.addEventListener('click', async () => {
    const el = document.getElementById(b.dataset.copy);
    if (!el) return;
    try {
      await navigator.clipboard.writeText(el.textContent);
      b.textContent = 'Copied';
    } catch {
      const r = document.createRange();
      r.selectNodeContents(el);
      const s = window.getSelection();
      s.removeAllRanges();
      s.addRange(r);
      b.textContent = 'Selected: press copy on your keyboard';
    }
  });
});
