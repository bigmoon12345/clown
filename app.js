import { POSITION_NAMES, TOPIC_REFLECTIONS } from './data.js';
import { analyzeReading, copyTextForReading, formatTime, lineFromTotal, normalizeRecord, tossCoins } from './divination.js';
import { readNdjson } from './streams.js';

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const STORAGE_KEY = 'guanyao.history.v1';
const state = { casting: false, record: null, topic: '综合', history: loadHistory() };
const aiState = { connected: false, available: false, canConfigure: false, busy: false, text: '', error: '', message: '', controller: null };
let toastTimer;

function loadHistory() {
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
    return Array.isArray(stored) ? stored.map(normalizeRecord).filter(Boolean).slice(0, 20) : [];
  } catch { return []; }
}

function element(tag, className, content) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (content !== undefined) node.textContent = content;
  return node;
}

function icon(name) {
  const node = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
  use.setAttribute('href', `#i-${name}`);
  node.append(use);
  node.setAttribute('aria-hidden', 'true');
  return node;
}

function notify(message) {
  clearTimeout(toastTimer);
  $('#toast span').textContent = message;
  $('#toast').hidden = false;
  toastTimer = setTimeout(() => { $('#toast').hidden = true; }, 3200);
}

function updateHistoryCount() {
  $('#history-count').textContent = state.history.length;
  $('#history-count').hidden = state.history.length === 0;
}

function selectTopic(topic) {
  state.topic = Object.hasOwn(TOPIC_REFLECTIONS, topic) ? topic : '综合';
  $$('.topic-chip').forEach((button) => {
    const selected = button.dataset.topic === state.topic;
    button.classList.toggle('is-selected', selected);
    button.setAttribute('aria-pressed', String(selected));
  });
}

function updateQuestionCount() {
  $('#question-count').textContent = `${$('#question').value.length} / 120`;
}

function setBusy(busy) {
  state.casting = busy;
  $('#cast-button').disabled = busy;
  $('#question').disabled = busy;
  $$('.topic-chip').forEach((button) => { button.disabled = busy; });
  $('#coin-stage').classList.toggle('is-casting', busy);
  $('.casting-card').setAttribute('aria-busy', String(busy));
  if (!busy) renderAi();
}

function updateProgress(completed, active = -1) {
  $$('.progress-step').forEach((node, index) => {
    node.classList.toggle('is-done', index < completed);
    node.classList.toggle('is-active', index === active);
    node.setAttribute('aria-label', `${POSITION_NAMES[index]}${index < completed ? '已完成' : index === active ? '摇卦中' : '等待中'}`);
  });
}

function showCoins(faces) {
  $$('[data-coin]').forEach((coin, index) => {
    const isBack = faces?.[index] === 3;
    coin.classList.toggle('is-back', isBack);
    const label = faces ? `${isBack ? '反面' : '正面'} · ${faces[index]}` : ['一枚', '二枚', '三枚'][index];
    $(`#coin-outcome-${index}`).textContent = label;
    coin.setAttribute('role', 'img');
    coin.setAttribute('aria-label', `第 ${index + 1} 枚铜钱${faces ? `：${label}` : ''}`);
  });
}

function renderHexagram(target, lines, changed) {
  const fragment = document.createDocumentFragment();
  const labels = [];
  for (let index = 5; index >= 0; index--) {
    const raw = lines[index];
    const line = raw ? lineFromTotal(raw.total) : null;
    const yang = line ? changed && line.moving ? !line.yang : line.yang : false;
    const row = element('div', `yao${line ? line.moving ? ' is-moving' : '' : ' is-pending'}`);
    row.append(element('i'));
    if (!yang) row.append(element('i'));
    if (line?.moving && !changed) row.append(element('span', 'moving-mark', line.mark));
    const label = `${POSITION_NAMES[index]}：${line ? `${yang ? '阳' : '阴'}爻${line.moving ? '，动爻' : ''}` : '等待投掷'}`;
    row.setAttribute('title', label);
    row.setAttribute('aria-hidden', 'true');
    labels.push(label);
    fragment.append(row);
  }
  target.replaceChildren(fragment);
  target.setAttribute('role', 'img');
  target.setAttribute('aria-label', `${changed ? '变卦' : '本卦'}，由上至下，${labels.join('；')}`);
}

