// scripts/check-syntax.js - Checks syntax of all JavaScript files in the project
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const targetDirs = ['middleware', 'routes', 'services', 'scripts', 'tests'];
const rootFiles = ['server.js', 'db.js'];

let allFiles = [...rootFiles];

for (const dir of targetDirs) {
  const dirPath = path.join(__dirname, '..', dir);
  if (fs.existsSync(dirPath)) {
    const files = fs.readdirSync(dirPath);
    for (const file of files) {
      if (file.endsWith('.js')) {
        allFiles.push(path.join(dir, file));
      }
    }
  }
}

console.log(`Checking syntax for ${allFiles.length} JavaScript files...`);
let hasError = false;

for (const file of allFiles) {
  const fullPath = path.join(__dirname, '..', file);
  try {
    execSync(`node -c "${fullPath}"`, { stdio: 'pipe' });
    console.log(`  ✓ ${file}`);
  } catch (err) {
    console.error(`  ✗ SYNTAX ERROR in ${file}:`);
    console.error(err.stderr.toString());
    hasError = true;
  }
}

if (hasError) {
  console.error('\nSyntax check failed! Please fix the errors above.');
  process.exit(1);
} else {
  console.log(`\nAll ${allFiles.length} files passed syntax validation cleanly.`);
}
