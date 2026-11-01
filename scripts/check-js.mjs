import { execFile } from 'node:child_process';
import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);
const root = process.cwd();
const roots = ['public/assets/js', 'scripts', 'tests'];

async function walk(directory, output = []) {
  for (const entry of await readdir(directory)) {
    const file = path.join(directory, entry);
    const info = await stat(file);
    if (info.isDirectory()) await walk(file, output);
    else if (/\.(m?js)$/.test(entry)) output.push(file);
  }
  return output;
}

const files = [];
for (const directory of roots) {
  try {
    await walk(path.resolve(root, directory), files);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
}
const jsFiles = files.filter((file) => file.endsWith('.js') || file.endsWith('.mjs'));

let failed = 0;
for (const file of jsFiles.sort()) {
  try {
    await run(process.execPath, ['--check', file], { cwd: root });
  } catch (error) {
    failed += 1;
    console.error(`\nSyntax error: ${path.relative(root, file)}`);
    console.error(error.stderr || error.message);
  }
}

if (failed > 0) {
  console.error(`\n${failed} JavaScript file(s) failed syntax validation.`);
  process.exit(1);
}
console.log(`Checked ${jsFiles.length} JavaScript modules: syntax OK.`);
