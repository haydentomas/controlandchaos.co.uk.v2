import fs from 'node:fs/promises';
import path from 'node:path';
import nunjucks from 'nunjucks';

const root = path.resolve(import.meta.dirname, '..');
export async function generateCMSPreviews() {
  const names = ['header', 'footer', 'event-card', 'blog-card', 'guide-card'];
  const compiled = await Promise.all(names.map(async name => {
    const filename = `partials/${name}.njk`;
    return nunjucks.precompileString(await fs.readFile(path.join(root, 'templates', filename), 'utf8'), { name: filename });
  }));
  const output = path.join(root, 'public/admin/preview-templates.js');
  const source = compiled.join('\n');
  const previous = await fs.readFile(output, 'utf8').catch(error => { if (error.code === 'ENOENT') return ''; throw error; });
  if (source !== previous) await fs.writeFile(output, source);
}