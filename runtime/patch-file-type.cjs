// Backport upstream 319abf871b50ba2fa221b4a7050059f1ae096f4f to the CJS
// release required by Lounge 4.5.2. Keep the original version/license metadata.
// https://github.com/sindresorhus/file-type/security/advisories/GHSA-5v7r-6r5c-r473
const fs = require('node:fs');
const path = require('node:path');
const file = path.join(path.dirname(require.resolve('file-type/package.json')), 'core.js');
if (require('file-type/package.json').version !== '16.5.4') {
  throw new Error('Reassess the ASF backport for this file-type version');
}
let source = fs.readFileSync(file, 'utf8');
const replacements = [
  ['\t\twhile (tokenizer.position + 24 < tokenizer.fileInfo.size) {\n\t\t\tconst header = await readHeader();',
   '\t\twhile (tokenizer.position + 24 < tokenizer.fileInfo.size) {\n\t\t\tconst previousPosition = tokenizer.position;\n\t\t\tconst header = await readHeader();'],
  ['\t\t\tawait tokenizer.ignore(payload);\n\t\t}\n\n\t\t// Default to ASF generic extension',
   '\t\t\tawait tokenizer.ignore(payload);\n\t\t\t// Upstream ASF non-advancing parser fix.\n\t\t\tif (tokenizer.position <= previousPosition) {\n\t\t\t\tbreak;\n\t\t\t}\n\t\t}\n\n\t\t// Default to ASF generic extension']
];
for (const [before, after] of replacements) {
  if (source.split(before).length !== 2) throw new Error('ASF backport context changed');
  source = source.replace(before, after);
}
fs.writeFileSync(file, source);
