const state = {
  dashboard: null,
  race: null,
  selectedSessionKey: null,
  raceLoadingKey: null,
  countdownTarget: null,
  countdownTimer: null,
};

const PRODUCTION_API_BASE = "https://func-pitwall-fd884b.azurewebsites.net";

const TEAM_COLOURS = {
  Mercedes: "00D7B6",
  Ferrari: "ED1131",
  McLaren: "F47600",
  "Red Bull Racing": "4781D7",
  "Racing Bulls": "6C98FF",
  Alpine: "00A1E8",
  "Haas F1 Team": "9C9FA2",
  Audi: "F50537",
  Williams: "1868DB",
  "Aston Martin": "229971",
  Cadillac: "909090",
};

const COMPOUND_COLOURS = {
  SOFT: { fill: "#FF2D2D", dark: false },
  MEDIUM: { fill: "#F4D033", dark: false },
  HARD: { fill: "#F0F0F0", dark: false },
  INTERMEDIATE: { fill: "#43C025", dark: false },
  WET: { fill: "#1575CF", dark: true },
  UNKNOWN: { fill: "#6b7280", dark: true },
};

function apiUrl(path) {
  const configured = window.PITWALL_API_BASE;
  if (configured) {
    return `${String(configured).replace(/\/$/, "")}${path}`;
  }
  if (new URLSearchParams(location.search).get("api") === "prod") {
    return `${PRODUCTION_API_BASE}${path}`;
  }
  const localHost = location.hostname === "localhost" || location.hostname === "127.0.0.1";
  if (localHost && location.port !== "7071") {
    return `http://localhost:7071${path}`;
  }
  return `${PRODUCTION_API_BASE}${path}`;
}

function $(id) {
  return document.getElementById(id);
}

function setText(id, value) {
  $(id).textContent = value;
}

function pad(value) {
  return String(value).padStart(2, "0");
}

