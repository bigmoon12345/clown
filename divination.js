import { HEXAGRAMS, HEXAGRAM_MATRIX, TRIGRAMS, POSITION_NAMES, POSITION_REFLECTIONS, TOPIC_REFLECTIONS } from './data.js';

const YAO = Object.freeze({
  6: { name: '老阴', yang: false, moving: true, mark: '×' },
  7: { name: '少阳', yang: true, moving: false, mark: '' },
  8: { name: '少阴', yang: false, moving: false, mark: '' },
  9: { name: '老阳', yang: true, moving: true, mark: '○' },
});

export function lineFromTotal(total) {
  if (!Object.hasOwn(YAO, total)) throw new RangeError('爻值须为 6、7、8 或 9。');
  return { total, ...YAO[total] };
}

export function lineFromFaces(faces) {
  if (!Array.isArray(faces) || faces.length !== 3 || faces.some((face) => face !== 2 && face !== 3)) {
    throw new TypeError('每次须包含三枚铜钱，正面记 2，反面记 3。');
  }
  return { ...lineFromTotal(faces.reduce((sum, face) => sum + face, 0)), faces: [...faces] };
}

export function tossCoins(random = globalThis.crypto) {
  if (typeof random?.getRandomValues !== 'function') throw new Error('当前浏览器不支持安全随机数，请使用新版浏览器。');
  const bytes = new Uint8Array(3);
  random.getRandomValues(bytes);
  // 使用随机字节最低位：256 个可能值中各有 128 个奇数、偶数，避免取模偏差。
  return lineFromFaces(Array.from(bytes, (byte) => (byte & 1) === 0 ? 2 : 3));
}

export function getHexagram(lines, changed = false) {
  if (!Array.isArray(lines) || lines.length !== 6) throw new RangeError('一个卦须有六爻，依初爻到上爻排列。');
  const bits = lines.map((line) => {
    const normalized = typeof line === 'number' ? lineFromTotal(line) : lineFromTotal(line.total);
    return Number(changed && normalized.moving ? !normalized.yang : normalized.yang);
  });
  const lowerIndex = TRIGRAMS.findIndex((trigram) => trigram.bits === bits.slice(0, 3).join(''));
  const upperIndex = TRIGRAMS.findIndex((trigram) => trigram.bits === bits.slice(3, 6).join(''));
  const number = HEXAGRAM_MATRIX[upperIndex][lowerIndex];
  return { ...HEXAGRAMS[number - 1], bits, lower: TRIGRAMS[lowerIndex], upper: TRIGRAMS[upperIndex], symbol: String.fromCodePoint(0x4dc0 + number - 1) };
}

export function analyzeReading(record) {
  const primary = getHexagram(record.lines);
  const changed = getHexagram(record.lines, true);
  const moving = record.lines.map((line, index) => lineFromTotal(line.total).moving ? index : -1).filter((index) => index >= 0);
  let movement;
  let change;
  if (moving.length === 0) {
    movement = '六爻皆静 · 本卦与变卦相同';
    change = '本次六爻皆静，卦象保持不变。可先围绕本卦的提示整理思绪，观察眼前条件，不必为变化而变化。';
  } else {
    movement = `${moving.map((index) => POSITION_NAMES[index]).join('、')}动 · 共 ${moving.length} 个动爻`;
    change = `动爻变后为「${changed.title}」，其卦义提示「${changed.theme}」。${moving.length === 1 ? POSITION_REFLECTIONS[moving[0]] : '多处爻象变动，可留意不同层面的相互影响，先分清轻重缓急。'}变卦提供另一角度，并不预定事情的结果。`;
  }
  return {
    primary, changed, moving, movement,
    meaning: primary.meaning,
    change,
    advice: `${TOPIC_REFLECTIONS[record.topic] || TOPIC_REFLECTIONS.综合}${primary.advice}`,
  };
}

export function formatTime(iso, options = {}) {
  return new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', ...options }).format(new Date(iso));
}

export function copyTextForReading(record) {
  const reading = analyzeReading(record);
  const lineSymbol = (line, changed = false) => {
    const normalized = lineFromTotal(line.total);
    const yang = changed && normalized.moving ? !normalized.yang : normalized.yang;
    return `${yang ? '━━━━━━' : '━━　━━'}${!changed && normalized.moving ? ` ${normalized.mark}` : ''}`;
  };
  const diagram = record.lines.map((line, index) => `${POSITION_NAMES[index]}　${lineSymbol(line)}　→　${lineSymbol(line, true)}　${line.name || lineFromTotal(line.total).name}`).reverse();
  const details = record.lines.map((line, index) => `${index + 1}. ${POSITION_NAMES[index]}：${line.faces.map((face) => face === 2 ? '正' : '反').join('、')}，合计 ${line.total}，${lineFromTotal(line.total).name}`);
  return [
    '【观爻 · 六爻起卦】',
    `起卦时间：${formatTime(record.createdAt, { timeZoneName: 'short' })}`,
    `问事类别：${record.topic}`,
    `所问之事：${record.question || '心中默念（未填写）'}`,
    '',
    `本卦：第 ${reading.primary.number} 卦 ${reading.primary.title}（${reading.primary.theme}）`,
    `变卦：第 ${reading.changed.number} 卦 ${reading.changed.title}（${reading.changed.theme}）`,
    `动爻：${reading.movement}`,
    '',
    '【卦象｜左本卦 · 右变卦｜自上而下显示】',
    ...diagram,
    '',
    '【六次铜钱记录｜按投掷顺序】',
    ...details,
    '计数约定：正面（乾隆通寶）=2；反面（吉祥）=3。六次结果从下往上成卦。',
    '',
    '【卦意简析】',
    reading.meaning,
    reading.change,
    `【${record.topic}启发】${reading.advice}`,
    ...(record.ai ? ['', `【AI 解卦 · ${record.ai.provider} · ${record.ai.model}】`, record.ai.text] : []),
    '',
    '简析取卦义与动爻作通俗提示，未作纳甲、六亲、世应排盘。传统文化体验，仅作参考。',
  ].join('\n');
}

export function normalizeRecord(value) {
  if (!value || typeof value !== 'object') return null;
  if (typeof value.id !== 'string' || value.id.length > 100) return null;
  if (typeof value.createdAt !== 'string' || !Number.isFinite(Date.parse(value.createdAt))) return null;
  if (typeof value.question !== 'string' || value.question.length > 120) return null;
  if (!Object.hasOwn(TOPIC_REFLECTIONS, value.topic)) return null;
  if (!Array.isArray(value.lines) || value.lines.length !== 6) return null;
  try {
    const lines = value.lines.map((line) => lineFromFaces(line.faces));
    const record = { id: value.id, createdAt: value.createdAt, question: value.question, topic: value.topic, lines };
    const ai = value.ai;
    if (ai && typeof ai.text === 'string' && ai.text.trim() && ai.text.length <= 16000
      && typeof ai.model === 'string' && ai.model.length <= 150
      && typeof ai.provider === 'string' && ai.provider.length <= 60
      && typeof ai.createdAt === 'string' && Number.isFinite(Date.parse(ai.createdAt))) {
      record.ai = { text: ai.text, model: ai.model, provider: ai.provider, createdAt: ai.createdAt };
    }
    return record;
  } catch { return null; }
}
