const state = {
  cards: [],
  selectedCorrectIndex: null,
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

const addCardBtn = document.getElementById('addCardBtn');
const downloadBtn = document.getElementById('downloadBtn');
const copyBtn = document.getElementById('copyBtn');
const captureSelectionBtn = document.getElementById('captureSelectionBtn');
const pasteClipboardBtn = document.getElementById('pasteClipboardBtn');

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

function showMessage(message, isError = false) {
  addMessageEl.textContent = message;
  addMessageEl.style.color = isError ? '#dc2626' : '#16a34a';
  setTimeout(() => {
    if (addMessageEl.textContent === message) addMessageEl.textContent = '';
  }, 2500);
}

function currentSetMeta() {
  const title = cleanText(setTitleEl.value) || 'Imported Browser Set';
  const description = cleanText(setDescriptionEl.value) || 'Generated by Qudoro Companion extension';
  return { title, description };
}

function createCardFromInputs() {
  const front = cleanText(frontTextEl.value);
  const back = cleanText(backTextEl.value);
  const options = parseOptions(optionsTextEl.value);
  const isMc = Boolean(isMultipleChoiceEl.checked && options.length >= 2);

  if (!front) {
    showMessage('Question/front is required.', true);
    return;
  }

  if (!isMc && !back) {
    showMessage('Back/answer is required for non-multiple-choice cards.', true);
    return;
  }

  let answerText = back;
  if (isMc) {
    if (state.selectedCorrectIndex === null || state.selectedCorrectIndex >= options.length) {
      showMessage('Choose the correct option before adding this card.', true);
      return;
    }
    answerText = options[state.selectedCorrectIndex];
  }

  const card = {
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
  const parsed = parseQuestionBlock(raw);
  if (!parsed.front && parsed.options.length === 0 && !parsed.back) {
    showMessage(`No usable text found from ${sourceLabel}.`, true);
    return;
  }

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
  showMessage(`${sourceLabel} parsed.`);
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
renderCorrectAnswerPicker();