function formatDate(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function formatLap(seconds) {
  if (typeof seconds !== "number" || !Number.isFinite(seconds)) return "—";
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds - minutes * 60;
  return `${minutes}:${remainder.toFixed(3).padStart(6, "0")}`;
}

function formatPlaces(value) {
  if (value == null) return "—";
  if (value > 0) return `+${value}`;
  return String(value);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function normalizeHex(value) {
  const hex = String(value || "").replace(/^#/, "").toUpperCase();
  return /^[0-9A-F]{6}$/.test(hex) ? `#${hex}` : null;
}

function teamColour(colour, teamName) {
  return normalizeHex(colour) || normalizeHex(TEAM_COLOURS[teamName]) || "#6B7280";
}

function showBanner(message) {
  const banner = $("banner");
  banner.hidden = !message;
  banner.textContent = message || "";
}

function setPageLoading(loading) {
  document.body.classList.toggle("is-loading", loading);
  $("main").setAttribute("aria-busy", loading ? "true" : "false");
}

function countdownTarget(meeting) {
  if (!meeting) return null;
  const now = Date.now();
  const sessions = meeting.sessions || [];
  const race = sessions.find((session) => session.sessionName === "Race" && Date.parse(session.dateStart) > now);
  if (race) return race.dateStart;
  const nextSession = sessions.find((session) => Date.parse(session.dateStart) > now);
  if (nextSession) return nextSession.dateStart;
  return meeting.dateStart;
}

function tickCountdown() {
  const target = Date.parse(state.countdownTarget);
  const ids = { d: "cd-d", h: "cd-h", m: "cd-m", s: "cd-s" };
  if (Number.isNaN(target)) {
    setText(ids.d, "—");
    setText(ids.h, "—");
    setText(ids.m, "—");
    setText(ids.s, "—");
    return;
  }
  const diff = Math.max(0, target - Date.now());
  const seconds = Math.floor(diff / 1000);
  setText(ids.d, pad(Math.floor(seconds / 86400)));
  setText(ids.h, pad(Math.floor((seconds % 86400) / 3600)));
  setText(ids.m, pad(Math.floor((seconds % 3600) / 60)));
  setText(ids.s, pad(seconds % 60));
}

function renderFreshness(dashboard) {
  const node = $("freshness");
  const stamp = formatDate(dashboard.generatedAt);
  node.classList.toggle("stale", Boolean(dashboard.stale));
  node.innerHTML = dashboard.stale
    ? `Data last refreshed: ${escapeHtml(stamp)}<br>Latest upstream refresh unavailable — showing last known data.`
    : `Data last refreshed: ${escapeHtml(stamp)}`;
}

function renderBarChart(container, rows, { ariaLabel } = {}) {
  if (ariaLabel) container.setAttribute("aria-label", ariaLabel);
  if (!rows.length) {
    container.innerHTML = `<p class="stint-empty">No data to chart.</p>`;
    return;
  }
  const max = Math.max(...rows.map((row) => Number(row.value) || 0), 1);
  container.innerHTML = rows
    .map((row) => {
      const colour = teamColour(row.colour, row.teamName);
      const pct = Math.max(4, ((Number(row.value) || 0) / max) * 100);
      const label = row.shortName || row.name;
      return `
        <div class="bar-row">
          <span class="bar-pos">${escapeHtml(row.position ?? "")}</span>
          <span class="bar-name" title="${escapeHtml(row.name)}">
            <span class="team-pip" style="background:${escapeHtml(colour)}"></span>${escapeHtml(label)}
          </span>
          <div class="bar-track" aria-hidden="true">
            <div class="bar-fill" style="width:${pct}%;background:${escapeHtml(colour)}"></div>
          </div>
          <span class="bar-value">${escapeHtml(row.display ?? row.value)}</span>
        </div>`;
    })
    .join("");
}

function renderNextMeeting(meeting) {
  if (!meeting) {
    setText("meeting-name", "No upcoming Grand Prix");
    setText("meeting-place", "Season complete or calendar not published yet.");
    setText("meeting-circuit", "");
    setText("next-gp-meta", "");
    state.countdownTarget = null;
    tickCountdown();
    $("schedule-body").innerHTML = `<tr><td colspan="3">No sessions scheduled.</td></tr>`;
    return;
  }

  setText("meeting-name", meeting.meetingName);
  setText("meeting-place", [meeting.location, meeting.country].filter(Boolean).join(", "));
  setText("meeting-circuit", meeting.circuit ? `Circuit: ${meeting.circuit}` : "");
  setText("next-gp-meta", `${formatDate(meeting.dateStart)} → ${formatDate(meeting.dateEnd)}`);
  state.countdownTarget = countdownTarget(meeting);
  tickCountdown();

  const sessions = meeting.sessions || [];
  $("schedule-body").innerHTML = sessions.length
    ? sessions
        .map(
          (session) => `
            <tr>
              <td>${escapeHtml(session.sessionName)}</td>
              <td>${escapeHtml(formatDate(session.dateStart))}</td>
              <td>${escapeHtml(formatDate(session.dateEnd))}</td>
            </tr>`
        )
        .join("")
    : `<tr><td colspan="3">No sessions published for this meeting.</td></tr>`;
}

function renderLatestRace(race) {
  const podium = $("podium");
  if (!race) {
    setText("latest-meta", "");
    podium.innerHTML = `<li><span class="name">No completed Grand Prix yet.</span></li>`;
    return;
  }
  setText("latest-meta", `${race.meetingName} · ${formatDate(race.date)}`);
  const top3 = race.top3 || [];
  podium.innerHTML = top3.length
    ? top3
        .map((row) => {
          const colour = teamColour(row.teamColour, row.teamName);
          return `
            <li style="--team:${escapeHtml(colour)}">
              <span class="pos">P${escapeHtml(row.position)}</span>
              <span class="name">${escapeHtml(row.fullName)}</span>
              <span class="team"><span class="team-pip" style="background:${escapeHtml(colour)}"></span>${escapeHtml(row.teamName || "")}</span>
            </li>`;
        })
        .join("")
    : `<li><span class="name">Results not published yet.</span></li>`;
}

function renderChampionships(dashboard) {
  const drivers = dashboard.driverChampionship || [];
  renderBarChart(
    $("drivers-chart"),
    drivers.map((row) => ({
      position: row.position,
      name: row.fullName,
      shortName: row.acronym || row.fullName,
      teamName: row.teamName,
      colour: row.teamColour,
      value: row.points,
    })),
    { ariaLabel: "Driver championship points" }
  );

  const teams = dashboard.teamChampionship || [];
  renderBarChart(
    $("teams-chart"),
    teams.map((row) => ({
      position: row.position,
      name: row.teamName,
      shortName: row.teamName,
      teamName: row.teamName,
      colour: row.teamColour,
      value: row.points,
    })),
    { ariaLabel: "Constructor championship points" }
  );
}

function renderSeason(races) {
  const select = $("season");
  if (!select) return;
  const selected = state.selectedSessionKey ? String(state.selectedSessionKey) : "";
  const options = [`<option value="">Season championship</option>`];
  for (const race of races || []) {
    const name = String(race.meetingName || "Grand Prix").replace(" Grand Prix", " GP");
    const place = race.circuit || race.location || "";
    options.push(
      `<option value="${escapeHtml(race.sessionKey)}">${escapeHtml(name)}${place ? ` · ${escapeHtml(place)}` : ""}</option>`
    );
  }
  select.innerHTML = options.join("");
  select.value = selected;
  select.disabled = Boolean(state.raceLoadingKey);
}

function driverByNumber(number) {
  return (state.race?.drivers || []).find((driver) => String(driver.driverNumber) === String(number));
}

function renderDriverOptions() {
  const drivers = state.race?.drivers || [];
  const options = drivers
    .map(
      (driver) =>
        `<option value="${escapeHtml(driver.driverNumber)}">${escapeHtml(driver.fullName)}${driver.finishPosition ? ` (P${driver.finishPosition})` : ""}</option>`
    )
    .join("");
  const blank = `<option value="">Select driver</option>`;
  $("driver-a").innerHTML = blank + options;
  $("driver-b").innerHTML = blank + options;
  $("driver-a").value = "";
  $("driver-b").value = "";
}

function compoundStyle(compound) {
  return COMPOUND_COLOURS[String(compound || "UNKNOWN").toUpperCase()] || COMPOUND_COLOURS.UNKNOWN;
}

function stintTrackMarkup(driver) {
  const stints = driver?.stints || [];
  if (!stints.length) {
    return `<p class="stint-empty">No stint data.</p>`;
  }
  const totalLaps = stints.reduce((sum, stint) => {
    const start = Number(stint.lapStart) || 0;
    const end = Number(stint.lapEnd) || start;
    return sum + Math.max(1, end - start + 1);
  }, 0);
  return stints
    .map((stint) => {
      const start = Number(stint.lapStart) || 0;
      const end = Number(stint.lapEnd) || start;
      const laps = Math.max(1, end - start + 1);
      const pct = (laps / Math.max(totalLaps, 1)) * 100;
      const compound = stint.compound || "UNKNOWN";
      const style = compoundStyle(compound);
      const darkClass = style.dark ? " is-dark" : "";
      return `<span class="stint-seg${darkClass}" style="flex:${pct};background:${style.fill}" title="${escapeHtml(compound)} L${start}–L${end}">${escapeHtml(compound.slice(0, 3))} ${escapeHtml(String(laps))}</span>`;
    })
    .join("");
}

function renderStints(targetId, headingId, driver) {
  $(headingId).textContent = `Tyre stints — ${driver ? driver.fullName : "—"}`;
  const target = $(targetId);
  const colour = driver ? teamColour(driver.teamColour, driver.teamName) : "";
  target.style.boxShadow = driver && (driver.stints || []).length ? `inset 3px 0 0 ${colour}` : "";
  target.innerHTML = stintTrackMarkup(driver);
}

function pairPercents(a, b, { invert = false } = {}) {
  const va = Number(a);
  const vb = Number(b);
  const aValid = Number.isFinite(va);
  const bValid = Number.isFinite(vb);
  if (!aValid && !bValid) return { a: 0, b: 0 };
  if (invert) {
    const max = Math.max(aValid ? va : 0, bValid ? vb : 0, 1);
    return {
      a: aValid ? Math.max(8, ((max - va + 0.1) / (max + 0.1)) * 100) : 0,
      b: bValid ? Math.max(8, ((max - vb + 0.1) / (max + 0.1)) * 100) : 0,
    };
  }
  const max = Math.max(aValid ? Math.abs(va) : 0, bValid ? Math.abs(vb) : 0, 1);
  return {
    a: aValid ? Math.max(8, (Math.abs(va) / max) * 100) : 0,
    b: bValid ? Math.max(8, (Math.abs(vb) / max) * 100) : 0,
  };
}

function raceMetrics(driverA, driverB) {
  return [
    {
      label: "Finish",
      a: driverA?.finishPosition,
      b: driverB?.finishPosition,
      displayA: driverA?.finishPosition != null ? `P${driverA.finishPosition}` : "—",
      displayB: driverB?.finishPosition != null ? `P${driverB.finishPosition}` : "—",
      invert: true,
    },
    {
      label: "Places",
      a: driverA?.placesGained,
      b: driverB?.placesGained,
      displayA: formatPlaces(driverA?.placesGained),
      displayB: formatPlaces(driverB?.placesGained),
    },
    {
      label: "Fastest lap",
      a: driverA?.fastestLap,
      b: driverB?.fastestLap,
      displayA: formatLap(driverA?.fastestLap),
      displayB: formatLap(driverB?.fastestLap),
      invert: true,
    },
    {
      label: "Pit stops",
      a: driverA?.pitStops,
      b: driverB?.pitStops,
      displayA: driverA?.pitStops ?? "—",
      displayB: driverB?.pitStops ?? "—",
    },
    {
      label: "Overtakes",
      a: driverA?.overtakes,
      b: driverB?.overtakes,
      displayA: driverA?.overtakes ?? "—",
      displayB: driverB?.overtakes ?? "—",
    },
  ];
}

function championshipMetrics(driverA, driverB) {
  return [
    {
      label: "Position",
      a: driverA?.position,
      b: driverB?.position,
      displayA: driverA?.position != null ? `P${driverA.position}` : "—",
      displayB: driverB?.position != null ? `P${driverB.position}` : "—",
      invert: true,
    },
    {
      label: "Points",
      a: driverA?.points,
      b: driverB?.points,
      displayA: driverA?.points ?? "—",
      displayB: driverB?.points ?? "—",
    },
  ];
}

function renderPairBars(container, driverA, driverB, metrics) {
  const colourA = teamColour(driverA?.teamColour, driverA?.teamName);
  const colourB = teamColour(driverB?.teamColour, driverB?.teamName);
  container.innerHTML = metrics
    .map((metric) => {
      const pct = pairPercents(metric.a, metric.b, { invert: metric.invert });
      return `
        <div class="bar-row">
          <span class="bar-name">${escapeHtml(metric.label)}</span>
          <div class="pair-track">
            <div class="bar-track" aria-hidden="true"><div class="bar-fill" style="width:${pct.a}%;background:${escapeHtml(colourA)}"></div></div>
            <span class="pair-caption">${escapeHtml(metric.displayA)}</span>
          </div>
          <div class="pair-track">
            <div class="bar-track" aria-hidden="true"><div class="bar-fill" style="width:${pct.b}%;background:${escapeHtml(colourB)}"></div></div>
            <span class="pair-caption">${escapeHtml(metric.displayB)}</span>
          </div>
        </div>`;
    })
    .join("");
}

function driverCardMarkup(driver, label) {
  const colour = teamColour(driver?.teamColour, driver?.teamName);
  let detail = driver?.teamName || "";
  if (driver?.finishPosition != null) {
    detail = driver.dnf ? "DNF" : driver.dsq ? "DSQ" : `P${driver.finishPosition}`;
  } else if (driver?.position != null) {
    detail = `P${driver.position} · ${driver.points ?? 0} pts`;
  }
  return `
    <article class="battle-card" style="border-top-color:${escapeHtml(colour)}">
      <span class="label">${escapeHtml(label)}</span>
      <span class="name">${escapeHtml(driver?.fullName || "—")}</span>
      <span class="label">${escapeHtml(detail)}</span>
    </article>`;
}

function scalePercents(values, { invert = false } = {}) {
  const nums = values.map((value) => Number(value));
  const valid = nums.filter((value) => Number.isFinite(value));
  if (!valid.length) return nums.map(() => 0);
  if (invert) {
    const max = Math.max(...valid, 1);
    return nums.map((value) => (Number.isFinite(value) ? Math.max(8, ((max - value + 0.1) / (max + 0.1)) * 100) : 0));
  }
  const max = Math.max(...valid.map((value) => Math.abs(value)), 1);
  return nums.map((value) => (Number.isFinite(value) ? Math.max(8, (Math.abs(value) / max) * 100) : 0));
}

function driverPool() {
  if (graph.mode === "race" && state.race) return state.race.drivers || [];
  return state.dashboard?.driverChampionship || [];
}

function driverFromPool(number) {
  if (number == null || number === "") return null;
  return driverPool().find((driver) => String(driver.driverNumber) === String(number)) || null;
}

function fieldSelects() {
  return [1, 2, 3, 4].map((index) => $(`field-${index}`));
}

function fieldSlotValues() {
  return fieldSelects().map((select) => select?.value || "");
}

function driverOptionMarkup(pool) {
  const groups = new Map();
  for (const driver of pool) {
    const team = driver.teamName || "Unattached";
    if (!groups.has(team)) groups.set(team, []);
    groups.get(team).push(driver);
  }
  let html = `<option value="">Empty seat</option>`;
  for (const [team, drivers] of groups) {
    html += `<optgroup label="${escapeHtml(team)}">`;
    for (const driver of drivers) {
      const extra =
        driver.finishPosition != null ? `P${driver.finishPosition}` : driver.position != null ? `P${driver.position}` : "";
      const name = driver.acronym || driver.fullName;
      html += `<option value="${escapeHtml(driver.driverNumber)}">${escapeHtml(name)}${extra ? ` · ${escapeHtml(extra)}` : ""}</option>`;
    }
    html += `</optgroup>`;
  }
  return html;
}

function fieldMetrics(drivers) {
  if (graph.mode === "race" && state.race) {
    return [
      {
        label: "Finish",
        invert: true,
        values: drivers.map((driver) => ({
          raw: driver?.finishPosition,
          display: driver?.finishPosition != null ? `P${driver.finishPosition}` : "—",
        })),
      },
      {
        label: "Places",
        values: drivers.map((driver) => ({
          raw: driver?.placesGained,
          display: formatPlaces(driver?.placesGained),
        })),
      },
      {
        label: "Fastest",
        invert: true,
        values: drivers.map((driver) => ({
          raw: driver?.fastestLap,
          display: formatLap(driver?.fastestLap),
        })),
      },
      {
        label: "Stops",
        values: drivers.map((driver) => ({
          raw: driver?.pitStops,
          display: driver?.pitStops ?? "—",
        })),
      },
      {
        label: "Overtakes",
        values: drivers.map((driver) => ({
          raw: driver?.overtakes,
          display: driver?.overtakes ?? "—",
        })),
      },
    ];
  }
  return [
    {
      label: "Position",
      invert: true,
      values: drivers.map((driver) => ({
        raw: driver?.position,
        display: driver?.position != null ? `P${driver.position}` : "—",
      })),
    },
    {
      label: "Points",
      values: drivers.map((driver) => ({
        raw: driver?.points,
        display: driver?.points ?? "—",
      })),
    },
  ];
}

function packAcronym(driver) {
  if (!driver) return "—";
  if (driver.acronym) return driver.acronym;
  const parts = String(driver.fullName || "").trim().split(/\s+/);
  return (parts[parts.length - 1] || "?").slice(0, 3).toUpperCase();
}

function packRow(label, drivers, cellFn) {
  return `<div class="pack-row">
    <span class="pack-label">${escapeHtml(label)}</span>
    ${drivers.map((driver, index) => cellFn(driver, index)).join("")}
  </div>`;
}

function renderPackBoard(container, drivers) {
  const header = packRow(
    "",
    drivers,
    (driver) => {
      const colour = teamColour(driver?.teamColour, driver?.teamName);
      return `<div class="pack-cell pack-driver">
        <span class="team-pip" style="background:${escapeHtml(colour)}"></span>
        <span>${escapeHtml(packAcronym(driver))}</span>
      </div>`;
    }
  );

  let rows = "";
  if (graph.mode === "race" && state.race) {
    const finishes = drivers.map((driver) =>
      driver && !driver.dnf && !driver.dsq && driver.finishPosition != null ? driver.finishPosition : null
    );
    const bestFinish = Math.min(...finishes.filter((value) => value != null), Infinity);
    rows += packRow("Finish", drivers, (driver) => {
      let text = "—";
      if (driver?.dsq) text = "DSQ";
      else if (driver?.dnf) text = "DNF";
      else if (driver?.finishPosition != null) text = `P${driver.finishPosition}`;
      const best = driver?.finishPosition === bestFinish && Number.isFinite(bestFinish);
      return `<div class="pack-cell pack-finish${best ? " is-best" : ""}">${escapeHtml(text)}</div>`;
    });

    rows += packRow("Places", drivers, (driver) => {
      const value = driver?.placesGained;
      const tone = value > 0 ? "is-up" : value < 0 ? "is-down" : "is-flat";
      return `<div class="pack-cell pack-delta ${tone}">${escapeHtml(formatPlaces(value))}</div>`;
    });

    const times = drivers.map((driver) => driver?.fastestLap).filter((value) => typeof value === "number");
    const bestTime = times.length ? Math.min(...times) : null;
    rows += packRow("Fastest", drivers, (driver) => {
      const time = driver?.fastestLap;
      let delta = "";
      if (typeof time === "number" && bestTime != null) {
        delta = time === bestTime ? "fastest" : `+${(time - bestTime).toFixed(3)}`;
      }
      return `<div class="pack-cell pack-time${time === bestTime ? " is-best" : ""}">
        <strong>${escapeHtml(formatLap(time))}</strong>
        <span>${escapeHtml(delta)}</span>
      </div>`;
    });

    rows += packRow("Stops", drivers, (driver) => {
      if (!driver) return `<div class="pack-cell pack-stops">—</div>`;
      const count = Number(driver.pitStops) || 0;
      const pips = Array.from({ length: Math.min(count, 6) }, () => "<i></i>").join("");
      return `<div class="pack-cell pack-stops"><strong>${count}</strong><span class="stop-pips">${pips}</span></div>`;
    });

    const overtakes = drivers.map((driver) => (driver == null ? 0 : Number(driver.overtakes) || 0));
    const maxOvertakes = Math.max(...overtakes, 1);
    rows += packRow("Overtakes", drivers, (driver) => {
      if (!driver) return `<div class="pack-cell pack-overtakes">—</div>`;
      const count = Number(driver.overtakes) || 0;
      const pct = (count / maxOvertakes) * 100;
      const colour = teamColour(driver.teamColour, driver.teamName);
      return `<div class="pack-cell pack-overtakes">
        <strong>${count}</strong>
        <span class="overtake-bar" aria-hidden="true"><span style="width:${pct}%;background:${escapeHtml(colour)}"></span></span>
      </div>`;
    });
  } else {
    const positions = drivers.map((driver) => driver?.position).filter((value) => value != null);
    const bestPosition = positions.length ? Math.min(...positions) : null;
    rows += packRow("Position", drivers, (driver) => {
      const best = driver?.position === bestPosition && bestPosition != null;
      return `<div class="pack-cell pack-finish${best ? " is-best" : ""}">${driver?.position != null ? `P${driver.position}` : "—"}</div>`;
    });
    const points = drivers.map((driver) => Number(driver?.points)).filter((value) => Number.isFinite(value));
    const bestPoints = points.length ? Math.max(...points) : null;
    rows += packRow("Points", drivers, (driver) => {
      const best = driver?.points === bestPoints && bestPoints != null;
      return `<div class="pack-cell pack-points${best ? " is-best" : ""}">${driver?.points ?? "—"}</div>`;
    });
  }

  container.innerHTML = `<div class="pack-board">${header}${rows}</div>`;
}

function setFieldDrawerOpen(open) {
  const drawer = $("field-drawer");
  const wrap = $("graph-stage");
  if (!drawer) return;
  drawer.classList.toggle("is-open", open);
  drawer.setAttribute("aria-hidden", open ? "false" : "true");
  wrap?.classList.toggle("is-field-open", open);
  if (!open) {
    $("mode-pack")?.classList.remove("is-active");
    $("mode-node")?.classList.remove("is-active");
    $("mode-pack")?.setAttribute("aria-pressed", "false");
    $("mode-node")?.setAttribute("aria-pressed", "false");
    graph.selected = null;
    if (graph.ctx) paintGraph();
  } else {
    syncModeToggle();
  }
  requestAnimationFrame(schedulePlot);
}

function syncModeToggle() {
  const pack = graph.drawerMode === "pack";
  $("mode-pack")?.classList.toggle("is-active", pack);
  $("mode-node")?.classList.toggle("is-active", !pack);
  $("mode-pack")?.setAttribute("aria-pressed", pack ? "true" : "false");
  $("mode-node")?.setAttribute("aria-pressed", pack ? "false" : "true");
}

function setDrawerMode(mode) {
  graph.drawerMode = mode === "node" ? "node" : "pack";
  const pack = graph.drawerMode === "pack";
  if ($("pack-panel")) $("pack-panel").hidden = !pack;
  if ($("node-panel")) $("node-panel").hidden = pack;
  if (pack) {
    $("field-heading").textContent = "Compare a pack";
  } else {
    $("field-heading").textContent = graph.selected?.label || "Constructor";
    renderNodePanel(graph.selected);
  }
  setFieldDrawerOpen(true);
}

function toggleDrawerMode(mode) {
  const open = $("field-drawer")?.classList.contains("is-open");
  if (open && graph.drawerMode === mode) {
    setFieldDrawerOpen(false);
    return;
  }
  setDrawerMode(mode);
}

function renderFieldCompare() {
  const drivers = fieldSlotValues().map(driverFromPool);
  const chart = $("field-chart");
  const stints = $("field-stints");
  if (!chart || !stints) return;
  if (!drivers.some(Boolean)) {
    chart.innerHTML = `<p class="stint-empty">Pick up to four drivers — teammates or mixed constructors.</p>`;
    stints.innerHTML = "";
    return;
  }
  renderPackBoard(chart, drivers);
  if (graph.mode === "race" && state.race) {
    stints.innerHTML = drivers
      .map(
        (driver) => `
        <div>
          <h4>${escapeHtml(driver?.fullName || "Empty")}</h4>
          <div class="stint-track">${stintTrackMarkup(driver)}</div>
        </div>`
      )
      .join("");
  } else {
    stints.innerHTML = "";
  }
}

function renderFieldOptions() {
  const pool = driverPool();
  const markup = driverOptionMarkup(pool);
  const current = fieldSlotValues();
  fieldSelects().forEach((select, index) => {
    if (!select) return;
    select.innerHTML = markup;
    const keep = current[index];
    select.value = pool.some((driver) => String(driver.driverNumber) === String(keep)) ? keep : "";
  });
  renderFieldCompare();
}

function onFieldSlotChange(index) {
  const select = $(`field-${index}`);
  const value = select?.value || "";
  if (value) {
    fieldSelects().forEach((other, otherIndex) => {
      if (other && otherIndex !== index - 1 && other.value === value) other.value = "";
    });
  }
  renderFieldCompare();
}

function setBattleAvailable(available) {
  $("battle-empty").hidden = available;
  $("battle-body").hidden = !available;
}

function renderBattle() {
  if (!state.race || $("battle-body").hidden) return;
  const driverA = driverByNumber($("driver-a").value);
  const driverB = driverByNumber($("driver-b").value);
  if (!driverA && !driverB) {
    $("battle-heads").innerHTML = "";
    $("battle-chart").innerHTML = `<p class="stint-empty">Pick two drivers, or send a teammate pair from a constructor node.</p>`;
    renderStints("stint-a", "stint-a-heading", null);
    renderStints("stint-b", "stint-b-heading", null);
    return;
  }
  $("battle-heads").innerHTML = driverCardMarkup(driverA, "Driver A") + driverCardMarkup(driverB, "Driver B");
  renderPairBars($("battle-chart"), driverA, driverB, raceMetrics(driverA, driverB));
  renderStints("stint-a", "stint-a-heading", driverA);
  renderStints("stint-b", "stint-b-heading", driverB);
}

function renderResultsChart(drivers) {
  const classified = (drivers || []).filter((driver) => driver.finishPosition != null);
  const fieldSize = classified.length || 1;
  renderBarChart(
    $("results-chart"),
    classified.map((driver) => ({
      position: `P${driver.finishPosition}`,
      name: driver.fullName,
      shortName: driver.acronym || driver.fullName,
      teamName: driver.teamName,
      colour: driver.teamColour,
      value: fieldSize - driver.finishPosition + 1,
      display: driver.dnf ? "DNF" : driver.dsq ? "DSQ" : `P${driver.finishPosition}`,
    })),
    { ariaLabel: "Race finishing order" }
  );
}

function renderTimeline(events) {
  const list = $("timeline");
  if (!events.length) {
    list.innerHTML = `<li>No race-control events matched the display filter.</li>`;
    return;
  }
  list.innerHTML = events
    .map((event) => {
      const lap = event.lapNumber != null ? `Lap ${event.lapNumber}` : "Lap —";
      const flag = event.flag ? `${event.flag} — ` : "";
      return `<li><span class="lap">${escapeHtml(lap)}</span><span class="cat">${escapeHtml(event.category)}</span> ${escapeHtml(flag)}${escapeHtml(event.message)}</li>`;
    })
    .join("");
}

function renderDashboard(dashboard) {
  state.dashboard = dashboard;
  renderFreshness(dashboard);
  renderNextMeeting(dashboard.nextMeeting);
  renderLatestRace(dashboard.latestRace);
  renderChampionships(dashboard);
  renderSeason(dashboard.previousRaces || []);
    graph.mode = "championship";
    renderActiveGraph();
    setBattleAvailable(false);
    renderFieldOptions();
    setPageLoading(false);
}

function setRaceLoading(loading, message) {
  const skeleton = $("race-skeleton");
  const body = $("race-body");
  const status = $("race-status");
  skeleton.hidden = !loading;
  body.hidden = loading;
  if (message) {
    status.hidden = false;
    status.dataset.tone = loading ? "loading" : "";
    status.textContent = message;
  } else {
    status.hidden = true;
    status.textContent = "";
    delete status.dataset.tone;
  }
}

async function loadRace(sessionKey) {
  state.selectedSessionKey = sessionKey;
  state.raceLoadingKey = sessionKey;
  renderSeason(state.dashboard?.previousRaces || []);
  setBattleAvailable(false);
  $("race-empty").hidden = true;
  $("race-detail-heading").textContent = "Race analysis";
  $("race-detail-meta").textContent = `Loading session ${sessionKey}`;
  setRaceLoading(true, "Fetching cached race detail…");
  $("grid").scrollIntoView({ behavior: "smooth", block: "start" });

  try {
    const response = await fetch(apiUrl(`/api/race/${sessionKey}`));
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(payload.error || `Race request failed (${response.status})`);
    }
    state.race = payload;
    state.raceLoadingKey = null;
    renderSeason(state.dashboard?.previousRaces || []);
    const meetingName = payload.meeting?.meetingName || "Selected race";
    $("race-detail-heading").textContent = meetingName;
    $("race-detail-meta").textContent = `${payload.session?.sessionName || "Race"} · ${formatDate(payload.session?.dateEnd)}`;
    $("battle-meta").textContent = `${meetingName} · pick any two drivers`;
    setRaceLoading(false);
    $("race-empty").hidden = true;
    renderDriverOptions();
    renderResultsChart(payload.drivers || []);
    setBattleAvailable(true);
    renderBattle();
    renderTimeline(payload.raceControl || []);
    graph.mode = "race";
    renderActiveGraph();
    renderFieldOptions();
  } catch (err) {
    state.race = null;
    state.raceLoadingKey = null;
    renderSeason(state.dashboard?.previousRaces || []);
    $("race-skeleton").hidden = true;
    $("race-body").hidden = true;
    $("race-empty").hidden = true;
    setBattleAvailable(false);
    const status = $("race-status");
    status.hidden = false;
    delete status.dataset.tone;
    status.textContent = err.message;
  }
}

function showChampionshipMap() {
  state.selectedSessionKey = null;
  state.race = null;
  state.raceLoadingKey = null;
  graph.mode = "championship";
  renderSeason(state.dashboard?.previousRaces || []);
  $("race-skeleton").hidden = true;
  $("race-body").hidden = true;
  $("race-empty").hidden = false;
  $("race-status").hidden = true;
  $("race-detail-heading").textContent = "Race analysis";
  $("race-detail-meta").textContent = "Select a Grand Prix on the constructor map.";
  $("battle-meta").textContent = "Any two drivers from the selected race.";
  setBattleAvailable(false);
  renderActiveGraph();
  renderFieldOptions();
}

async function loadDashboard() {
  setPageLoading(true);
  try {
    const response = await fetch(apiUrl("/api/dashboard"));
    const payload = await response.json().catch(() => ({}));
    if (response.status === 503) {
      showBanner(payload.error || "Dashboard snapshot is not available yet.");
      setText("freshness", "No snapshot yet");
      setPageLoading(false);
      return;
    }
    if (!response.ok) {
      throw new Error(payload.error || `Dashboard request failed (${response.status})`);
    }
    showBanner("");
    renderDashboard(payload);
  } catch (err) {
    showBanner(err.message);
    setText("freshness", "Failed to load dashboard");
    setPageLoading(false);
  }
}

const graph = {
  nodes: [],
  links: [],
  canvas: null,
  ctx: null,
  wrap: null,
  raf: 0,
  hover: null,
  selected: null,
  yaw: 0,
  drag: null,
  dragMoved: false,
  dragOrigin: null,
  held: false,
  mode: "championship",
  drawerMode: "pack",
  width: 0,
  height: 0,
  dpr: 1,
  ticks: 0,
  running: false,
};

function hexToRgb(hex) {
  const value = String(hex || "6B7280").replace("#", "");
  return {
    r: parseInt(value.slice(0, 2), 16) || 107,
    g: parseInt(value.slice(2, 4), 16) || 114,
    b: parseInt(value.slice(4, 6), 16) || 128,
  };
}

function rgba(hex, alpha) {
  const { r, g, b } = hexToRgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function teamShortName(name) {
  return String(name || "")
    .replace(" Racing", "")
    .replace(" F1 Team", "");
}

function hubNode({ id, label, short, meta }) {
  return {
    id,
    kind: "event",
    label,
    short,
    colour: "#E3C25B",
    value: 220,
    meta,
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
  };
}

function buildChampionshipGraph(dashboard) {
  const teams = dashboard.teamChampionship || [];
  const nodes = [
    hubNode({
      id: "championship",
      label: "2026 Championship",
      short: "2026",
      meta: "Click a constructor to compare its two cars",
    }),
  ];
  const links = [];
  teams.forEach((team, index) => {
    const angle = (index / Math.max(teams.length, 1)) * Math.PI * 2 - Math.PI / 2;
    nodes.push({
      id: `team:${team.teamName}`,
      kind: "team",
      label: team.teamName,
      short: teamShortName(team.teamName),
      colour: teamColour(team.teamColour, team.teamName),
      value: Number(team.points) || 0,
      rank: Number(team.position) || teams.length,
      meta: `P${team.position} · ${team.points} pts`,
      teamName: team.teamName,
      x: 0,
      y: 0,
      vx: 0,
      vy: 0,
    });
    links.push({ source: nodes.length - 1, target: 0, kind: "event" });
  });
  graph.nodes = nodes;
  graph.links = links;
}

function buildRaceGraph(race) {
  const meetingName = race.meeting?.meetingName || "Race";
  const nodes = [
    hubNode({
      id: "event",
      label: meetingName,
      short: meetingName.replace(" Grand Prix", " GP"),
      meta: `${race.session?.sessionName || "Race"} · ${formatDate(race.session?.dateEnd)} · ${race.meeting?.circuit || race.meeting?.location || ""}`,
    }),
  ];
  const links = [];
  const drivers = race.drivers || [];
  const teamNames = [...new Set(drivers.map((driver) => driver.teamName).filter(Boolean))];
  teamNames.forEach((name, index) => {
    const angle = (index / Math.max(teamNames.length, 1)) * Math.PI * 2 - Math.PI / 2;
    const sample = drivers.find((driver) => driver.teamName === name);
    const cars = drivers.filter((driver) => driver.teamName === name);
    const classified = cars
      .map((car) => car.finishPosition)
      .filter((position) => position != null);
    const rank = classified.length ? Math.min(...classified) : 99;
    const lead = cars.find((car) => car.finishPosition === rank);
    nodes.push({
      id: `team:${name}`,
      kind: "team",
      label: name,
      short: teamShortName(name),
      colour: teamColour(sample?.teamColour, name),
      value: classified.length ? Math.max(1, 22 - rank) : 4,
      rank,
      meta: classified.length ? `Best ${lead?.acronym || ""} P${rank} · ${cars.length} cars` : `${cars.length} cars · no classified finish`,
      teamName: name,
      x: 0,
      y: 0,
      vx: 0,
      vy: 0,
    });
    links.push({ source: nodes.length - 1, target: 0, kind: "event" });
  });
  graph.nodes = nodes;
  graph.links = links;
}

function nodeRadius(node) {
  if (node.kind === "event") return 11;
  return 8;
}

function graphPoint(event) {
  const rect = graph.canvas.getBoundingClientRect();
  return {
    x: event.clientX - rect.left - graph.width / 2,
    y: event.clientY - rect.top - graph.height / 2,
  };
}

function hitNode(point) {
  let found = null;
  let best = Infinity;
  for (const node of graph.nodes) {
    if (node.kind === "event") continue;
    const dist = Math.hypot(node.x - point.x, node.y - point.y);
    const radius = nodeRadius(node) + 10;
    if (dist <= radius && dist < best) {
      found = node;
      best = dist;
    }
  }
  return found;
}

function normalizeTrackKey(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/grand prix/g, "")
    .replace(/[^a-z0-9]+/g, "");
}

function meetingForTrack() {
  if (graph.mode === "race" && state.race?.meeting) return state.race.meeting;
  return state.dashboard?.nextMeeting || null;
}

function resolveTrack() {
  const data = window.PITWALL_TRACKS;
  const meeting = meetingForTrack();
  if (!data?.outlines || !data.alias || !meeting) return null;
  const keys = [meeting.circuit, meeting.location, meeting.meetingName];
  let id = null;
  for (const part of keys) {
    const alias = data.alias[normalizeTrackKey(part)];
    if (alias) {
      id = alias;
      break;
    }
  }
  const rec = id ? data.outlines[id] : null;
  if (!rec?.pts?.length) return null;
  const outline = [];
  for (let i = 0; i < rec.pts.length; i += 2) outline.push([rec.pts[i], rec.pts[i + 1]]);
  return { id, name: rec.name, location: rec.location, outline };
}

function rotateTrackPoint(east, north, yaw) {
  const mx = east;
  const my = -north;
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  return { x: mx * c - my * s, y: mx * s + my * c };
}

function trackFitScale(outline, yaw, rx) {
  let maxAbs = 1e-6;
  for (const [east, north] of outline) {
    const point = rotateTrackPoint(east, north, yaw);
    maxAbs = Math.max(maxAbs, Math.abs(point.x), Math.abs(point.y));
  }
  return rx / maxAbs;
}

function projectTrack(east, north, yaw, cx, cy, scale, iso) {
  const point = rotateTrackPoint(east, north, yaw);
  return { x: cx + point.x * scale, y: cy + point.y * scale * iso };
}

function sampleTrack(outline, t) {
  const count = outline.length;
  const wrapped = ((t % 1) + 1) % 1;
  const index = wrapped * count;
  const i0 = Math.floor(index) % count;
  const i1 = (i0 + 1) % count;
  const f = index - Math.floor(index);
  const a = outline[i0];
  const b = outline[i1];
  return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f];
}

function plotOrigin() {
  const usableW = Math.max(160, graph.width - 48);
  const usableH = Math.max(170, graph.height - 52);
  const iso = 1;
  const rx = Math.max(90, Math.min(usableW * 0.46, usableH * 0.46));
  const track = resolveTrack();
  return {
    x: 0,
    y: 8,
    rx,
    ry: rx * iso,
    iso,
    scale: track ? trackFitScale(track.outline, 0, rx) : rx,
    track,
  };
}

function projectedCentroid(outline, plot) {
  let x = 0;
  let y = 0;
  for (const [east, north] of outline) {
    const point = projectTrack(east, north, 0, plot.x, plot.y, plot.scale, plot.iso);
    x += point.x;
    y += point.y;
  }
  const n = outline.length || 1;
  return { x: x / n, y: y / n };
}

function inwardNormal(px, py, tx, ty, center) {
  const len = Math.hypot(tx, ty) || 1;
  let nx = -ty / len;
  let ny = tx / len;
  if (nx * (center.x - px) + ny * (center.y - py) < 0) {
    nx = -nx;
    ny = -ny;
  }
  return { x: nx, y: ny };
}

function interpolatePath(points, distances, target) {
  let i = 1;
  while (i < distances.length && distances[i] < target) i += 1;
  i = Math.min(i, points.length - 1);
  const span = distances[i] - distances[i - 1] || 1;
  const f = (target - distances[i - 1]) / span;
  const a = points[i - 1];
  const b = points[i];
  return {
    x: a.x + (b.x - a.x) * f,
    y: a.y + (b.y - a.y) * f,
    tx: b.x - a.x,
    ty: b.y - a.y,
  };
}

function layoutMountain() {
  if (!graph.width || !graph.nodes.length) return;
  const plot = plotOrigin();
  const hub = graph.nodes.find((node) => node.kind === "event");
  const teams = graph.nodes.filter((node) => node.kind === "team");
  if (hub) {
    hub.x = plot.x;
    hub.surfaceY = -((graph.height || 320) / 2) + 18;
    hub.pinH = 0;
    hub.y = hub.surfaceY;
    hub.angle = 0;
    hub.depth = -1;
  }
  const ranked = [...teams].sort((a, b) => (a.rank || 99) - (b.rank || 99));
  const count = ranked.length || 1;
  if (plot.track) {
    const points = plot.track.outline.map(([east, north]) =>
      projectTrack(east, north, 0, plot.x, plot.y, plot.scale, plot.iso)
    );
    const distances = [0];
    for (let i = 1; i < points.length; i += 1) {
      distances.push(distances[i - 1] + Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y));
    }
    const available = distances[distances.length - 1] || 1;
    const span = Math.min(available * 0.58, Math.max((count - 1) * 48, available * 0.28));
    const step = count <= 1 ? 0 : span / Math.max(count - 1, 1);
    const center = projectedCentroid(plot.track.outline, plot);
    ranked.forEach((team, index) => {
      const placed = interpolatePath(points, distances, index * step);
      const normal = inwardNormal(placed.x, placed.y, placed.tx, placed.ty, center);
      team.x = placed.x;
      team.surfaceY = placed.y;
      team.y = placed.y;
      team.pinH = 0;
      team.angle = Math.atan2(placed.ty, placed.tx);
      team.depth = placed.y;
      team.labelDx = normal.x;
      team.labelDy = normal.y;
    });
  } else {
    const span = Math.PI * 0.95;
    ranked.forEach((team, index) => {
      const t = count <= 1 ? 0 : index / Math.max(count - 1, 1);
      const angle = -Math.PI / 2 + t * span;
      team.x = plot.x + Math.cos(angle) * plot.rx;
      team.surfaceY = plot.y + Math.sin(angle) * plot.ry;
      team.y = team.surfaceY;
      team.pinH = 0;
      team.angle = angle;
      team.depth = Math.sin(angle);
      team.labelDx = -Math.cos(angle);
      team.labelDy = -Math.sin(angle);
    });
  }
  graph.plot = plot;
}

