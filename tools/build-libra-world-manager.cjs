const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const { minify } = require('terser');

const main = async () => {
  const root = path.resolve(__dirname, '..');
  const manifestPath = path.join(root, 'src', 'build-manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

  const outputPath = path.join(root, manifest.output);
  const minifiedOutputPath = path.join(root, manifest.minifiedOutput || manifest.output.replace(/\.js$/i, '.min.js'));
  const outputDir = path.dirname(outputPath);
  fs.mkdirSync(outputDir, { recursive: true });

  const chunks = [];
  for (const part of manifest.parts || []) {
    const partPath = path.join(root, 'src', part.file);
    if (!fs.existsSync(partPath)) {
      throw new Error(`Missing source part: ${path.relative(root, partPath)}`);
    }
    chunks.push(fs.readFileSync(partPath, 'utf8'));
  }

  const bundle = chunks.join('');
  fs.writeFileSync(outputPath, bundle, 'utf8');

  const minified = await minify(bundle, {
    compress: false,
    mangle: false,
    format: {
      comments: /@(?:name|display-name|description|version|author|api|arg)\b|^!/
    }
  });
  if (!minified.code) throw new Error('Terser produced an empty minified bundle');
  fs.writeFileSync(minifiedOutputPath, minified.code + '\n', 'utf8');

  for (const target of [outputPath, minifiedOutputPath]) {
    const check = spawnSync(process.execPath, ['--check', target], {
      cwd: root,
      encoding: 'utf8'
    });
    if (check.status !== 0) {
      process.stderr.write(check.stdout || '');
      process.stderr.write(check.stderr || '');
      process.exit(check.status || 1);
    }
  }

  const hash = crypto.createHash('sha256').update(bundle).digest('hex');
  const size = Buffer.byteLength(bundle, 'utf8');
  const minifiedBundle = fs.readFileSync(minifiedOutputPath);
  const minifiedHash = crypto.createHash('sha256').update(minifiedBundle).digest('hex');
  const minifiedSize = minifiedBundle.length;
  const savedBytes = size - minifiedSize;
  const savedPercent = size > 0 ? ((savedBytes / size) * 100).toFixed(2) : '0.00';

  console.log(`Built ${path.relative(root, outputPath)}`);
  console.log(`Built ${path.relative(root, minifiedOutputPath)}`);
  console.log(`Parts: ${chunks.length}`);
  console.log(`Size: ${size} bytes`);
  console.log(`Minified size: ${minifiedSize} bytes`);
  console.log(`Saved: ${savedBytes} bytes (${savedPercent}%)`);
  console.log(`SHA256: ${hash}`);
  console.log(`Minified SHA256: ${minifiedHash}`);
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
