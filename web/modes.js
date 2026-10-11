// Fast | Sand switch for hosts without one of their own (Windows): shown when the
// URL has ?modes, and the mode last picked opens next time.
const nav = document.querySelector('nav');
if (new URLSearchParams(location.search).has('modes')) {
  let saved; try { saved = localStorage.getItem('mode'); } catch {}
  if (saved === 'sand' && location.pathname.endsWith('/fast.html')) location.replace('index.html' + location.search);
  nav.hidden = false;
  for (const a of nav.querySelectorAll('a')) {
    a.href = a.getAttribute('href') + location.search;
    a.onclick = () => { try { localStorage.setItem('mode', a.dataset.mode); } catch {} };
  }
}
