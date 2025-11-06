import express from 'express';
import cors from 'cors';
import morgan from 'morgan';
import dotenv from 'dotenv';
import { OpenAI } from 'openai';

dotenv.config();
const app = express();
app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use(morgan('tiny'));

const PORT = process.env.PORT || 8080;
const MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';
const SYSTEM_PROMPT = process.env.SYSTEM_PROMPT || '你是一个短视频评论生成器，基于输入的主题和视频信息，生成一句简洁有梗、易共鸣、适合中文社媒的热评。语气自然，避免夸张广告语。';

const apiKey = process.env.OPENAI_API_KEY;
const openai = apiKey ? new OpenAI({ apiKey }) : null;

app.get('/healthz', (req, res) => {
  res.json({ ok: true, model: MODEL, time: new Date().toISOString() });
});

app.get('/', (_req, res) => {
  res.type('html').send(`<!doctype html>
  <html lang="zh-CN"><meta charset="utf-8">
  <title>AI短视频热评</title>
  <style>body{font-family:system-ui,-apple-system;max-width:760px;margin:40px auto;padding:0 16px}</style>
  <h1>AI短视频热评 Demo</h1>
  <p>输入视频要点，点击生成。</p>
  <textarea id="t" rows="6" style="width:100%"></textarea>
  <div style="margin:10px 0">
    语气：<select id="tone">
      <option>轻松有梗</option>
      <option>走心共鸣</option>
      <option>犀利吐槽</option>
      <option>温柔鼓励</option>
    </select>
    长度：<input id="len" type="number" value="40" min="10" max="80" style="width:80px">
  </div>
  <button id="btn">生成热评</button>
  <pre id="out" style="white-space:pre-wrap"></pre>
  <script>
    btn.onclick = async () => {
      out.textContent = '生成中...';
      const r = await fetch('/api/generate-hot-comment', {
        method:'POST',
        headers:{'content-type':'application/json'},
        body: JSON.stringify({ prompt: t.value, tone: tone.value, length: Number(len.value) })
      });
      const j = await r.json();
      out.textContent = j.comment || JSON.stringify(j,null,2);
    };
  </script>`);
});

app.post('/api/generate-hot-comment', async (req, res) => {
  try {
    const { prompt, tone = '轻松有梗', length = 40 } = req.body || {};
    if (!prompt || typeof prompt !== 'string') return res.status(400).json({ error: 'prompt 必填' });
    if (!openai) {
      return res.json({ comment: `【本地模式示例】${prompt.slice(0,20)}… ｜ ${tone} ｜ ~${length}字` });
    }
    const userPrompt = `视频要点：${prompt}\n语气：${tone}\n长度：~${length}字\n要求：口语自然、上手即用、不要话术和表情洪流，像真实热评。只返回一句评论。`;
    const resp = await openai.chat.completions.create({
      model: MODEL,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userPrompt }
      ],
      temperature: 0.7,
      max_tokens: 120
    });
    const text = resp.choices?.[0]?.message?.content?.trim();
    res.json({ comment: text });
  } catch (e) {
    res.status(500).json({ error: '生成失败', detail: String(e?.message || e) });
  }
});

app.listen(PORT, () => console.log('Listening on', PORT));
