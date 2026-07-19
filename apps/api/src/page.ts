/** Minimal server-rendered page for the first classroom slice. Vanilla JS,
 * no framework: login form, create-classroom form, classroom list with
 * loading / empty / validation-error / server-error / success states. */
export const PAGE_HTML = `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>ASA Lab — Классы</title>
<style>
  body { font-family: system-ui, sans-serif; max-width: 640px; margin: 2rem auto; padding: 0 1rem; color:#1c2733; }
  h1 { font-size: 1.4rem; }
  form { margin: 1rem 0; display: flex; gap: .5rem; flex-wrap: wrap; }
  input { padding: .5rem; border: 1px solid #b6c2cf; border-radius: 6px; flex: 1 1 180px; }
  button { padding: .5rem 1rem; border: 0; border-radius: 6px; background: #2563eb; color: #fff; cursor: pointer; }
  button[disabled] { opacity: .6; cursor: wait; }
  .msg { padding: .5rem .75rem; border-radius: 6px; margin: .5rem 0; display: none; }
  .msg.error { background: #fde8e8; color: #9b1c1c; }
  .msg.success { background: #def7ec; color: #03543f; }
  .msg.show { display: block; }
  ul#list { list-style: none; padding: 0; }
  ul#list li { padding: .6rem .75rem; border: 1px solid #dbe2ea; border-radius: 8px; margin: .4rem 0; }
  #empty, #loading { color: #5b6b7b; }
  .hidden { display: none !important; }
</style>
</head>
<body>
<h1>ASA Lab — кабинет педагога</h1>

<section id="login-section">
  <h2>Вход</h2>
  <form id="login-form">
    <input id="workspace" name="workspace" placeholder="workspace (напр. local-school)" autocomplete="organization" required>
    <input id="email" type="email" name="email" placeholder="email" autocomplete="username" required>
    <input id="password" type="password" name="password" placeholder="пароль" autocomplete="current-password" required>
    <button id="login-btn" type="submit">Войти</button>
  </form>
  <div id="login-error" class="msg error"></div>
</section>

<section id="app-section" class="hidden">
  <p>Вы вошли как <strong id="who"></strong> <button id="logout-btn" type="button">Выйти</button></p>
  <h2>Создать класс</h2>
  <form id="create-form">
    <input id="title" name="title" placeholder="Название класса" maxlength="255">
    <button id="create-btn" type="submit">Создать</button>
  </form>
  <div id="create-error" class="msg error"></div>
  <div id="create-success" class="msg success"></div>
  <h2>Мои классы</h2>
  <p id="loading">Загрузка…</p>
  <p id="empty" class="hidden">Классов пока нет.</p>
  <ul id="list"></ul>
</section>

<script>
const $ = (id) => document.getElementById(id);
const show = (el, text) => { el.textContent = text; el.classList.add('show'); };
const hide = (el) => { el.textContent = ''; el.classList.remove('show'); };

async function api(path, options) {
  const response = await fetch(path, Object.assign({ headers: { 'content-type': 'application/json' } }, options));
  let body = null;
  try { body = await response.json(); } catch { body = null; }
  return { status: response.status, body };
}

async function refreshList() {
  $('loading').classList.remove('hidden');
  $('empty').classList.add('hidden');
  const { status, body } = await api('/classrooms');
  $('loading').classList.add('hidden');
  if (status !== 200) { show($('create-error'), 'Не удалось загрузить список классов (ошибка сервера).'); return; }
  const list = $('list');
  list.innerHTML = '';
  const items = (body && body.items) || [];
  if (items.length === 0) { $('empty').classList.remove('hidden'); return; }
  for (const c of items) {
    const li = document.createElement('li');
    li.textContent = c.title;
    li.dataset.id = c.id;
    list.appendChild(li);
  }
}

async function enterApp(me) {
  $('login-section').classList.add('hidden');
  $('app-section').classList.remove('hidden');
  $('who').textContent = me.displayName + ' (' + me.email + ')';
  await refreshList();
}

$('login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  hide($('login-error'));
  const btn = $('login-btn'); btn.disabled = true;
  const { status, body } = await api('/auth/login', { method: 'POST', body: JSON.stringify({ workspace: $('workspace').value.trim(), email: $('email').value, password: $('password').value }) });
  btn.disabled = false;
  if (status === 200) { await enterApp(body.user); return; }
  if (status === 400 || status === 401) { show($('login-error'), 'Неверный email или пароль.'); return; }
  show($('login-error'), 'Ошибка сервера, попробуйте ещё раз.');
});

$('logout-btn').addEventListener('click', async () => {
  await api('/auth/logout', { method: 'POST' });
  location.reload();
});

$('create-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  hide($('create-error')); hide($('create-success'));
  const title = $('title').value.trim();
  if (!title) { show($('create-error'), 'Введите название класса.'); return; }
  const btn = $('create-btn'); btn.disabled = true;
  const { status, body } = await api('/classrooms', { method: 'POST', body: JSON.stringify({ title }) });
  btn.disabled = false;
  if (status === 201) {
    $('title').value = '';
    show($('create-success'), 'Класс «' + body.classroom.title + '» создан.');
    await refreshList();
    return;
  }
  if (status === 400) { show($('create-error'), (body && body.error && body.error.message) || 'Некорректное название.'); return; }
  if (status === 401) { location.reload(); return; }
  show($('create-error'), 'Ошибка сервера, класс не создан.');
});

(async function init() {
  const { status, body } = await api('/auth/me');
  if (status === 200) { await enterApp(body.user); }
})();
</script>
</body>
</html>`;
