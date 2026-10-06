const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createVSIX } = require('@vscode/vsce');

function marketplaceManifest(source) {
  const manifest = structuredClone(source);
  delete manifest.enabledApiProposals;
  manifest.activationEvents = manifest.activationEvents?.filter(event => !event.startsWith('onChatSession:'));
  delete manifest.contributes.chatSessions;
  manifest.contributes.chatParticipants = manifest.contributes.chatParticipants?.filter(item => item.id !== 'hrmcngs.toritsu-ai.session');
  delete manifest.contributes.menus['chat/chatSessions'];
  delete manifest.contributes.menus['chatSessions/item/context'];
  return manifest;
}

async function main() {
  const root = path.resolve(__dirname, '..');
  const sessions = process.argv.includes('--sessions');
  const stage = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'toritsu-package-')));
  try {
    // Build from an isolated copy so packaging never rewrites the working manifest.
    await fs.cp(root, stage, { recursive: true, filter: source => {
      const relative = path.relative(root, source);
      const first = relative.split(path.sep)[0];
      return !['.git', '.codex', '.agents', '.aws'].includes(first) && !source.endsWith('.vsix');
    } });
    const source = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'));
    await fs.writeFile(path.join(stage, 'package.json'), JSON.stringify(sessions ? source : marketplaceManifest(source), null, 2) + '\n');
    await createVSIX({ cwd: stage, packagePath: path.join(root, sessions ? 'toritsu-ai-sessions.vsix' : 'toritsu-ai.vsix'), skipLicense: true });
  } finally {
    await fs.rm(stage, { recursive: true, force: true });
  }
}

module.exports = { marketplaceManifest };
if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
