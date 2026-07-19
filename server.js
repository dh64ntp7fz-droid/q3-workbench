const express = require('express');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const app = express();
const PORT = process.env.PORT || 3721;
const DATA_FILE = path.join(__dirname, 'data', 'workflow.json');

app.use(express.json({ limit: '5mb' }));
app.use(express.static(path.join(__dirname, 'public')));

function ensureData() {
  if (!fs.existsSync(path.join(__dirname, 'data'))) {
    fs.mkdirSync(path.join(__dirname, 'data'), { recursive: true });
  }
  if (!fs.existsSync(DATA_FILE)) fs.writeFileSync(DATA_FILE, '{}');
}
ensureData();

function readJSON(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (e) { return {}; }
}
function writeJSON(file, data) {
  fs.writeFileSync(file, JSON.stringify(data));
}

// GET 全量数据
app.get('/api/workflow', (req, res) => {
  const data = readJSON(DATA_FILE);
  res.json({ data, serverTime: Date.now() });
});

// POST 保存（合并）
app.post('/api/workflow', (req, res) => {
  const existing = readJSON(DATA_FILE);
  const incoming = req.body;
  delete incoming._t;
  const merged = { ...existing, ...incoming, _savedAt: Date.now() };
  writeJSON(DATA_FILE, merged);
  res.json({ ok: true, savedAt: Date.now() });
});

// 企业微信推送代理
app.post('/api/send-wecom', async (req, res) => {
  try {
    const d = req.body;
    let payload;
    if (d.msgtype) {
      payload = d;
    } else {
      const bl = d.bulletList || '';
      const zg = (d.notes && d.notes.zhenggai) || '（未填写）';
      const wt = (d.notes && d.notes.wenti) || '（未填写）';
      const dj = (d.notes && d.notes.daijiao) || '（未填写）';
      const ps = d.pushSummary || '暂无';
      const content = `📋 驻店记录 · ${d.store||'未知'}
日期：${d.date||''} ${d.time||''}
合格项：${d.checkCount||0} / ${d.totalItems||0}

检查详情：
${bl}

与店长沟通：
${d.resolved||'（未填写）'}

驻店整改记录：
${zg}

问题点发现改善：
${wt}

店长带教案例：
${dj}

📌 今日已完成：
${ps}
`;
      payload = { msgtype: 'text', text: { content } };
    }
    const resp = await fetch('https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=d35ec9fd-b3e2-4132-848c-0fbc7ab38107', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
    });
    const result = await resp.json();
    res.json({ ok: result.errcode === 0, errmsg: result.errmsg });
  } catch (e) {
    res.json({ ok: false, errmsg: e.message });
  }
});

// ── 自动化看板 API ──

// 1. 获取 cron 任务列表（直接读取 jobs.json）
app.get('/api/automation/cron', (req, res) => {
  try {
    const cronFile = path.join(require('os').homedir(), '.hermes', 'cron', 'jobs.json');
    if (fs.existsSync(cronFile)) {
      const data = JSON.parse(fs.readFileSync(cronFile, 'utf8'));
      res.json(data);
    } else {
      res.json({ jobs: [] });
    }
  } catch (e) {
    res.json({ error: e.message, jobs: [] });
  }
});

// 1b. 获取 cron 最近输出日志
app.get('/api/automation/cron-outputs', (req, res) => {
  try {
    const outputDir = path.join(require('os').homedir(), '.hermes', 'cron', 'output');
    if (!fs.existsSync(outputDir)) return res.json({ outputs: [] });
    const dirs = fs.readdirSync(outputDir, { withFileTypes: true }).filter(d => d.isDirectory());
    const outputs = dirs.map(d => {
      const jobDir = path.join(outputDir, d.name);
      const files = fs.readdirSync(jobDir).filter(f => f.endsWith('.txt'));
      return files.map(f => {
        const full = path.join(jobDir, f);
        const stat = fs.statSync(full);
        let preview = '';
        try { preview = fs.readFileSync(full, 'utf8').slice(0, 200); } catch(_) {}
        return { jobId: d.name, file: f, modified: stat.mtime.toISOString(), size: stat.size, preview };
      });
    }).flat().sort((a,b) => new Date(b.modified) - new Date(a.modified)).slice(0, 20);
    res.json({ outputs, serverTime: Date.now() });
  } catch (e) {
    res.json({ error: e.message, outputs: [] });
  }
});

