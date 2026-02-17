const state = {
  cards: [],
  batchQueue: [],
  selectedCorrectIndex: null,
};

const OPENAI_RESPONSES_URL = 'https://api.openai.com/v1/responses';

const setTitleEl = document.getElementById('setTitle');
const setDescriptionEl = document.getElementById('setDescription');
const noteInputEl = document.getElementById('noteInput');
const frontTextEl = document.getElementById('frontText');
const backTextEl = document.getElementById('backText');
const forceAddDuplicatesEl = document.getElementById('forceAddDuplicates');
const addMessageEl = document.getElementById('addMessage');
const cardCountEl = document.getElementById('cardCount');
const cardsListEl = document.getElementById('cardsList');
const batchCountEl = document.getElementById('batchCount');
const batchListEl = document.getElementById('batchList');
const openAiKeyEl = document.getElementById('openAiKey');
const ocrImageInputEl = document.getElementById('ocrImageInput');

const optionEls = [
  document.getElementById('optionA'),
  document.getElementById('optionB'),
  document.getElementById('optionC'),
  document.getElementById('optionD'),
];

const markButtons = Array.from(document.querySelectorAll('.mark-btn'));

const addCardBtn = document.getElementById('addCardBtn');
const parseNoteBtn = document.getElementById('parseNoteBtn');
const downloadBtn = document.getElementById('downloadBtn');
const copyBtn = document.getElementById('copyBtn');
const captureSelectionBtn = document.getElementById('captureSelectionBtn');
const pasteClipboardBtn = document.getElementById('pasteClipboardBtn');
const addBatchBtn = document.getElementById('addBatchBtn');
const clearBatchBtn = document.getElementById('clearBatchBtn');
const ocrImageBtn = document.getElementById('ocrImageBtn');
const saveKeyBtn = document.getElementById('saveKeyBtn');

const now = () => Date.now();
const uid = () => (crypto && crypto.randomUUID ? crypto.randomUUID() : `q_${now()}_${Math.random().toString(16).slice(2)}`);

function cleanText(value) {
  return (value || '').replace(/\r\n/g, '\n').trim();
}

function normalizeQuestion(value) {
  return cleanText(value).toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

function buildBigrams(value) {
  if (!value) return [];
  if (value.length < 2) return [value];
  const grams = [];
  for (let i = 0; i < value.length - 1; i += 1) grams.push(value.slice(i, i + 2));
  return grams;
}

function diceCoefficient(a, b) {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const aBigrams = buildBigrams(a);
  const bBigrams = buildBigrams(b);
  const counts = new Map();
  aBigrams.forEach((gram) => counts.set(gram, (counts.get(gram) || 0) + 1));
  let overlap = 0;
  bBigrams.forEach((gram) => {
    const count = counts.get(gram) || 0;
    if (count > 0) {
      overlap += 1;
      counts.set(gram, count - 1);
    }
  });
  return (2 * overlap) / (aBigrams.length + bBigrams.length);
}

function findDuplicateCard(front) {
  const normalized = normalizeQuestion(front);
  if (!normalized) return null;
  for (const card of state.cards) {
    const cardNorm = normalizeQuestion(card.content);
    if (!cardNorm) continue;
    if (cardNorm === normalized) return card;
    const lengthDiff = Math.abs(cardNorm.length - normalized.length);
    const allowedDiff = Math.max(8, Math.round(normalized.length * 0.25));
    if (lengthDiff <= allowedDiff && diceCoefficient(cardNorm, normalized) >= 0.9) return card;
  }
  return null;
}

function getEditorOptions() {
  return optionEls.map((el) => cleanText(el.value)).filter(Boolean);
}

function setEditorOptions(options) {
  optionEls.forEach((el, idx) => {
    el.value = options[idx] || '';
  });
}

function updateCorrectButtons() {
  markButtons.forEach((btn) => {
    const idx = Number(btn.dataset.index);
    const active = idx === state.selectedCorrectIndex;
    btn.classList.toggle('active', active);
    btn.textContent = active ? '✓ Correct' : 'Mark correct';
  });
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
  const lines = cleanText(raw).split('\n').map((line) => line.trim()).filter(Boolean);
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

  const lines = text.split('\n').map((line) => line.trim()).filter(Boolean);
  const optionPattern = /^(?:[-*•]\s*)?(?:\(?[A-Za-z]\)|[A-Za-z][).]|\d{1,2}[).])\s+(.+)$/;
  const optionStartIndex = lines.findIndex((line) => optionPattern.test(line));

  if (optionStartIndex === -1) {
    if (lines.length === 1) return { front: lines[0], back: '', options: [], correctIndex: null };
    return { front: lines[0], back: lines.slice(1).join('\n'), options: [], correctIndex: null };
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

  const options = optionLines.map((line) => line.replace(optionPattern, '$1').trim()).filter(Boolean);
  const trailingText = trailingLines.join('\n');
  const directAnswer = detectAnswerFromRaw(trailingText, options);
  const fallbackAnswer = directAnswer !== null ? directAnswer : detectAnswerFromRaw(text, options);
  const backMatch = trailingText.match(/(?:^|\n)\s*(?:answer|ans|correct)\s*[:\-]?\s*(.+)$/i);
  const frontText = frontLines.join(' ').replace(/^(?:q(?:uestion)?\s*[:.)\-]\s*)/i, '').trim();

  return {
    front: frontText || lines[0],
    back: backMatch ? cleanText(backMatch[1]) : '',
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
  const seen = new Set();
  return blocks
    .map((block) => {
      const parsed = parseQuestionBlock(block);
      const confidence = scoreConfidence(parsed);
      const signature = normalizeQuestion(parsed.front || block);
      return { id: uid(), parsed, confidence, isLowConfidence: confidence < 0.55, signature };
    })
    .filter((item) => item.parsed.front || item.parsed.options.length || item.parsed.back)
    .filter((item) => {
      if (!item.signature) return true;
      if (seen.has(item.signature)) return false;
      seen.add(item.signature);
      return true;
    });
}