function contourPath(ctx, cx, cy, rx, ry, seed) {
  ctx.beginPath();
  const steps = 72;
  for (let i = 0; i <= steps; i += 1) {
    const a = (i / steps) * Math.PI * 2;
    const wobble = 1 + Math.sin(a * 3 + seed * 0.45) * 0.04 + Math.sin(a * 7 + seed) * 0.02;
    const x = cx + Math.cos(a) * rx * wobble;
    const y = cy + Math.sin(a) * ry * wobble;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
}

function trackContourPath(ctx, outline, yaw, cx, cy, scale, iso) {
  ctx.beginPath();
  outline.forEach(([east, north], index) => {
    const point = projectTrack(east, north, yaw, cx, cy, scale, iso);
    if (index === 0) ctx.moveTo(point.x, point.y);
    else ctx.lineTo(point.x, point.y);
  });
  ctx.closePath();
}

function drawStartFinish(ctx, plot, yaw) {
  const outline = plot.track?.outline;
  if (!outline || outline.length < 2) return;
  const a = outline[0];
  const b = outline[1];
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len = Math.hypot(dx, dy) || 1;
  const nx = -dy / len;
  const ny = dx / len;
  const width = 0.055;
  const left = projectTrack(a[0] + nx * width, a[1] + ny * width, yaw, plot.x, plot.y, plot.scale, plot.iso);
  const right = projectTrack(a[0] - nx * width, a[1] - ny * width, yaw, plot.x, plot.y, plot.scale, plot.iso);
  ctx.beginPath();
  ctx.moveTo(left.x, left.y);
  ctx.lineTo(right.x, right.y);
  ctx.strokeStyle = "rgba(236, 240, 244, 0.92)";
  ctx.lineWidth = 3;
  ctx.lineCap = "butt";
  ctx.stroke();
}

function drawMountainBase(ctx, plot) {
  if (plot.track) {
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    trackContourPath(ctx, plot.track.outline, 0, plot.x, plot.y, plot.scale, plot.iso);
    ctx.fillStyle = "rgba(14, 20, 28, 0.92)";
    ctx.fill();
    ctx.strokeStyle = "rgba(32, 42, 54, 1)";
    ctx.lineWidth = 13;
    ctx.stroke();
    ctx.strokeStyle = "rgba(210, 224, 232, 0.95)";
    ctx.lineWidth = 2.3;
    ctx.stroke();
    drawStartFinish(ctx, plot, 0);
    ctx.fillStyle = "rgba(176, 196, 210, 0.78)";
    ctx.font = "600 10px Segoe UI, sans-serif";
    ctx.textAlign = "center";
    const labelY = Math.min(plot.y + plot.ry + 24, (graph.height || 320) / 2 - 12);
    ctx.fillText(plot.track.name, plot.x, labelY);
    return;
  }

  contourPath(ctx, plot.x, plot.y, plot.rx, plot.ry, 1);
  ctx.fillStyle = "rgba(14, 20, 28, 0.92)";
  ctx.fill();
  ctx.strokeStyle = "rgba(198, 214, 224, 0.55)";
  ctx.lineWidth = 1.8;
  ctx.stroke();
}

function drawPeakFlag(ctx, node) {
  const x = node.x;
  const y = node.y - 9;
  ctx.beginPath();
  ctx.moveTo(x, node.y);
  ctx.lineTo(x, y);
  ctx.strokeStyle = "#e8eaed";
  ctx.lineWidth = 1.6;
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x + 14, y + 5);
  ctx.lineTo(x, y + 12);
  ctx.closePath();
  ctx.fillStyle = rgba(node.colour, 1);
  ctx.fill();
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = 1;
  ctx.stroke();
}

