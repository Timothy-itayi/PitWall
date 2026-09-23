const state = {
  dashboard: null,
  race: null,
  battle: null,
  telemetry: null,
  telemetryDriver: null,
  telemetrySeq: 0,
  selectedSessionKey: null,
  battleSessionKey: null,
  raceLoadingKey: null,
  battleLoadingKey: null,
  raceCache: new Map(),
  raceInflight: new Map(),
  compareCards: [],
  countdownTarget: null,
  countdownTimer: null,
};

const COMPARE_CAP = 6;

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

function formatDay(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString(undefined, { day: "numeric", month: "short", timeZone: "UTC" });
}

function formatClock(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString(undefined, {
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone: "UTC",
  });
}

function formatPoints(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "—";
  return Number.isInteger(number) ? String(number) : number.toFixed(1);
}

function formatGap(leader, points) {
  const value = Number(points);
  if (!Number.isFinite(value) || !Number.isFinite(leader)) return "—";
  const gap = leader - value;
  if (gap === 0) return "—";
  return `−${formatPoints(gap)}`;
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
    ? `<span class="freshness-line">Updated ${escapeHtml(stamp)}</span><span class="freshness-note">OpenF1 refresh failed. Showing the last good snapshot.</span>`
    : `<span class="freshness-line">Updated ${escapeHtml(stamp)}</span>`;
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
  const circuit = meeting.circuit || "";
  setText("meeting-circuit", normalizeTrackKey(circuit) === normalizeTrackKey(meeting.location) ? "" : circuit);
  setText("next-gp-meta", `${formatDay(meeting.dateStart)} – ${formatDay(meeting.dateEnd)}`);
  state.countdownTarget = countdownTarget(meeting);
  tickCountdown();

  const sessions = meeting.sessions || [];
  $("schedule-body").innerHTML = sessions.length
    ? sessions
        .map(
          (session) => `
            <tr>
              <td>${escapeHtml(session.sessionName)}</td>
              <td>${escapeHtml(formatClock(session.dateStart))}</td>
              <td>${escapeHtml(formatClock(session.dateEnd))}</td>
            </tr>`
        )
        .join("")
    : `<tr><td colspan="3">No sessions published for this meeting.</td></tr>`;
}

function splitName(fullName) {
  const parts = String(fullName || "").trim().split(/\s+/);
  if (parts.length < 2) return { first: "", last: parts[0] || "" };
  return { first: parts.slice(0, -1).join(" "), last: parts[parts.length - 1] };
}

function renderLatestRace(race) {
  const podium = $("podium");
  if (!race) {
    setText("latest-meta", "");
    podium.innerHTML = `<li class="podium-empty">No completed Grand Prix yet.</li>`;
    return;
  }
  setText("latest-meta", `${race.meetingName}, ${formatDay(race.date)}`);
  const top3 = race.top3 || [];
  podium.innerHTML = top3.length
    ? top3
        .map((row) => {
          const colour = teamColour(row.teamColour, row.teamName);
          const { first, last } = splitName(row.fullName);
          return `
            <li style="--team:${escapeHtml(colour)}">
              <span class="pos"><span class="sr-only">Position </span>${escapeHtml(row.position)}</span>
              <span class="name"><span class="first">${escapeHtml(first)}</span> <span class="last">${escapeHtml(last)}</span></span>
              <span class="team">${escapeHtml(row.teamName || "")}</span>
            </li>`;
        })
        .join("")
    : `<li class="podium-empty">Results not published yet.</li>`;
}

function standingsRowMarkup(row, leader, { extra = "" } = {}) {
  const colour = teamColour(row.colour, row.teamName);
  const detail = row.detail ? `<span class="standings-secondary">${escapeHtml(row.detail)}</span>` : "";
  return `
    <li class="standings-row${Number(row.position) === 1 ? " is-leader" : ""}" style="--team:${escapeHtml(colour)}">
      <span class="standings-pos">${escapeHtml(row.position ?? "")}</span>
      <span class="standings-name" title="${escapeHtml(row.name)}">
        <span class="team-pip" style="background:${escapeHtml(colour)}"></span>
        <span class="standings-primary">${escapeHtml(row.shortName || row.name)}</span>
        ${detail}
      </span>
      ${extra}
      <span class="standings-pts">${escapeHtml(formatPoints(row.points))}</span>
      <span class="standings-gap">${escapeHtml(formatGap(leader, row.points))}</span>
    </li>`;
}

// Standings as one or more columns. Long lists split so the whole field
// fits the tile with no scrolling.
function renderStandings(container, rows, ariaLabel, { columns = 1, head = ["Pos", "Driver", "Pts", "Gap"], extra } = {}) {
  if (!container) return;
  container.classList.add("standings");
  if (ariaLabel) container.setAttribute("aria-label", ariaLabel);
  if (!rows.length) {
    container.innerHTML = `<p class="stint-empty">No championship data.</p>`;
    return;
  }
  const leader = Number(rows[0]?.points);
  const perColumn = Math.ceil(rows.length / columns);
  const chunks = [];
  for (let i = 0; i < rows.length; i += perColumn) chunks.push(rows.slice(i, i + perColumn));
  container.style.setProperty("--rows", perColumn);
  container.innerHTML = chunks
    .map(
      (chunk, index) => `
      <div class="standings-col">
        <div class="standings-head" aria-hidden="true">${head.map((label) => `<span>${escapeHtml(label)}</span>`).join("")}</div>
        <ol class="standings-list" start="${index * perColumn + 1}">
          ${chunk.map((row) => standingsRowMarkup(row, leader, { extra: extra ? extra(row) : "" })).join("")}
        </ol>
      </div>`
    )
    .join("");
}