function showMessage(message, isError = false) {
  addMessageEl.textContent = message;
  addMessageEl.style.color = isError ? '#dc2626' : '#16a34a';
  setTimeout(() => {
    if (addMessageEl.textContent === message) addMessageEl.textContent = '';
  }, 2800);
}

function buildCard(front, back, options, correctIndex) {
  const isMc = options.length >= 2;
  if (!front) return null;
  if (!isMc && !back) return null;
  if (isMc && (correctIndex === null || correctIndex < 0 || correctIndex >= options.length)) return null;
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

function clearEditor() {
  frontTextEl.value = '';
  backTextEl.value = '';
  setEditorOptions([]);
  state.selectedCorrectIndex = null;
  updateCorrectButtons();
}

function loadParsedIntoEditor(parsed) {
  frontTextEl.value = parsed.front;
  backTextEl.value = parsed.back;
  setEditorOptions(parsed.options.slice(0, 4));
  state.selectedCorrectIndex = parsed.correctIndex !== null && parsed.correctIndex < 4 ? parsed.correctIndex : null;
  updateCorrectButtons();
}

function renderCards() {
  cardsListEl.innerHTML = '';
  cardCountEl.textContent = String(state.cards.length);

  state.cards.forEach((card, idx) => {
    const li = document.createElement('li');
    const top = document.createElement('div');
    top.className = 'card-item-top';

    const title = document.createElement('span');
    title.textContent = `${idx + 1}. ${card.content}`;

    const actions = document.createElement('div');
    actions.className = 'small-actions';

    const removeBtn = document.createElement('button');
    removeBtn.className = 'ghost';
    removeBtn.textContent = 'Remove';
    removeBtn.addEventListener('click', () => {
      state.cards.splice(idx, 1);
      persist();
      renderCards();
      renderBatchQueue();
    });

    actions.appendChild(removeBtn);
    top.appendChild(title);
    top.appendChild(actions);
    li.appendChild(top);
    cardsListEl.appendChild(li);
  });
}

function addSingleBatchItem(itemId) {
  const item = state.batchQueue.find((entry) => entry.id === itemId);
  if (!item) return;

  const duplicateCard = !forceAddDuplicatesEl.checked ? findDuplicateCard(item.parsed.front) : null;
  if (duplicateCard) {
    showMessage('Duplicate blocked: batch question already exists.', true);
    state.batchQueue = state.batchQueue.filter((entry) => entry.id !== itemId);
    renderBatchQueue();
    return;
  }

  const card = buildCard(item.parsed.front, item.parsed.back, item.parsed.options, item.parsed.correctIndex);
  if (!card) {
    loadParsedIntoEditor(item.parsed);
    showMessage('Review this item and mark correct answer.', true);
    return;
  }

  state.cards.push(card);
  state.batchQueue = state.batchQueue.filter((entry) => entry.id !== itemId);
  persist();
  renderCards();
  renderBatchQueue();
  showMessage('Batch item added.');
}

function renderBatchQueue() {
  batchListEl.innerHTML = '';
  batchCountEl.textContent = String(state.batchQueue.length);

  state.batchQueue.forEach((item, index) => {
    const duplicateCard = findDuplicateCard(item.parsed.front);
    const li = document.createElement('li');
    const top = document.createElement('div');
    top.className = 'batch-item-top';

    const title = document.createElement('span');
    title.textContent = `${index + 1}. ${item.parsed.front || '(Missing question)'}`;

    const badge = document.createElement('span');
    badge.className = `badge ${(item.isLowConfidence || duplicateCard) ? 'badge-low' : 'badge-high'}`;
    badge.textContent = duplicateCard ? 'Duplicate' : (item.isLowConfidence ? 'Low' : 'High');

    top.appendChild(title);
    top.appendChild(badge);

    const actions = document.createElement('div');
    actions.className = 'small-actions';

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

    li.appendChild(top);
    li.appendChild(actions);
    batchListEl.appendChild(li);
  });
}

function createCardFromInputs() {
  const front = cleanText(frontTextEl.value);
  const back = cleanText(backTextEl.value);
  const options = getEditorOptions();

  const duplicateCard = !forceAddDuplicatesEl.checked ? findDuplicateCard(front) : null;
  if (duplicateCard) {
    showMessage('Duplicate blocked: this question already exists.', true);
    return;
  }

  const card = buildCard(front, back, options, options.length >= 2 ? state.selectedCorrectIndex : null);
  if (!card) {
    showMessage('Missing question, answer, or correct option.', true);
    return;
  }

  state.cards.push(card);
  persist();
  renderCards();
  renderBatchQueue();
  clearEditor();
  showMessage('Added to snapshot list.');
}

function addAllHighConfidence() {
  if (!state.batchQueue.length) {
    showMessage('Batch queue is empty.', true);
    return;
  }

  let added = 0;
  let skippedDuplicates = 0;
  const remaining = [];

  state.batchQueue.forEach((item) => {
    if (item.isLowConfidence) {
      remaining.push(item);
      return;
    }

    if (!forceAddDuplicatesEl.checked && findDuplicateCard(item.parsed.front)) {
      skippedDuplicates += 1;
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
  showMessage(`Added ${added}, skipped ${skippedDuplicates}, ${remaining.length} need review.`);
}

function applyParsedContent(raw, sourceLabel) {
  const parsedItems = parseBatchInput(raw);
  if (!parsedItems.length) {
    showMessage(`No usable text found from ${sourceLabel}.`, true);
    return;
  }

  if (parsedItems.length === 1) {
    loadParsedIntoEditor(parsedItems[0].parsed);
    showMessage(`${sourceLabel} parsed.`);
    return;
  }

  state.batchQueue = [...state.batchQueue, ...parsedItems];
  renderBatchQueue();
  loadParsedIntoEditor(parsedItems[0].parsed);
  const lowCount = parsedItems.filter((item) => item.isLowConfidence).length;
  showMessage(`${sourceLabel}: ${parsedItems.length} items parsed (${lowCount} low confidence).`, lowCount > 0);
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
  const text = cleanText(result || '');
  noteInputEl.value = text;
  applyParsedContent(text, 'Selection');
}

async function fillFromClipboard() {
  const text = cleanText(await navigator.clipboard.readText());
  noteInputEl.value = text;
  applyParsedContent(text, 'Clipboard');
}

function currentSetMeta() {
  return {
    title: cleanText(setTitleEl.value) || 'Imported Browser Set',
    description: cleanText(setDescriptionEl.value) || 'Generated by Qudoro Companion extension',
  };
}

function buildQudoroExport() {
  const { title, description } = currentSetMeta();
  const setId = uid();
  return {
    questions: state.cards,
    sets: [
      {
        id: setId,
        title,
        description,
        questionIds: state.cards.map((c) => c.id),
        createdAt: now(),
      },
    ],
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
  await navigator.clipboard.writeText(JSON.stringify(buildQudoroExport(), null, 2));
  showMessage('JSON copied to clipboard.');
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('Could not read image file.'));
    reader.readAsDataURL(file);
  });
}

function extractOcrText(responseBody) {
  if (typeof responseBody.output_text === 'string' && cleanText(responseBody.output_text)) {
    return cleanText(responseBody.output_text);
  }
  const outputs = Array.isArray(responseBody.output) ? responseBody.output : [];
  const textParts = [];
  outputs.forEach((out) => {
    const content = Array.isArray(out.content) ? out.content : [];
    content.forEach((entry) => {
      if (typeof entry.text === 'string') textParts.push(entry.text);
    });
  });
  return cleanText(textParts.join('\n'));
}

async function runOcrFromImage(file) {
  const apiKey = cleanText(openAiKeyEl.value);
  if (!apiKey) {
    showMessage('Add your OpenAI API key first.', true);
    return;
  }
  if (!file) {
    showMessage('Choose an image first.', true);
    return;
  }

  const imageDataUrl = await fileToDataUrl(file);
  showMessage('Running OCR on image...');

  const response = await fetch(OPENAI_RESPONSES_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'gpt-4.1-mini',
      input: [
        {
          role: 'user',
          content: [
            { type: 'input_text', text: 'Extract only quiz/study text with line breaks and no explanation.' },
            { type: 'input_image', image_url: imageDataUrl },
          ],
        },
      ],
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`OCR request failed (${response.status}): ${errText.slice(0, 180)}`);
  }

  const data = await response.json();
  const extracted = extractOcrText(data);
  if (!extracted) throw new Error('OCR returned no text. Try a clearer image.');

  noteInputEl.value = extracted;
  applyParsedContent(extracted, 'OCR image');
}

function persist() {
  chrome.storage.local.set({
    qudoroCompanion: {
      setTitle: setTitleEl.value,
      setDescription: setDescriptionEl.value,
      cards: state.cards,
      openAiKey: openAiKeyEl.value,
      forceAddDuplicates: Boolean(forceAddDuplicatesEl.checked),
    },
  });
}

function hydrate() {
  chrome.storage.local.get(['qudoroCompanion'], (res) => {
    const data = res.qudoroCompanion;
    if (!data) return;
    setTitleEl.value = data.setTitle || '';
    setDescriptionEl.value = data.setDescription || '';
    openAiKeyEl.value = data.openAiKey || '';
    forceAddDuplicatesEl.checked = Boolean(data.forceAddDuplicates);
    state.cards = Array.isArray(data.cards) ? data.cards : [];
    renderCards();
    renderBatchQueue();
  });
}

setTitleEl.addEventListener('input', persist);
setDescriptionEl.addEventListener('input', persist);
openAiKeyEl.addEventListener('change', persist);
forceAddDuplicatesEl.addEventListener('change', persist);

markButtons.forEach((btn) => {
  btn.addEventListener('click', () => {
    const idx = Number(btn.dataset.index);
    const optionValue = cleanText(optionEls[idx].value);
    if (!optionValue) {
      showMessage('Type this option first, then mark it correct.', true);
      return;
    }
    state.selectedCorrectIndex = idx;
    updateCorrectButtons();
  });
});

optionEls.forEach((el, idx) => {
  el.addEventListener('input', () => {
    if (state.selectedCorrectIndex === idx && !cleanText(el.value)) {
      state.selectedCorrectIndex = null;
      updateCorrectButtons();
    }
  });
});

addCardBtn.addEventListener('click', createCardFromInputs);
parseNoteBtn.addEventListener('click', () => {
  const noteText = cleanText(noteInputEl.value);
  if (!noteText) {
    showMessage('Paste notes text first.', true);
    return;
  }
  applyParsedContent(noteText, 'Notes');
});
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
  fillFromClipboard().catch(() => showMessage('Clipboard read failed.', true));
});
ocrImageBtn.addEventListener('click', () => {
  ocrImageInputEl.value = '';
  ocrImageInputEl.click();
});
ocrImageInputEl.addEventListener('change', () => {
  const file = ocrImageInputEl.files && ocrImageInputEl.files[0];
  runOcrFromImage(file).catch((err) => showMessage(err.message || 'OCR import failed.', true));
});
saveKeyBtn.addEventListener('click', () => {
  persist();
  showMessage('API key saved locally in this extension.');
});

hydrate();
renderCards();
renderBatchQueue();
updateCorrectButtons();