function renderResult(record, complete = true) {
  $('#result-empty').hidden = true;
  $('#result-content').hidden = false;
  $('#result-category').textContent = `${record.topic}问事`;
  $('#result-time').textContent = formatTime(record.createdAt);
  $('#result-time').dateTime = record.createdAt;
  $('#result-question').textContent = record.question;
  $('#result-question').hidden = !record.question;
  renderHexagram($('#primary-hexagram'), record.lines, false);
  renderHexagram($('#changed-hexagram'), record.lines, true);
  $('.reading-box').hidden = !complete;
  $('.result-actions').hidden = !complete;
  $('.toss-details').hidden = !complete;
  $('.movement-summary').hidden = !complete;
  $('#ai-reading').hidden = !complete;
  $('#result-state').classList.toggle('is-complete', complete);
  $('#result-state').textContent = complete ? '六爻已成' : `${record.lines.length} / 6 爻`;
  if (!complete) {
    $('#primary-name').textContent = '本卦渐成';
    $('#changed-name').textContent = '变卦渐显';
    $('#primary-short').textContent = '由下而上 · 依次成爻';
    $('#changed-short').textContent = '阴阳变换 · 静候卦成';
    return;
  }
  const reading = analyzeReading(record);
  $('#primary-name').textContent = reading.primary.title;
  $('#changed-name').textContent = reading.changed.title;
  $('#primary-short').textContent = `第 ${reading.primary.number} 卦 · ${reading.primary.theme}`;
  $('#changed-short').textContent = `第 ${reading.changed.number} 卦 · ${reading.changed.theme}`;
  $('#movement-text').textContent = reading.movement;
  $('#reading-primary').textContent = reading.meaning;
  $('#reading-change').textContent = reading.change;
  $('#advice-category').textContent = `${record.topic} · 思考与行动`;
  $('#reading-advice').textContent = reading.advice;
  const fragment = document.createDocumentFragment();
  record.lines.forEach((line, index) => {
    const row = element('div', `toss-record${line.moving ? ' is-moving' : ''}`);
    row.append(element('span', '', POSITION_NAMES[index]), element('span', 'record-coins', line.faces.map((face) => face === 2 ? '正' : '反').join('')), element('span', '', line.total), element('span', '', `${line.name}${line.moving ? ' · 动' : ''}`));
    fragment.append(row);
  });
  $('#toss-table').replaceChildren(fragment);
  renderAi();
}

const pause = (duration) => new Promise((resolve) => setTimeout(resolve, duration));

async function castReading() {
  if (state.casting) return;
  cancelAi();
  setBusy(true);
  state.record = null;
  $('.toss-details').open = false;
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const record = {
    id: '',
    createdAt: new Date().toISOString(),
    question: $('#question').value.trim(),
    topic: state.topic,
    lines: [],
  };
  try {
    // 日期仅用于记录；所有铜钱正反均由 Web Crypto 独立生成。
    const idBytes = new Uint32Array(2);
    crypto.getRandomValues(idBytes);
    record.id = `${Date.now()}-${idBytes[0].toString(16)}${idBytes[1].toString(16)}`;
    renderResult(record, false);
    updateProgress(0, 0);
    for (let index = 0; index < 6; index++) {
      const line = tossCoins();
      $('#cast-button-label').textContent = `正在摇卦 · 第 ${index + 1} 次`;
      $('#casting-status').textContent = `${POSITION_NAMES[index]} · 铜钱起落，静候一刻`;
      updateProgress(index, index);
      $$('.coin-shell').forEach((coin) => { coin.classList.add('is-tossing'); });
      await pause(reducedMotion ? 20 : 620);
      $$('.coin-shell').forEach((coin) => { coin.classList.remove('is-tossing'); });
      showCoins(line.faces);
      record.lines.push(line);
      updateProgress(index + 1);
      $('#casting-status').textContent = `${POSITION_NAMES[index]} · ${line.faces.map((face) => face === 2 ? '正' : '反').join('、')} · ${line.total} ${line.name}${line.moving ? '（动爻）' : ''}`;
      renderResult(record, false);
      await pause(reducedMotion ? 20 : 260);
    }
    state.record = record;
    renderResult(record);
    $('#casting-status').textContent = '六爻已成。愿你观其象，也听见自己的答案。';
    $('#cast-button-label').textContent = '再起一卦';
    state.history = [record, ...state.history].slice(0, 20);
    updateHistoryCount();
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state.history)); }
    catch { notify('卦象已生成，当前浏览器未能保存记录'); }
    if (matchMedia('(max-width: 800px)').matches) $('.result-card').scrollIntoView({ behavior: reducedMotion ? 'instant' : 'smooth', block: 'start' });
  } catch (error) {
    resetReading();
    notify(error instanceof Error ? error.message : '起卦未完成，请重试');
  } finally {
    $$('.coin-shell').forEach((coin) => { coin.classList.remove('is-tossing'); });
    setBusy(false);
  }
}