function renderChampionships(dashboard) {
  const drivers = dashboard.driverChampionship || [];
  const meta = $("drivers-meta");
  if (meta) {
    const [lead, second] = drivers;
    const margin = lead && second ? (Number(lead.points) || 0) - (Number(second.points) || 0) : null;
    meta.textContent =
      margin == null ? "" : margin === 0 ? "Level on points at the top" : `${lead.acronym || lead.fullName} leads by ${formatPoints(margin)}`;
  }
  renderStandings(
    $("drivers-chart"),
    drivers.map((row) => ({
      position: row.position,
      name: row.fullName,
      shortName: row.acronym || row.fullName,
      detail: row.teamName,
      teamName: row.teamName,
      colour: row.teamColour,
      points: row.points,
    })),
    "Driver championship points",
    { columns: drivers.length > 12 ? 2 : 1 }
  );

  const teams = dashboard.teamChampionship || [];
  renderStandings(
    $("teams-chart"),
    teams.map((row) => ({
      position: row.position,
      name: row.teamName,
      shortName: row.teamName,
      teamName: row.teamName,
      colour: row.teamColour,
      points: row.points,
    })),
    "Constructor championship points",
    { head: ["Pos", "Team", "Pts", "Gap"] }
  );
}

function renderSeason(races) {
  fillRaceSelect($("season"), races, state.selectedSessionKey, {
    blankLabel: "Season championship",
    disabled: Boolean(state.raceLoadingKey),
  });
  fillRaceSelect($("battle-season"), races, state.battleSessionKey, {
    blankLabel: races?.length ? "" : "No completed race",
    disabled: Boolean(state.battleLoadingKey),
  });
  const raceSelect = $("compare-race");
  fillRaceSelect(raceSelect, races, raceSelect?.value || "", {
    blankLabel: races?.length ? "" : "No completed race",
    disabled: false,
  });
}

function fillRaceSelect(select, races, selectedKey, { blankLabel, disabled }) {
  if (!select) return;
  const selected = selectedKey ? String(selectedKey) : "";
  const options = [];
  if (blankLabel) options.push(`<option value="">${escapeHtml(blankLabel)}</option>`);
  for (const race of races || []) {
    const name = String(race.meetingName || "Grand Prix").replace(" Grand Prix", " GP");
    const place = race.circuit || race.location || "";
    options.push(
      `<option value="${escapeHtml(race.sessionKey)}">${escapeHtml(name)}${place ? ` · ${escapeHtml(place)}` : ""}</option>`
    );
  }
  select.innerHTML = options.join("");
  const hasSelected = [...select.options].some((option) => option.value === selected);
  select.value = hasSelected ? selected : select.options[0]?.value || "";
  select.disabled = disabled;
}

function driverByNumber(number) {
  const pool = state.battle?.drivers || [];
  return pool.find((driver) => String(driver.driverNumber) === String(number));
}

