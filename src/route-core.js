// 日期：2026-10-15；创建人：项目维护者。
// 纯配置变换：不读文件、不联网、不安装、不重载客户端。
const NAMES = Object.freeze({
  follow: '引导-当前订阅', ordinary: '引导-普通线路',
  gpt: '引导-GPT线路', automatic: '引导-地区自动',
  static: '引导-静态出口', provider: 'guide-static-local'
});
const GPT_DOMAINS = ['openai.com', 'chatgpt.com', 'oaistatic.com', 'oaiusercontent.com', 'oaistatsig.com'];
const SERVICES = {
  onedrive: {
    processes: ['OneDrive', 'OneDrive File Provider', 'OneDrive Sync Service'],
    domains: ['onedrive.com', 'onedrive.live.com', 'onedrive.live.net', '1drv.com', '1drv.ms',
      'livefilestore.com', 'storage.live.com', 'sharepoint.com', 'sharepointonline.com',
      'officeapps.live.com', 'login.live.com', 'login.microsoftonline.com']
  },
  icloud: {
    processes: ['bird', 'cloudd'],
    domains: ['icloud.com', 'icloud.com.cn', 'icloud-content.com', 'icloud-content.com.cn',
      'icloud.apple.com', 'apple-cloudkit.com', 'apple-livephotoskit.com']
  },
  publishers: { processes: [], domains: ['sciencedirect.com', 'elsevier.com', 'els-cdn.com', 'sciencedirectassets.com'] }
};
const copy = value => JSON.parse(JSON.stringify(value));
function requireValue(ok, message) { if (!ok) throw new Error(message); }
function onlyKeys(object, keys, name) {
  requireValue(object && typeof object === 'object' && !Array.isArray(object), name + ' 必须是对象');
  requireValue(Object.keys(object).every(key => keys.includes(key)), name + ' 含未知字段；凭据应放在本地节点文件');
}
function validateSettings(input) {
  onlyKeys(input, ['version', 'subscriptionEntry', 'staticExit', 'ordinary', 'directServices',
    'extraDirectDomains', 'extraGptHosts', 'dns'], '设计');
  const settings = copy(input);
  requireValue(settings.version === 1, '不支持的设计版本');
  requireValue(typeof settings.subscriptionEntry === 'string', 'subscriptionEntry 必须是组名或空字符串');
  onlyKeys(settings.staticExit, ['enabled', 'providerPath'], 'staticExit');
  requireValue(typeof settings.staticExit.enabled === 'boolean', 'staticExit.enabled 必须为布尔值');
  requireValue(/^\.\/proxy_providers\/[A-Za-z0-9._-]+\.local\.ya?ml$/.test(settings.staticExit.providerPath),
    '静态节点路径必须是 ./proxy_providers/名称.local.yaml，相对于 Mihomo 数据目录');
  onlyKeys(settings.ordinary, ['mode', 'include', 'exclude', 'interval', 'tolerance'], 'ordinary');
  requireValue(['subscription', 'auto'].includes(settings.ordinary.mode), '普通线路模式必须为 subscription 或 auto');
  for (const key of ['include', 'exclude']) {
    requireValue(typeof settings.ordinary[key] === 'string', '节点筛选表达式必须是字符串');
    try { new RegExp(settings.ordinary[key], 'i'); } catch (_) { throw new Error('节点筛选正则无效'); }
  }
  requireValue(Number.isInteger(settings.ordinary.interval) && settings.ordinary.interval >= 60,
    '健康检查间隔须为至少 60 秒的整数');
  requireValue(Number.isInteger(settings.ordinary.tolerance) && settings.ordinary.tolerance >= 0,
    '切换容差须为非负整数');
  requireValue(Array.isArray(settings.directServices) && settings.directServices.every(key => SERVICES[key]), '未知直连服务');
  for (const key of ['extraDirectDomains', 'extraGptHosts']) {
    requireValue(Array.isArray(settings[key]) && settings[key].every(domain =>
      typeof domain === 'string' && /^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z][a-z0-9-]*$/i.test(domain)),
    key + ' 只能填写域名，不能包含协议、端口、路径或凭据');
  }
  onlyKeys(settings.dns, ['enabled'], 'dns');
  requireValue(typeof settings.dns.enabled === 'boolean', 'dns.enabled 必须为布尔值');
  const directDomains = [...settings.extraDirectDomains,
    ...settings.directServices.flatMap(key => SERVICES[key].domains)];
  for (const direct of directDomains) for (const gpt of [...GPT_DOMAINS, ...settings.extraGptHosts]) {
    requireValue(!(gpt === direct || gpt.endsWith('.' + direct) || direct.endsWith('.' + gpt)),
      '直连域名与 GPT 域名重叠，请先决定业务优先级');
  }
  return settings;
}
function applyRouting(input, design, profileName) {
  const settings = validateSettings(design);
  const config = copy(input);
  requireValue(!config.mode || config.mode === 'rule', '请先确认使用规则模式；本脚本不会切换运行模式');
  requireValue(Array.isArray(config.rules) && Array.isArray(config['proxy-groups']), '缺少规则或代理组');
  const sourceGroups = config['proxy-groups'];
  const previousFollow = sourceGroups.find(group => group.name === NAMES.follow);
  const managedNames = new Set(Object.values(NAMES).filter(name => name !== NAMES.provider));
  if (sourceGroups.some(group => managedNames.has(group.name))) {
    requireValue(previousFollow && previousFollow.type === 'select' && previousFollow.proxies.length === 1,
      '项目代理组命名冲突，请先合并已有扩展');
  }
  const matches = config.rules.filter(rule => rule.startsWith('MATCH,'));
  requireValue(matches.length === 1 && config.rules[config.rules.length - 1] === matches[0],
    '需要一个位于末尾的 MATCH；含 PASS 总开关或多个 MATCH 的配置须先人工合并');
  let entry = settings.subscriptionEntry || matches[0].split(',')[1];
  if (entry === NAMES.ordinary && previousFollow) entry = previousFollow.proxies[0];
  requireValue(!managedNames.has(entry) && sourceGroups.some(group => group.name === entry),
    '无法确定订阅主入口，请填写 subscriptionEntry；不会猜测或退回直连');
  config.proxies = Array.isArray(config.proxies) ? config.proxies : [];
  config['proxy-groups'] = sourceGroups.filter(group => !managedNames.has(group.name));
  const groups = config['proxy-groups'];
  groups.push({ name: NAMES.follow, type: 'select', proxies: [entry] });
  const ordinaryChoices = [NAMES.follow];
  if (settings.ordinary.mode === 'auto') {
    const include = new RegExp(settings.ordinary.include, 'i');
    const exclude = settings.ordinary.exclude ? new RegExp(settings.ordinary.exclude, 'i') : null;
    const candidates = config.proxies.filter(node => include.test(node.name) && !(exclude && exclude.test(node.name)))
      .map(node => node.name);
    requireValue(candidates.length > 0, '没有匹配的内联节点；请修改筛选或使用订阅自己的自动组');
    groups.push({ name: NAMES.automatic, type: 'url-test', proxies: candidates,
      url: 'https://www.gstatic.com/generate_204', interval: settings.ordinary.interval,
      tolerance: settings.ordinary.tolerance, lazy: false, 'expected-status': '200-299' });
    ordinaryChoices.unshift(NAMES.automatic);
  }
  groups.push({ name: NAMES.ordinary, type: 'select', proxies: ordinaryChoices });
  const gptChoices = [NAMES.ordinary];
  if (settings.staticExit.enabled) {
    config['proxy-providers'] = config['proxy-providers'] || {};
    requireValue(!config['proxy-providers'][NAMES.provider] || previousFollow, '静态 provider 命名冲突');
    config['proxy-providers'][NAMES.provider] = { type: 'file', path: settings.staticExit.providerPath,
      'health-check': { enable: true, url: 'https://www.gstatic.com/generate_204', interval: 300, lazy: false } };
    groups.push({ name: NAMES.static, type: 'fallback', use: [NAMES.provider],
      url: 'https://www.gstatic.com/generate_204', interval: 300, lazy: false });
    gptChoices.unshift(NAMES.static);
  } else if (config['proxy-providers']) {
    delete config['proxy-providers'][NAMES.provider];
  }
  groups.push({ name: NAMES.gpt, type: 'select', proxies: gptChoices });
  const localRules = ['DOMAIN,localhost,DIRECT', 'IP-CIDR,127.0.0.0/8,DIRECT,no-resolve', 'IP-CIDR6,::1/128,DIRECT,no-resolve'];
  const processRules = settings.directServices.flatMap(key => SERVICES[key].processes)
    .map(name => 'PROCESS-NAME,' + name + ',DIRECT');
  const directDomains = [...new Set([...settings.directServices.flatMap(key => SERVICES[key].domains), ...settings.extraDirectDomains])];
  const directRules = directDomains.map(domain => 'DOMAIN-SUFFIX,' + domain + ',DIRECT');
  const gptRules = GPT_DOMAINS.map(domain => 'DOMAIN-SUFFIX,' + domain + ',' + NAMES.gpt)
    .concat(settings.extraGptHosts.map(domain => 'DOMAIN,' + domain + ',' + NAMES.gpt));
  const prepended = [...new Set([...localRules, ...processRules, ...directRules, ...gptRules])];
  const managedRules = new Set(prepended);
  // 原订阅应用专用规则继续保留，只替换末尾默认入口；不强行改写每个原生代理组。
  const sourceRules = config.rules.filter(rule => !managedRules.has(rule));
  config.rules = [...prepended, ...sourceRules.map(rule => rule.startsWith('MATCH,') ? 'MATCH,' + NAMES.ordinary : rule)];
  config.profile = { ...config.profile, 'store-selected': true };
  if (processRules.length) config['find-process-mode'] = 'strict';
  if (settings.dns.enabled) {
    const directDns = ['https://dns.alidns.com/dns-query#DIRECT'];
    const normalDns = ['https://cloudflare-dns.com/dns-query#' + NAMES.ordinary];
    const policy = {};
    for (const rule of config.rules.slice().reverse()) {
      const [type, domain, target] = rule.split(',');
      if (!['DOMAIN', 'DOMAIN-SUFFIX'].includes(type) || !['DIRECT', NAMES.gpt].includes(target)) continue;
      policy[type === 'DOMAIN' ? domain : '+.' + domain] = target === 'DIRECT' ? directDns :
        ['https://cloudflare-dns.com/dns-query#' + NAMES.gpt];
    }
    for (const domain of ['localhost', '+.localhost', '+.lan', '+.local', '+.home.arpa']) policy[domain] = ['system'];
    config.dns = { ...config.dns, enable: true, 'respect-rules': false,
      'default-nameserver': ['https://223.5.5.5/dns-query'], 'proxy-server-nameserver': directDns,
      'direct-nameserver': directDns, 'direct-nameserver-follow-policy': false,
      nameserver: normalDns, 'nameserver-policy': policy };
    delete config.dns.fallback;
    delete config.dns['fallback-filter'];
    delete config.dns['proxy-server-nameserver-policy'];
  }
  return config;
}
if (typeof module !== 'undefined') module.exports = { applyRouting, validateSettings, NAMES };
