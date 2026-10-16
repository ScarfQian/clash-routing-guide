import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import core from '../src/route-core.js';
const base = JSON.parse(fs.readFileSync(new URL('../examples/subscription.example.json', import.meta.url)));
const design = JSON.parse(fs.readFileSync(new URL('../examples/design.example.json', import.meta.url)));
const clone = value => structuredClone(value);
function group(config, name) { return config['proxy-groups'].find(item => item.name === name); }
function checkGraph(config) {
  const entries = [...config.proxies, ...config['proxy-groups']];
  const names = new Set(entries.map(item => item.name));
  assert.equal(names.size, entries.length);
  const visited = new Set(), active = new Set();
  function visit(name) {
    assert.ok(!active.has(name), 'dependency cycle');
    if (visited.has(name)) return;
    active.add(name);
    const item = entries.find(entry => entry.name === name);
    for (const ref of [...(item.proxies || []), ...(item['dialer-proxy'] ? [item['dialer-proxy']] : [])]) {
      if (['DIRECT', 'REJECT', 'PASS'].includes(ref)) continue;
      assert.ok(names.has(ref)); visit(ref);
    }
    for (const provider of item.use || []) assert.ok(config['proxy-providers'][provider]);
    active.delete(name); visited.add(name);
  }
  names.forEach(visit);
}
test('默认不改 DNS、TUN、源节点或原生应用组，GPT 跟随订阅', () => {
  const source = clone(base); source.dns = { enable: false }; source.tun = { enable: false };
  const saved = clone(source), out = core.applyRouting(source, design);
  assert.deepEqual(source, saved);
  assert.deepEqual(out.proxies, source.proxies);
  assert.deepEqual(out.dns, source.dns); assert.deepEqual(out.tun, source.tun);
  assert.deepEqual(group(out, 'Media'), group(source, 'Media'));
  assert.deepEqual(group(out, core.NAMES.gpt).proxies, [core.NAMES.ordinary]);
  assert.ok(out.rules.includes('DOMAIN-SUFFIX,video.example,Media'));
  checkGraph(out);
});
test('不同订阅主入口均由原末尾 MATCH 识别，而非绑定一个供应商', () => {
  for (const entry of ['Subscription-A', '节点选择', 'Proxy', '兜底入口', 'Main']) {
    const source = clone(base); source['proxy-groups'][0].name = entry;
    source['proxy-groups'][1].proxies[0] = entry; source.rules[source.rules.length - 1] = 'MATCH,' + entry;
    const out = core.applyRouting(source, design);
    assert.deepEqual(group(out, core.NAMES.follow).proxies, [entry]); checkGraph(out);
  }
});
test('显式入口可覆盖 MATCH，但无有效入口或多个 MATCH 必须报错', () => {
  const explicit = clone(design); explicit.subscriptionEntry = 'Media';
  assert.deepEqual(group(core.applyRouting(base, explicit), core.NAMES.follow).proxies, ['Media']);
  const missing = clone(base); missing.rules[missing.rules.length - 1] = 'MATCH,DIRECT';
  assert.throws(() => core.applyRouting(missing, design), /主入口/);
  const multiple = clone(base); multiple.rules.unshift('MATCH,Subscription');
  assert.throws(() => core.applyRouting(multiple, design), /MATCH/);
  assert.throws(() => core.applyRouting({ ...base, mode: 'global' }, design), /规则模式/);
});
test('地区自动只影响普通默认入口，按地区/倍率过滤并保留稳定阈值', () => {
  const settings = clone(design); settings.ordinary.mode = 'auto';
  const out = core.applyRouting(base, settings), auto = group(out, core.NAMES.automatic);
  assert.deepEqual(auto.proxies, ['US-A', 'US-B']); assert.equal(auto.interval, 300); assert.equal(auto.tolerance, 100);
  assert.deepEqual(group(out, 'Media'), group(base, 'Media'));
  settings.ordinary.include = 'No-Such-Region';
  assert.throws(() => core.applyRouting(base, settings), /没有匹配/);
  const premium = clone(base); premium.proxies[0].name = '美国 2.5x-A';
  premium.proxies[1].name = '美国 1x-B'; premium['proxy-groups'][0].proxies = premium.proxies.map(node => node.name);
  settings.ordinary.include = '美国.*2\\.5x';
  assert.deepEqual(group(core.applyRouting(premium, settings), core.NAMES.automatic).proxies, ['美国 2.5x-A']);
});
test('静态出口引用本地 provider，普通节点与入口不变', () => {
  const settings = clone(design); settings.staticExit.enabled = true;
  const out = core.applyRouting(base, settings);
  assert.deepEqual(group(out, core.NAMES.gpt).proxies, [core.NAMES.static, core.NAMES.ordinary]);
  assert.equal(out['proxy-providers'][core.NAMES.provider].type, 'file');
  assert.deepEqual(group(out, core.NAMES.static).use, [core.NAMES.provider]);
  assert.deepEqual(out.proxies, base.proxies); checkGraph(out);
});
test('本机/主动选择的直连在 GPT 与原订阅规则之前', () => {
  const settings = clone(design); settings.directServices = ['onedrive', 'icloud', 'publishers'];
  const out = core.applyRouting(base, settings);
  assert.equal(out.rules[0], 'DOMAIN,localhost,DIRECT');
  assert.ok(out.rules.indexOf('PROCESS-NAME,OneDrive,DIRECT') < out.rules.indexOf('DOMAIN-SUFFIX,chatgpt.com,' + core.NAMES.gpt));
  assert.ok(out.rules.includes('DOMAIN-SUFFIX,sciencedirect.com,DIRECT'));
  settings.extraDirectDomains = ['chatgpt.com'];
  assert.throws(() => core.applyRouting(base, settings), /重叠/);
});
test('DNS 可选并显式绑定出口，保留本地解析且没有节点启动循环', () => {
  const settings = clone(design); settings.dns.enabled = true; settings.directServices = ['icloud'];
  const source = clone(base); source.dns = { ipv6: true, fallback: ['1.1.1.1'], 'nameserver-policy': { obsolete: ['system'] } };
  const out = core.applyRouting(source, settings), dns = out.dns;
  assert.equal(dns.ipv6, true); assert.equal(dns.fallback, undefined);
  assert.deepEqual(dns.nameserver, ['https://cloudflare-dns.com/dns-query#' + core.NAMES.ordinary]);
  assert.deepEqual(dns['nameserver-policy']['+.chatgpt.com'], ['https://cloudflare-dns.com/dns-query#' + core.NAMES.gpt]);
  assert.deepEqual(dns['nameserver-policy']['+.icloud.com'], ['https://dns.alidns.com/dns-query#DIRECT']);
  assert.deepEqual(dns['nameserver-policy']['+.local'], ['system']);
  assert.deepEqual(dns['proxy-server-nameserver'], ['https://dns.alidns.com/dns-query#DIRECT']);
  assert.deepEqual(dns['default-nameserver'], ['https://223.5.5.5/dns-query']);
  assert.equal(dns.listen, undefined); checkGraph(out);
});
test('同一设计重复生成不重复组/规则，静态与 DNS 组合也一致', () => {
  for (const staticEnabled of [false, true]) for (const dnsEnabled of [false, true]) {
    const settings = clone(design); settings.staticExit.enabled = staticEnabled; settings.dns.enabled = dnsEnabled;
    settings.directServices = ['onedrive', 'icloud', 'publishers']; settings.ordinary.mode = 'auto';
    const once = core.applyRouting(base, settings);
    assert.deepEqual(core.applyRouting(once, settings), once); checkGraph(once);
  }
});
test('设计拒绝凭据字段、绝对 provider 路径和过密检查', () => {
  const settings = clone(design); settings.staticExit.password = 'REPLACE_ME';
  assert.throws(() => core.validateSettings(settings), /未知字段/);
  delete settings.staticExit.password; settings.staticExit.providerPath = '/private/static.yaml';
  assert.throws(() => core.validateSettings(settings), /节点路径/);
  settings.staticExit.providerPath = design.staticExit.providerPath; settings.ordinary.interval = 1;
  assert.throws(() => core.validateSettings(settings), /间隔/);
});
