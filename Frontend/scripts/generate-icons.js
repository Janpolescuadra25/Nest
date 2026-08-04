const fs = require('fs');
const path = require('path');

const SOURCE_DIR = path.join(__dirname, '..', 'public', 'Nest_Logo');
const TARGET_DIR = path.join(__dirname, '..', 'public', 'icons');
fs.mkdirSync(TARGET_DIR, { recursive: true });

const icons = [
  { src: 'icon-16.png', dest: 'icon16.png' },
  { src: 'icon-48.png', dest: 'icon48.png' },
  { src: 'icon-128.png', dest: 'icon128.png' },
  { src: 'Nest_logo.png', dest: 'autobooks-logo.png' },
];

for (const { src, dest } of icons) {
  const sourcePath = path.join(SOURCE_DIR, src);
  const targetPath = path.join(TARGET_DIR, dest);
  if (!fs.existsSync(sourcePath)) {
    console.error(`[Icons] Missing source icon: ${sourcePath}`);
    process.exit(1);
  }
  fs.copyFileSync(sourcePath, targetPath);
  console.log(`[Icons] Copied ${dest} from Nest_Logo/${src}`);
}