function relatedNodes(node) {
  if (!node) return null;
  const related = new Set([node]);
  for (const link of graph.links) {
    const a = graph.nodes[link.source];
    const b = graph.nodes[link.target];
    if (a === node) related.add(b);
    if (b === node) related.add(a);
  }
  return related;
}

function driversForTeam(teamName) {
  if (graph.mode === "race" && state.race) {
    return (state.race.drivers || []).filter((driver) => driver.teamName === teamName);
  }
  return (state.dashboard?.driverChampionship || []).filter((driver) => driver.teamName === teamName);
}

function bubbleCell(value, tone) {
  return `<span class="bubble-val${tone ? ` ${tone}` : ""}">${escapeHtml(value)}</span>`;
}

function renderNodePanel(node) {
  const body = $("node-body");
  const stints = $("node-stints");
  const meta = $("node-meta");
  if (!body || !stints) return;
  if (!node || node.kind !== "team") {
    if (meta) meta.textContent = "Tap a constructor pin on the circuit.";
    $("field-heading").textContent = "Constructor";
    body.innerHTML = `<p class="muted">The left panel swaps between a mixed pack and the constructor you tap.</p>`;
    stints.innerHTML = "";
    return;
  }

  const cars = driversForTeam(node.label);
  const carA = cars[0] || null;
  const carB = cars[1] || null;
  $("field-heading").textContent = node.label;
  if (meta) meta.textContent = node.meta || "Teammate split.";

  let rows = "";
  if (!cars.length) {
    rows = `<p class="muted">No drivers attached to this constructor.</p>`;
  } else if (graph.mode === "race") {
    const bestFinish = Math.min(
      ...cars.map((driver) => (driver && !driver.dnf && !driver.dsq && driver.finishPosition != null ? driver.finishPosition : Infinity))
    );
    const times = cars.map((driver) => driver?.fastestLap).filter((value) => typeof value === "number");
    const bestTime = times.length ? Math.min(...times) : null;
    const finish = (driver) => {
      if (driver?.dsq) return "DSQ";
      if (driver?.dnf) return "DNF";
      if (driver?.finishPosition != null) return `P${driver.finishPosition}`;
      return "—";
    };
    rows = `<div class="bubble-grid">
      <span class="bubble-label"></span>
      <div class="bubble-driver">${escapeHtml(packAcronym(carA))}<span>${escapeHtml(carA?.fullName || "—")}</span></div>
      <div class="bubble-driver">${escapeHtml(packAcronym(carB))}<span>${escapeHtml(carB?.fullName || "—")}</span></div>
      <span class="bubble-label">Finish</span>
      ${bubbleCell(finish(carA), carA?.finishPosition === bestFinish && Number.isFinite(bestFinish) ? "is-best" : "")}
      ${bubbleCell(finish(carB), carB?.finishPosition === bestFinish && Number.isFinite(bestFinish) ? "is-best" : "")}
      <span class="bubble-label">Places</span>
      ${bubbleCell(formatPlaces(carA?.placesGained), carA?.placesGained > 0 ? "is-up" : carA?.placesGained < 0 ? "is-down" : "")}
      ${bubbleCell(formatPlaces(carB?.placesGained), carB?.placesGained > 0 ? "is-up" : carB?.placesGained < 0 ? "is-down" : "")}
      <span class="bubble-label">Fastest</span>
      ${bubbleCell(formatLap(carA?.fastestLap), carA?.fastestLap === bestTime && bestTime != null ? "is-best" : "")}
      ${bubbleCell(formatLap(carB?.fastestLap), carB?.fastestLap === bestTime && bestTime != null ? "is-best" : "")}
      <span class="bubble-label">Stops</span>
      ${bubbleCell(carA?.pitStops ?? "—", "")}
      ${bubbleCell(carB?.pitStops ?? "—", "")}
      <span class="bubble-label">Overtakes</span>
      ${bubbleCell(carA?.overtakes ?? "—", "")}
      ${bubbleCell(carB?.overtakes ?? "—", "")}
    </div>`;
    if (carA && carB) {
      rows += `<div class="bubble-action"><button type="button" data-send-battle="${escapeHtml(carA.driverNumber)},${escapeHtml(carB.driverNumber)}">Send pair to Battle</button></div>`;
    }
    stints.innerHTML = `<div>
        <h4>${escapeHtml(carA?.fullName || "—")}</h4>
        <div class="stint-track">${stintTrackMarkup(carA)}</div>
      </div>
      <div>
        <h4>${escapeHtml(carB?.fullName || "—")}</h4>
        <div class="stint-track">${stintTrackMarkup(carB)}</div>
      </div>`;
  } else {
    const positions = cars.map((driver) => driver?.position).filter((value) => value != null);
    const bestPosition = positions.length ? Math.min(...positions) : null;
    const points = cars.map((driver) => Number(driver?.points)).filter((value) => Number.isFinite(value));
    const bestPoints = points.length ? Math.max(...points) : null;
    rows = `<div class="bubble-grid">
      <span class="bubble-label"></span>
      <div class="bubble-driver">${escapeHtml(packAcronym(carA))}<span>${escapeHtml(carA?.fullName || "—")}</span></div>
      <div class="bubble-driver">${escapeHtml(packAcronym(carB))}<span>${escapeHtml(carB?.fullName || "—")}</span></div>
      <span class="bubble-label">Pos</span>
      ${bubbleCell(carA?.position != null ? `P${carA.position}` : "—", carA?.position === bestPosition && bestPosition != null ? "is-best" : "")}
      ${bubbleCell(carB?.position != null ? `P${carB.position}` : "—", carB?.position === bestPosition && bestPosition != null ? "is-best" : "")}
      <span class="bubble-label">Pts</span>
      ${bubbleCell(carA?.points ?? "—", carA?.points === bestPoints && bestPoints != null ? "is-best" : "")}
      ${bubbleCell(carB?.points ?? "—", carB?.points === bestPoints && bestPoints != null ? "is-best" : "")}
    </div>`;
    stints.innerHTML = "";
  }

  body.innerHTML = `<div class="bubble-head"><span class="swatch" style="background:${escapeHtml(node.colour)}"></span>${escapeHtml(node.label)}</div>${rows}`;
}

