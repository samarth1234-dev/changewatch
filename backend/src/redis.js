function redisConnectionOptions() {
  const url = new URL(process.env.REDIS_URL || 'redis://127.0.0.1:6379');
  const options = {
    host: url.hostname,
    port: Number(url.port || 6379),
  };
  if (url.username) options.username = decodeURIComponent(url.username);
  if (url.password) options.password = decodeURIComponent(url.password);
  if (url.protocol === 'rediss:') options.tls = {};
  return options;
}

module.exports = { redisConnectionOptions };
