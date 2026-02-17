const state = {
  cards: [],
  selectedCorrectIndex: null,
  batchQueue: [],
};

const setTitleEl = document.getElementById('setTitle');
const setDescriptionEl = document.getElementById('setDescription');
const frontTextEl = document.getElementById('frontText');
const backTextEl = document.getElementById('backText');
const optionsTextEl = document.getElementById('optionsText');
const isMultipleChoiceEl = document.getElementById('isMultipleChoice');
const addMessageEl = document.getElementById('addMessage');
const cardCountEl = document.getElementById('cardCount');
const cardsListEl = document.getElementById('cardsList');
const correctAnswerBlockEl = document.getElementById('correctAnswerBlock');
const correctAnswerListEl = document.getElementById('correctAnswerList');
const batchCountEl = document.getElementById('batchCount');
const batchListEl = document.getElementById('batchList');

const addCardBtn = document.getElementById('addCardBtn');
const downloadBtn = document.getElementById('downloadBtn');
const copyBtn = document.getElementById('copyBtn');
const captureSelectionBtn = document.getElementById('captureSelectionBtn');
const pasteClipboardBtn = document.getElementById('pasteClipboardBtn');
const addBatchBtn = document.getElementById('addBatchBtn');
const clearBatchBtn = document.getElementById('clearBatchBtn');

const now = () => Date.now();

const uid = () =>
  (crypto && crypto.randomUUID ? crypto.randomUUID() : `q_${now()}_${Math.random().toString(16).slice(2)}`);

function cleanText(value) {
  return (value || '').replace(/\r\n/g, '\n').trim();
}

function parseOptions(raw) {
  return cleanText(raw)
    .split('\n')
    .map((line) => line.replace(/^\s*(?:[-*•]\s*)?(?:\(?[A-Za-z0-9]\)?[).:\-]?\s*)?/, '').trim())
    .filter(Boolean);
}

function parseAnswerTokenToIndex(token, options) {
  const normalized = String(token || '').trim().toLowerCase();
  if (!normalized || options.length === 0) return null;

  if (/^[a-z]$/.test(normalized)) {
    const idx = normalized.charCodeAt(0) - 'a'.charCodeAt(0);
    if (idx >= 0 && idx < options.length) return idx;
  }

  if (/^\d+$/.test(normalized)) {
    const idx = parseInt(normalized, 10) - 1;
    if (idx >= 0 && idx < options.length) return idx;
  }

  const compact = normalized.replace(/[\W_]+/g, '');
  const idx = options.findIndex((opt) => opt.toLowerCase().replace(/[\W_]+/g, '') === compact);
  return idx >= 0 ? idx : null;
}

function detectAnswerFromRaw(raw, options) {
  const lines = cleanText(raw)
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  for (const line of lines) {
    const markedOption = line.match(/^(?:[-*•]\s*)?(?:\(?([A-Za-z0-9]{1,2})\)?[).:\-]?\s+)(.+)\s*(?:\(correct\)|\*|✔)$/i);
    if (markedOption) {
      const tokenIdx = parseAnswerTokenToIndex(markedOption[1], options);
      if (tokenIdx !== null) return tokenIdx;
      const textIdx = parseAnswerTokenToIndex(markedOption[2], options);
      if (textIdx !== null) return textIdx;
    }

    const match = line.match(/^(?:answer|ans|correct)\s*[:\-]?\s*(.+)$/i);
    if (!match) continue;
    const token = cleanText(match[1]);
    const tokenOnly = token.match(/^\(?([A-Za-z0-9]{1,2})\)?(?:[).:\-])?$/);
    if (tokenOnly) {
      const idx = parseAnswerTokenToIndex(tokenOnly[1], options);
      if (idx !== null) return idx;
    }
    const idx = parseAnswerTokenToIndex(token, options);
    if (idx !== null) return idx;
  }

  return null;
}

