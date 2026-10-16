const { startServer } = require('./src/index');

startServer();
// Bind the API first, then load the browser worker independently. This keeps
// the dashboard responsive while Playwright warms up on a cold local start.
setImmediate(() => require('./src/services/worker').startWorker());