function syncSelectedNode() {
  const key = graph.selected?.id || graph.selected?.teamName;
  if (!key) {
    if (graph.drawerMode === "node" && $("field-drawer")?.classList.contains("is-open")) {
      renderNodePanel(null);
    }
    return;
  }
  graph.selected = graph.nodes.find((node) => node.id === key || node.teamName === key) || null;
  if (graph.drawerMode === "node" && $("field-drawer")?.classList.contains("is-open")) {
    renderNodePanel(graph.selected);
  }
}

function handleNodeClick(node) {
  const open = $("field-drawer")?.classList.contains("is-open");
  if (node && node.kind === "team") {
    if (open && graph.drawerMode === "node" && graph.selected?.id === node.id) {
      setFieldDrawerOpen(false);
    } else {
      graph.selected = node;
      setDrawerMode("node");
    }
  }
  paintGraph();
}

function setBattleDriver(slot, driverNumber) {
  if (!state.race || driverNumber == null || driverNumber === "") return;
  const select = $(slot === "a" ? "driver-a" : "driver-b");
  if (!select) return;
  select.value = String(driverNumber);
  renderBattle();
}

function drawGraph() {
  const ctx = graph.ctx;
  if (!ctx || !graph.canvas) return;
  const w = graph.width || graph.canvas.clientWidth;
  const h = graph.height || graph.canvas.clientHeight;
  graph.canvas.dataset.size = `${Math.round(w)}x${Math.round(h)}:${graph.nodes.length}`;
  ctx.save();
  ctx.setTransform(graph.dpr || 1, 0, 0, graph.dpr || 1, 0, 0);
  ctx.fillStyle = "#07090d";
  ctx.fillRect(0, 0, w, h);
  ctx.translate(w / 2, h / 2);

  const plot = graph.plot || plotOrigin();
  drawMountainBase(ctx, plot);

  const hub = graph.nodes.find((node) => node.kind === "event");
  const teams = graph.nodes.filter((node) => node.kind === "team");
  const ranked = [...teams].sort((a, b) => (a.rank || 99) - (b.rank || 99));

  if (hub) {
    ctx.font = "600 12px Segoe UI, sans-serif";
    ctx.fillStyle = "#e8eaed";
    ctx.textAlign = "center";
    ctx.fillText(hub.short, plot.x, -((graph.height || 320) / 2) + 18);
  }

  const drawPin = (node) => {
    if (node.kind === "event") return;
    const selected = node === graph.selected || node === graph.hover;
    const radius = node.rank === 1 ? 10 : 8;
    if (node.rank === 1) drawPeakFlag(ctx, node);
    ctx.beginPath();
    ctx.arc(node.x, node.y, radius, 0, Math.PI * 2);
    ctx.fillStyle = rgba(node.colour, 1);
    ctx.fill();
    ctx.lineWidth = selected ? 2.6 : 1.7;
    ctx.strokeStyle = "#ffffff";
    ctx.stroke();
    ctx.font = "600 11px Segoe UI, sans-serif";
    ctx.fillStyle = "#e8eaed";
    const label = node.rank && node.rank < 99 ? `${node.short}  P${node.rank}` : node.short;
    const dx = node.labelDx || 1;
    const dy = node.labelDy || 0;
    ctx.textAlign = Math.abs(dx) < 0.35 ? "center" : dx > 0 ? "left" : "right";
    ctx.fillText(label, node.x + dx * (radius + 10), node.y + dy * (radius + 8) + 4);
  };

  [...ranked].reverse().forEach(drawPin);
  ctx.restore();
}

