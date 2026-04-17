#!/usr/bin/env node

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { spawn } from "node:child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");

function checkElectronInstallation() {
  try {
    const electronPath = path.resolve(projectRoot, "node_modules/electron");
    const pathFile = path.join(electronPath, "path.txt");

    if (!fs.existsSync(electronPath)) {
      console.log("Electron module not found, running install...");
      return true;
    }

    if (!fs.existsSync(pathFile)) {
      console.log("Electron path.txt not found, running install...");
      return true;
    }

    const pathContent = fs.readFileSync(pathFile, "utf-8").trim();
    if (!pathContent) {
      console.log("Electron path.txt is empty, running install...");
      return true;
    }

    const executablePath = path.join(electronPath, "dist", pathContent);
    if (!fs.existsSync(executablePath)) {
      console.log("Electron executable not found, running install...");
      return true;
    }

    console.log("Electron installation is valid, skipping install...");
    return false;
  } catch (error) {
    console.log("Error checking Electron installation:", error.message);
    return true;
  }
}

function runCommand(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const childProcess = spawn(command, args, {
      stdio: "inherit",
      cwd: projectRoot,
      ...options,
    });

    childProcess.on("close", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`Command failed with code ${code}`));
      }
    });

    childProcess.on("error", reject);
  });
}

async function main() {
  const needInstall = checkElectronInstallation();

  if (needInstall) {
    console.log("Running Electron install script...");
    const installScript = path.resolve(
      projectRoot,
      "node_modules/electron/install.js",
    );

    if (fs.existsSync(installScript)) {
      await runCommand("node", [installScript], {
        cwd: path.resolve(projectRoot, "node_modules/electron"),
      });
      console.log("Electron install completed successfully");
    } else {
      console.error("Electron install script not found at:", installScript);
      process.exit(1);
    }
  } else {
    console.log("Electron postinstall check completed successfully");
  }
}

main().catch((error) => {
  console.error("Error in postinstall script:", error);
  process.exit(1);
});
