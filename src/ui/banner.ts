import pc from 'picocolors';
import boxen from 'boxen';
import { intro, outro } from '@clack/prompts';

export function showBanner() {
  console.log('\n');
  console.log(
    boxen(
      `${pc.bold(pc.cyan('🚀 DEVPLOY'))} ${pc.dim('v1.0.0')}\n` +
      `${pc.gray('Modern, Scalable Zero-Downtime Server Deployment CLI')}`,
      {
        padding: { top: 0, bottom: 0, left: 2, right: 2 },
        margin: { top: 0, bottom: 1 },
        borderStyle: 'round',
        borderColor: 'cyan',
      }
    )
  );
}

export function startFlow(title: string) {
  intro(pc.bgCyan(pc.black(` ${title} `)));
}

export function endFlow(message: string) {
  outro(pc.green(`✔ ${message}`));
}

export function showSuccessSummaryCard(options: {
  projectName: string;
  projectDir: string;
  targetEnv: string;
  host: string;
  username: string;
  deployPath: string;
  isNewFile: boolean;
}) {
  const title = options.isNewFile
    ? pc.bold(pc.green('🎉 devploy.config.ts Created Successfully!'))
    : pc.bold(pc.green(`🎉 Project '${options.projectName}' Added to devploy.config.ts!`));

  const cardContent = `
${title}

${pc.bold(pc.cyan('📋 Configuration Details'))}
  ${pc.gray('• Project Name:')}     ${pc.bold(pc.white(options.projectName))}
  ${pc.gray('• Local Directory:')}  ${pc.cyan(options.projectDir)}
  ${pc.gray('• Environment:')}      ${pc.magenta(options.targetEnv.toUpperCase())}
  ${pc.gray('• Server Target:')}    ${pc.green(`${options.username}@${options.host}`)}
  ${pc.gray('• Deploy Path:')}      ${pc.yellow(options.deployPath)}

${pc.bold(pc.cyan('⚡ Quick Start Commands'))}
  ${pc.gray('1.')} Deploy Project:     ${pc.bold(pc.green(`devploy deploy --project ${options.projectName}`))}
  ${pc.gray('2.')} View Environment:   ${pc.bold(pc.cyan(`devploy status --project ${options.projectName}`))}
  ${pc.gray('3.')} Stream Server Logs: ${pc.bold(pc.yellow(`devploy logs --project ${options.projectName}`))}
`.trim();

  console.log('\n');
  console.log(
    boxen(cardContent, {
      padding: 1,
      margin: { top: 0, bottom: 1 },
      borderStyle: 'double',
      borderColor: 'green',
    })
  );

  outro(pc.bold(pc.green('✔ Setup complete! Run `devploy deploy` to begin deployment.')));
}
