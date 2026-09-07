// 英语词形还原（lemmatization）
//
// 作用：把单词的屈折变形（复数、时态、比较级/最高级、副词等）还原为词典中的
// 原形，从而显著提升在线词典 / 本地词典 / 未来 MDX 词典的查词命中率。
// 例如 books -> book、went -> go、running -> run、better -> good、children -> child。
//
// 实现：常用不规则词内置表 + 通用屈折规则还原，零依赖、纯函数、可离线运行。
// 查词时原词优先，仅当原词查不到才用还原后的候选逐个再查，因此规则过还原
// （如把 bed 误还原成 b）不会产生错误结果，只是多一次无果的查询。

// 不规则变形 -> 原形（覆盖高频不规则动词 / 名词 / 形容词 / 副词）
const IRREGULAR: Record<string, string> = {
  // 动词 be / have / do
  am: 'be', is: 'be', are: 'be', was: 'be', were: 'be', been: 'be', being: 'be',
  has: 'have', had: 'have', having: 'have',
  does: 'do', did: 'do', doing: 'do',
  // 常见不规则动词
  went: 'go', gone: 'go', going: 'go',
  made: 'make', making: 'make',
  came: 'come', coming: 'come',
  took: 'take', taken: 'take', taking: 'take',
  gave: 'give', given: 'give', giving: 'give',
  got: 'get', gotten: 'get', getting: 'get',
  said: 'say', saying: 'say',
  saw: 'see', seen: 'see', seeing: 'see',
  found: 'find', finding: 'find',
  thought: 'think', thinking: 'think',
  knew: 'know', known: 'know', knowing: 'know',
  became: 'become', becoming: 'become',
  brought: 'bring', bringing: 'bring',
  began: 'begin', begun: 'begin', beginning: 'begin',
  kept: 'keep', keeping: 'keep',
  held: 'hold', holding: 'hold',
  told: 'tell', telling: 'tell',
  left: 'leave', leaving: 'leave',
  felt: 'feel', feeling: 'feel',
  put: 'put', putting: 'put',
  set: 'set', setting: 'set',
  met: 'meet', meeting: 'meet',
  paid: 'pay', paying: 'pay',
  sat: 'sit', sitting: 'sit',
  spoke: 'speak', spoken: 'speak', speaking: 'speak',
  broke: 'break', broken: 'break', breaking: 'break',
  chose: 'choose', chosen: 'choose', choosing: 'choose',
  drove: 'drive', driven: 'drive', driving: 'drive',
  ate: 'eat', eaten: 'eat', eating: 'eat',
  fell: 'fall', fallen: 'fall', falling: 'fall',
  grew: 'grow', grown: 'grow', growing: 'grow',
  wrote: 'write', written: 'write', writing: 'write',
  ran: 'run', running: 'run',
  sang: 'sing', sung: 'sing', singing: 'sing',
  drew: 'draw', drawn: 'draw', drawing: 'draw',
  flew: 'fly', flown: 'fly', flying: 'fly',
  threw: 'throw', thrown: 'throw', throwing: 'throw',
  bought: 'buy', buying: 'buy',
  caught: 'catch', catching: 'catch',
  taught: 'teach', teaching: 'teach',
  built: 'build', building: 'build',
  sent: 'send', sending: 'send',
  spent: 'spend', spending: 'spend',
  lost: 'lose', losing: 'lose',
  won: 'win', winning: 'win',
  shook: 'shake', shaken: 'shake',
  stood: 'stand', standing: 'stand',
  understood: 'understand', understanding: 'understand',
  cut: 'cut', cutting: 'cut',
  hit: 'hit', hitting: 'hit',
  let: 'let', letting: 'let',
  shut: 'shut', shutting: 'shut',
  spread: 'spread', spreading: 'spread',
  dealt: 'deal', dealing: 'deal',
  meant: 'mean', meaning: 'mean',
  learnt: 'learn', learned: 'learn',
  fed: 'feed', feeding: 'feed',
  led: 'lead', leading: 'lead',
  bled: 'bleed', bleeding: 'bleed',
  sped: 'speed', speeding: 'speed',
  wept: 'weep', weeping: 'weep',
  swept: 'sweep', sweeping: 'sweep',
  dreamt: 'dream', dreamed: 'dream',
  burnt: 'burn', burned: 'burn',
  leapt: 'leap', leaped: 'leap',
  crept: 'creep',
  slept: 'sleep', sleeping: 'sleep',
  dwelt: 'dwell',
  smelt: 'smell', smelled: 'smell',
  spelt: 'spell', spelled: 'spell',
  knelt: 'kneel',
  fought: 'fight', fighting: 'fight',
  sought: 'seek', seeking: 'seek',
  // 不规则名词（复数 -> 单数）
  children: 'child',
  men: 'man',
  women: 'woman',
  feet: 'foot',
  teeth: 'tooth',
  mice: 'mouse',
  geese: 'goose',
  people: 'person',
  oxen: 'ox',
  indices: 'index',
  crises: 'crisis',
  analyses: 'analysis',
  bases: 'basis',
  axes: 'axis',
  oases: 'oasis',
  criteria: 'criterion',
  phenomena: 'phenomenon',
  // 不规则形容词 / 副词
  better: 'good',
  best: 'good',
  worse: 'bad',
  worst: 'bad',
  farther: 'far',
  further: 'far',
  furthest: 'far',
  less: 'little',
  least: 'little',
  more: 'much',
  most: 'much',
};

