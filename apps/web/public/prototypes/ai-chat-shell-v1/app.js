const shell = document.querySelector('.ai-shell');
const historyList = document.querySelector('#historyList');
const historySearch = document.querySelector('#historySearch');
const messages = document.querySelector('#messages');
const startState = document.querySelector('#startState');
const composer = document.querySelector('#composer');
const promptInput = document.querySelector('#promptInput');
const sendButton = document.querySelector('#sendButton');
const chatScroll = document.querySelector('#chatScroll');

const chats = [
  {
    id: 'electronics',
    title: 'Почему светодиоду нужен резистор',
    messages: [
      { role: 'user', text: 'Почему светодиоду нужен резистор?' },
      {
        role: 'assistant',
        text: 'Резистор ограничивает ток через светодиод. В рабочей версии здесь будет ответ реальной модели с учётом проекта ученика.',
      },
    ],
  },
  {
    id: 'arduino',
    title: 'Идея проекта на Arduino',
    messages: [
      { role: 'user', text: 'Помоги придумать проект на Arduino для школы.' },
      {
        role: 'assistant',
        text: 'Можно начать с школьной мини-метеостанции: температура, влажность, экран и запись измерений. Сейчас это демонстрационный ответ интерфейса.',
      },
    ],
  },
  {
    id: 'programming',
    title: 'Как работает цикл for',
    messages: [],
  },
];

let currentChatId = null;

function isMobile() {
  return window.matchMedia('(max-width: 900px)').matches;
}

function setSidebar(open) {
  shell.dataset.sidebarOpen = String(open);
}

function escapeHtml(value) {
  return value.replace(/[&<>"']/g, (char) => {
    const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' };
    return map[char];
  });
}

function currentChat() {
  return chats.find((chat) => chat.id === currentChatId) ?? null;
}

function renderHistory() {
  const query = historySearch.value.trim().toLocaleLowerCase('ru-RU');
  const visible = chats.filter((chat) => chat.title.toLocaleLowerCase('ru-RU').includes(query));
  historyList.innerHTML = '';

  if (visible.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty-history';
    empty.textContent = 'Ничего не найдено';
    historyList.append(empty);
    return;
  }

  visible.forEach((chat) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'history-item';
    if (chat.id === currentChatId) button.classList.add('active');
    button.textContent = chat.title;
    button.addEventListener('click', () => {
      currentChatId = chat.id;
      renderHistory();
      renderMessages();
      if (isMobile()) setSidebar(false);
    });
    historyList.append(button);
  });
}

function renderMessages() {
  const chat = currentChat();
  const list = chat?.messages ?? [];
  startState.hidden = list.length > 0;
  messages.innerHTML = list
    .map((message) => {
      const body = escapeHtml(message.text);
      if (message.role === 'user') {
        return '<article class="message user"><div class="bubble">' + body + '</div></article>';
      }
      return (
        '<article class="message assistant">' +
        '<div class="assistant-mark" aria-hidden="true">A</div>' +
        '<div class="bubble"><span class="demo-label">Демо-ответ</span>' +
        body +
        '</div></article>'
      );
    })
    .join('');

  requestAnimationFrame(() => {
    chatScroll.scrollTop = chatScroll.scrollHeight;
  });
}

function createChat(initialText = '') {
  const id = 'chat-' + Date.now();
  chats.unshift({
    id,
    title: initialText ? initialText.slice(0, 54) : 'Новый чат',
    messages: [],
  });
  currentChatId = id;
  historySearch.value = '';
  renderHistory();
  renderMessages();
  if (initialText) sendMessage(initialText);
  if (isMobile()) setSidebar(false);
  promptInput.focus();
}

function sendMessage(text) {
  const clean = text.trim();
  if (!clean) return;

  if (!currentChat()) {
    createChat();
  }

  const chat = currentChat();
  if (!chat) return;

  if (chat.messages.length === 0) {
    chat.title = clean.slice(0, 54);
  }

  chat.messages.push({ role: 'user', text: clean });
  chat.messages.push({
    role: 'assistant',
    text: 'Это первый UI-срез ASA Lab AI. Реальная модель ещё не подключена. Следующий срез заменит этот демонстрационный ответ потоковым ответом серверного LLM.',
  });

  promptInput.value = '';
  resizeInput();
  renderHistory();
  renderMessages();
}

function resizeInput() {
  promptInput.style.height = 'auto';
  promptInput.style.height = Math.min(promptInput.scrollHeight, 160) + 'px';
  sendButton.disabled = promptInput.value.trim().length === 0;
}

document.querySelector('#collapseSidebar').addEventListener('click', () => setSidebar(false));
document.querySelector('#openSidebar').addEventListener('click', () => setSidebar(true));
document.querySelector('#drawerBackdrop').addEventListener('click', () => setSidebar(false));
document.querySelector('#newChat').addEventListener('click', () => createChat());
historySearch.addEventListener('input', renderHistory);

document.querySelector('#themeToggle').addEventListener('click', () => {
  const root = document.documentElement;
  root.dataset.theme = root.dataset.theme === 'dark' ? 'light' : 'dark';
});

document.querySelectorAll('[data-prompt]').forEach((button) => {
  button.addEventListener('click', () => {
    const prompt = button.getAttribute('data-prompt') ?? '';
    createChat(prompt);
  });
});

composer.addEventListener('submit', (event) => {
  event.preventDefault();
  sendMessage(promptInput.value);
});

promptInput.addEventListener('input', resizeInput);
promptInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault();
    sendMessage(promptInput.value);
  }
});

window.addEventListener('resize', () => {
  if (!isMobile() && shell.dataset.sidebarOpen === undefined) setSidebar(true);
});

if (isMobile()) setSidebar(false);
else setSidebar(true);

renderHistory();
renderMessages();
resizeInput();
