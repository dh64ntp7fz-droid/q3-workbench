const express = require('express');
const fs = require('fs');
const path = require('path');

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

// 健康检查
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', uptime: process.uptime() });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`🧭 三季度工作台服务已启动`);
  console.log(`   本地地址: http://localhost:${PORT}`);
});
