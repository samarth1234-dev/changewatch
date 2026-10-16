const path = require('node:path');

/** @type {import('next').NextConfig} */
module.exports = {
  outputFileTracingRoot: path.join(__dirname),
};
