export function parseJson(val, fallback) {
  try {
    return JSON.parse(val || '');
  } catch {
    return fallback;
  }
}

export async function dbGet(d1, sql, params = []) {
  return d1.prepare(sql).bind(...params).first();
}

export async function dbAll(d1, sql, params = []) {
  const result = await d1.prepare(sql).bind(...params).all();
  return result.results || [];
}

export async function dbRun(d1, sql, params = []) {
  return d1.prepare(sql).bind(...params).run();
}
