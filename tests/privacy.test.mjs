import test from 'node:test';
import assert from 'node:assert/strict';
import { auditText, checkProject } from '../tools/release.mjs';
test('隐私检查允许公共 DNS、回环和文档示例', () => {
  assert.deepEqual(auditText('1.1.1.1 223.5.5.5 127.0.0.1 192.0.2.10 password: REPLACE_ME'), []);
});
test('隐私检查发现身份和实际凭据形态，不在测试源码保存这些内容', () => {
  const email = ['person', 'example.invalid'].join('@');
  const directory = ['/', 'Users', '/', 'sample', '/'].join('');
  const identifier = ['11111111', '2222', '3333', '4444', '555555555555'].join('-');
  const ip = [45, 67, 89, 10].join('.');
  const credential = ['pass', 'word', ': ', 'not', '-', 'a', '-', 'placeholder'].join('');
  for (const text of [email, directory, identifier, ip, credential]) assert.ok(auditText(text).length > 0);
});
test('公开文件清单和文档相对链接完整，公开内容通过扫描', async () => {
  assert.ok((await checkProject()).length > 0);
});
