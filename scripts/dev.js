const { spawn } = require('node:child_process');
const path = require('node:path');

const root = path.join(__dirname, '..');
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const commands = [
  { label: 'api', args: ['--prefix', 'backend', 'start'], color: '\x1b[36m' },
  { label: 'web', args: ['--prefix', 'frontend', 'run', 'dev'], color: '\x1b[35m' },
];
const processes = [];

for (const command of commands) {
  const child = spawn(npm, command.args, { cwd: root, stdio: ['inherit', 'pipe', 'pipe'] });
  processes.push(child);
  for (const stream of [child.stdout, child.stderr]) {
    stream.on('data', (chunk) => process.stdout.write(`${command.color}[${command.label}]\x1b[0m ${chunk}`));
  }
  child.on('exit', (code) => {
    if (code && code !== 0) console.error(`${command.label} exited with code ${code}.`);
  });
}

function stop() {
  for (const child of processes) child.kill('SIGTERM');
  process.exit(0);
}

process.on('SIGINT', stop);
process.on('SIGTERM', stop);

console.log('Starting changewatch… React dashboard: http://localhost:3000');