function parseQuestionBlock(raw) {
  const text = cleanText(raw);
  if (!text) return { front: '', back: '', options: [], correctIndex: null };

  const lines = text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  const optionPattern = /^(?:[-*•]\s*)?(?:\(?[A-Za-z]\)|[A-Za-z][).]|\d{1,2}[).])\s+(.+)$/;
  const optionStartIndex = lines.findIndex((line) => optionPattern.test(line));

  if (optionStartIndex === -1) {
    if (lines.length === 1) return { front: lines[0], back: '', options: [], correctIndex: null };
    return {
      front: lines[0],
      back: lines.slice(1).join('\n'),
      options: [],
      correctIndex: null,
    };
  }

  const frontLines = lines.slice(0, optionStartIndex);
  const optionLines = [];
  const trailingLines = [];

  let inOptions = true;
  for (let i = optionStartIndex; i < lines.length; i += 1) {
    const line = lines[i];
    if (inOptions && optionPattern.test(line)) {
      optionLines.push(line);
      continue;
    }

    if (inOptions && optionLines.length > 0 && !/^(?:answer|ans|correct)\s*[:\-]?/i.test(line)) {
      optionLines[optionLines.length - 1] = `${optionLines[optionLines.length - 1]} ${line}`.trim();
      continue;
    }

    inOptions = false;
    trailingLines.push(line);
  }

  const options = optionLines
    .map((line) => line.replace(optionPattern, '$1').trim())
    .filter(Boolean);

  const trailingText = trailingLines.join('\n');
  const directAnswer = detectAnswerFromRaw(trailingText, options);
  const fallbackAnswer = directAnswer !== null ? directAnswer : detectAnswerFromRaw(text, options);

  const frontText = frontLines.join(' ').replace(/^(?:q(?:uestion)?\s*[:.)\-]\s*)/i, '').trim();
  const backMatch = trailingText.match(/(?:^|\n)\s*(?:answer|ans|correct)\s*[:\-]?\s*(.+)$/i);
  const back = backMatch ? cleanText(backMatch[1]) : '';

  return {
    front: frontText || lines[0],
    back,
    options,
    correctIndex: fallbackAnswer,
  };
}

function scoreConfidence(parsed) {
  let score = 0;
  if (parsed.front && parsed.front.length >= 12) score += 0.35;
  if (/[?]$/.test(parsed.front)) score += 0.1;
  if (parsed.options.length >= 2) score += 0.25;
  if (parsed.options.length >= 3) score += 0.1;
  if (parsed.correctIndex !== null) score += 0.2;
  if (!parsed.options.length && parsed.back.length >= 8) score += 0.15;
  return Math.min(1, Number(score.toFixed(2)));
}

function splitIntoBlocks(raw) {
  const text = cleanText(raw);
  if (!text) return [];

  const byBlankLines = text.split(/\n\s*\n+/).map(cleanText).filter(Boolean);
  if (byBlankLines.length > 1) return byBlankLines;

  const lines = text.split('\n');
  const starts = [];
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i].trim();
    if (/^(?:q(?:uestion)?\s*)?\d{1,3}[).:\-]\s+\S+/i.test(line)) starts.push(i);
  }

  if (starts.length < 2) return [text];

  const blocks = [];
  for (let i = 0; i < starts.length; i += 1) {
    const start = starts[i];
    const end = i + 1 < starts.length ? starts[i + 1] : lines.length;
    const block = cleanText(lines.slice(start, end).join('\n'));
    if (block) blocks.push(block);
  }
  return blocks.length ? blocks : [text];
}

function parseBatchInput(raw) {
  const blocks = splitIntoBlocks(raw);
  return blocks
    .map((block) => {
      const parsed = parseQuestionBlock(block);
      return {
        id: uid(),
        parsed,
        confidence: scoreConfidence(parsed),
        isLowConfidence: scoreConfidence(parsed) < 0.55,
      };
    })
    .filter((item) => item.parsed.front || item.parsed.options.length || item.parsed.back);
}

