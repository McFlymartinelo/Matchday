import { compColors, initials } from './api.js';

export const AVATAR_GROUPS = [
  {
    id: 'football',
    label: 'Football',
    icon: '⚽',
    emojis: [
      '⚽', '🏆', '🥅', '🧤', '🏟️', '🎯', '⭐', '👑', '🍀',
      '🥇', '🥈', '🥉', '📣', '🚩', '🔥', '💪', '🧊', '🎖️',
    ],
  },
  {
    id: 'fun',
    label: 'Fun',
    icon: '😂',
    emojis: [
      '😂', '🤡', '😎', '🤯', '😤', '🥳', '😈', '👻', '🎭',
      '🤑', '💀', '🤪', '😏', '🫡', '🤝', '👊', '🙌', '💯',
    ],
  },
  {
    id: 'flags',
    label: 'Drapeaux',
    icon: '🌍',
    emojis: [
      '🇫🇷', '🇪🇸', '🇬🇧', '🏴', '🇩🇪', '🇮🇹', '🇵🇹', '🇳🇱', '🇧🇪',
      '🇲🇦', '🇩🇿', '🇹🇳', '🇸🇳', '🇨🇮', '🇧🇷', '🇦🇷', '🇵🇱', '🇹🇷',
      '🌍', '🏳️', '🏴‍☠️',
    ],
  },
  {
    id: 'animals',
    label: 'Animaux',
    icon: '🦁',
    emojis: [
      '🦁', '🐔', '🦅', '🐻', '🐺', '🦊', '🐯', '🦉', '🦈',
      '🐘', '🦓', '🐎', '🐶', '🐱', '🦋', '🐝', '🦍', '🐧',
    ],
  },
  {
    id: 'clubs',
    label: 'Clubs',
    icon: '🛡️',
    type: 'clubs',
  },
];

export function isClubAvatar(value) {
  return typeof value === 'string' && value.startsWith('club:');
}

export function isEmojiAvatar(value) {
  if (!value || isClubAvatar(value)) return false;
  if (value.startsWith('http')) return false;
  return [...value].length <= 4;
}

export function parseClubAvatar(value) {
  if (!isClubAvatar(value)) return null;
  const parts = value.split(':');
  return {
    teamId: Number(parts[1]),
    compCode: parts[2] ?? 'L1',
    label: parts.slice(3).join(':') || '???',
  };
}

export function formatClubAvatar(team) {
  const label = (team.short_name || team.team_name || '???').replace(/:/g, '');
  return `club:${team.team_id}:${team.comp_code}:${label}`;
}

export function bsdTeamLogoUrl(teamId) {
  if (!teamId) return null;
  return `https://sports.bzzoiro.com/img/team/${teamId}/?bg=transparent`;
}

export function clubCrestLetters(label, teamName) {
  const src = (label || teamName || '???').replace(/[^a-zA-Z0-9]/g, '');
  if (src.length <= 3) return src.toUpperCase() || '???';
  return src.slice(0, 3).toUpperCase();
}

export function renderClubCrestHtml(club, { size = 'md', title = '' } = {}) {
  const teamId = club.teamId ?? club.team_id;
  const logoUrl = club.logoUrl ?? club.logo_url ?? bsdTeamLogoUrl(teamId);
  const cc = compColors(club.compCode ?? club.comp_code ?? 'L1');
  const letters = clubCrestLetters(club.label, club.teamName ?? club.team_name);
  const cls = size === 'lg' ? 'avatar-crest avatar-crest-lg' : size === 'sm' ? 'avatar-crest avatar-crest-sm' : 'avatar-crest';
  const tip = (title || club.teamName || club.team_name || club.label || '').replace(/"/g, '&quot;');

  if (logoUrl) {
    return `<span class="avatar-crest-wrap" title="${tip}">
      <img src="${logoUrl}" alt="" class="avatar-crest-img ${cls}" loading="lazy"
        onerror="this.classList.add('hidden');this.nextElementSibling?.classList.remove('hidden')">
      <span class="${cls} avatar-crest-fallback hidden" style="background:${cc.bg};color:${cc.color}">${letters}</span>
    </span>`;
  }

  return `<span class="${cls}" style="background:${cc.bg};color:${cc.color}" title="${tip}">${letters}</span>`;
}

export function renderAvatarHtml(avatar, displayName, profileColor = '#6B3FD6', size = 'lg') {
  if (isClubAvatar(avatar)) {
    return renderClubCrestHtml(parseClubAvatar(avatar), { size: size === 'sm' ? 'sm' : 'lg' });
  }
  if (typeof avatar === 'string' && /^https?:\/\//i.test(avatar)) {
    try {
      const url = new URL(avatar);
      if (url.protocol === 'http:' || url.protocol === 'https:') {
        return `<img src="${url.href.replace(/"/g, '%22')}" alt="" class="profile-avatar-img">`;
      }
    } catch { /* ignore */ }
  }
  if (avatar && isEmojiAvatar(avatar)) return avatar;
  return initials(displayName);
}

export function avatarMatches(a, b) {
  return a === b;
}

export function isAvatarActive(current, option) {
  return avatarMatches(current, option);
}
