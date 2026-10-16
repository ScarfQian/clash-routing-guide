// 日期：2026-10-15；创建人：项目维护者。发布采用明确文件清单。
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ignored = new Set(['.git', 'local', 'dist', 'backups', 'logs', 'node_modules']);
const allowedIps = new Set(['0.0.0.0', '1.1.1.1', '1.0.0.1', '223.5.5.5', '223.6.6.6']);
export function auditText(text) {
  const issues = [];
  if (/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(text)) issues.push('邮箱地址');
  if (/(?:\/Users\/|\/home\/)[^\s/"'<>]+|[A-Z]:\\Users\\[^\s\\"'<>]+/.test(text)) issues.push('个人目录');
  if (/\b[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}\b/i.test(text)) issues.push('UUID');
  if (/https?:\/\/[^\s"'<>]+[?&](?:token|key|secret|auth|access_token)=/i.test(text)) issues.push('带认证参数的链接');
  if (/https?:\/\/[^\s/@]+:[^\s/@]+@/i.test(text)) issues.push('URL 内嵌凭据');
  for (const match of text.matchAll(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g)) {
    const ip = match[0];
    const parts = ip.split('.').map(Number);
    if (parts.some(value => value > 255)) continue;
    const example = /^(?:127\.|10\.|192\.168\.|192\.0\.2\.|198\.51\.100\.|203\.0\.113\.|198\.18\.)/.test(ip) ||
      (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31);
    if (!example && !allowedIps.has(ip)) issues.push('非示例公网 IPv4');
  }
  const assignments = /\b(?:password|uuid|secret|token|api[-_]?key|public[-_]?key|short[-_]?id)\b["']?\s*[:=]\s*["']?([^\s,"'\n}]+)/gi;
  for (const match of text.matchAll(assignments)) {
    if (!/^(?:REPLACE_ME|PLACEHOLDER|example|null|false|true)$/.test(match[1]) && !match[1].startsWith('/'))
      issues.push('疑似凭据值');
  }
  return [...new Set(issues)];
}
async function inventory(dir, prefix = '') {
  const files = [];
  for (const item of await fs.readdir(dir, { withFileTypes: true })) {
    if (!prefix && ignored.has(item.name)) continue;
    const rel = prefix + item.name;
    if (item.isSymbolicLink()) throw new Error('公开文件不允许符号链接：' + rel);
    if (item.isDirectory()) files.push(...await inventory(path.join(dir, item.name), rel + '/'));
    else files.push(rel);
  }
  return files.sort();
}
export async function checkProject() {
  const listed = JSON.parse(await fs.readFile(path.join(root, 'PUBLIC_FILES.json'), 'utf8'));
  if (!Array.isArray(listed) || new Set(listed).size !== listed.length ||
    listed.some(file => !/^[A-Za-z0-9._/-]+$/.test(file) || file.split('/').includes('..') || path.isAbsolute(file)))
    throw new Error('公开文件清单无效');
  const actual = await inventory(root);
  if (JSON.stringify([...listed].sort()) !== JSON.stringify(actual)) throw new Error('项目文件与公开清单不一致；先核查新增文件');
  for (const rel of listed) {
    const text = await fs.readFile(path.join(root, rel), 'utf8');
    const issues = auditText(text);
    if (issues.length) throw new Error(rel + '：' + issues.join('、'));
    if (rel.endsWith('.md')) {
      for (const match of text.matchAll(/\]\(([^)]+)\)/g)) {
        const target = match[1].split('#')[0];
        if (!target || /^(?:https?:|mailto:)/.test(target)) continue;
        const resolved = path.resolve(path.dirname(path.join(root, rel)), target);
        if (!resolved.startsWith(root + path.sep)) throw new Error('文档链接超出项目：' + rel);
        await fs.access(resolved);
      }
    }
  }
  return listed;
}
async function run() {
  const listed = await checkProject();
  if (process.argv[2] === 'prepare') {
    const target = path.join(root, 'dist/clash-routing-guide-public');
    await fs.rm(target, { recursive: true, force: true });
    for (const rel of listed) {
      const output = path.join(target, rel);
      await fs.mkdir(path.dirname(output), { recursive: true });
      await fs.writeFile(output, await fs.readFile(path.join(root, rel)), { mode: 0o644 });
    }
    console.log('已导出 dist/clash-routing-guide-public/；只包含 ' + listed.length + ' 个公开清单文件。未上传。');
  } else console.log('公开清单、相对链接及通用隐私检查通过：' + listed.length + ' 个文件。');
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  run().catch(error => { console.error(error.message); process.exitCode = 1; });