function renderCorrectAnswerPicker() {
  const options = parseOptions(optionsTextEl.value);
  const isMc = Boolean(isMultipleChoiceEl.checked && options.length >= 2);

  if (!isMc) {
    correctAnswerBlockEl.classList.add('hidden');
    correctAnswerListEl.innerHTML = '';
    state.selectedCorrectIndex = null;
    return;
  }

  if (state.selectedCorrectIndex === null || state.selectedCorrectIndex >= options.length) {
    state.selectedCorrectIndex = null;
  }

  correctAnswerBlockEl.classList.remove('hidden');
  correctAnswerListEl.innerHTML = '';

  options.forEach((option, index) => {
    const item = document.createElement('label');
    item.className = `correct-item${state.selectedCorrectIndex === index ? ' active' : ''}`;

    const radio = document.createElement('input');
    radio.type = 'radio';
    radio.name = 'correctAnswer';
    radio.checked = state.selectedCorrectIndex === index;
    radio.addEventListener('change', () => {
      state.selectedCorrectIndex = index;
      renderCorrectAnswerPicker();
    });

    const text = document.createElement('span');
    text.textContent = `${index + 1}. ${option}`;

    const check = document.createElement('span');
    check.className = 'check';
    check.textContent = '✓';

    item.appendChild(radio);
    item.appendChild(text);
    item.appendChild(check);
    correctAnswerListEl.appendChild(item);
  });
}

function renderCards() {
  cardsListEl.innerHTML = '';
  cardCountEl.textContent = String(state.cards.length);

  state.cards.forEach((card, idx) => {
    const li = document.createElement('li');
    const span = document.createElement('span');
    span.className = 'title';
    span.textContent = `${idx + 1}. ${card.content}`;

    const delBtn = document.createElement('button');
    delBtn.className = 'delete';
    delBtn.textContent = 'Remove';
    delBtn.addEventListener('click', () => {
      state.cards.splice(idx, 1);
      persist();
      renderCards();
    });

    li.appendChild(span);
    li.appendChild(delBtn);
    cardsListEl.appendChild(li);
  });
}

function renderBatchQueue() {
  batchListEl.innerHTML = '';
  batchCountEl.textContent = String(state.batchQueue.length);

  state.batchQueue.forEach((item, index) => {
    const li = document.createElement('li');
    li.className = 'batch-item';

    const head = document.createElement('div');
    head.className = 'batch-head';

    const question = document.createElement('div');
    question.className = 'batch-question';
    question.textContent = `${index + 1}. ${item.parsed.front || '(Missing question)'}`;

    const badge = document.createElement('span');
    badge.className = `badge ${item.isLowConfidence ? 'badge-low' : 'badge-high'}`;
    badge.textContent = `${item.isLowConfidence ? 'Low' : 'High'} ${(item.confidence * 100).toFixed(0)}%`;

    head.appendChild(question);
    head.appendChild(badge);

    const meta = document.createElement('div');
    meta.className = 'batch-meta';
    meta.textContent = `${item.parsed.options.length} option(s)${item.parsed.correctIndex !== null ? ' • answer detected' : ''}`;

    const actions = document.createElement('div');
    actions.className = 'batch-actions';

    const useBtn = document.createElement('button');
    useBtn.className = 'ghost';
    useBtn.textContent = 'Use';
    useBtn.addEventListener('click', () => loadParsedIntoEditor(item.parsed));

    const addBtn = document.createElement('button');
    addBtn.textContent = 'Add';
    addBtn.addEventListener('click', () => addSingleBatchItem(item.id));

    const removeBtn = document.createElement('button');
    removeBtn.className = 'ghost';
    removeBtn.textContent = 'Remove';
    removeBtn.addEventListener('click', () => {
      state.batchQueue = state.batchQueue.filter((entry) => entry.id !== item.id);
      renderBatchQueue();
    });

    actions.appendChild(useBtn);
    actions.appendChild(addBtn);
    actions.appendChild(removeBtn);

    li.appendChild(head);
    li.appendChild(meta);
    li.appendChild(actions);
    batchListEl.appendChild(li);
  });
}

function showMessage(message, isError = false) {
  addMessageEl.textContent = message;
  addMessageEl.style.color = isError ? '#dc2626' : '#16a34a';
  setTimeout(() => {
    if (addMessageEl.textContent === message) addMessageEl.textContent = '';
  }, 3000);
}

