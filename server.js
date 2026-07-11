const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3721;
const DATA_FILE = path.join(__dirname, 'data', 'workflow.json');
const STATS_FILE = path.join(__dirname, 'data', 'stats.json');

app.use(express.json({ limit: '5mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// 确保数据目录和文件存在
function ensureData() {
  if (!fs.existsSync(path.join(__dirname, 'data'))) {
    fs.mkdirSync(path.join(__dirname, 'data'), { recursive: true });
  }
  if (!fs.existsSync(DATA_FILE)) fs.writeFileSync(DATA_FILE, '{}');
  if (!fs.existsSync(STATS_FILE)) fs.writeFileSync(STATS_FILE, '{}');
}
ensureData();

function readJSON(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (e) { return {}; }
}

function writeJSON(file, data) {
  fs.writeFileSync(file, JSON.stringify(data));
}

// ── API ──

// 获取所有工作台数据
app.get('/api/workflow', (req, res) => {
  const data = readJSON(DATA_FILE);
  res.json({ data, serverTime: Date.now() });
});

// 保存工作台数据（合并方式）
app.post('/api/workflow', (req, res) => {
  const existing = readJSON(DATA_FILE);
  const incoming = req.body;
  // 去掉 _t 避免覆盖冲突，保留服务端时间戳
  delete incoming._t;
  const merged = { ...existing, ...incoming, _savedAt: Date.now() };
  writeJSON(DATA_FILE, merged);
  res.json({ ok: true, savedAt: Date.now() });
});

// 获取统计数据（周/月完成率等）
app.get('/api/stats', (req, res) => {
  const stats = readJSON(STATS_FILE);
  res.json({ stats });
});

// 记录每日完成快照
app.post('/api/stats/snapshot', (req, res) => {
  const stats = readJSON(STATS_FILE);
  const today = new Date().toISOString().slice(0, 10);
  stats[today] = req.body;
  writeJSON(STATS_FILE, stats);
  res.json({ ok: true });
});

// 导出全部数据（备份用）
app.get('/api/backup', (req, res) => {
  const workflow = readJSON(DATA_FILE);
  const stats = readJSON(STATS_FILE);
  res.json({
    version: '2.0',
    exportedAt: new Date().toISOString(),
    workflow,
    stats
  });
});

// 恢复数据
app.post('/api/restore', (req, res) => {
  const { workflow, stats } = req.body;
  if (workflow) writeJSON(DATA_FILE, workflow);
  if (stats) writeJSON(STATS_FILE, stats);
  res.json({ ok: true, restoredAt: Date.now() });
});


// 企业微信 webhook 转发（避免CORS）
app.post('/api/send-wecom', async (req, res) => {
  try {
    const data = req.body;
    const WECOM_URL = 'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=d35ec9fd-b3e2-4132-848c-0fbc7ab38107';

    // Build markdown message
    const { store, date, time, checkCount, totalItems, resolved } = data;
    const md = {
      msgtype: 'markdown',
      markdown: {
        content: `## 📋 驻店记录 · ${store}\n> 日期：${date} ${time || ''}\n> 合格项：${checkCount} / ${totalItems}\n\n### 📝 与店长沟通要点\n> ${resolved || '（未填写）'}\n\n---\n> 👤 邹慧明 · 三季度工作台`
      }
    };

    const response = await fetch(WECOM_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(md)
    });
    const result = await response.json();
    res.json({ ok: result.errcode === 0, errmsg: result.errmsg });
  } catch (e) {
    res.json({ ok: false, errmsg: e.message });
  }
});

// 健康检查
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', uptime: process.uptime() });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`🧭 三季度工作台服务已启动`);
  console.log(`   本地地址: http://localhost:${PORT}`);
  console.log(`   数据文件: ${DATA_FILE}`);
});
