// Merriam-Webster 词典 API Key：通过环境变量注入（MW_API_KEY=... node cdp_mw.mjs），避免明文写入仓库
const KEY = process.env.MW_API_KEY || '';
const BASE = 'https://www.dictionaryapi.com/api/v3/references/learners/json';
const WORDS = ['musicologist', 'brilliant', 'serendipity'];

function newConn(url) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    let id = 0; const pend = new Map();
    const send = (method, params = {}) => new Promise((res) => {
      const i = ++id; pend.set(i, res); ws.send(JSON.stringify({ id: i, method, params }));
    });
    ws.on('open', async () => {
      try {
        await send('Runtime.enable');
        for (const w of WORDS) {
          const u = `${BASE}/${w}?key=${KEY}`;
          const r = await send('Runtime.evaluate', {
            expression: `fetch(${JSON.stringify(u)}).then(r=>r.status).catch(e=>'ERR:'+e.message)`,
            returnByValue: true, awaitPromise: true,
          });
          console.log('WORD', w, '=> MW HTTP', r.result.result.value);
        }
        ws.close(); resolve();
      } catch (e) { ws.close(); reject(e); }
    });
    ws.on('message', (d) => {
      const m = JSON.parse(d);
      if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); }
    });
    ws.on('error', (e) => reject(e));
  });
}

async function getPageWs() {
  for (let i = 0; i < 30; i++) {
    try {
      const list = await (await fetch('http://127.0.0.1:9333/json/list')).json();
      const page = list.find((t) => t.type === 'page') || list[0];
      if (page && page.webSocketDebuggerUrl) return page.webSocketDebuggerUrl;
    } catch (e) { /* retry */ }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error('no page target after 30s');
}

(async () => {
  const url = await getPageWs();
  console.log('PAGE_WS_OK');
  await newConn(url);
  console.log('VERIFY_DONE');
  process.exit(0);
})().catch((e) => { console.error('FAIL', e.message); process.exit(1); });
