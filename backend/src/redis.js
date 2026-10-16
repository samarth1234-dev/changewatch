function redisConnectionOptions() {
  const rawUrl = process.env.REDIS_URL || 'redis://127.0.0.1:6379';
  const url = new URL(rawUrl);
  const isTls = url.protocol === 'rediss:' || url.hostname.includes('upstash.io');
  const options = {
    host: url.hostname,
    port: Number(url.port || 6379),
    maxRetriesPerRequest: null,
  };
  if (url.username) options.username = decodeURIComponent(url.username);
  if (url.password) options.password = decodeURIComponent(url.password);
  if (isTls) {
    options.tls = {
      rejectUnauthorized: false,
    };
  }
  return options;
}

module.exports = { redisConnectionOptions };
