import * as p from "@clack/prompts";
import { setTimeout } from "node:timers/promises";
import color from "picocolors";
import fs from "fs";
import path from "path";
import { execSync } from "child_process";
import { fileURLToPath } from "url";

interface PackageJson {
  name: string;
  version: string;
  [key: string]: unknown;
}

// Get the directory where this script is located (important for npm packages)
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Configuration for template repository
const TEMPLATE_CONFIG = {
  // Default template repository
  repo: "https://github.com/valoriz/hello-streak-app.git",
  // If template is in a subdirectory of the repo
  templatePath: "",
  // Local template directory (for when running as installed package)
  localTemplatePath: path.join(__dirname, "template"),
};

/**
 * Sets up the project template, either from a local directory or by cloning a remote repository.
 * @param projectName - The name of the project.
 * @param forceRemote - A flag to force cloning from the remote repository.
 */
async function setupTemplate(projectName: string, forceRemote = false): Promise<void> {
  // First, try to use local template if it exists (for installed packages) and not forcing remote
  if (!forceRemote && fs.existsSync(TEMPLATE_CONFIG.localTemplatePath)) {
    console.log(color.dim("Using local template..."));
    copyDirectory(TEMPLATE_CONFIG.localTemplatePath, projectName);
    return;
  }

  // If no local template or forcing remote, clone from repository
  await cloneTemplate(TEMPLATE_CONFIG.repo, projectName, TEMPLATE_CONFIG.templatePath);
}

/**
 * Clones a Git repository to a temporary directory and copies the template files to the project directory.
 * @param repoUrl - The URL of the Git repository.
 * @param projectName - The name of the project.
 * @param templatePath - The path to the template subfolder within the repository.
 */
async function cloneTemplate(repoUrl: string, projectName: string, templatePath: string = ""): Promise<void> {
  const tempDir = path.join(process.cwd(), `.temp-${Date.now()}`);

  try {
    // Clone the repository to a temporary directory
    console.log(color.dim(`Cloning template from ${repoUrl}...`));
    execSync(`git clone --depth 1 ${repoUrl} "${tempDir}"`, {
      stdio: "pipe", // Hide git clone output
    });

    // Determine source path (repo root or subfolder)
    const sourcePath = templatePath ? path.join(tempDir, templatePath) : tempDir;

    if (!fs.existsSync(sourcePath)) {
      throw new Error(`Template path "${templatePath}" not found in repository`);
    }

    // Copy template files to project directory
    copyDirectory(sourcePath, projectName);

    // Clean up: remove .git directory from the new project
    const gitDir = path.join(projectName, ".git");
    if (fs.existsSync(gitDir)) {
      fs.rmSync(gitDir, { recursive: true, force: true });
    }
  } finally {
    // Clean up temporary directory
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  }
}

/**
 * Recursively copies a directory from a source path to a destination path.
 * @param src - The source directory path.
 * @param dest - The destination directory path.
 */