function currentSetMeta() {
  const title = cleanText(setTitleEl.value) || 'Imported Browser Set';
  const description = cleanText(setDescriptionEl.value) || 'Generated by Qudoro Companion extension';
  return { title, description };
}

function buildCard(front, back, options, correctIndex) {
  const isMc = options.length >= 2;
  if (!front) return null;

  if (!isMc && !back) return null;

  if (isMc && (correctIndex === null || correctIndex < 0 || correctIndex >= options.length)) {
    return null;
  }

  const answerText = isMc ? options[correctIndex] : back;

  return {
    id: uid(),
    content: front,
    rationale: back || answerText,
    answer: [answerText],
    options: isMc ? options : [],
    tags: ['extension-import'],
    domain: 'General',
    questionStyle: isMc ? 'Multiple Choice' : 'Flashcard',
    createdAt: now(),
    box: 1,
    nextReviewDate: now(),
    easeFactor: 2.5,
    repetitions: 0,
    interval: 0,
  };
}

function createCardFromInputs() {
  const front = cleanText(frontTextEl.value);
  const back = cleanText(backTextEl.value);
  const options = parseOptions(optionsTextEl.value);
  const isMc = Boolean(isMultipleChoiceEl.checked && options.length >= 2);

  const card = buildCard(front, back, isMc ? options : [], isMc ? state.selectedCorrectIndex : null);
  if (!card) {
    showMessage('Review this card: missing question, answer, or correct option.', true);
    return;
  }

  state.cards.push(card);
  persist();
  renderCards();
  showMessage('Card added.');

  frontTextEl.value = '';
  backTextEl.value = '';
  optionsTextEl.value = '';
  isMultipleChoiceEl.checked = false;
  state.selectedCorrectIndex = null;
  renderCorrectAnswerPicker();
}

function loadParsedIntoEditor(parsed) {
  frontTextEl.value = parsed.front;
  backTextEl.value = parsed.back;
  optionsTextEl.value = '';
  isMultipleChoiceEl.checked = false;
  state.selectedCorrectIndex = null;

  if (parsed.options.length >= 2) {
    optionsTextEl.value = parsed.options.join('\n');
    isMultipleChoiceEl.checked = true;
    state.selectedCorrectIndex = parsed.correctIndex;
  }

  renderCorrectAnswerPicker();
}

function addSingleBatchItem(itemId) {
  const item = state.batchQueue.find((entry) => entry.id === itemId);
  if (!item) return;

  const card = buildCard(item.parsed.front, item.parsed.back, item.parsed.options, item.parsed.correctIndex);
  if (!card) {
    loadParsedIntoEditor(item.parsed);
    showMessage('Could not auto-add this item. Review and choose the correct option.', true);
    return;
  }

  state.cards.push(card);
  state.batchQueue = state.batchQueue.filter((entry) => entry.id !== itemId);
  persist();
  renderCards();
  renderBatchQueue();
  showMessage('Batch item added.');
}

function addAllHighConfidence() {
  if (!state.batchQueue.length) {
    showMessage('Batch queue is empty.', true);
    return;
  }

  const highConfidence = state.batchQueue.filter((item) => !item.isLowConfidence);
  if (!highConfidence.length) {
    showMessage('No high-confidence items to auto-add.', true);
    return;
  }

  let added = 0;
  const remaining = [];

  state.batchQueue.forEach((item) => {
    if (item.isLowConfidence) {
      remaining.push(item);
      return;
    }

    const card = buildCard(item.parsed.front, item.parsed.back, item.parsed.options, item.parsed.correctIndex);
    if (!card) {
      remaining.push(item);
      return;
    }

    state.cards.push(card);
    added += 1;
  });

  state.batchQueue = remaining;
  persist();
  renderCards();
  renderBatchQueue();
  showMessage(`Added ${added} card(s). ${remaining.length} item(s) still need review.`);
}

function buildQudoroExport() {
  const { title, description } = currentSetMeta();
  const setId = uid();
  const questionIds = state.cards.map((c) => c.id);
  const set = {
    id: setId,
    title,
    description,
    questionIds,
    createdAt: now(),
  };
  return {
    questions: state.cards,
    sets: [set],
  };
}

