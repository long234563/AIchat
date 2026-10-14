const $ = (id) => document.getElementById(id);
const app = $('app');
const chatList = $('chatList');
const messagesEl = $('messages');
const conversationEl = $('conversation');
const welcomeEl = $('welcome');
const inputEl = $('messageInput');
const webToggle = $('webToggle');
const sendBtn = $('sendBtn');
const sendIcon = $('sendIcon');

const STORE_KEY = 'longdragon-ai-chats-v1';
const THEME_KEY = 'longdragon-ai-theme';
let chats = readChats();
let activeId = chats[0]?.id || null;
let isBusy = false;
let pendingController = null;
let toastTimeout;

function readChats() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORE_KEY) || '[]');
    if (!Array.isArray(saved)) return [];
    return saved.filter(c => c && typeof c.id === 'string' && Array.isArray(c.messages)).slice(0, 25);
  } catch { return []; }
}
function saveChats() {
  try {
    const trimmed = chats.slice(0, 25).map(c => ({
      ...c, messages: c.messages.slice(-60)
    }));
    localStorage.setItem(STORE_KEY, JSON.stringify(trimmed));
  } catch {
    toast('Bộ nhớ trình duyệt đã đầy hoặc bị khóa. Không thể lưu lịch sử.');
  }
}
function newId() {
  return (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function')
    ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(36).slice(2);
}
function activeChat() { return chats.find(c => c.id === activeId); }
function setTheme(theme) {
  const isLight = theme === 'light';
  document.body.classList.toggle('light', isLight);
  $('themeIcon').textContent = isLight ? '☾' : '☼';
  $('themeLabel').textContent = isLight ? 'Giao diện tối' : 'Giao diện sáng';
  try { localStorage.setItem(THEME_KEY, theme); } catch { /* private mode */ }
}
try { setTheme(localStorage.getItem(THEME_KEY) || 'dark'); } catch { setTheme('dark'); }

function toast(text) {
  const el = $('toast');
  el.textContent = text;
  el.classList.add('show');
  clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => el.classList.remove('show'), 3300);
}
function closeSidebar() { app.classList.remove('sidebar-open'); }
$('menuBtn').addEventListener('click', () => app.classList.add('sidebar-open'));
$('closeSidebar').addEventListener('click', closeSidebar);
$('mobileOverlay').addEventListener('click', closeSidebar);
$('themeBtn').addEventListener('click', () => setTheme(document.body.classList.contains('light') ? 'dark' : 'light'));
$('newChat').addEventListener('click', createChat);

document.addEventListener('keydown', (e) => {
  if (e.altKey && e.key.toLowerCase() === 'n') { e.preventDefault(); createChat(); }
});
function createChat() {
  if (isBusy) { toast('Hãy dừng hoặc chờ câu trả lời hiện tại trước khi tạo chat mới.'); return; }
  activeId = null;
  inputEl.value = '';
  resizeInput();
  renderConversation();
  renderChatList();
  closeSidebar();
  inputEl.focus();
}
function openChat(id) {
  if (isBusy) { toast('Hãy dừng hoặc chờ câu trả lời trước khi chuyển hội thoại.'); return; }
  activeId = id;
  renderChatList();
  renderConversation();
  closeSidebar();
}
function renderChatList() {
  chatList.replaceChildren();
  if (!chats.length) {
    const p = document.createElement('p');
    p.className = 'empty-history';
    p.textContent = 'Chưa có cuộc trò chuyện nào. Hãy bắt đầu bằng một câu hỏi!';
    chatList.append(p);
    return;
  }
  for (const chat of chats) {
    const row = document.createElement('div');
    row.className = 'history-row' + (chat.id === activeId ? ' active' : '');
    const select = document.createElement('button');
    select.className = 'history-main';
    select.type = 'button';
    const icon = document.createElement('span');
    icon.className = 'chat-icon';
    icon.textContent = '▤';
    const title = document.createElement('span');
    title.className = 'history-name';
    title.textContent = chat.title || 'Cuộc trò chuyện mới';
    select.append(icon, title);
    select.title = chat.title;
    select.addEventListener('click', () => openChat(chat.id));
    const del = document.createElement('button');
    del.className = 'delete-chat';
    del.type = 'button';
    del.textContent = '×';
    del.title = 'Xóa hội thoại';
    del.setAttribute('aria-label', `Xóa hội thoại ${chat.title || ''}`);
    del.addEventListener('click', () => {
      if (isBusy) { toast('Không thể xóa hội thoại khi đang trả lời.'); return; }
      chats = chats.filter(c => c.id !== chat.id);
      if (activeId === chat.id) activeId = chats[0]?.id || null;
      saveChats();
      renderChatList();
      renderConversation();
    });
    row.append(select, del);
    chatList.append(row);
  }
}
function scrollToBottom() { conversationEl.scrollTop = conversationEl.scrollHeight; }
function renderConversation() {
  const chat = activeChat();
  messagesEl.replaceChildren();
  welcomeEl.hidden = Boolean(chat?.messages.length);
  $('currentTitle').textContent = chat?.title || 'Cuộc trò chuyện mới';
  if (!chat) return;
  for (const m of chat.messages) appendMessage(m);
  requestAnimationFrame(scrollToBottom);
}