function resetReading() {
  cancelAi();
  state.record = null;
  $('#result-empty').hidden = false;
  $('#result-content').hidden = true;
  $('#result-state').textContent = '静候卦成';
  $('#result-state').classList.remove('is-complete');
  $('#cast-button-label').textContent = '静心 · 一键起卦';
  $('#casting-status').textContent = '三枚铜钱，六次投掷，一卦自成。';
  updateProgress(0);
  showCoins();
}

function renderHistory() {
  const list = $('#history-list');
  const fragment = document.createDocumentFragment();
  if (!state.history.length) {
    const empty = element('div', 'history-empty');
    empty.append(icon('clock'), element('span', '', '还没有起卦记录。\n从此刻的一问开始。'));
    fragment.append(empty);
  }
  state.history.forEach((record) => {
    const reading = analyzeReading(record);
    const button = element('button', 'history-item');
    button.type = 'button';
    const content = element('div', 'history-content');
    content.append(element('h3', 'history-item-title', `${reading.primary.title} → ${reading.changed.title}`), element('p', 'history-item-question', record.question || '心中默念，未填写所问'), element('div', 'history-item-meta', `${record.topic} · ${formatTime(record.createdAt)}`));
    button.append(element('span', 'history-symbol', reading.primary.symbol), content, icon('chevron'));
    button.addEventListener('click', () => {
      if (state.casting) { notify('正在起卦，请待本次六爻落定'); return; }
      cancelAi();
      state.record = record;
      $('#question').value = record.question;
      updateQuestionCount();
      selectTopic(record.topic);
      renderResult(record);
      showCoins(record.lines[5].faces);
      updateProgress(6);
      $('#casting-status').textContent = '正在回看一卦，愿此刻有新的体会。';
      $('#cast-button-label').textContent = '再起一卦';
      $('#history-dialog').close();
      $('.result-card').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    });
    fragment.append(button);
  });
  list.replaceChildren(fragment);
  $('#clear-history').disabled = state.history.length === 0;
  $('#clear-confirm').hidden = true;
}

async function copyReading() {
  if (!state.record || state.casting) return;
  await copyText(copyTextForReading(state.record), state.record.ai ? '已复制完整卦象与 AI 解读' : '已复制卦象、铜钱记录与简析');
}

async function copyText(text, message) {
  try {
    if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable');
    await navigator.clipboard.writeText(text);
    notify(message);
  } catch {
    const temporary = element('textarea');
    temporary.value = text;
    temporary.readOnly = true;
    temporary.style.cssText = 'position:fixed;left:-9999px;top:0;';
    document.body.append(temporary);
    temporary.select();
    let copied = false;
    try { copied = document.execCommand('copy'); } catch { /* 提供可手动复制的窗口。 */ }
    temporary.remove();
    if (copied) { $('#copy-button').focus({ preventScroll: true }); notify(message); }
    else {
      $('#copy-fallback').value = text;
      $('#copy-dialog').showModal();
      $('#copy-fallback').focus();
      $('#copy-fallback').select();
    }
  }
}

function renderAi() {
  const record = state.record;
  $('#ai-reading').hidden = !record || state.casting;
  if (!record) return;
  const text = aiState.busy || aiState.error ? aiState.text : record.ai?.text || aiState.text;
  $('#ai-reading').classList.toggle('is-loading', aiState.busy);
  $('#ai-reading').setAttribute('aria-busy', String(aiState.busy));
  $('#ai-intro').hidden = Boolean(text);
  $('#ai-output').hidden = !text;
  $('#ai-output').textContent = text;
  $('#ai-error').hidden = !aiState.error;
  $('#ai-error').textContent = aiState.error;
  $('#ai-stop').hidden = !aiState.busy;
  $('#ai-copy').hidden = !text || aiState.busy;
  $('#ai-generate').disabled = aiState.busy;
  $('#ai-generate span').textContent = aiState.busy ? '正在解读…' : record.ai ? '重新生成解读' : aiState.error ? '重试 AI 解读' : '请 AI 解读这一卦';
  $('#ai-status').textContent = aiState.busy ? aiState.message || '正在连接云端…' : aiState.error ? '本次解读未完成' : record.ai ? `${record.ai.provider} · 已完成并保存` : aiState.connected ? '免费云端模型已连接' : aiState.available ? '首次使用，请连接 API Key' : 'AI 服务暂未连接';
  $('#copy-button span').textContent = record.ai ? '复制卦象、简析与 AI 解读' : '复制卦象与简析';
}

