// 日期：2026-10-15；创建人：项目维护者。只写项目 local/，不操作运行中的客户端。
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline/promises';
import core from '../src/route-core.js';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const local = path.join(root, 'local');
const readJson = async file => JSON.parse(await fs.readFile(file, 'utf8'));
async function save(file, content) {
  await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  await fs.writeFile(file, content, { mode: 0o600 });
}
async function main() {
  const command = process.argv[2] || 'help';
  if (command === 'init') {
    if (!process.stdin.isTTY) throw new Error('请在交互终端运行 npm run guide，或手动复制示例到 local/design.json');
    const target = path.join(local, 'design.json');
    try { await fs.access(target); throw new Error('local/design.json 已存在；请直接编辑，避免覆盖已有设计'); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    const settings = await readJson(path.join(root, 'examples/design.example.json'));
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    console.log('这里只问设计偏好。不要输入订阅 URL、IP、账号、密码或令牌。');
    try {
      settings.subscriptionEntry = (await rl.question('订阅主入口组名（留空则从最终 MATCH 识别）：')).trim();
      settings.staticExit.enabled = /^y$/i.test((await rl.question('是否已准备自己的静态节点，供 GPT 选择？[y/N] ')).trim());
      if (/^y$/i.test((await rl.question('普通默认流量是否使用美国节点自动组？[y/N] ')).trim())) settings.ordinary.mode = 'auto';
      for (const [key, label] of [['onedrive','OneDrive'], ['icloud','iCloud'], ['publishers','ScienceDirect / Elsevier']]) {
        if (/^y$/i.test((await rl.question(label + ' 是否需要直连？[y/N] ')).trim())) settings.directServices.push(key);
      }
      console.log('DNS 分流保持关闭。先验证访问出口，再按手册单独启用。');
    } finally { rl.close(); }
    core.validateSettings(settings);
    await save(target, JSON.stringify(settings, null, 2) + '\n');
    console.log('已保存 local/design.json。下一步：npm run build。尚未修改 Clash。');
  } else if (command === 'build') {
    const settings = core.validateSettings(await readJson(path.join(local, 'design.json')));
    const source = await fs.readFile(path.join(root, 'src/route-core.js'), 'utf8');
    const script = '// 本地生成文件，不随公开项目上传。\nconst SETTINGS = ' + JSON.stringify(settings, null, 2) + ';\n' +
      source + '\nfunction main(config, profileName) { return applyRouting(config, SETTINGS, profileName); }\n';
    await save(path.join(local, 'global-script.js'), script);
    console.log('已生成 local/global-script.js。先备份、预览、校验，再手动应用。');
  } else if (command === 'demo') {
    const settings = await readJson(path.join(root, 'examples/design.example.json'));
    const original = await readJson(path.join(root, 'examples/subscription.example.json'));
    for (const [name, configure] of Object.entries({ basic: () => {}, static: s => { s.staticExit.enabled = true; },
      dns: s => { s.staticExit.enabled = true; s.dns.enabled = true; s.directServices = ['onedrive','icloud','publishers']; },
      auto: s => { s.ordinary.mode = 'auto'; } })) {
      const design = structuredClone(settings); configure(design);
      await save(path.join(local, 'demo/demo-' + name + '.json'), JSON.stringify(core.applyRouting(original, design), null, 2));
    }
    await save(path.join(local, 'demo/proxy_providers/static.local.yaml'), await fs.readFile(path.join(root, 'examples/static-provider.example.yaml'), 'utf8'));
    console.log('已生成 local/demo/demo-{basic,static,dns,auto}.json 和占位节点。仅作离线检查，无法联网。');
  } else {
    console.log('npm run guide：本地问答；npm run build：生成脚本；npm run demo：虚构示例；npm run check：测试与隐私检查。');
  }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
