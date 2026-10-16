const dns = require('node:dns').promises;

function isPrivateIp(address) {
  return /^127\./.test(address) || /^10\./.test(address) || /^192\.168\./.test(address)
    || /^169\.254\./.test(address) || /^172\.(1[6-9]|2\d|3[01])\./.test(address)
    || address === '::1' || address.startsWith('fc') || address.startsWith('fd') || address.startsWith('fe80:');
}

async function validatePublicUrl(url) {
  let parsed;
  try { parsed = new URL(url); } catch (_error) { throw new Error('Enter a valid public http(s) URL.'); }
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) {
    throw new Error('Only public http(s) URLs without credentials can be monitored.');
  }
  if (['localhost', '0.0.0.0', '::1'].includes(parsed.hostname)) throw new Error('Local and private addresses cannot be monitored.');
  try {
    const resolved = await dns.lookup(parsed.hostname, { all: true });
    if (resolved.some(({ address }) => isPrivateIp(address))) throw new Error('Local and private addresses cannot be monitored.');
  } catch (error) {
    if (error.message.includes('cannot be monitored')) throw error;
  }
  return parsed;
}

module.exports = { validatePublicUrl };
