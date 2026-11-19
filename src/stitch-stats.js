(function (root) {
  "use strict";

  function dayKey(date = new Date()) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  }

  function create(counts = {}, now = new Date()) {
    return { version: 1, startedAt: now.toISOString(), colors: Object.fromEntries(
      Object.entries(counts).map(([dmc, baseline]) => [dmc, { baseline, runs: [], threads: [] }])) };
  }

  function color(stats, dmc) {
    return stats.colors[dmc] ||= { baseline: 0, runs: [], threads: [] };
  }

  function snapshot(stats, dmc) {
    return structuredClone(color(stats, dmc));
  }

  function restoreColor(stats, dmc, saved) {
    stats.colors[dmc] = structuredClone(saved);
  }

  function rebaseColor(stats, dmc, count) {
    stats.colors[dmc] = { baseline: count, runs: [], threads: [] };
  }

  function currentThread(stats, dmc) {
    return stats.colors[dmc]?.threads.find(thread => thread.end === null) || null;
  }

  // Runs describe surviving completed diagonals, not button presses. Corrections trim
  // their original dates and thread membership instead of creating negative activity today.
  function record(stats, dmc, before, after, now = new Date()) {
    const entry = color(stats, dmc);
    if (after < before) {
      entry.baseline = Math.min(entry.baseline, after);
      entry.runs = entry.runs.filter(run => run.from < after).map(run => ({ ...run, to: Math.min(run.to, after) }));
      entry.threads = entry.threads.filter(thread => thread.start < after).map(thread =>
        thread.end !== null && thread.end > after ? { ...thread, end: null, endedAt: null } : thread);
      return;
    }
    if (after === before) return;
    let thread = currentThread(stats, dmc);
    if (!thread) {
      thread = { number: (entry.threads.at(-1)?.number || 0) + 1, start: before, end: null,
        startedAt: now.toISOString(), endedAt: null, partial: entry.threads.length === 0 && entry.baseline > 0 };
      entry.threads.push(thread);
    }
    const day = dayKey(now), last = entry.runs.at(-1);
    if (last?.to === before && last.day === day && last.thread === thread.number) last.to = after;
    else entry.runs.push({ from: before, to: after, day, thread: thread.number });
  }

  function finishThread(stats, dmc, count, now = new Date()) {
    const thread = currentThread(stats, dmc);
    if (!thread || count <= thread.start) return false;
    thread.end = count;
    thread.endedAt = now.toISOString();
    return true;
  }

  function load(value, paths, counts, now = new Date()) {
    if (value === undefined || value === null) return create(counts, now);
    const validTime = time => typeof time === "string" && Number.isFinite(Date.parse(time));
    const validDay = day => typeof day === "string" && /^\d{4}-\d{2}-\d{2}$/.test(day)
      && Number.isFinite(Date.parse(`${day}T12:00:00Z`)) && new Date(`${day}T12:00:00Z`).toISOString().slice(0, 10) === day;
    const fail = () => { throw new Error("Statistiques de broderie invalides. La progression actuelle est conservee."); };
    if (value.version !== 1 || !validTime(value.startedAt) || !value.colors || typeof value.colors !== "object" || Array.isArray(value.colors)) fail();
    const limits = new Map((paths?.paths || []).map(path => [path.dmc, path.points.length]));
    for (const [dmc, entry] of Object.entries(value.colors)) {
      const count = counts[dmc] || 0;
      if (!limits.has(dmc) || !entry || !Number.isInteger(entry.baseline) || entry.baseline < 0 || entry.baseline > count
          || !Array.isArray(entry.runs) || !Array.isArray(entry.threads)) fail();
      let position = entry.baseline, number = 0;
      const threads = new Map();
      for (const [i, thread] of entry.threads.entries()) {
        const end = thread.end === null ? count : thread.end;
        if (!Number.isInteger(thread.number) || thread.number <= number || thread.start !== position
            || !Number.isInteger(end) || end <= position || end > count || typeof thread.partial !== "boolean"
            || !validTime(thread.startedAt) || (thread.end === null ? thread.endedAt !== null || i !== entry.threads.length - 1 : !validTime(thread.endedAt))) fail();
        position = end; number = thread.number; threads.set(number, thread);
      }
      if (position !== count) fail();
      position = entry.baseline;
      for (const run of entry.runs) {
        const thread = threads.get(run.thread);
        if (!thread || run.from !== position || !Number.isInteger(run.to) || run.to <= position || run.to > count
            || run.from < thread.start || run.to > (thread.end ?? count) || !validDay(run.day)) fail();
        position = run.to;
      }
      if (position !== count) fail();
    }
    for (const [dmc, count] of Object.entries(counts)) if (count && !value.colors[dmc]) fail();
    return structuredClone(value);
  }

  function summarize(stats, paths, counts, now = new Date()) {
    const days = new Map(), threads = [];
    let undated = 0;
    for (const path of paths?.paths || []) {
      const entry = stats.colors[path.dmc];
      if (!entry) continue;
      undated += entry.baseline;
      for (const run of entry.runs) {
        if (!days.has(run.day)) days.set(run.day, { day: run.day, diagonals: 0, crosses: 0 });
        const day = days.get(run.day);
        day.diagonals += run.to - run.from;
        for (let i = run.from; i < run.to; i++) if (path.points[i]?.diagonal === "upper") day.crosses++;
      }
      for (const thread of entry.threads) threads.push({ ...thread, dmc: path.dmc,
        diagonals: (thread.end ?? counts[path.dmc] ?? 0) - thread.start });
    }
    const today = days.get(dayKey(now)) || { day: dayKey(now), diagonals: 0, crosses: 0 };
    const recentDays = Array.from({ length: 7 }, (_, i) => {
      const date = new Date(now); date.setDate(date.getDate() - 6 + i);
      const day = dayKey(date);
      return days.get(day) || { day, diagonals: 0, crosses: 0 };
    });
    const completed = threads.filter(thread => thread.end !== null);
    const measured = completed.filter(thread => !thread.partial);
    const total = [...days.values()].reduce((sum, day) => sum + day.diagonals, 0);
    return { today, recentDays, days: [...days.values()].sort((a, b) => b.day.localeCompare(a.day)),
      threads: threads.sort((a, b) => b.startedAt.localeCompare(a.startedAt) || b.number - a.number),
      undated, total, activeDays: days.size, averagePerDay: days.size ? total / days.size : null,
      week: recentDays.reduce((sum, day) => sum + day.diagonals, 0), completedThreads: completed.length,
      measuredThreads: measured.length, averagePerThread: measured.length
        ? measured.reduce((sum, thread) => sum + thread.diagonals, 0) / measured.length : null };
  }

  const api = { dayKey, create, snapshot, restoreColor, rebaseColor, currentThread, record, finishThread, load, summarize };
  root.StitchStats = api;
  if (typeof module !== "undefined") module.exports = api;
})(typeof window === "undefined" ? globalThis : window);
