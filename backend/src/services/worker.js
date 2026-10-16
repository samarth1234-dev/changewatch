// Keep the worker startup lean for local development; the root BullMQ import
// also loads unused optional backends.
const { Worker } = require('bullmq/dist/cjs/classes/worker');
const { getTargetsByUrl } = require('../store');
const { checkUrlForTargets } = require('../monitoring');
const { redisConnectionOptions } = require('../redis');

function startWorker() {
  const worker = new Worker(
    'website-monitor',
    async (job) => {
      const { url } = job.data;
      const targets = getTargetsByUrl(url).filter((target) => target.active);
      if (targets.length === 0) return { skipped: true };
      // One page fetch is shared by every target subscribing to this URL.
      return checkUrlForTargets(url, targets);
    },
    { connection: redisConnectionOptions(), concurrency: 2 },
  );

  worker.on('completed', (job, result) => {
    if (!result?.skipped) console.log(`Checked ${job.data.url} for ${result.targets} monitor(s).`);
  });
  worker.on('failed', (job, error) => console.error(`Check failed for ${job?.data?.url || 'unknown URL'}: ${error.message}`));
  worker.on('error', (error) => console.error(`Worker connection error: ${error.message}`));
  return worker;
}

module.exports = { startWorker };