// 通用屈折规则还原：返回可能的原形候选（不含原词本身）
function ruleBased(word: string): string[] {
  const w = word.toLowerCase();
  const out: string[] = [];
  const push = (s: string) => {
    if (s && s.length >= 2 && s !== w) out.push(s);
  };

  // 所有格 's
  if (w.endsWith("'s")) push(w.slice(0, -2));

  // 名词复数 / 动词三单：-(e)s / -ies / -(s|x|z|ch|sh)es
  if (w.endsWith('ies') && w.length > 4) {
    push(w.slice(0, -3) + 'y'); // babies -> baby
  } else if (
    w.endsWith('ses') || w.endsWith('xes') || w.endsWith('zes') ||
    w.endsWith('ches') || w.endsWith('shes')
  ) {
    push(w.slice(0, -2)); // boxes -> box, churches -> church
  } else if (w.endsWith('s') && !w.endsWith('ss') && w.length > 3) {
    push(w.slice(0, -1)); // books -> book, makes -> make
  }

  // 现在分词 -ing / 去 e 加 ing / 双写加 ing
  if (w.endsWith('ying')) {
    push(w.slice(0, -4) + 'y'); // lying -> lie, dying -> die
  } else if (w.endsWith('ing') && w.length > 4) {
    const stem = w.slice(0, -3);
    push(stem); // running -> run (可能需双写修正)
    if (/(.)\1/.test(stem.slice(-2))) push(stem.slice(0, -1)); // stopping -> stop
  }

  // 过去式 / 过去分词 -ed / -ied / 双写加 ed
  if (w.endsWith('ied') && w.length > 4) {
    push(w.slice(0, -3) + 'y'); // tried -> try, copied -> copy
  } else if (w.endsWith('ed') && w.length > 3) {
    push(w.slice(0, -1)); // walked -> walk (去 d)
    const stem2 = w.slice(0, -2);
    push(stem2); // played -> play, looked -> look (去 ed)
    if (/(.)\1/.test(stem2.slice(-2))) push(stem2.slice(0, -1)); // stopped -> stop
  }

  // 比较级 / 最高级 -er / -est（形容词 / 副词）
  if (w.endsWith('est') && w.length > 4) {
    const s1 = w.slice(0, -3);
    push(s1); // biggest -> big
    if (/(.)\1/.test(s1.slice(-2))) push(s1.slice(0, -1));
    if (w.endsWith('iest')) push(w.slice(0, -4) + 'y'); // happiest -> happy
    else if (w.endsWith('est')) push(w.slice(0, -4) + 'y'); // 兜底，少数情况
  } else if (w.endsWith('er') && w.length > 3) {
    const s1 = w.slice(0, -2);
    push(s1); // bigger -> big
    if (/(.)\1/.test(s1.slice(-2))) push(s1.slice(0, -1));
    if (w.endsWith('ier')) push(w.slice(0, -3) + 'y'); // happier -> happy
  }

  // 副词 -ly
  if (w.endsWith('ily')) {
    push(w.slice(0, -3) + 'y'); // happily -> happy
  } else if (w.endsWith('ly') && w.length > 4) {
    push(w.slice(0, -2)); // quickly -> quick
  }

  return out;
}

// 词形还原主函数
// @param word 待还原的词（建议先去除标点、转小写；内部会再做一次清理）
// @param lang 语言，仅英文（'en'）启用不规则表，其他语言仅用通用规则（如复数 -s）
// @returns 候选原形数组，第一项恒为原词（查词时原词优先），其后为还原候选
export function lemmatize(word: string, lang = 'en'): string[] {
  const w = word.trim().toLowerCase().replace(/[^a-z'-]/g, '');
  if (!w) return [word];
  const candidates = new Set<string>([w]); // 原词优先
  if (lang === 'en' && IRREGULAR[w]) candidates.add(IRREGULAR[w]);
  for (const c of ruleBased(w)) candidates.add(c);
  return Array.from(candidates);
}