// 2. 获取后台进程
app.get('/api/automation/processes', async (req, res) => {
  try {
    const raw = execSync('hermes process list 2>/dev/null || echo "[]"', { encoding: 'utf8', timeout: 5000 });
    res.set('Content-Type', 'application/json');
    res.send(raw);
  } catch (e) {
    res.json({ error: e.message, processes: [] });
  }
});

// 3. 获取 .hermes/scripts 下的脚本列表
app.get('/api/automation/scripts', (req, res) => {
  try {
    const scriptsDir = path.join(require('os').homedir(), '.hermes', 'scripts');
    if (!fs.existsSync(scriptsDir)) return res.json({ scripts: [] });
    const files = fs.readdirSync(scriptsDir).filter(f => f.endsWith('.sh') || f.endsWith('.py'));
    const result = files.map(f => {
      const full = path.join(scriptsDir, f);
      const stat = fs.statSync(full);
      let header = '';
      try {
        header = fs.readFileSync(full, 'utf8').split('\n').slice(0, 8).filter(l => l.startsWith('#')).join('\n');
      } catch (_) {}
      return {
        name: f,
        size: stat.size,
        modified: stat.mtime.toISOString(),
        header: header || '(无注释)'
      };
    });
    res.json({ scripts: result, serverTime: Date.now() });
  } catch (e) {
    res.json({ error: e.message, scripts: [] });
  }
});

// 4. 获取技能统计数据（每个子目录下的 SKILL.md 算一个技能）
app.get('/api/automation/skills', (req, res) => {
  try {
    const skillsDir = path.join(require('os').homedir(), '.hermes', 'skills');
    if (!fs.existsSync(skillsDir)) return res.json({ skills: [], total: 0 });
    const cats = fs.readdirSync(skillsDir, { withFileTypes: true });
    let total = 0;
    const byCategory = {};
    for (const cat of cats) {
      const catPath = path.join(skillsDir, cat.name);
      if (cat.isDirectory()) {
        const items = fs.readdirSync(catPath, { withFileTypes: true });
        const skillNames = items
          .filter(f => f.isDirectory() && fs.existsSync(path.join(catPath, f.name, 'SKILL.md')))
          .map(f => f.name);
        if (skillNames.length > 0) {
          byCategory[cat.name] = skillNames;
          total += skillNames.length;
        }
      }
    }
    res.json({ byCategory, total, serverTime: Date.now() });
  } catch (e) {
    res.json({ error: e.message, total: 0, byCategory: {} });
  }
});

