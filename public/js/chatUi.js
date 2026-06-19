import { chat } from './api.js';
import { renderAvatarHtml } from './avatars.js';

export const CHAT_REACTIONS = ['👍', '🔥', '😂', '🎯', '💪', '😱', '❤️', '🏆'];

function formatChatTime(iso) {
  if (!iso) return '';
  const raw = String(iso).includes('T') ? iso : `${iso.replace(' ', 'T')}Z`;
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
}

function reactionBar(messageId, reactions = [], myReactions = [], mine = false) {
  const counts = Object.fromEntries(reactions.map(r => [r.emoji, Number(r.count) || 0]));
  return `<div class="chat-reactions ${mine ? 'mine' : 'other'}">
    ${CHAT_REACTIONS.map(emoji => {
      const active = myReactions.includes(emoji);
      const count = counts[emoji] || 0;
      return `<button type="button" class="chat-react-btn ${active ? 'active' : ''}"
        data-msg="${messageId}" data-emoji="${emoji}" aria-label="Réagir ${emoji}">
        ${emoji}${count ? `<span class="chat-react-count">${count}</span>` : ''}
      </button>`;
    }).join('')}
  </div>`;
}

function messageHtml(m, userId, userColor) {
  const mine = m.user_id === userId;
  const time = formatChatTime(m.created_at);
  const bubbleStyle = mine ? `--chat-mine:${userColor || 'var(--pl)'};` : '';

  return `<div class="chat-msg ${mine ? 'mine' : 'other'}">
    ${!mine ? `<div class="chat-msg-head">
      <span class="chat-msg-avatar">${renderAvatarHtml(m.avatar, m.display_name, m.profile_color, 'sm')}</span>
      <span class="chat-msg-name">${m.display_name}</span>
      <span class="chat-msg-time">${time}</span>
    </div>` : ''}
    <div class="chat-bubble ${mine ? 'mine' : 'other'}" style="${bubbleStyle}">${escapeHtml(m.content)}</div>
    ${mine && time ? `<div class="chat-msg-time mine">${time}</div>` : ''}
    ${reactionBar(m.id, m.reactions, m.myReactions ?? [], mine)}
  </div>`;
}

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

export async function renderChatScreen(el, state) {
  const messages = await chat.list(state.group.id);
  const userColor = state.user.profileColor || '#6B3FD6';

  el.innerHTML = `
    <div class="chat-screen">
      <div class="chat-header">
        <div class="chat-header-label">Chat du groupe</div>
        <div class="chat-header-title">${escapeHtml(state.group.name)}</div>
      </div>
      <div class="chat-msgs" id="chat-msgs">
        ${messages.length
          ? messages.map(m => messageHtml(m, state.user.id, userColor)).join('')
          : '<div class="empty-state chat-empty">Aucun message — lance la conversation !</div>'}
      </div>
      <div class="chat-compose">
        <input id="chat-input" type="text" placeholder="Écrire un message…" maxlength="500" autocomplete="off">
        <button type="button" class="chat-send-btn" id="chat-send">Envoyer</button>
      </div>
    </div>`;

  const msgsEl = document.getElementById('chat-msgs');
  msgsEl.scrollTop = msgsEl.scrollHeight;

  const send = async () => {
    const input = document.getElementById('chat-input');
    const text = input.value.trim();
    if (!text) return;
    input.value = '';
    await chat.send(state.group.id, text);
    await renderChatScreen(el, state);
  };

  document.getElementById('chat-send').onclick = send;
  document.getElementById('chat-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); send(); }
  });

  el.querySelectorAll('.chat-react-btn').forEach(btn => {
    btn.onclick = async () => {
      await chat.react(state.group.id, Number(btn.dataset.msg), btn.dataset.emoji);
      await renderChatScreen(el, state);
    };
  });
}
