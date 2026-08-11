#!/usr/bin/env node

import { Command } from 'commander';
import pc from 'picocolors';
import { showBanner } from './ui/banner.js';
import { logger } from './ui/logger.js';
import { initCommand } from './commands/init.js';
import { deployCommand } from './commands/deploy.js';
import { rollbackCommand } from './commands/rollback.js';
import { statusCommand } from './commands/status.js';
import { logsCommand } from './commands/logs.js';
import { purgeCommand } from './commands/purge.js';
import { listCommand } from './commands/list.js';
import { unlockCommand } from './commands/unlock.js';
import { modCommand } from './commands/mod.js';
import { deleteCommand } from './commands/delete.js';
import { updateCommand } from './commands/update.js';
export { defineConfig } from './config/loader.js';

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

function getPackageVersion(): string {
  try {
    const __dirname = path.dirname(fileURLToPath(import.meta.url));
    const pkgPath = path.resolve(__dirname, '../package.json');
    if (fs.existsSync(pkgPath)) {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
      if (pkg.version) return pkg.version;
    }
    const currentPkgPath = path.resolve(__dirname, 'package.json');
    if (fs.existsSync(currentPkgPath)) {
      const pkg = JSON.parse(fs.readFileSync(currentPkgPath, 'utf-8'));
      if (pkg.version) return pkg.version;
    }
  } catch {}
  return '1.1.2';
}

const program = new Command();

program
  .name('devploy')
  .description('Modern & Scalable Node.js Server Deployment CLI')
  .version(getPackageVersion())
  .option('-u, --update', 'Update @chiake/devploy CLI to the latest version')
  .action(async (options) => {
    if (options.update) {
      try {
        await updateCommand();
      } catch (err: any) {
        logger.error(`Update failed: ${err.message}`);
        process.exit(1);
      }
    } else if (process.argv.length <= 2) {
      program.outputHelp();
    }
  });

// Show banner on root invocation or help
if (process.argv.length <= 2) {
  showBanner();
}

program
  .command('init')
  .description('Initialize a new devploy.config.ts in the current project')
  .action(async () => {
    try {
      await initCommand();
    } catch (err: any) {
      logger.error(`Initialization failed: ${err.message}`);
      process.exit(1);
    }
  });

program
  .command('deploy')
  .description('Deploy project to a target environment')
  .option('-p, --project <project>', 'Target project name (for multi-project setups)')
  .option('-e, --env <environment>', 'Target environment name (e.g. production, staging)')
  .option('-f, --force', 'Forcefully override active deployment locks')
  .option('-y, --yes', 'Skip interactive confirmation prompts for CI/CD')
  .action(async (options) => {
    try {
      await deployCommand(options);
    } catch (err: any) {
      logger.error(`Deployment failed: ${err.message}`);
      process.exit(1);
    }
  });

program
  .command('rollback')
  .description('Instantly rollback to the previous release symlink')
  .option('-p, --project <project>', 'Target project name')
  .option('-e, --env <environment>', 'Target environment name')
  .option('-r, --release <release_id>', 'Specific release ID to rollback to')
  .option('-y, --yes', 'Skip confirmation prompt')
  .action(async (options) => {
    try {
      await rollbackCommand(options);
    } catch (err: any) {
      logger.error(`Rollback failed: ${err.message}`);
      process.exit(1);
    }
  });

program
  .command('status')
  .description('View remote releases and connection status')
  .option('-p, --project <project>', 'Target project name')
  .option('-e, --env <environment>', 'Target environment name')
  .action(async (options) => {
    try {
      await statusCommand(options);
    } catch (err: any) {
      logger.error(`Status check failed: ${err.message}`);
      process.exit(1);
    }
  });

program
  .command('logs')
  .description('Stream real-time remote logs from server target')
  .option('-p, --project <project>', 'Target project name')
  .option('-e, --env <environment>', 'Target environment name')
  .option('-n, --lines <count>', 'Number of log lines to retrieve', '50')
  .option('-f, --filter <keyword>', 'Filter logs by specific keyword or pattern')
  .option('-g, --grep <keyword>', 'Filter logs by specific keyword or pattern')
  .action(async (options) => {
    try {
      await logsCommand(options);
    } catch (err: any) {
      logger.error(`Log streaming failed: ${err.message}`);
      process.exit(1);
    }
  });

program
  .command('list')
  .alias('ls')
  .description('List all configured projects and target environments')
  .action(async () => {
    try {
      await listCommand();
    } catch (err: any) {
      logger.error(`List failed: ${err.message}`);
      process.exit(1);
    }
  });

program
  .command('purge')
  .description('Purge and delete local devploy configuration file(s)')
  .option('-y, --yes', 'Skip confirmation prompt')
  .action(async (options) => {
    try {
      await purgeCommand(options);
    } catch (err: any) {
      logger.error(`Purge failed: ${err.message}`);
      process.exit(1);
    }
  });

program
  .command('unlock')
  .description('Remove deployment lock (.deploy.lock) from target server')
  .option('-p, --project <project>', 'Target project name')
  .option('-e, --env <environment>', 'Target environment name')
  .action(async (options) => {
    try {
      await unlockCommand(options);
    } catch (err: any) {
      logger.error(`Unlock failed: ${err.message}`);
      process.exit(1);
    }
  });

program
  .command('mod [project-name]')
  .alias('modify')
  .alias('edit')
  .description('Modify existing project configuration interactively')
  .action(async (projectName) => {
    try {
      await modCommand(projectName);
    } catch (err: any) {
      logger.error(`Modification failed: ${err.message}`);
      process.exit(1);
    }
  });

program
  .command('delete [project-name]')
  .alias('remove')
  .alias('rm')
  .description('Remove a specific project from devploy.config.ts')
  .option('-p, --project <project>', 'Target project name to remove')
  .option('-y, --yes', 'Skip confirmation prompt')
  .action(async (projectName, options) => {
    try {
      await deleteCommand(projectName || options.project, options);
    } catch (err: any) {
      logger.error(`Deletion failed: ${err.message}`);
      process.exit(1);
    }
  });

program
  .command('update')
  .alias('upgrade')
  .description('Update @chiake/devploy CLI to the latest version')
  .action(async () => {
    try {
      await updateCommand();
    } catch (err: any) {
      logger.error(`Update failed: ${err.message}`);
      process.exit(1);
    }
  });

program.parse(process.argv);
