const fs = require('fs');
const path = require('path');

// List of files to delete
const filesToDelete = [
  'electron/main/services/agentService.ts',
  'electron/main/services/hintService.ts',
  'electron/main/services/viewManagerService.ts',
  'electron/main/services/index.ts',
  'electron/main/handlers/aiHandler.ts',
  'electron/main/handlers/hintHandler.ts',
  'electron/main/handlers/navigationHandler.ts',
  'electron/main/handlers/index.ts'
];

// List of directories to remove (after files are deleted)
const dirsToRemove = [
  'electron/main/services',
  'electron/main/handlers'
];

console.log('Starting cleanup...');

// Delete files
filesToDelete.forEach(file => {
  const filePath = path.join(__dirname, file);
  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      console.log(`Deleted: ${file}`);
    } else {
      console.log(`File not found: ${file}`);
    }
  } catch (error) {
    console.error(`Error deleting ${file}:`, error.message);
  }
});

// Remove empty directories
dirsToRemove.forEach(dir => {
  const dirPath = path.join(__dirname, dir);
  try {
    if (fs.existsSync(dirPath)) {
      fs.rmdirSync(dirPath);
      console.log(`Removed directory: ${dir}`);
    } else {
      console.log(`Directory not found: ${dir}`);
    }
  } catch (error) {
    console.error(`Error removing ${dir}:`, error.message);
  }
});

console.log('Cleanup complete!');