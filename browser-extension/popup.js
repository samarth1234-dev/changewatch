document.getElementById('open').addEventListener('click', async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.url || !/^https?:\/\//.test(tab.url)) return;
  await chrome.tabs.create({ url: `http://localhost:3000/?url=${encodeURIComponent(tab.url)}` });
  window.close();
});