// 5. 获取项目/系统列表（全面版）
app.get('/api/automation/projects', (req, res) => {
  const home = require('os').homedir();
  const projects = [
    // ── 在线运行系统 ──
    { name: '包间预订系统', path: path.join(home, 'room-reservation-supabase'), tech: 'Node.js + Supabase + Render', icon: '📅', desc: '5店包间预订管理，每日自动推送4次', category: '🌐 在线系统', url: 'https://room-reservation-davw.onrender.com' },
    { name: '食材上报系统', path: null, tech: 'Node.js + Render', icon: '🥩', desc: '不能隔夜菜品上报，5店全覆盖，每日两次推送', category: '🌐 在线系统', url: 'https://food-dongxgll.onrender.com' },
    { name: '三季度工作台', path: path.join(home, 'Documents/Codex/三季度工作台'), tech: 'Node.js + Express', icon: '🧭', desc: '驻店检查、任务追踪、经营看板', category: '🌐 在线系统', url: 'https://q3-workbench.onrender.com' },
    { name: '排队叫号系统', path: null, tech: 'Node + Supabase · Render', icon: '🔢', desc: '门店排队取号管理，独立部署', category: '🌐 在线系统', url: 'https://queue-system.onrender.com' },
    { name: '新鲜食材·菜品推荐系统', path: null, tech: 'FastAPI + Supabase', icon: '🍲', desc: '新鲜食材推荐+菜品搭配推荐，独立部署', category: '🌐 在线系统', url: 'https://food-report.onrender.com' },
    // ── 独立部署页面 ──
    { name: '招聘聊天系统', path: null, tech: '纯前端 · GitHub Pages', icon: '💼', desc: '湘阁里辣招聘对话机器人，GLM AI兜底，企微通知', category: '🌐 在线系统', url: 'https://dh64ntp7fz-droid.github.io/recruit-chat/' },
    { name: '发票自动开票系统', path: null, tech: '百望金穗云 · 自动化', icon: '🧾', desc: '数电自助开票+自动登录扫码认证，输入金额自动生成二维码', category: '📄 独立页面' },
    { name: '免费伞借还追踪系统', path: null, tech: '小程序', icon: '☂️', desc: '门店免费伞借用/归还登记，陈总排雷文档中有记载', category: '📄 独立页面' },
    // ── 自动化工具/报表 ──
    { name: '竞品每日早报系统', path: null, tech: 'Cron + Python + Word', icon: '📊', desc: '每日9:00自动抓取大众点评评分+竞品数据，生成Word报告推送（已执行47次）', category: '🤖 自动化工具' },
    { name: '顾客反馈归类分析系统', path: null, tech: 'Python + python-docx', icon: '📋', desc: 'CSV导入→自动归类分析→Word报告输出，7类+8类投诉分类，锦厦/天安模板通用', category: '🤖 自动化工具' },
    { name: '能量辅导简报系统', path: null, tech: 'Skill + Python + Word', icon: '⚡', desc: '能量事件→6节框架+8维度+5心法分析→docx报告/HTML简报', category: '🤖 自动化工具' },
    { name: '日报自动同步系统', path: null, tech: 'Cron + Python + AppleScript', icon: '📝', desc: '每日23:30自动扫描日报文件→同步到Apple备忘录，已自动运行26次', category: '🤖 自动化工具' },
    { name: '每日回顾提醒', path: null, tech: 'Cron + Shell + 企微', icon: '🔔', desc: '每日22:10企业微信提醒回顾（已执行12次）', category: '🤖 自动化工具' },
    // ── 数据/知识库 ──
    { name: 'AI知识库', path: path.join(home, 'AI知识库'), tech: '本地文件系统', icon: '📚', desc: '门店运营/会议纪要/AI脚本工具/固定规则库/素材资料统一归档', category: '📁 数据资产' },
    { name: '三季度工具表格（15张）', path: null, tech: 'Excel', icon: '📑', desc: '整改完成表/顾客反馈/维修追踪/早例会复盘/带教辅导/场景考核/明星员工/宿舍检查等', category: '📁 数据资产' },
  ];
  for (const p of projects) {
    if (p.path && fs.existsSync(p.path)) {
      const pkg = path.join(p.path, 'package.json');
      if (fs.existsSync(pkg)) {
        try {
          const pkgData = JSON.parse(fs.readFileSync(pkg, 'utf8'));
          p.version = pkgData.version || '—';
        } catch (_) { p.version = '—'; }
      }
      p.exists = true;
    } else {
      p.exists = p.path ? false : null;
    }
  }
  res.json({ projects, serverTime: Date.now() });
});

