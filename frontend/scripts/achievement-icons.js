const ACHIEVEMENT_ICON_MAP = {
  first_task: 'leaf-outline',
  tasks_10: 'flame-outline',
  tasks_50: 'flash-outline',
  tasks_100: 'trophy-outline',
  tasks_500: 'crown-outline',
  first_project: 'folder-outline',
  projects_5: 'business-outline',
  collab_project: 'people-outline',
  first_friend: 'hand-left-outline',
  friends_5: 'handshake-outline',
  friends_15: 'star-outline',
  messages_10: 'chatbubbles-outline',
  messages_100: 'chatbox-ellipses-outline',
  messages_500: 'megaphone-outline',
  notes_5: 'document-text-outline',
  notes_25: 'library-outline',
  mindmap_start: 'git-network-outline'
};

function getAchievementIcon(id, fallback) {
  return ACHIEVEMENT_ICON_MAP[id] || 'ribbon-outline';
}

window.getAchievementIcon = getAchievementIcon;