function cancelAi() {
  aiState.controller?.abort();
  aiState.controller = null;
  aiState.busy = false;
  aiState.text = '';
  aiState.error = '';
  aiState.message = '';
}

async function checkAiConnection() {
  try {
    const response = await fetch('./api/ai/status', { cache: 'no-store', signal: AbortSignal.timeout(7000) });
    if (!response.ok) throw new Error('Unavailable');
    const data = await response.json();
    aiState.available = true;
    aiState.connected = data.configured === true;
    aiState.canConfigure = data.canConfigure === true;
  } catch { aiState.available = false; aiState.connected = false; aiState.canConfigure = false; }
  renderAi();
}

async function openAiSettings() {
  await checkAiConnection();
  $('#ai-config-form').hidden = !aiState.canConfigure;
  $('#ai-config-readonly').hidden = aiState.canConfigure;
  $('#ai-config-readonly').textContent = aiState.available ? '请由网站管理者在服务器配置 SILICONFLOW_API_KEY 后重启网站。' : 'AI 服务未连接。请通过项目中的 npm start 启动网站后重试。';
  $('#ai-config-message').className = 'ai-config-message';
  $('#ai-config-message').textContent = aiState.connected ? '已连接云端，可填写新的 Key 替换当前连接。' : '密钥仅存于本机网站服务，不写入浏览器记录。';
  $('#ai-api-key').value = '';
  $('#ai-api-key').type = 'password';
  $('#ai-toggle-key').textContent = '显示';
  $('#ai-toggle-key').setAttribute('aria-label', '显示密钥');
  if (!$('#ai-settings-dialog').open) $('#ai-settings-dialog').showModal();
}

async function configureAi(event) {
  event.preventDefault();
  const input = $('#ai-api-key');
  const button = $('#ai-config-submit');
  const message = $('#ai-config-message');
  button.disabled = true;
  button.querySelector('span').textContent = '正在验证连接…';
  message.className = 'ai-config-message';
  message.textContent = '正在确认密钥权限与免费模型可用性…';
  try {
    const response = await fetch('./api/ai/config', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Guanyao-Config': '1' }, body: JSON.stringify({ apiKey: input.value.trim() }), signal: AbortSignal.timeout(20000) });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || '连接未成功，请稍后重试。');
    input.value = '';
    aiState.connected = true;
    aiState.available = true;
    aiState.error = '';
    $('#ai-settings-dialog').close();
    renderAi();
    notify('已连接 DeepSeek 免费云端模型');
  } catch (error) {
    message.className = 'ai-config-message is-error';
    message.textContent = error.name === 'TimeoutError' ? '验证超时，请检查网络后重试。' : error.message || '连接未成功，请稍后重试。';
  } finally { button.disabled = false; button.querySelector('span').textContent = '验证并连接'; }
}

async function generateAi() {
  if (!state.record || state.casting || aiState.busy) return;
  if (!aiState.connected) { await openAiSettings(); return; }
  const record = state.record;
  const controller = new AbortController();
  aiState.controller = controller;
  aiState.busy = true;
  aiState.text = '';
  aiState.error = '';
  aiState.message = '正在连接云端…';
  renderAi();
  let completed = false;
  try {
    const response = await fetch('./api/ai/read', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ record: { id: record.id, createdAt: record.createdAt, question: record.question, topic: record.topic, lines: record.lines } }),
      signal: AbortSignal.any([controller.signal, AbortSignal.timeout(130000)]),
    });
    if (!response.ok) {
      const data = await response.json();
      if (data.code === 'NOT_CONFIGURED' || data.code === 'INVALID_KEY') aiState.connected = false;
      throw new Error(data.error || '云端未能完成解读，请稍后重试。');
    }
    for await (const event of readNdjson(response.body)) {
      if (aiState.controller !== controller || state.record?.id !== record.id) return;
      if (event.type === 'thinking') aiState.message = '正在梳理卦象，请稍候…';
      if (event.type === 'delta' && typeof event.text === 'string') { aiState.text += event.text; aiState.message = '正在生成解读…'; }
      if (aiState.text.length > 16000) throw new Error('解读内容超出长度限制，请重新生成。');
      if (event.type === 'error') throw new Error(event.error || '解读中断，请重试。');
      if (event.type === 'done') {
        if (!aiState.text.trim()) throw new Error('云端未返回解读内容，请重试。');
        const ai = { text: aiState.text, model: event.model, provider: event.provider, createdAt: event.createdAt };
        const normalized = normalizeRecord({ ...record, ai });
        if (!normalized?.ai) throw new Error('云端解读数据不完整，请重试。');
        record.ai = normalized.ai;
        completed = true;
        const position = state.history.findIndex((item) => item.id === record.id);
        if (position >= 0) {
          state.history[position] = record;
          try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state.history)); }
          catch { notify('解读已完成，浏览器暂未能保存记录'); }
        }
        break;
      }
      renderAi();
    }
    if (!completed) throw new Error('解读连接中断，当前文字可能不完整，请重新生成。');
  } catch (error) {
    if (aiState.controller !== controller) return;
    aiState.error = controller.signal.aborted ? '已停止生成，当前文字未作为完整解读保存。' : error.name === 'TimeoutError' ? '云端响应超时，请稍后重试。' : error.message || '解读失败，请重试。';
  } finally {
    if (aiState.controller === controller) { aiState.busy = false; aiState.controller = null; renderAi(); }
  }
}