// 6. 工作台 stats 数据
app.get('/api/automation/stats', (req, res) => {
  const statsFile = path.join(__dirname, 'data', 'stats.json');
  const stats = readJSON(statsFile);
  const workflow = readJSON(DATA_FILE);
  res.json({
    workflowItemCount: Object.keys(workflow).filter(k => !k.startsWith('_')).length,
    stats,
    serverTime: Date.now()
  });
});

// 健康检查
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', uptime: process.uptime() });
});

// ── 脚本管理 API ──
const SCRIPTS_DIR = path.join(require('os').homedir(), '.hermes', 'scripts');

// 读取脚本内容
app.get('/api/scripts/:name/content', (req, res) => {
  try {
    const f = path.join(SCRIPTS_DIR, req.params.name);
    if (!f.startsWith(SCRIPTS_DIR)) return res.status(400).json({ error: 'Invalid path' });
    if (!fs.existsSync(f)) return res.status(404).json({ error: 'Not found' });
    res.json({ name: req.params.name, content: fs.readFileSync(f, 'utf8') });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 保存脚本
app.post('/api/scripts/:name/save', (req, res) => {
  try {
    const f = path.join(SCRIPTS_DIR, req.params.name);
    if (!f.startsWith(SCRIPTS_DIR)) return res.status(400).json({ error: 'Invalid path' });
    fs.writeFileSync(f, req.body.content, 'utf8');
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 执行脚本
app.post('/api/scripts/:name/run', (req, res) => {
  try {
    const f = path.join(SCRIPTS_DIR, req.params.name);
    if (!f.startsWith(SCRIPTS_DIR)) return res.status(400).json({ error: 'Invalid path' });
    if (!fs.existsSync(f)) return res.status(404).json({ error: 'Not found' });
    const cmd = f.endsWith('.py') ? `python3 "${f}"` : `bash "${f}"`;
    const out = execSync(cmd, { encoding: 'utf8', timeout: 30000, maxBuffer: 1024*50 });
    res.json({ ok: true, output: out.slice(0, 5000) });
  } catch (e) {
    const output = e.stdout || '';
    res.json({ ok: false, error: e.message.slice(0, 200), output: (output+'').slice(0, 5000) });
  }
});

// 切换Cron开关
app.post('/api/cron/:id/toggle', (req, res) => {
  try {
    const cronFile = path.join(require('os').homedir(), '.hermes', 'cron', 'jobs.json');
    const data = JSON.parse(fs.readFileSync(cronFile, 'utf8'));
    const job = data.jobs.find(j => j.id === req.params.id);
    if (!job) return res.status(404).json({ error: 'Job not found' });
    job.enabled = !(job.enabled === false);
    fs.writeFileSync(cronFile, JSON.stringify(data, null, 2));
    res.json({ ok: true, enabled: job.enabled });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── 每日回顾提醒（21:00 推送企业微信群） ──
function scheduleDailyReview() {
  const now = new Date();
  const target = new Date();
  target.setHours(22, 5, 0, 0);
  let ms = target - now;
  if (ms < 0) { target.setDate(target.getDate() + 1); ms = target - now; }
  setTimeout(async () => {
    const hook = process.env.WEBHOOK_DAILY_REVIEW;
    if (hook) {
      try {
        const r = await fetch(hook, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            msgtype: 'text',
            text: { content: '美好的一天即将结束，请把今天的事情做一下回顾，发送到群内！坚持就是胜利✌️✌️✌️✌️', mentioned_list: ['@all'] }
          })
        });
        console.log('每日回顾提醒:', r.ok ? '✅ 已推送' : `❌ ${r.status}`);
      } catch (e) { console.error('每日回顾提醒失败:', e.message); }
    }
    scheduleDailyReview();
  }, ms);
}
scheduleDailyReview();

app.listen(PORT, '0.0.0.0', () => {
  console.log(`🧭 三季度工作台服务已启动`);
  console.log(`   本地地址: http://localhost:${PORT}`);
});