function downloadExport() {
  if (state.cards.length === 0) {
    showMessage('Add at least one card before export.', true);
    return;
  }

  const payload = JSON.stringify(buildQudoroExport(), null, 2);
  const blob = new Blob([payload], { type: 'application/json' });
  const url = URL.createObjectURL(blob);

  const a = document.createElement('a');
  a.href = url;
  a.download = `qudoro-extension-export-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

async function copyExportToClipboard() {
  if (state.cards.length === 0) {
    showMessage('Add at least one card before copy.', true);
    return;
  }
  const payload = JSON.stringify(buildQudoroExport(), null, 2);
  await navigator.clipboard.writeText(payload);
  showMessage('JSON copied to clipboard.');
}

function applyParsedContent(raw, sourceLabel) {
  const parsedItems = parseBatchInput(raw);
  if (!parsedItems.length) {
    showMessage(`No usable text found from ${sourceLabel}.`, true);
    return;
  }

  if (parsedItems.length === 1) {
    loadParsedIntoEditor(parsedItems[0].parsed);
    const isLow = parsedItems[0].isLowConfidence;
    showMessage(
      `${sourceLabel} parsed${isLow ? ' (low confidence, please review).' : '.'}`,
      isLow
    );
    return;
  }

  state.batchQueue = [...state.batchQueue, ...parsedItems];
  renderBatchQueue();
  loadParsedIntoEditor(parsedItems[0].parsed);

  const lowCount = parsedItems.filter((item) => item.isLowConfidence).length;
  const msg = `${sourceLabel} parsed ${parsedItems.length} items. ${lowCount} low-confidence.`;
  showMessage(msg, lowCount > 0);
}

async function captureFromSelection() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || tab.id === undefined) {
    showMessage('No active tab found.', true);
    return;
  }

  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: () => window.getSelection()?.toString() || '',
  });

  applyParsedContent(result || '', 'Selection');
}

async function fillFromClipboard() {
  const text = await navigator.clipboard.readText();
  applyParsedContent(text, 'Clipboard');
}

function persist() {
  const payload = {
    setTitle: setTitleEl.value,
    setDescription: setDescriptionEl.value,
    cards: state.cards,
  };
  chrome.storage.local.set({ qudoroCompanion: payload });
}

function hydrate() {
  chrome.storage.local.get(['qudoroCompanion'], (res) => {
    const data = res.qudoroCompanion;
    if (!data) return;
    setTitleEl.value = data.setTitle || '';
    setDescriptionEl.value = data.setDescription || '';
    state.cards = Array.isArray(data.cards) ? data.cards : [];
    renderCards();
  });
}

setTitleEl.addEventListener('input', persist);
setDescriptionEl.addEventListener('input', persist);
optionsTextEl.addEventListener('input', () => {
  if (state.selectedCorrectIndex !== null) {
    const options = parseOptions(optionsTextEl.value);
    if (state.selectedCorrectIndex >= options.length) state.selectedCorrectIndex = null;
  }
  renderCorrectAnswerPicker();
});
isMultipleChoiceEl.addEventListener('change', renderCorrectAnswerPicker);
addCardBtn.addEventListener('click', createCardFromInputs);
addBatchBtn.addEventListener('click', addAllHighConfidence);
clearBatchBtn.addEventListener('click', () => {
  state.batchQueue = [];
  renderBatchQueue();
});
downloadBtn.addEventListener('click', downloadExport);
copyBtn.addEventListener('click', () => {
  copyExportToClipboard().catch(() => showMessage('Clipboard copy failed.', true));
});
captureSelectionBtn.addEventListener('click', () => {
  captureFromSelection().catch(() => showMessage('Selection capture failed.', true));
});
pasteClipboardBtn.addEventListener('click', () => {
  fillFromClipboard().catch(() => showMessage('Clipboard read failed. Allow clipboard permission and try again.', true));
});

hydrate();
renderCards();
renderBatchQueue();
renderCorrectAnswerPicker();
