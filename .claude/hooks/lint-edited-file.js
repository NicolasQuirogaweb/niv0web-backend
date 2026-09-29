// Claude Code hook (PostToolUse on Edit/Write): lints the file that was just edited.
// If ESLint fails it exits with code 2, so the error goes back to the agent and it
// fixes it in the same turn instead of finding out later in CI.
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

let input = '';
process.stdin.on('data', (chunk) => (input += chunk));
process.stdin.on('end', () => {
  let filePath;
  try {
    filePath = JSON.parse(input).tool_input?.file_path;
  } catch {
    process.exit(0);
  }
  if (!filePath || !filePath.endsWith('.js')) process.exit(0);

  const relative = path.relative(process.cwd(), filePath);
  if (relative.startsWith('..') || relative.includes('node_modules')) process.exit(0);

  const eslintBin = path.join(process.cwd(), 'node_modules', 'eslint', 'bin', 'eslint.js');
  if (!fs.existsSync(eslintBin)) process.exit(0); // sin npm install no hay nada que correr

  try {
    execFileSync(process.execPath, [eslintBin, relative], { stdio: 'pipe' });
  } catch (err) {
    process.stderr.write(`ESLint failed on ${relative}:\n${err.stdout?.toString() || err.message}`);
    process.exit(2);
  }
});
