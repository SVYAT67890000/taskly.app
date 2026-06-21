const ACHIEVEMENT_ICON_MAP = {
  first_task: 'checkmark-circle-outline',
  tasks_10: 'list-outline',
  tasks_50: 'trophy-outline',
  first_project: 'folder-outline',
  collab_project: 'people-outline',
  first_friend: 'hand-left-outline',
  friends_5: 'star-outline',
  messages_10: 'chatbubbles-outline',
  mindmap_start: 'git-network-outline',
  notes_5: 'document-text-outline'
};

function getAchievementIcon(id, fallback) {
  return ACHIEVEMENT_ICON_MAP[id] || 'ribbon-outline';
}

window.getAchievementIcon = getAchievementIcon;