function validHttpUrl(value) {
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) ? url.href : null;
  } catch { return null; }
}

// Hỗ trợ đánh dấu trích dẫn nội dòng (khi nhà cung cấp trả về vị trí nguồn).
function injectCitationTags(raw, citations) {
  const items = (citations || []).filter(a => validHttpUrl(a.url)
    && Number.isInteger(a.end_index) && a.end_index >= 0 && a.end_index <= raw.length)
    .map((a, i) => ({ ...a, n: i + 1 }))
    .sort((a, b) => b.end_index - a.end_index);
  let annotated = raw;
  for (const a of items) {
    const tag = `CITETAG${a.n}END`;
    const start = a.start_index;
    const piece = Number.isInteger(start) && start >= 0 && start < a.end_index
      ? annotated.slice(start, a.end_index) : '';
    if (piece.length < 100 && /^[【\[][^\n]*[】\]]$/.test(piece)) {
      annotated = annotated.slice(0, start) + tag + annotated.slice(a.end_index);
    } else {
      annotated = annotated.slice(0, a.end_index) + tag + annotated.slice(a.end_index);
    }
  }
  return { annotated, refs: items };
}
function replaceCitationTags(root, citations) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const targets = [];
  while (walker.nextNode()) if (/CITETAG\d+END/.test(walker.currentNode.textContent)) targets.push(walker.currentNode);
  for (const textNode of targets) {
    const text = textNode.textContent;
    const fragment = document.createDocumentFragment();
    const matcher = /CITETAG(\d+)END/g;
    let cursor = 0, match;
    while ((match = matcher.exec(text))) {
      fragment.append(document.createTextNode(text.slice(cursor, match.index)));
      const citation = citations.find(a => a.n === Number(match[1]));
      if (citation) {
        const anchor = document.createElement('a');
        anchor.href = validHttpUrl(citation.url);
        anchor.target = '_blank';
        anchor.rel = 'noopener noreferrer';
        anchor.className = 'cite-link';
        anchor.textContent = `[${citation.n}]`;
        anchor.title = citation.title || 'Mở nguồn tham khảo';
        fragment.append(anchor);
      }
      cursor = matcher.lastIndex;
    }
    fragment.append(document.createTextNode(text.slice(cursor)));
    textNode.replaceWith(fragment);
  }
}
function renderFormattedAnswer(target, message) {
  const raw = message.text || '';
  const { annotated, refs } = injectCitationTags(raw, message.citations || []);
  if (window.marked && window.DOMPurify) {
    // DOMPurify loại bỏ HTML độc hại do nội dung AI cung cấp.
    const html = window.DOMPurify.sanitize(window.marked.parse(annotated), { USE_PROFILES: { html: true } });
    target.innerHTML = html;
    replaceCitationTags(target, refs);
    target.querySelectorAll('a[href]').forEach(a => {
      const url = validHttpUrl(a.getAttribute('href'));
      if (!url) a.removeAttribute('href');
      else { a.href = url; a.target = '_blank'; a.rel = 'noopener noreferrer'; }
    });
  } else {
    target.textContent = raw; // Vẫn hiển thị an toàn khi chưa tải được thư viện Markdown.
  }
}
function appendMessage(message) {
  const row = document.createElement('article');
  row.className = 'message ' + (message.role === 'user' ? 'user' : 'assistant');
  if (message.role === 'assistant') {
    const avatar = document.createElement('div');
    avatar.className = 'message-avatar';
    avatar.textContent = '✦';
    avatar.setAttribute('aria-hidden', 'true');
    row.append(avatar);
  }
  const content = document.createElement('div');
  content.className = 'message-content';
  if (message.role === 'user') {
    content.textContent = message.text;
  } else {
    const label = document.createElement('div');
    label.className = 'message-label';
    label.textContent = 'long AI';
    const body = document.createElement('div');
    body.className = 'message-text';
    renderFormattedAnswer(body, message);
    content.append(label, body);
    if (message.error) {
      const err = document.createElement('p');
      err.className = 'error-text';
      err.textContent = '⚠ ' + message.error;
      content.append(err);
    }
    const sources = (message.sources || []).filter(s => validHttpUrl(s.url));
    if (sources.length) {
      const sourceGroup = document.createElement('div');
      sourceGroup.className = 'sources';
      const heading = document.createElement('strong');
      heading.textContent = '↗ Nguồn tham khảo';
      const chips = document.createElement('div');
      chips.className = 'source-chips';
      sources.slice(0, 8).forEach((s, i) => {
        const a = document.createElement('a');
        a.href = validHttpUrl(s.url);
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
        a.className = 'source-chip';
        const label = document.createElement('span');
        label.textContent = `${i + 1}. ${s.title || new URL(s.url).hostname}`;
        a.append(label);
        chips.append(a);
      });
      sourceGroup.append(heading, chips);
      content.append(sourceGroup);
    }
    if (message.searchSuggestions) {
      const searchBox = document.createElement('div');
      searchBox.className = 'search-suggestions';
      const iframe = document.createElement('iframe');
      iframe.title = 'Đề xuất tìm kiếm Google';
      iframe.setAttribute('sandbox', 'allow-popups allow-popups-to-escape-sandbox');
      iframe.referrerPolicy = 'no-referrer';
      iframe.loading = 'lazy';
      // Nội dung HTML từ Google được cách ly trong iframe sandbox, không được chạy script.
      iframe.srcdoc = message.searchSuggestions;
      searchBox.append(iframe);
      content.append(searchBox);
    }
    if (message.text) {
      const tools = document.createElement('div');
      tools.className = 'answer-tools';
      const copy = document.createElement('button');
      copy.className = 'answer-tool';
      copy.type = 'button';
      copy.textContent = '▢  Sao chép câu trả lời';
      copy.addEventListener('click', async () => {
        try { await navigator.clipboard.writeText(message.text); toast('Đã sao chép câu trả lời'); }
        catch { toast('Không thể sao chép tự động.'); }
      });
      tools.append(copy);
      content.append(tools);
    }
  }
  row.append(content);
  messagesEl.append(row);
  return row;
}
function resizeInput() {
  inputEl.style.height = 'auto';
  inputEl.style.height = Math.min(inputEl.scrollHeight, 160) + 'px';
  $('charCount').textContent = inputEl.value.length > 4000 ? `${inputEl.value.length}/6000` : '';
}
inputEl.addEventListener('input', resizeInput);
inputEl.addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
    e.preventDefault();
    if (!isBusy) $('chatForm').requestSubmit();
  }
});
$('chatForm').addEventListener('submit', e => {
  e.preventDefault();
  if (isBusy) { pendingController?.abort(); return; }
  sendQuestion(inputEl.value);
});
for (const prompt of document.querySelectorAll('[data-prompt]')) {
  prompt.addEventListener('click', () => {
    if (isBusy) return;
    if (prompt.dataset.prompt.startsWith('Tìm trên web')) webToggle.checked = true;
    sendQuestion(prompt.dataset.prompt);
  });
}
function setBusy(value) {
  isBusy = value;
  inputEl.disabled = value;
  sendIcon.textContent = value ? '■' : '↑';
  sendBtn.title = value ? 'Dừng trả lời' : 'Gửi câu hỏi';
  sendBtn.setAttribute('aria-label', value ? 'Dừng trả lời' : 'Gửi câu hỏi');
}
async function sendQuestion(raw) {
  const question = (raw || '').trim();
  if (!question || isBusy) return;
  if (question.length > 6000) { toast('Câu hỏi dài tối đa 6000 ký tự.'); return; }
  let chat = activeChat();
  if (!chat) {
    chat = { id: newId(), title: question.slice(0, 48), messages: [], createdAt: Date.now() };
    chats.unshift(chat);
    activeId = chat.id;
  }
  // Lịch sử lượt trước được gửi qua API để duy trì ngữ cảnh hội thoại.
  const history = chat.messages.filter(m => !m.error && m.text && ['user', 'assistant'].includes(m.role))
    .slice(-16).map(m => ({ role: m.role, text: m.text }));
  chat.messages.push({ role: 'user', text: question });
  inputEl.value = '';
  resizeInput();
  renderChatList();
  renderConversation();
  saveChats();

  const answer = { role: 'assistant', text: '', sources: [], citations: [] };
  chat.messages.push(answer);
  welcomeEl.hidden = true;
  const row = appendMessage(answer);
  const container = row.querySelector('.message-content');
  const body = row.querySelector('.message-text');
  body.classList.add('stream');
  body.innerHTML = '<span class="dots"><span></span><span></span><span></span></span>';
  const status = document.createElement('p');
  status.className = 'status-line';
  status.textContent = webToggle.checked ? 'Đang tìm kiếm trên web…' : 'Đang suy nghĩ...';
  container.append(status);
  const controller = new AbortController();
  pendingController = controller;
  setBusy(true);
  scrollToBottom();
  let completed = false;
  try {
    const response = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: question, history, searchWeb: webToggle.checked }),
      signal: controller.signal
    });
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      throw new Error(payload.error || `Máy chủ phản hồi lỗi HTTP ${response.status}`);
    }
    if (!response.body) throw new Error('Trình duyệt không hỗ trợ nhận dữ liệu streaming.');
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    const handle = (evt) => {
      if (evt.type === 'delta') {
        answer.text += evt.text || '';
        body.textContent = answer.text;
        status.textContent = '';
        scrollToBottom();
      } else if (evt.type === 'status') {
        status.textContent = evt.text || '';
      } else if (evt.type === 'error') {
        throw new Error(evt.error || 'API báo lỗi không xác định.');
      } else if (evt.type === 'done') {
        completed = true;
        answer.sources = evt.sources || [];
        answer.citations = evt.citations || [];
        answer.searchSuggestions = evt.searchSuggestions || ''; 
      }
    };
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let breakAt;
      while ((breakAt = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, breakAt);
        buffer = buffer.slice(breakAt + 1);
        if (line.trim()) handle(JSON.parse(line));
      }
    }
    buffer += decoder.decode();
    if (buffer.trim()) handle(JSON.parse(buffer));
    if (!completed) throw new Error('Kết nối bị gián đoạn trước khi AI trả lời xong.');
  } catch (error) {
    answer.error = error.name === 'AbortError' ? 'Đã dừng tạo câu trả lời.' : error.message || 'Không thể kết nối đến API.';
    if (error.name !== 'AbortError') toast(answer.error);
  } finally {
    status.remove();
    body.classList.remove('stream');
    renderFormattedAnswer(body, answer);
    if (!answer.text && !answer.error) answer.error = 'Không có nội dung được trả về.';
    if (answer.error) {
      const err = document.createElement('p');
      err.className = 'error-text';
      err.textContent = '⚠ ' + answer.error;
      container.append(err);
    }
    if (answer.sources.length || answer.text) {
      // Sử dụng cùng logic tạo nút sao chép và nguồn tham khảo.
      row.remove();
      appendMessage(answer);
    }
    saveChats();
    setBusy(false);
    pendingController = null;
    scrollToBottom();
    inputEl.focus();
  }
}
async function checkHealth() {
  const status = $('connection');
  const label = $('connectionText');
  try {
    const r = await fetch('/api/health');
    if (!r.ok) throw new Error('Server chưa sẵn sàng');
    const data = await r.json();
    status.classList.add(data.configured ? 'ready' : 'error');
    label.textContent = data.configured ? 'API sẵn sàng' : 'Chưa cấu hình API';
    if (!data.configured) toast('Chưa cấu hình khóa API. Mở file .env, điền API key rồi khởi động lại.');
  } catch {
    status.classList.add('error');
    label.textContent = 'Không kết nối server';
  }
}
renderChatList();
renderConversation();
resizeInput();
checkHealth();
