const state = {
  dashboard: null,
  race: null,
  selectedSessionKey: null,
  countdownTarget: null,
  countdownTimer: null,
};

const PRODUCTION_API_BASE = "https://func-pitwall-fd884b.azurewebsites.net";

function apiUrl(path) {
  const configured = window.PITWALL_API_BASE;
  if (configured) {
    return `${String(configured).replace(/\/$/, "")}${path}`;
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

function showBanner(message) {
  const banner = $("banner");
  banner.hidden = !message;
  banner.textContent = message || "";
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
        .map(
          (row) => `
            <li>
              <span class="pos">P${escapeHtml(row.position)}</span>
              <span class="name">${escapeHtml(row.fullName)}</span>
              <span class="team">${escapeHtml(row.teamName || "")}</span>
            </li>`
        )
        .join("")
    : `<li><span class="name">Results not published yet.</span></li>`;
}

function renderChampionships(dashboard) {
  const drivers = (dashboard.driverChampionship || []).slice(0, 10);
  $("drivers-body").innerHTML = drivers.length
    ? drivers
        .map(
          (row) => `
            <tr>
              <td class="num">${escapeHtml(row.position)}</td>
              <td>${escapeHtml(row.fullName)}</td>
              <td>${escapeHtml(row.teamName || "—")}</td>
              <td class="num">${escapeHtml(row.points)}</td>
            </tr>`
        )
        .join("")
    : `<tr><td colspan="4">Championship data not available yet.</td></tr>`;

  const teams = dashboard.teamChampionship || [];
  $("teams-body").innerHTML = teams.length
    ? teams
        .map(
          (row) => `
            <tr>
              <td class="num">${escapeHtml(row.position)}</td>
              <td>${escapeHtml(row.teamName)}</td>
              <td class="num">${escapeHtml(row.points)}</td>
            </tr>`
        )
        .join("")
    : `<tr><td colspan="3">Championship data not available yet.</td></tr>`;
}

function renderSeason(races) {
  const list = $("season-list");
  if (!races.length) {
    list.innerHTML = `<li>No completed Grand Prix races yet.</li>`;
    return;
  }
  list.innerHTML = races
    .map((race) => {
      const selected = String(race.sessionKey) === String(state.selectedSessionKey) ? "selected" : "";
      return `
        <li class="${selected}">
          <div>
            <span class="race-name">${escapeHtml(race.meetingName)}</span>
            <span class="race-place">${escapeHtml([race.location, race.country].filter(Boolean).join(", "))} · ${escapeHtml(formatDate(race.date))}</span>
          </div>
          <button type="button" data-session-key="${escapeHtml(race.sessionKey)}">View Race</button>
        </li>`;
    })
    .join("");
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
  $("driver-a").innerHTML = options;
  $("driver-b").innerHTML = options;
  if (drivers[0]) $("driver-a").value = drivers[0].driverNumber;
  if (drivers[1]) $("driver-b").value = drivers[1].driverNumber;
  else if (drivers[0]) $("driver-b").value = drivers[0].driverNumber;
}

function renderStints(targetId, headingId, driver) {
  $(headingId).textContent = `Tyre stints — ${driver ? driver.fullName : "—"}`;
  const stints = driver?.stints || [];
  $(targetId).innerHTML = stints.length
    ? stints
        .map((stint) => {
          const compound = stint.compound || "UNKNOWN";
          const range = `L${stint.lapStart ?? "?"}–L${stint.lapEnd ?? "?"}`;
          return `<li>${escapeHtml(compound)}  ${escapeHtml(range)}</li>`;
        })
        .join("")
    : `<li>No stint data.</li>`;
}

function renderBattle() {
  if (!state.race) return;
  const driverA = driverByNumber($("driver-a").value);
  const driverB = driverByNumber($("driver-b").value);
  setText("battle-a-name", driverA?.fullName || "Driver A");
  setText("battle-b-name", driverB?.fullName || "Driver B");

  const rows = [
    ["Finish", driverA?.finishPosition != null ? `P${driverA.finishPosition}` : "—", driverB?.finishPosition != null ? `P${driverB.finishPosition}` : "—"],
    ["Initial position", driverA?.initialPosition != null ? `P${driverA.initialPosition}` : "—", driverB?.initialPosition != null ? `P${driverB.initialPosition}` : "—"],
    ["Places gained/lost", formatPlaces(driverA?.placesGained), formatPlaces(driverB?.placesGained)],
    ["Fastest lap", formatLap(driverA?.fastestLap), formatLap(driverB?.fastestLap)],
    ["Pit stops", driverA?.pitStops ?? "—", driverB?.pitStops ?? "—"],
    ["OpenF1-recorded overtakes", driverA?.overtakes ?? "—", driverB?.overtakes ?? "—"],
  ];

  $("battle-body").innerHTML = rows
    .map(
      ([metric, a, b]) => `
        <tr>
          <th>${escapeHtml(metric)}</th>
          <td>${escapeHtml(a)}</td>
          <td>${escapeHtml(b)}</td>
        </tr>`
    )
    .join("");

  renderStints("stint-a", "stint-a-heading", driverA);
  renderStints("stint-b", "stint-b-heading", driverB);
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
}

async function loadRace(sessionKey) {
  state.selectedSessionKey = sessionKey;
  renderSeason(state.dashboard?.previousRaces || []);
  const detail = $("race-detail");
  const status = $("race-status");
  detail.hidden = false;
  status.hidden = false;
  status.textContent = "Loading race detail…";
  $("race-detail-heading").textContent = "Race analysis";
  $("race-detail-meta").textContent = `sessionKey ${sessionKey}`;

  try {
    const response = await fetch(apiUrl(`/api/race/${sessionKey}`));
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(payload.error || `Race request failed (${response.status})`);
    }
    state.race = payload;
    status.hidden = true;
    const meetingName = payload.meeting?.meetingName || "Selected race";
    $("race-detail-heading").textContent = meetingName;
    $("race-detail-meta").textContent = `${payload.session?.sessionName || "Race"} · ${formatDate(payload.session?.dateEnd)}`;
    renderDriverOptions();
    renderBattle();
    renderTimeline(payload.raceControl || []);
    detail.scrollIntoView({ behavior: "smooth", block: "start" });
  } catch (err) {
    state.race = null;
    status.hidden = false;
    status.textContent = err.message;
    $("battle-body").innerHTML = "";
    $("timeline").innerHTML = "";
  }
}

async function loadDashboard() {
  try {
    const response = await fetch(apiUrl("/api/dashboard"));
    const payload = await response.json().catch(() => ({}));
    if (response.status === 503) {
      showBanner(payload.error || "Dashboard snapshot is not available yet.");
      setText("freshness", "No snapshot yet");
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
  }
}

$("season-list").addEventListener("click", (event) => {
  const button = event.target.closest("button[data-session-key]");
  if (!button) return;
  loadRace(button.getAttribute("data-session-key"));
});

$("driver-a").addEventListener("change", renderBattle);
$("driver-b").addEventListener("change", renderBattle);

state.countdownTimer = setInterval(tickCountdown, 1000);
loadDashboard();