function renderDriverOptions() {
  const drivers = state.battle?.drivers || [];
  const options = drivers
    .map(
      (driver) =>
        `<option value="${escapeHtml(driver.driverNumber)}">${escapeHtml(driver.fullName)}${driver.finishPosition ? ` (P${driver.finishPosition})` : ""}</option>`
    )
    .join("");
  const blank = `<option value="">Select driver</option>`;
  const classified = drivers.filter((driver) => driver.finishPosition != null);
  $("driver-a").innerHTML = blank + options;
  $("driver-b").innerHTML = blank + options;
  $("driver-a").value = classified[0] ? String(classified[0].driverNumber) : "";
  $("driver-b").value = classified[1] ? String(classified[1].driverNumber) : "";
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
  if (state.battle?.drivers?.length) return state.battle.drivers;
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
  if (mode !== "node") {
    showView("battle");
    return;
  }
  graph.drawerMode = "node";
  const heading = $("field-heading");
  if (!heading) return;
  if ($("node-panel")) $("node-panel").hidden = false;
  heading.textContent = graph.selected?.label || "Constructor";
  renderNodePanel(graph.selected);
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
  if (state.battle) {
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
  const body = $("battle-body");
  if (!body || !state.battle || body.hidden) return;
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
  const container = $("results-chart");
  if (!container) return;
  const classified = (drivers || []).filter((driver) => driver.finishPosition != null);
  container.classList.add("standings");
  container.setAttribute("aria-label", "Race finishing order");
  if (!classified.length) {
    container.innerHTML = `<p class="stint-empty">No classified finishers.</p>`;
    return;
  }
  container.innerHTML = `
    <div class="standings-head" aria-hidden="true"><span>P</span><span>Name</span><span>+/−</span><span>Stops</span></div>
    <ol class="standings-list">
      ${classified
        .map((driver) => {
          const colour = teamColour(driver.teamColour, driver.teamName);
          const delta = driver.dnf || driver.dsq ? (driver.dsq ? "DSQ" : "DNF") : formatPlaces(driver.placesGained);
          const selected = String(state.telemetryDriver) === String(driver.driverNumber) ? " is-selected" : "";
          return `
            <li class="standings-row${selected}" data-driver="${escapeHtml(driver.driverNumber)}">
              <span class="standings-pos">${escapeHtml(driver.finishPosition)}</span>
              <span class="standings-name" title="${escapeHtml(driver.fullName)}">
                <span class="team-pip" style="background:${escapeHtml(colour)}"></span>
                <span class="standings-primary">${escapeHtml(driver.acronym || driver.fullName)}</span>
                <span class="standings-secondary">${escapeHtml(teamAbbrev(driver.teamName))}</span>
              </span>
              <span class="standings-pts">${escapeHtml(delta)}</span>
              <span class="standings-gap">${escapeHtml(driver.pitStops ?? "—")}</span>
            </li>`;
        })
        .join("")}
    </ol>`;
}

function renderTimeline(events) {
  const list = $("timeline");
  if (!list) return;
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

function isRosterDriver(row) {
  if (!row || row.driverNumber == null) return false;
  const name = String(row.fullName || "").trim();
  if (!name || /^driver\s*#\d+$/i.test(name)) return false;
  return Boolean(row.teamName);
}

function sanitizeDashboard(dashboard) {
  if (!dashboard) return dashboard;
  const driverChampionship = (dashboard.driverChampionship || [])
    .filter(isRosterDriver)
    .map((row, index) => ({ ...row, position: index + 1 }));
  const teamChampionship = (dashboard.teamChampionship || [])
    .filter((row) => row && row.teamName)
    .map((row, index) => ({ ...row, position: index + 1 }));
  const latestRace = dashboard.latestRace
    ? { ...dashboard.latestRace, top3: (dashboard.latestRace.top3 || []).filter(isRosterDriver) }
    : dashboard.latestRace;
  return { ...dashboard, driverChampionship, teamChampionship, latestRace };
}

function renderDashboard(dashboard) {
  state.dashboard = sanitizeDashboard(dashboard);
  renderFreshness(state.dashboard);
  renderNextMeeting(state.dashboard.nextMeeting);
  renderLatestRace(state.dashboard.latestRace);
  renderChampionships(state.dashboard);
  renderSeason(state.dashboard.previousRaces || []);
  renderFieldOptions();
  renderCompareDrivers();
  setPageLoading(false);
  requestAnimationFrame(paintNextTrack);
}

function setRaceLoading(loading, message) {
  const skeleton = $("race-skeleton");
  const body = $("race-body");
  const status = $("race-status");
  if (!skeleton || !body || !status) return;
  skeleton.hidden = !loading;
  body.hidden = loading;
  status.classList.toggle("sheen-text", Boolean(loading && message));
  if (message) {
    status.hidden = false;
    status.dataset.tone = loading ? "loading" : "";
    status.textContent = loading ? "Data coming through, give us a second or two…" : message;
  } else {
    status.hidden = true;
    status.textContent = "";
    delete status.dataset.tone;
  }
}

async function loadRace(sessionKey) {
  if (!$("race-empty") || !$("race-detail-heading") || !$("race-detail-meta")) return;
  state.selectedSessionKey = sessionKey;
  state.raceLoadingKey = sessionKey;
  renderSeason(state.dashboard?.previousRaces || []);
  $("race-empty").hidden = true;
  if ($("timeline")) $("timeline").innerHTML = "";
  $("race-detail-heading").textContent = "Race analysis";
  $("race-detail-meta").textContent = `Loading session ${sessionKey}`;
  setRaceLoading(true, "Fetching cached race detail…");

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
    setRaceLoading(false);
    $("race-empty").hidden = true;
    renderResultsChart(payload.drivers || []);
    renderTimeline(payload.raceControl || []);
    renderTelemetryDrivers(payload.drivers || []);
    paintRaceTrack();
  } catch (err) {
    state.race = null;
    state.raceLoadingKey = null;
    renderSeason(state.dashboard?.previousRaces || []);
    $("race-skeleton").hidden = true;
    $("race-body").hidden = true;
    $("race-empty").hidden = true;
    const status = $("race-status");
    status.classList.remove("sheen-text");
    status.hidden = false;
    delete status.dataset.tone;
    status.textContent = err.message;
  }
}

async function loadBattle(sessionKey) {
  const key = String(sessionKey || "");
  if (!key) return null;
  if (state.raceCache.has(key)) return state.raceCache.get(key);
  const pending = state.raceInflight.get(key);
  if (pending) return pending;
  const request = (async () => {
    const response = await fetch(apiUrl(`/api/race/${encodeURIComponent(key)}`));
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(payload.error || `Race request failed (${response.status})`);
    }
    state.raceCache.set(key, payload);
    return payload;
  })();
  state.raceInflight.set(key, request);
  try {
    return await request;
  } finally {
    if (state.raceInflight.get(key) === request) state.raceInflight.delete(key);
  }
}

function compareRosterDriver(driverNumber) {
  return (state.dashboard?.driverChampionship || []).find((driver) => String(driver.driverNumber) === String(driverNumber)) || null;
}

function compareDriverRecord(card) {
  const payload = state.raceCache.get(String(card.sessionKey));
  if (!payload) return null;
  return (payload.drivers || []).find((driver) => String(driver.driverNumber) === String(card.driverNumber)) || null;
}

function compareMeetingLabel(sessionKey) {
  const meeting = state.raceCache.get(String(sessionKey))?.meeting;
  if (meeting?.meetingName) {
    const place = meeting.circuit || meeting.location || "";
    return place ? `${meeting.meetingName} · ${place}` : meeting.meetingName;
  }
  const race = (state.dashboard?.previousRaces || []).find((row) => String(row.sessionKey) === String(sessionKey));
  if (!race) return "Grand Prix";
  const place = race.circuit || race.location || "";
  const name = race.meetingName || "Grand Prix";
  return place ? `${name} · ${place}` : name;
}

function comparePositionText(driver) {
  if (!driver) return "—";
  if (driver.dns) return "DNS";
  if (driver.dsq) return "DSQ";
  if (driver.dnf) return "DNF";
  if (driver.finishPosition != null) return `P${driver.finishPosition}`;
  return "—";
}

function compareClassified(driver) {
  return Boolean(driver) && driver.finishPosition != null && !driver.dnf && !driver.dsq && !driver.dns;
}

function setCompareNote(message) {
  const note = $("compare-note");
  if (!note) return;
  note.hidden = !message;
  note.textContent = message || "";
}

function syncCompareAdd() {
  const button = $("compare-add-btn");
  const driver = $("compare-driver")?.value || "";
  const race = $("compare-race")?.value || "";
  const full = state.compareCards.length >= COMPARE_CAP;
  if (button) button.disabled = full || !driver || !race;
  const note = $("compare-note");
  if (full) setCompareNote("Six drivers is the board limit.");
  else if (note && note.textContent === "Six drivers is the board limit.") setCompareNote("");
}

function renderCompareDrivers() {
  const select = $("compare-driver");
  if (!select) return;
  const pool = state.dashboard?.driverChampionship || [];
  const current = select.value;
  if (!pool.length) {
    select.innerHTML = `<option value="">No drivers</option>`;
    syncCompareAdd();
    return;
  }
  const groups = new Map();
  for (const driver of pool) {
    const team = driver.teamName || "Unattached";
    if (!groups.has(team)) groups.set(team, []);
    groups.get(team).push(driver);
  }
  let html = "";
  for (const [team, drivers] of groups) {
    html += `<optgroup label="${escapeHtml(team)}">`;
    for (const driver of drivers) {
      const number = driver.driverNumber != null ? ` · #${driver.driverNumber}` : "";
      html += `<option value="${escapeHtml(driver.driverNumber)}">${escapeHtml(driver.fullName || driver.acronym || "Driver")}${escapeHtml(number)}</option>`;
    }
    html += `</optgroup>`;
  }
  select.innerHTML = html;
  const keep = pool.some((driver) => String(driver.driverNumber) === String(current));
  select.value = keep ? current : String(pool[0].driverNumber);
  syncCompareAdd();
}

function compareCardMarkup(card, driver, bestFinish, bestLap) {
  const roster = compareRosterDriver(card.driverNumber);
  const source = driver || roster;
  const colour = teamColour(source?.teamColour, source?.teamName);
  const acronym = source?.acronym || "—";
  const name = source?.fullName || `Driver #${card.driverNumber}`;
  const meeting = compareMeetingLabel(card.sessionKey);
  const head = `
    <header class="compare-card-head">
      <span class="team-pip" style="background:${escapeHtml(colour)}"></span>
      <div class="compare-identity">
        <span class="compare-acronym">${escapeHtml(acronym)}</span>
        <span class="compare-name">${escapeHtml(name)}</span>
        <span class="compare-race">${escapeHtml(meeting)}</span>
      </div>
      <button type="button" class="compare-remove" data-remove-compare="${escapeHtml(card.id)}">Remove<span class="sr-only"> ${escapeHtml(name)}</span></button>
    </header>`;
  if (card.status === "loading") {
    return `<article class="compare-card is-loading" style="--team:${escapeHtml(colour)}">${head}<p class="compare-status sheen-text">Loading race…</p></article>`;
  }
  if (card.status === "error") {
    return `<article class="compare-card" style="--team:${escapeHtml(colour)}">${head}<p class="compare-status">${escapeHtml(card.error || "Race request failed")}</p></article>`;
  }
  if (card.status === "absent" || !driver) {
    return `<article class="compare-card" style="--team:${escapeHtml(colour)}">${head}<p class="compare-status">Did not start.</p></article>`;
  }
  const position = comparePositionText(driver);
  const bestPos = compareClassified(driver) && driver.finishPosition === bestFinish;
  const bestTime = typeof driver.fastestLap === "number" && driver.fastestLap === bestLap;
  return `<article class="compare-card" style="--team:${escapeHtml(colour)}">
    ${head}
    <dl class="compare-facts">
      <div>
        <dt>Position</dt>
        <dd${bestPos ? ` class="is-best"` : ""}>${escapeHtml(position)}${bestPos ? `<span class="sr-only">, best finish</span>` : ""}</dd>
      </div>
      <div>
        <dt>Fastest lap</dt>
        <dd${bestTime ? ` class="is-best"` : ""}>${escapeHtml(formatLap(driver.fastestLap))}${bestTime ? `<span class="sr-only">, quickest lap</span>` : ""}</dd>
      </div>
    </dl>
    <p class="compare-tyres-label">Tyres</p>
    <div class="stint-track">${stintTrackMarkup(driver)}</div>
  </article>`;
}

function renderCompareBoard() {
  const board = $("compare-board");
  const empty = $("compare-empty");
  if (!board) return;
  const cards = state.compareCards;
  if (empty) empty.hidden = cards.length > 0;
  board.hidden = cards.length === 0;
  if (!cards.length) {
    board.innerHTML = "";
    syncCompareAdd();
    return;
  }
  const records = cards.map((card) => (card.status === "ready" ? compareDriverRecord(card) : null));
  const sameSession = cards.every((card) => String(card.sessionKey) === String(cards[0].sessionKey));
  const finishes = records.filter(compareClassified).map((driver) => driver.finishPosition);
  const bestFinish = finishes.length >= 2 ? Math.min(...finishes) : null;
  const laps = sameSession ? records.map((driver) => driver?.fastestLap).filter((value) => typeof value === "number") : [];
  const bestLap = laps.length >= 2 ? Math.min(...laps) : null;
  board.innerHTML = cards.map((card, index) => compareCardMarkup(card, records[index], bestFinish, bestLap)).join("");
  syncCompareAdd();
}

async function addCompareCard(driverNumber, sessionKey) {
  const driver = String(driverNumber || "");
  const session = String(sessionKey || "");
  if (!driver || !session) return;
  if (state.compareCards.length >= COMPARE_CAP) {
    syncCompareAdd();
    return;
  }
  const id = `${session}:${driver}`;
  if (state.compareCards.some((card) => card.id === id)) {
    setCompareNote("That driver is already on this Grand Prix.");
    return;
  }
  const note = $("compare-note");
  if (note && note.textContent === "That driver is already on this Grand Prix.") setCompareNote("");
  state.compareCards.push({ id, sessionKey: session, driverNumber: driver, status: "loading", error: "" });
  renderCompareBoard();
  try {
    await loadBattle(session);
    const card = state.compareCards.find((row) => row.id === id);
    if (!card) return;
    card.status = compareDriverRecord(card) ? "ready" : "absent";
    card.error = "";
  } catch (err) {
    const card = state.compareCards.find((row) => row.id === id);
    if (!card) return;
    card.status = "error";
    card.error = err.message || "Race request failed";
  }
  renderCompareBoard();
}

function removeCompareCard(id) {
  const next = state.compareCards.filter((card) => card.id !== id);
  if (next.length === state.compareCards.length) return;
  state.compareCards = next;
  const note = $("compare-note");
  if (note && note.textContent === "That driver is already on this Grand Prix.") setCompareNote("");
  renderCompareBoard();
}

function showChampionshipMap() {
  if (!$("race-empty")) return;
  state.selectedSessionKey = null;
  state.race = null;
  state.raceLoadingKey = null;
  state.telemetry = null;
  state.telemetryDriver = null;
  state.telemetrySeq += 1;
  renderSeason(state.dashboard?.previousRaces || []);
  $("race-skeleton").hidden = true;
  $("race-body").hidden = true;
  $("race-empty").hidden = false;
  $("race-status").hidden = true;
  $("race-detail-heading").textContent = "Race analysis";
  $("race-detail-meta").textContent = "Pick a Grand Prix for the lap feed.";
  if ($("timeline")) $("timeline").innerHTML = "";
  clearTelemetryFeed();
  paintRaceTrack();
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

function teamAbbrev(name) {
  const key = String(name || "")
    .trim()
    .toLowerCase()
    .replace(/\s+f1 team$/, "")
    .replace(/\s+racing$/, "");
  const known = {
    mclaren: "McL",
    ferrari: "Fer",
    "red bull": "RBR",
    mercedes: "Mer",
    "aston martin": "Ast",
    alpine: "Alp",
    williams: "Wil",
    rb: "RB",
    "racing bulls": "RB",
    haas: "Haa",
    "kick sauber": "Sau",
    sauber: "Sau",
    audi: "Aud",
    cadillac: "Cad",
  };
  if (known[key]) return known[key];
  const word = key.split(/\s+/).filter(Boolean)[0] || "";
  if (!word) return "";
  if (word.length <= 3) return word.charAt(0).toUpperCase() + word.slice(1);
  return word.charAt(0).toUpperCase() + word.slice(1, 3);
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

function outlineForMeeting(meeting) {
  const data = window.PITWALL_TRACKS;
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

function resolveTrack() {
  return outlineForMeeting(meetingForTrack());
}

function paintNextTrack() {
  const host = $("next-track");
  if (!host) return;
  const track = outlineForMeeting(state.dashboard?.nextMeeting);
  const key = track ? track.id : "none";
  if (host.dataset.track === key && host.firstElementChild) return;
  host.dataset.track = key;
  if (!track) {
    host.innerHTML = state.dashboard ? `<p class="track-missing">No circuit map for this venue.</p>` : "";
    return;
  }
  // Fit the outline into a 400 x 300 box; the SVG scales itself after that.
  const W = 400;
  const H = 300;
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  const pts = track.outline.map(([east, north]) => {
    const p = rotateTrackPoint(east, north, 0);
    minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
    minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
    return p;
  });
  const pad = 26;
  const scale = Math.min((W - pad * 2) / (maxX - minX || 1), (H - pad * 2) / (maxY - minY || 1));
  const ox = (W - (maxX - minX) * scale) / 2 - minX * scale;
  const oy = (H - (maxY - minY) * scale) / 2 - minY * scale;
  const xy = pts.map((p) => [ox + p.x * scale, oy + p.y * scale]);
  const d = `M${xy.map(([x, y]) => `${x.toFixed(1)} ${y.toFixed(1)}`).join("L")}Z`;
  // Start / finish line, perpendicular to the first segment.
  const [ax, ay] = xy[0];
  const [bx, by] = xy[1];
  const len = Math.hypot(bx - ax, by - ay) || 1;
  const nx = (-(by - ay) / len) * 9;
  const ny = ((bx - ax) / len) * 9;
  host.innerHTML = `
    <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${escapeHtml(track.name)} layout">
      <path class="track-ribbon" d="${d}" />
      <path class="track-line" d="${d}" />
      <path class="track-light" d="${d}" pathLength="1000" />
      <line class="track-start" x1="${(ax + nx).toFixed(1)}" y1="${(ay + ny).toFixed(1)}" x2="${(ax - nx).toFixed(1)}" y2="${(ay - ny).toFixed(1)}" />
    </svg>
    <p class="track-name">${escapeHtml(track.name)}</p>`;
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
  const usableW = Math.max(160, graph.width - 148);
  const usableH = Math.max(160, graph.height - 88);
  const iso = 1;
  const rx = Math.max(72, Math.min(usableW * 0.46, usableH * 0.46));
  const track = resolveTrack();
  return {
    x: 0,
    y: 6,
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
    const start = available * 0.04;
    const span = available * 0.9;
    const step = count <= 1 ? 0 : span / Math.max(count - 1, 1);
    const center = projectedCentroid(plot.track.outline, plot);
    const push = 16;
    ranked.forEach((team, index) => {
      const placed = interpolatePath(points, distances, start + index * step);
      const inward = inwardNormal(placed.x, placed.y, placed.tx, placed.ty, center);
      const outward = { x: -inward.x, y: -inward.y };
      team.x = placed.x + outward.x * push;
      team.surfaceY = placed.y + outward.y * push;
      team.y = team.surfaceY;
      team.pinH = 0;
      team.angle = Math.atan2(placed.ty, placed.tx);
      team.depth = placed.y;
      team.labelDx = outward.x;
      team.labelDy = outward.y;
    });
    for (let i = 0; i < ranked.length; i += 1) {
      for (let j = 0; j < i; j += 1) {
        const a = ranked[i];
        const b = ranked[j];
        const dist = Math.hypot(a.x - b.x, a.y - b.y);
        if (dist >= 26 || dist === 0) continue;
        const ox = (a.x - b.x) / dist;
        const oy = (a.y - b.y) / dist;
        const nudge = 26 - dist;
        a.x += ox * nudge;
        a.y += oy * nudge;
      }
    }
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
    body.innerHTML = `<p class="muted">Tap a constructor pin on the circuit. The four-seat pack is on PitWall Battle.</p>`;
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
  if (node && node.kind === "team") {
    graph.selected = graph.selected?.id === node.id ? null : node;
  }
  paintGraph();
}

function setBattleDriver(slot, driverNumber) {
  if (!state.battle || driverNumber == null || driverNumber === "") return;
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
    const code = teamAbbrev(node.label || node.short);
    const label = node.rank && node.rank < 99 ? `${code} P${node.rank}` : code;
    const dx = node.labelDx || 1;
    const dy = node.labelDy || 0;
    ctx.textAlign = Math.abs(dx) < 0.35 ? "center" : dx > 0 ? "left" : "right";
    ctx.fillText(label, node.x + dx * (radius + 10), node.y + dy * (radius + 8) + 4);
  };

  [...ranked].reverse().forEach(drawPin);
  ctx.restore();
}

function clearTelemetryFeed() {
  const driver = $("telemetry-driver");
  if (driver) {
    driver.innerHTML = `<option value="">Select a driver</option>`;
    driver.value = "";
    driver.disabled = true;
  }
  setText("telemetry-pos", "—");
  const tyre = $("telemetry-tyre");
  if (tyre) {
    tyre.textContent = "—";
    tyre.className = "";
    tyre.style.removeProperty("--compound");
  }
  const throttle = $("telemetry-throttle");
  const brake = $("telemetry-brake");
  if (throttle) throttle.innerHTML = "";
  if (brake) brake.innerHTML = "";
  const copy = $("graph-copy");
  if (copy) {
    copy.classList.remove("sheen-text");
    copy.textContent = state.race
      ? "No lap feed for this selection."
      : "Pick a Grand Prix. Throttle, brake, tyre, and position load with the fastest lap.";
  }
}

function compoundColour(compound) {
  const key = String(compound || "").toUpperCase();
  if (key === "SOFT") return "#ff2b2b";
  if (key === "MEDIUM") return "#ffd12e";
  if (key === "HARD") return "#f4f6f8";
  if (key === "INTERMEDIATE") return "#43d043";
  if (key === "WET") return "#3b9dff";
  return "#9aa3b2";
}

function renderTelemetryDrivers(drivers) {
  const select = $("telemetry-driver");
  if (!select) return;
  const classified = (drivers || []).filter((driver) => driver.finishPosition != null);
  const pool = classified.length ? classified : drivers || [];
  select.innerHTML = pool
    .map(
      (driver) =>
        `<option value="${escapeHtml(driver.driverNumber)}">${escapeHtml(driver.acronym || driver.fullName)}</option>`
    )
    .join("");
  select.disabled = !pool.length;
  const keep = pool.some((driver) => String(driver.driverNumber) === String(state.telemetryDriver));
  const next = keep ? state.telemetryDriver : pool[0]?.driverNumber;
  if (next == null) {
    clearTelemetryFeed();
    return;
  }
  select.value = String(next);
  loadTelemetry(next);
}

function markTelemetryDriver(driverNumber) {
  state.telemetryDriver = driverNumber == null ? null : String(driverNumber);
  document.querySelectorAll("#results-chart .standings-row").forEach((row) => {
    row.classList.toggle("is-selected", row.dataset.driver === state.telemetryDriver);
  });
  const select = $("telemetry-driver");
  if (select && state.telemetryDriver && select.value !== state.telemetryDriver) {
    select.value = state.telemetryDriver;
  }
}

function pedalPath(samples, key) {
  const usable = (samples || []).filter((sample) => Number.isFinite(sample[key]) && Number.isFinite(sample.t));
  if (usable.length < 2) return "";
  const end = usable[usable.length - 1].t || 1;
  return usable
    .map((sample, index) => {
      const x = (sample.t / end) * 100;
      const y = 26 - (Math.max(0, Math.min(100, sample[key])) / 100) * 22;
      return `${index === 0 ? "M" : "L"}${x.toFixed(2)} ${y.toFixed(2)}`;
    })
    .join(" ");
}

function renderTelemetry(detail) {
  const position = $("telemetry-pos");
  const tyre = $("telemetry-tyre");
  const copy = $("graph-copy");
  position.textContent = detail?.position != null ? `P${detail.position}` : "—";
  const compound = detail?.compound || "—";
  tyre.textContent = compound;
  tyre.className = detail?.compound ? "telemetry-tyre" : "";
  if (detail?.compound) tyre.style.setProperty("--compound", compoundColour(detail.compound));
  else tyre.style.removeProperty("--compound");
  const throttle = pedalPath(detail?.samples, "throttle");
  const brake = pedalPath(detail?.samples, "brake");
  $("telemetry-throttle").innerHTML = throttle
    ? `<path d="${throttle}" fill="none" stroke="#f3f5f8" stroke-width="1.6" vector-effect="non-scaling-stroke" />`
    : "";
  $("telemetry-brake").innerHTML = brake
    ? `<path d="${brake}" fill="none" stroke="#ff5a5a" stroke-width="1.6" vector-effect="non-scaling-stroke" />`
    : "";
  copy.classList.remove("sheen-text");
  const lap = detail?.lapNumber != null ? `Fastest lap ${detail.lapNumber}` : "Fastest lap";
  copy.textContent = `${lap} · ${formatLap(detail?.lapDuration)} · OpenF1 car data`;
}

async function loadTelemetry(driverNumber) {
  const sessionKey = state.selectedSessionKey;
  if (!sessionKey || driverNumber == null || driverNumber === "") return;
  const seq = state.telemetrySeq + 1;
  state.telemetrySeq = seq;
  markTelemetryDriver(driverNumber);
  const copy = $("graph-copy");
  copy.classList.add("sheen-text");
  copy.textContent = "Data coming through, give us a second or two…";
  const select = $("telemetry-driver");
  if (select) select.disabled = true;
  try {
    const response = await fetch(apiUrl(`/api/race/${sessionKey}/telemetry?driver=${encodeURIComponent(driverNumber)}`));
    const payload = await response.json().catch(() => ({}));
    if (seq !== state.telemetrySeq) return;
    if (!response.ok) throw new Error(payload.error || `Telemetry request failed (${response.status})`);
    const driver = (state.race?.drivers || []).find((row) => String(row.driverNumber) === String(driverNumber));
    state.telemetry = {
      ...payload,
      teamColour: driver?.teamColour || null,
    };
    renderTelemetry(state.telemetry);
    paintRaceTrack();
  } catch (err) {
    if (seq !== state.telemetrySeq) return;
    state.telemetry = null;
    copy.classList.remove("sheen-text");
    copy.textContent = err.message;
    setText("telemetry-pos", "—");
    paintRaceTrack();
  } finally {
    if (seq === state.telemetrySeq && select) select.disabled = false;
  }
}

function meetingForTrack() {
  if (state.race?.meeting) return state.race.meeting;
  return state.dashboard?.nextMeeting || null;
}

function paintRaceTrack() {
  const canvas = $("grid-canvas");
  if (!canvas) return;
  const wrap = canvas.parentElement;
  const width = Math.round(canvas.clientWidth || wrap?.clientWidth || 0);
  const height = Math.round(canvas.clientHeight || wrap?.clientHeight || 0);
  if (width < 8 || height < 8) return;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
  }
  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = "#07090d";
  ctx.fillRect(0, 0, width, height);
  const samples = (state.telemetry?.samples || []).filter((sample) => sample.x != null && sample.y != null);
  if (samples.length >= 2) {
    drawPedalTrack(ctx, samples, width, height);
    return;
  }
  drawStaticTrack(ctx, width, height, outlineForMeeting(meetingForTrack()));
}

function drawStaticTrack(ctx, width, height, track) {
  if (!track) {
    ctx.fillStyle = "rgba(154, 163, 178, 0.9)";
    ctx.font = "600 12px Segoe UI, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("Circuit outline unavailable", width / 2, height / 2);
    return;
  }
  const rx = Math.max(48, Math.min(width * 0.36, height * 0.36));
  const scale = trackFitScale(track.outline, 0, rx);
  ctx.save();
  ctx.translate(width / 2, height / 2);
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  trackContourPath(ctx, track.outline, 0, 0, 0, scale, 1);
  ctx.strokeStyle = "rgba(32, 42, 54, 1)";
  ctx.lineWidth = 10;
  ctx.stroke();
  ctx.strokeStyle = "rgba(210, 224, 232, 0.92)";
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.fillStyle = "rgba(176, 196, 210, 0.9)";
  ctx.font = "600 12px Segoe UI, sans-serif";
  ctx.textAlign = "center";
  ctx.fillText(track.name, 0, -height / 2 + 22);
  ctx.restore();
}

function drawPedalTrack(ctx, samples, width, height) {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const sample of samples) {
    minX = Math.min(minX, sample.x);
    maxX = Math.max(maxX, sample.x);
    minY = Math.min(minY, sample.y);
    maxY = Math.max(maxY, sample.y);
  }
  const spanX = maxX - minX || 1;
  const spanY = maxY - minY || 1;
  const pad = 28;
  const scale = Math.min((width - pad * 2) / spanX, (height - pad * 2) / spanY);
  const offsetX = (width - spanX * scale) / 2;
  const offsetY = (height - spanY * scale) / 2;
  const point = (sample) => ({
    x: offsetX + (sample.x - minX) * scale,
    y: offsetY + (maxY - sample.y) * scale,
  });
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.beginPath();
  samples.forEach((sample, index) => {
    const plotted = point(sample);
    if (index === 0) ctx.moveTo(plotted.x, plotted.y);
    else ctx.lineTo(plotted.x, plotted.y);
  });
  ctx.strokeStyle = "rgba(42, 49, 64, 0.95)";
  ctx.lineWidth = 7;
  ctx.stroke();
  for (let i = 1; i < samples.length; i += 1) {
    const sample = samples[i];
    const from = point(samples[i - 1]);
    const to = point(sample);
    const braking = Number(sample.brake) >= 50;
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(to.x, to.y);
    ctx.lineWidth = braking ? 4.2 : 3;
    ctx.strokeStyle = braking ? "rgba(255, 90, 90, 0.95)" : `rgba(243, 245, 248, ${0.35 + 0.6 * ((Number(sample.throttle) || 0) / 100)})`;
    ctx.stroke();
  }
}

function initRaceTrack() {
  window.addEventListener("resize", paintRaceTrack);
  const canvas = $("grid-canvas");
  if (!canvas || typeof ResizeObserver !== "function") return;
  const observer = new ResizeObserver(() => paintRaceTrack());
  if (canvas.parentElement) observer.observe(canvas.parentElement);
}

function schedulePlot() {
  requestAnimationFrame(paintRaceTrack);
}

function paintGraph() {
  if (!graph.ctx) return;
  layoutMountain();
  drawGraph();
}

function resizeGraph() {
  if (!graph.canvas || !graph.wrap) return false;
  const cssW = graph.canvas.clientWidth || graph.wrap.clientWidth;
  const cssH = graph.canvas.clientHeight || graph.wrap.clientHeight;
  if (cssW < 8 || cssH < 8) return false;
  const width = Math.max(120, Math.round(cssW));
  const height = Math.max(120, Math.round(cssH));
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
    $("graph-copy").textContent = `${trackBit || state.race.meeting?.circuit || name}. Pins follow the finishing order. Tap one to highlight it.`;
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

const VIEWS = ["overview", "battle"];

function showView(view, { historyMode = "push" } = {}) {
  const next = VIEWS.includes(view) ? view : "overview";
  document.body.dataset.view = next;
  document.querySelectorAll("[data-stage]").forEach((stage) => {
    stage.hidden = stage.dataset.stage !== next;
  });
  document.querySelectorAll("[data-view-target]").forEach((button) => {
    const active = button.dataset.viewTarget === next;
    button.classList.toggle("is-active", active);
    if (active) button.setAttribute("aria-current", "page");
    else button.removeAttribute("aria-current");
  });
  const nextHash = `#${next}`;
  if (location.hash !== nextHash) {
    if (historyMode === "replace") history.replaceState(null, "", nextHash);
    else history.pushState(null, "", nextHash);
  }
  if (next === "overview") requestAnimationFrame(paintNextTrack);
}

function setNavOpen(open) {
  document.body.classList.toggle("nav-collapsed", !open);
  const toggle = $("nav-toggle");
  if (toggle) {
    toggle.setAttribute("aria-expanded", open ? "true" : "false");
    toggle.setAttribute("aria-label", open ? "Collapse navigation" : "Expand navigation");
  }
  try {
    localStorage.setItem("pitwall-nav-open", open ? "1" : "0");
  } catch (_err) {
    /* private mode */
  }
  if (document.body.dataset.view === "race") schedulePlot();
  requestAnimationFrame(paintNextTrack);
}

function initShell() {
  let open = true;
  try {
    if (localStorage.getItem("pitwall-nav-open") === "0") open = false;
  } catch (_err) {
    open = true;
  }
  setNavOpen(open);
  $("nav-toggle")?.addEventListener("click", () => {
    setNavOpen(document.body.classList.contains("nav-collapsed"));
  });
  document.querySelectorAll("[data-view-target]").forEach((button) => {
    button.addEventListener("click", () => showView(button.dataset.viewTarget));
  });
  const fromHash = location.hash.replace("#", "");
  showView(VIEWS.includes(fromHash) ? fromHash : "overview", { historyMode: "replace" });
  window.addEventListener("hashchange", () => {
    const view = location.hash.replace("#", "");
    showView(VIEWS.includes(view) ? view : "overview", { historyMode: "replace" });
  });
  const track = $("next-track");
  if (track?.parentElement && "ResizeObserver" in window) {
    const observer = new ResizeObserver(() => paintNextTrack());
    observer.observe(track.parentElement);
  }
}

$("compare-add")?.addEventListener("submit", (event) => {
  event.preventDefault();
  addCompareCard($("compare-driver")?.value, $("compare-race")?.value);
});

$("compare-driver")?.addEventListener("change", () => {
  const note = $("compare-note");
  if (note && note.textContent === "That driver is already on this Grand Prix.") setCompareNote("");
  syncCompareAdd();
});

$("compare-race")?.addEventListener("change", () => {
  const note = $("compare-note");
  if (note && note.textContent === "That driver is already on this Grand Prix.") setCompareNote("");
  syncCompareAdd();
});

$("compare-board")?.addEventListener("click", (event) => {
  const button = event.target.closest("[data-remove-compare]");
  if (!button) return;
  removeCompareCard(button.getAttribute("data-remove-compare"));
});

$("field-close")?.addEventListener("click", () => setFieldDrawerOpen(false));

fieldSelects().forEach((select, index) => {
  select?.addEventListener("change", () => onFieldSlotChange(index + 1));
});

$("node-panel")?.addEventListener("click", (event) => {
  const button = event.target.closest("[data-send-battle]");
  if (!button) return;
  const [driverA, driverB] = button.getAttribute("data-send-battle").split(",");
  setBattleDriver("a", driverA);
  setBattleDriver("b", driverB);
  showView("battle");
});

document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") return;
  if ($("field-drawer")?.classList.contains("is-open")) {
    setFieldDrawerOpen(false);
    return;
  }
  if (!document.body.classList.contains("nav-collapsed")) setNavOpen(false);
});

$("driver-a")?.addEventListener("change", renderBattle);
$("driver-b")?.addEventListener("change", renderBattle);

initShell();
state.countdownTimer = setInterval(tickCountdown, 1000);
loadDashboard();
