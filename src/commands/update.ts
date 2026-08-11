import { execa } from 'execa';
import pc from 'picocolors';
import { createSpinner, logger } from '../ui/logger.js';
import { startFlow, endFlow } from '../ui/banner.js';

export async function updateCommand() {
  startFlow('Update Devploy CLI');
  const s = createSpinner();
  s.start('Updating @chiake/devploy to latest version via npm...');

  try {
    const res = await execa('npm', ['install', '-g', '@chiake/devploy@latest'], {
      reject: false,
    });

    if (res.exitCode !== 0) {
      s.stop(pc.red('✖ Failed to update @chiake/devploy'));
      logger.error(res.stderr || res.stdout || 'Unknown error during npm install');
      logger.info(
        `Try running manually with elevated permissions:\n  ${pc.cyan('sudo npm install -g @chiake/devploy@latest')}`
      );
      process.exit(1);
    }

    let currentVersion = '';
    try {
      const vRes = await execa('devploy', ['--version']);
      if (vRes.exitCode === 0 && vRes.stdout.trim()) {
        currentVersion = vRes.stdout.trim();
      }
    } catch (_) {}

    if (!currentVersion) {
      try {
        const npmRes = await execa('npm', ['view', '@chiake/devploy', 'version']);
        if (npmRes.exitCode === 0 && npmRes.stdout.trim()) {
          currentVersion = npmRes.stdout.trim();
        }
      } catch (_) {}
    }

    const versionStr = currentVersion
      ? currentVersion.startsWith('v')
        ? currentVersion
        : `v${currentVersion}`
      : '';

    s.stop(pc.green(`✔ Updated @chiake/devploy to latest version${versionStr ? ` (${versionStr})` : ''}`));
    endFlow(
      versionStr
        ? `Update completed successfully! Current version: ${pc.cyan(pc.bold(versionStr))}`
        : 'Update completed successfully!'
    );
  } catch (err: any) {
    s.stop(pc.red(`✖ Failed to update: ${err.message}`));
    logger.info(
      `Try running manually:\n  ${pc.cyan('npm install -g @chiake/devploy@latest')}`
    );
    process.exit(1);
  }
}