function schedulePlot() {
  requestAnimationFrame(resizeGraph);
  requestAnimationFrame(() => requestAnimationFrame(resizeGraph));
  setTimeout(resizeGraph, 240);
}

function paintGraph() {
  if (!graph.ctx) return;
  layoutMountain();
  drawGraph();
}

function resizeGraph() {
  if (!graph.canvas || !graph.wrap) return false;
  const width = Math.max(160, Math.round(graph.canvas.clientWidth || graph.wrap.clientWidth));
  const height = Math.max(360, Math.round(graph.canvas.clientHeight || graph.wrap.clientHeight));
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const changed = !(width === graph.width && height === graph.height && dpr === graph.dpr && graph.canvas.width);
  if (changed) {
    graph.dpr = dpr;
    graph.width = width;
    graph.height = height;
    graph.canvas.width = Math.round(width * dpr);
    graph.canvas.height = Math.round(height * dpr);
    graph.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  paintGraph();
  return changed;
}

function updateGraphChrome() {
  const raceMode = graph.mode === "race" && state.race;
  const track = resolveTrack();
  const trackBit = track ? track.name : "";
  if (raceMode) {
    const name = state.race.meeting?.meetingName || "Selected race";
    $("grid-heading").textContent = "Race constructors";
    $("graph-copy").textContent = `${name} · ${trackBit || state.race.meeting?.circuit || ""} · P1 at start/finish, then finishing order along the circuit. Tap a pin for the constructor split.`
      .replace(/\s+/g, " ")
      .trim();
  } else {
    $("grid-heading").textContent = "Constructor map";
    const next = state.dashboard?.nextMeeting;
    const nextBit = track && next ? ` Circuit is ${track.name} (${next.meetingName}).` : "";
    $("graph-copy").textContent = `P1 at start/finish, then championship order along the circuit.${nextBit} Tap a pin for the constructor split.`;
  }
}

function renderActiveGraph() {
  graph.canvas = $("grid-canvas");
  graph.wrap = graph.canvas.parentElement;
  graph.ctx = graph.canvas.getContext("2d");
  if (graph.mode === "race" && state.race) {
    buildRaceGraph(state.race);
  } else {
    graph.mode = "championship";
    buildChampionshipGraph(state.dashboard || {});
  }
  $("grid").dataset.nodes = String(graph.nodes.length);
  updateGraphChrome();
  syncSelectedNode();
  resizeGraph();
}

function initGraphInteractions() {
  const canvas = $("grid-canvas");
  canvas.addEventListener("pointerdown", (event) => {
    graph.held = true;
    graph.dragMoved = false;
    graph.dragOrigin = graphPoint(event);
  });
  canvas.addEventListener("pointermove", (event) => {
    const point = graphPoint(event);
    if (graph.held && graph.dragOrigin) {
      const distance = Math.hypot(point.x - graph.dragOrigin.x, point.y - graph.dragOrigin.y);
      if (distance > 6) graph.dragMoved = true;
    }
    const node = hitNode(point);
    if (node !== graph.hover) {
      graph.hover = node;
      drawGraph();
    }
  });
  canvas.addEventListener("pointerup", (event) => {
    if (!graph.dragMoved) handleNodeClick(hitNode(graphPoint(event)));
    graph.held = false;
    graph.dragMoved = false;
    graph.dragOrigin = null;
  });
  canvas.addEventListener("pointerleave", () => {
    graph.hover = null;
    graph.held = false;
    drawGraph();
  });
  window.addEventListener("resize", resizeGraph);
  const plotObserver = new ResizeObserver(() => {
    if (!graph.ctx) return;
    resizeGraph();
  });
  plotObserver.observe(canvas);
  if (canvas.parentElement) plotObserver.observe(canvas.parentElement);
}

function initPageNav() {
  const links = [...document.querySelectorAll(".page-nav a")];
  const sections = links
    .map((link) => document.querySelector(link.getAttribute("href")))
    .filter(Boolean);
  const observer = new IntersectionObserver(
    (entries) => {
      const visible = entries
        .filter((entry) => entry.isIntersecting)
        .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
      if (!visible) return;
      links.forEach((link) => {
        link.classList.toggle("is-active", link.getAttribute("href") === `#${visible.target.id}`);
      });
    },
    { rootMargin: "-30% 0px -55% 0px", threshold: [0.15, 0.4, 0.7] }
  );
  sections.forEach((section) => observer.observe(section));
}

$("season").addEventListener("change", (event) => {
  const key = event.target.value;
  if (!key) {
    showChampionshipMap();
    return;
  }
  loadRace(key);
});

$("mode-pack").addEventListener("click", () => toggleDrawerMode("pack"));
$("mode-node").addEventListener("click", () => toggleDrawerMode("node"));

$("field-close").addEventListener("click", () => setFieldDrawerOpen(false));

fieldSelects().forEach((select, index) => {
  select?.addEventListener("change", () => onFieldSlotChange(index + 1));
});

$("node-panel").addEventListener("click", (event) => {
  const button = event.target.closest("[data-send-battle]");
  if (!button) return;
  const [driverA, driverB] = button.getAttribute("data-send-battle").split(",");
  setBattleDriver("a", driverA);
  setBattleDriver("b", driverB);
  $("battle").scrollIntoView({ behavior: "smooth", block: "start" });
});

document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") return;
  if ($("field-drawer").classList.contains("is-open")) {
    setFieldDrawerOpen(false);
  }
});

$("driver-a").addEventListener("change", renderBattle);
$("driver-b").addEventListener("change", renderBattle);

initGraphInteractions();
initPageNav();
state.countdownTimer = setInterval(tickCountdown, 1000);
loadDashboard();