function copyDirectory(src: string, dest: string): void {
  if (!fs.existsSync(src)) {
    throw new Error(`Template directory ${src} does not exist`);
  }

  // Create destination directory
  fs.mkdirSync(dest, { recursive: true });

  const items = fs.readdirSync(src);

  items.forEach((item: string) => {
    // Skip .git directory and other common files we don't want to copy
    if (item === ".git" || item === ".DS_Store" || item === "node_modules") {
      return;
    }

    const srcPath = path.join(src, item);
    const destPath = path.join(dest, item);
    const stat = fs.statSync(srcPath);

    if (stat.isDirectory()) {
      copyDirectory(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  });
}

/**
 * Updates the `package.json` file with the new project name and version.
 * @param projectPath - The path to the new project directory.
 * @param projectName - The name of the project.
 */
function updatePackageJson(projectPath: string, projectName: string): void {
  const packageJsonPath = path.join(projectPath, "package.json");

  if (fs.existsSync(packageJsonPath)) {
    try {
      const packageJson: PackageJson = JSON.parse(
        fs.readFileSync(packageJsonPath, "utf8")
      );
      packageJson.name = projectName;
      packageJson.version = "0.1.0";

      fs.writeFileSync(packageJsonPath, JSON.stringify(packageJson, null, 2));
      console.log(color.dim(`Updated package.json with project name: ${projectName}`));
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(color.yellow(`Warning: Could not update package.json - ${message}`));
    }
  }
}

/**
 * Checks if Bun is available by running `bun --version`.
 * @returns `true` if Bun is available, otherwise `false`.
 */
function checkBunAvailability(): boolean {
  try {
    execSync("bun --version", { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

/**
 * Checks if Git is available by running `git --version`.
 * @returns `true` if Git is available, otherwise `false`.
 */
function checkGitAvailability(): boolean {
  try {
    execSync("git --version", { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

/**
 * Installs bun if not available
 */
function installBun(): void {
  try {
    // this command works for macOS and Linux
    execSync("curl -fsSL https://bun.sh/install | sh", { stdio: "inherit" });
    console.log(color.green("Bun installed successfully!"));
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(color.red("Failed to install Bun:"), message);
  }
}

/**
 * Install @valoriz/streak

 */
function installStreakPackage(projectName: string): void {
  try {
    execSync("bun add streak-forge", {
      cwd: projectName,
      stdio: ["ignore", "pipe", "pipe"], // capture stdout and stderr
      encoding: "utf-8",
    });
    console.log(color.green("streak-forge installed successfully!"));
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(color.red("Failed to install streak-forge:"), message);
  }
}

async function main(): Promise<void> {
  console.clear();

  await setTimeout(1000);
  console.log("\x1b[33m");
  console.log("███████ ████████ ██████  ███████  █████  ██   ██     ██ ███████");
  console.log("██         ██    ██   ██ ██      ██   ██ ██  ██      ██ ██     ");
  console.log("███████    ██    ██████  █████   ███████ █████       ██ ███████");
  console.log("     ██    ██    ██   ██ ██      ██   ██ ██  ██ ██   ██      ██");
  console.log("███████    ██    ██   ██ ███████ ██   ██ ██   ██ ██████ ███████");
  console.log("\x1b[0m");

  // Check if git is available
  if (!checkGitAvailability()) {
    p.outro(color.red("Git is required but not found. Please install Git and try again."));
    return;
  }

  // Check if bun is available
  if (!checkBunAvailability()) {
    console.log(color.yellow("Bun is not found. Installing Bun..."));
    installBun();

    // check bun availability again after installation
    if (!checkBunAvailability()) {
      p.outro(color.red("Bun installation failed. Please install Bun and try again.\nVisit: https://bun.sh"));
      return;
    }
  }

  const readyToPlay = await p.select({
    message: "Ok to proceed?",
    initialValue: "Yes",
    options: [
      { value: "Yes", label: "Yes" },
      { value: "No", label: "No" },
    ],
  });

  if (readyToPlay !== "Yes") {
    p.outro("Maybe next time!");
    return;
  }

  // Get project name from user
  let projectName = await p.text({
    message: "What would you like to name your project?",
    placeholder: "my-streak-app",
    validate(value) {
      if (!value) return;
      if (!/^[a-zA-Z0-9-_]+$/.test(value)) {
        return "Project name can only contain letters, numbers, hyphens (-), and underscores (_).";
      }
      if (fs.existsSync(value)) {
        return `Folder "${value}" already exists`;
      }
      return;
    },
  });

  if (!projectName) {
    projectName = "my-streak-app"; // Set default project name if user input is empty
    console.log(color.dim(`No project name provided, using default: "${projectName}"`));
  }
  if (p.isCancel(projectName)) {
    p.cancel("Operation cancelled.");
    return;
  }



  const templateRepo = TEMPLATE_CONFIG.repo;


  let s = p.spinner();
  s.start("Downloading template...");

  try {
    await setTimeout(500);
    // Force remote template download for now
    TEMPLATE_CONFIG.repo = templateRepo;
    await setupTemplate(projectName, true);
    s.stop("Template downloaded successfully!");

    s = p.spinner();
    s.start("Installing dependencies...");

    try {
      // Check if package.json exists before installing
      const packageJsonPath = path.join(projectName, "package.json");
      if (fs.existsSync(packageJsonPath)) {
        // Use bun install instead of npm install
        const installOutput = execSync("bun install", {
          cwd: projectName,
          stdio: ["ignore", "pipe", "pipe"], // capture stdout and stderr
          encoding: "utf-8",
        });

        installStreakPackage(projectName);

        s.stop("Dependencies installed!");

        // Filter and print relevant output from bun install
        const lines = installOutput.split("\n").filter((line: string) => {
          const trimmedLine = line.trim();
          return (
            trimmedLine &&
            (trimmedLine.includes("packages installed") ||
              trimmedLine.includes("Done in") ||
              trimmedLine.includes("Saved lockfile") ||
              trimmedLine.includes("dependencies installed"))
          );
        });

        lines.forEach((line: string) => console.log(color.gray(line.trim())));
      } else {
        s.stop("No package.json found, skipping dependency installation");
      }
    } catch (installError: unknown) {
      s.stop("Failed to install dependencies");
      const message = installError instanceof Error ? installError.message : String(installError);
      console.error(color.red("Error during bun install:"), message);
      console.log(color.dim("You can install dependencies manually later with: bun install"));
    }

    s = p.spinner();
    s.start("Updating configuration...");
    await setTimeout(300);
    updatePackageJson(projectName, projectName);
    s.stop("Configuration updated!");

    s = p.spinner();
    s.start("Finishing up...");
    await setTimeout(300);
    s.stop("");

    console.log("");
    p.outro(`${color.green("Streak app created successfully! ")}`);

    console.log(color.cyan(`\nNext steps:`));
    console.log(color.dim(`  1.`), `Maps into your project:`, color.green(`cd ${projectName}`));
    console.log(color.dim(`  2.`), `Start the project:`, color.green(`bun dev`));
    console.log(color.dim(`  3.`), `Or run:`, color.green(`bun start`));
    console.log(`\nHappy hacking! 🚀`);
  } catch (error: unknown) {
    s.stop("Failed to create project");
    const message = error instanceof Error ? error.message : String(error);
    p.outro(`${color.bgRed(color.white(`Error: ${message}`))}`);

    if (message.includes("git clone")) {
      console.error(color.red("Git clone failed. Please check:"));
      console.error(color.dim("- Internet connection"));
      console.error(color.dim("- Repository URL is correct"));
      console.error(color.dim("- You have access to the repository"));
    } else if (message.includes("Template path")) {
      console.error(color.red("Template path not found in repository."));
      console.error(color.dim(`Check if the path "${TEMPLATE_CONFIG.templatePath}" exists in the repo.`));
    }
  }
}

main().catch(console.error);