$('#question').addEventListener('input', updateQuestionCount);
$$('.topic-chip').forEach((button) => button.addEventListener('click', () => selectTopic(button.dataset.topic)));
$('#cast-button').addEventListener('click', castReading);
$('#reset-button').addEventListener('click', () => { if (!state.casting) resetReading(); });
$('#copy-button').addEventListener('click', copyReading);
$('#ai-generate').addEventListener('click', generateAi);
$('#ai-settings-open').addEventListener('click', openAiSettings);
$('#ai-stop').addEventListener('click', () => { aiState.controller?.abort(); });
$('#ai-copy').addEventListener('click', () => { const text = aiState.error ? aiState.text : state.record?.ai?.text; if (text) copyText(text, '已复制 AI 解读'); });
$('#ai-config-form').addEventListener('submit', configureAi);
$('#ai-toggle-key').addEventListener('click', () => { const show = $('#ai-api-key').type === 'password'; $('#ai-api-key').type = show ? 'text' : 'password'; $('#ai-toggle-key').textContent = show ? '隐藏' : '显示'; $('#ai-toggle-key').setAttribute('aria-label', show ? '隐藏密钥' : '显示密钥'); });
$('#ai-settings-dialog').addEventListener('close', () => { $('#ai-api-key').value = ''; $('#ai-api-key').type = 'password'; });
$('#guide-open').addEventListener('click', () => $('#guide-dialog').showModal());
$('#history-open').addEventListener('click', () => { renderHistory(); $('#history-dialog').showModal(); });
$$('[data-close]').forEach((button) => button.addEventListener('click', () => document.getElementById(button.dataset.close).close()));
$$('dialog').forEach((dialog) => dialog.addEventListener('click', (event) => {
  if (event.target !== dialog) return;
  const rect = dialog.getBoundingClientRect();
  if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) dialog.close();
}));
$('#clear-history').addEventListener('click', () => { $('#clear-confirm').hidden = false; $('#clear-cancel').focus(); });
$('#clear-cancel').addEventListener('click', () => { $('#clear-confirm').hidden = true; $('#clear-history').focus(); });
$('#clear-confirm-button').addEventListener('click', () => {
  try { localStorage.removeItem(STORAGE_KEY); }
  catch { notify('浏览器限制了存储操作，暂未清除记录'); return; }
  state.history = [];
  updateHistoryCount();
  renderHistory();
  notify('起卦记录已清除');
});
$('#select-copy-text').addEventListener('click', () => { $('#copy-fallback').focus(); $('#copy-fallback').select(); });
window.addEventListener('storage', (event) => {
  if (event.key !== STORAGE_KEY && event.key !== null) return;
  state.history = loadHistory();
  updateHistoryCount();
  if ($('#history-dialog').open) renderHistory();
});

updateHistoryCount();
updateQuestionCount();
updateProgress(0);
showCoins();
void checkAiConnection();
