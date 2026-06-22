import { dbGet, dbAll, dbRun } from './sql.js';

export async function getStats(d1, userId) {
  const completedTasksRow = await dbGet(
    d1,
    `SELECT COUNT(*) as c FROM tasks WHERE owner_id = ? AND status = 'completed'`,
    [userId]
  );

  const completedAsAssigneeRow = await dbGet(
    d1,
    `SELECT COUNT(*) as c FROM tasks
     WHERE status = 'completed' AND assignees_json LIKE ?`,
    [`%"${userId}"%`]
  );

  const totalCompleted = (completedTasksRow?.c || 0) + (completedAsAssigneeRow?.c || 0);

  const projectsOwnedRow = await dbGet(
    d1,
    `SELECT COUNT(*) as c FROM projects WHERE owner_id = ?`,
    [userId]
  );

  const collabProjectsRow = await dbGet(
    d1,
    `SELECT COUNT(DISTINCT pm.project_id) as c FROM project_members pm
     JOIN projects p ON p.id = pm.project_id
     WHERE pm.user_id = ? AND (
       SELECT COUNT(*) FROM project_members WHERE project_id = pm.project_id
     ) > 1`,
    [userId]
  );

  const friendsCountRow = await dbGet(
    d1,
    `SELECT COUNT(*) as c FROM friendships WHERE user_id = ?`,
    [userId]
  );

  const messagesSentRow = await dbGet(
    d1,
    `SELECT COUNT(*) as c FROM messages WHERE from_user_id = ?`,
    [userId]
  );

  const notesCountRow = await dbGet(
    d1,
    `SELECT COUNT(*) as c FROM notes WHERE user_id = ?`,
    [userId]
  );

  const mindmapProjectsRow = await dbGet(
    d1,
    `SELECT COUNT(DISTINCT mm.project_id) as c FROM mind_maps mm
     JOIN project_members pm ON pm.project_id = mm.project_id
     WHERE pm.user_id = ? AND mm.nodes_json != '[]'`,
    [userId]
  );

  return {
    completedTasks: totalCompleted,
    projectsOwned: projectsOwnedRow?.c || 0,
    collabProjects: collabProjectsRow?.c || 0,
    friendsCount: friendsCountRow?.c || 0,
    messagesSent: messagesSentRow?.c || 0,
    notesCount: notesCountRow?.c || 0,
    mindmapProjects: mindmapProjectsRow?.c || 0
  };
}

async function unlockAchievement(d1, userId, achievementId) {
  const exists = await dbGet(
    d1,
    'SELECT 1 AS ok FROM user_achievements WHERE user_id = ? AND achievement_id = ?',
    [userId, achievementId]
  );
  if (exists) return null;

  const ach = await dbGet(d1, 'SELECT * FROM achievements WHERE id = ?', [achievementId]);
  if (!ach) return null;

  const now = new Date().toISOString();
  await dbRun(
    d1,
    'INSERT INTO user_achievements (user_id, achievement_id, unlocked_at) VALUES (?, ?, ?)',
    [userId, achievementId, now]
  );

  return { ...ach, unlockedAt: now };
}

export async function checkAndUnlock(d1, userId) {
  const stats = await getStats(d1, userId);
  const unlocked = [];

  const rules = [
    { id: 'first_task', ok: stats.completedTasks >= 1 },
    { id: 'tasks_10', ok: stats.completedTasks >= 10 },
    { id: 'tasks_50', ok: stats.completedTasks >= 50 },
    { id: 'tasks_100', ok: stats.completedTasks >= 100 },
    { id: 'tasks_500', ok: stats.completedTasks >= 500 },
    { id: 'first_project', ok: stats.projectsOwned >= 1 },
    { id: 'projects_5', ok: stats.projectsOwned >= 5 },
    { id: 'collab_project', ok: stats.collabProjects >= 1 },
    { id: 'first_friend', ok: stats.friendsCount >= 1 },
    { id: 'friends_5', ok: stats.friendsCount >= 5 },
    { id: 'friends_15', ok: stats.friendsCount >= 15 },
    { id: 'messages_10', ok: stats.messagesSent >= 10 },
    { id: 'messages_100', ok: stats.messagesSent >= 100 },
    { id: 'messages_500', ok: stats.messagesSent >= 500 },
    { id: 'mindmap_start', ok: stats.mindmapProjects >= 1 },
    { id: 'notes_5', ok: stats.notesCount >= 5 },
    { id: 'notes_25', ok: stats.notesCount >= 25 }
  ];

  for (const rule of rules) {
    if (rule.ok) {
      const result = await unlockAchievement(d1, userId, rule.id);
      if (result) unlocked.push(result);
    }
  }

  return unlocked;
}

export async function getUserAchievements(d1, userId) {
  const all = await dbAll(d1, 'SELECT * FROM achievements ORDER BY category, id');
  const userRows = await dbAll(
    d1,
    'SELECT achievement_id, unlocked_at FROM user_achievements WHERE user_id = ?',
    [userId]
  );
  const map = Object.fromEntries(userRows.map(r => [r.achievement_id, r.unlocked_at]));

  return all.map(a => ({
    ...a,
    unlocked: !!map[a.id],
    unlockedAt: map[a.id] || null
  }));
}
