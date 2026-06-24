const { getDb } = require('./init');

async function getStats(userId) {
  const db = getDb();

  const completedTasks = (await db.prepare(
    `SELECT COUNT(*) as c FROM tasks WHERE owner_id = ? AND status = 'completed'`
  ).get(userId))?.c || 0;

  const completedAsAssignee = (await db.prepare(`
    SELECT COUNT(*) as c FROM tasks
    WHERE status = 'completed' AND assignees_json LIKE ?
  `).get(`%"${userId}"%`))?.c || 0;

  const totalCompleted = completedTasks + completedAsAssignee;

  const projectsOwned = (await db.prepare(
    `SELECT COUNT(*) as c FROM projects WHERE owner_id = ?`
  ).get(userId))?.c || 0;

  const collabProjects = (await db.prepare(`
    SELECT COUNT(DISTINCT pm.project_id) as c FROM project_members pm
    JOIN projects p ON p.id = pm.project_id
    WHERE pm.user_id = ? AND (
      SELECT COUNT(*) FROM project_members WHERE project_id = pm.project_id
    ) > 1
  `).get(userId))?.c || 0;

  const friendsCount = (await db.prepare(
    `SELECT COUNT(*) as c FROM friendships WHERE user_id = ?`
  ).get(userId))?.c || 0;

  const messagesSent = (await db.prepare(
    `SELECT COUNT(*) as c FROM messages WHERE from_user_id = ?`
  ).get(userId))?.c || 0;

  const notesCount = (await db.prepare(
    `SELECT COUNT(*) as c FROM notes WHERE user_id = ?`
  ).get(userId))?.c || 0;

  const mindmapEdits = (await db.prepare(`
    SELECT COUNT(*) as c FROM mind_maps mm
    JOIN project_members pm ON pm.project_id = mm.project_id
    WHERE pm.user_id = ? AND mm.updated_by = ?
  `).get(userId))?.c || 0;

  return {
    completedTasks: totalCompleted,
    projectsOwned,
    collabProjects,
    friendsCount,
    messagesSent,
    notesCount,
    mindmapEdits
  };
}

async function unlockAchievement(userId, achievementId) {
  const db = getDb();
  const exists = await db.prepare(
    'SELECT 1 FROM user_achievements WHERE user_id = ? AND achievement_id = ?'
  ).get(userId, achievementId);
  if (exists) return null;

  const ach = await db.prepare('SELECT * FROM achievements WHERE id = ?').get(achievementId);
  if (!ach) return null;

  const now = new Date().toISOString();
  await db.prepare(
    'INSERT INTO user_achievements (user_id, achievement_id, unlocked_at) VALUES (?, ?, ?)'
  ).run(userId, achievementId, now);

  return { ...ach, unlockedAt: now };
}

async function checkAndUnlock(userId) {
  const stats = await getStats(userId);
  const unlocked = [];

  const rules = [
    { id: 'first_task', ok: stats.completedTasks >= 1 },
    { id: 'tasks_10', ok: stats.completedTasks >= 10 },
    { id: 'tasks_50', ok: stats.completedTasks >= 50 },
    { id: 'first_project', ok: stats.projectsOwned >= 1 },
    { id: 'collab_project', ok: stats.collabProjects >= 1 },
    { id: 'first_friend', ok: stats.friendsCount >= 1 },
    { id: 'friends_5', ok: stats.friendsCount >= 5 },
    { id: 'messages_10', ok: stats.messagesSent >= 10 },
    { id: 'mindmap_start', ok: stats.mindmapEdits >= 1 },
    { id: 'notes_5', ok: stats.notesCount >= 5 }
  ];

  for (const rule of rules) {
    if (rule.ok) {
      const result = await unlockAchievement(userId, rule.id);
      if (result) unlocked.push(result);
    }
  }

  return unlocked;
}

async function getUserAchievements(userId) {
  const db = getDb();
  const all = await db.prepare('SELECT * FROM achievements ORDER BY category, id').all();
  const userRows = await db.prepare(
    'SELECT achievement_id, unlocked_at FROM user_achievements WHERE user_id = ?'
  ).all(userId);
  const map = Object.fromEntries(userRows.map(r => [r.achievement_id, r.unlocked_at]));

  return all.map(a => ({
    ...a,
    unlocked: !!map[a.id],
    unlockedAt: map[a.id] || null
  }));
}

module.exports = { getStats, checkAndUnlock, getUserAchievements, unlockAchievement };
