(function (root) {
  "use strict";
  let lastRevision = -1, lastDmc, lastDay;
  const number = value => value === null ? "-" : value.toLocaleString("fr-CH", { maximumFractionDigits: 1 });
  const date = value => new Date(value).toLocaleDateString("fr-CH", { day: "2-digit", month: "2-digit", year: "numeric" });
  const text = (id, value) => { document.getElementById(id).textContent = value; };
  function row(values) {
    const tr = document.createElement("tr");
    for (const value of values) { const td = document.createElement("td"); td.textContent = value; tr.append(td); }
    return tr;
  }
  function emptyRow(message) {
    const tr = row([message]); tr.firstChild.colSpan = 3; return tr;
  }
  function render(stats, paths, counts, dmc, revision) {
    const today = StitchStats.dayKey();
    if (!paths || (revision === lastRevision && dmc === lastDmc && today === lastDay)) return;
    lastRevision = revision; lastDmc = dmc; lastDay = today;
    const summary = StitchStats.summarize(stats, paths, counts);
    text("todayDiagonals", number(summary.today.diagonals));
    text("todayCrosses", number(summary.today.crosses));
    text("weekDiagonals", number(summary.week));
    text("activeStitchDays", number(summary.activeDays));
    text("dailyStitchAverage", number(summary.averagePerDay));
    text("finishedThreadCount", number(summary.completedThreads));
    text("threadDiagonalAverage", number(summary.averagePerThread));
    const current = StitchStats.currentThread(stats, dmc);
    text("currentThreadLabel", current ? `DMC ${dmc} - n\u00b0 ${current.number}` : `DMC ${dmc || "-"}`);
    text("currentThreadDiagonals", `${number(current ? (counts[dmc] || 0) - current.start : 0)} diag.`);
    document.getElementById("changeThreadButton").disabled = !current;
    text("threadProgressNote", current?.partial ? "Bout deja commence avant le suivi : mesure partielle."
      : current ? "Bout en cours" : "Aucun bout en cours pour cette couleur.");
    text("stitchStatsSince", `Suivi depuis le ${date(stats.startedAt)}.${summary.undated
      ? ` ${number(summary.undated)} diagonales anterieures sans date.` : ""}`);
    text("threadHistorySummary", `Moyenne : ${number(summary.averagePerThread)} diagonales sur ${number(summary.measuredThreads)} bouts complets. Bouts partiels et en cours exclus.`);
    const max = Math.max(1, ...summary.recentDays.map(day => day.diagonals));
    document.getElementById("dailyStitchChart").replaceChildren(...summary.recentDays.map(day => {
      const item = document.createElement("div"); item.className = "daily-stitch-row";
      const label = document.createElement("span");
      label.textContent = day.day === today ? "Aujourd'hui" : new Date(`${day.day}T12:00:00`).toLocaleDateString("fr-CH", { weekday: "short", day: "numeric" });
      const track = document.createElement("span"); track.className = "daily-stitch-track";
      const bar = document.createElement("span"); bar.style.width = `${day.diagonals / max * 100}%`; track.append(bar);
      const count = document.createElement("strong"); count.textContent = number(day.diagonals);
      item.title = `${date(`${day.day}T12:00:00`)} : ${day.diagonals} diagonales, ${day.crosses} croix terminees`;
      item.append(label, track, count); return item;
    }));
    document.getElementById("dailyStitchHistory").replaceChildren(...(summary.days.length ? summary.days.map(day =>
      row([date(`${day.day}T12:00:00`), number(day.diagonals), number(day.crosses)])) : [emptyRow("Aucune diagonale datee.")]));
    document.getElementById("threadHistory").replaceChildren(...(summary.threads.length ? summary.threads.map(thread => {
      const tr = row([`n\u00b0 ${thread.number} - DMC ${thread.dmc}`, number(thread.diagonals),
        `${thread.end === null ? "En cours" : "Termine"}${thread.partial ? " (partiel)" : ""} - ${date(thread.endedAt || thread.startedAt)}`]);
      tr.title = `Diagonales ${thread.start + 1} a ${thread.end ?? counts[thread.dmc]}. Debut : ${new Date(thread.startedAt).toLocaleString("fr-CH")}`;
      tr.classList.toggle("selected-thread-color", thread.dmc === dmc);
      return tr;
    }) : [emptyRow("Aucun bout de fil enregistre.")]));
  }
  root.StitchStatsView = { render };
})(window);
