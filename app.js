const PROGRAM_URL = "data/program.json";
const VERSION_URL = "data/version.json";
const SAVED_KEY = "ifac26-my-program-v2";
const LEGACY_KEY = "ifac26-favs";
const DAY_KEY = "ifac26-selected-day";

const $ = (selector) => document.querySelector(selector);
const state = {
  program: null,
  view: "schedule",
  dayIndex: Number.parseInt(readStorage(DAY_KEY, "0"), 10) || 0,
  query: "",
  type: "",
  savedSessions: new Set(),
  savedPapers: new Set(),
  storageAvailable: true,
};

function readStorage(key, fallback = "") {
  try {
    return localStorage.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
}

function loadSavedProgram() {
  try {
    const stored = JSON.parse(readStorage(SAVED_KEY, "{}"));
    state.savedSessions = new Set(Array.isArray(stored.sessions) ? stored.sessions : []);
    state.savedPapers = new Set(Array.isArray(stored.papers) ? stored.papers : []);
  } catch {
    state.savedSessions = new Set();
    state.savedPapers = new Set();
  }
}

function persistSavedProgram() {
  const value = JSON.stringify({
    schemaVersion: 2,
    sessions: [...state.savedSessions],
    papers: [...state.savedPapers],
    updatedAt: new Date().toISOString(),
  });
  try {
    localStorage.setItem(SAVED_KEY, value);
    state.storageAvailable = localStorage.getItem(SAVED_KEY) === value;
  } catch {
    state.storageAvailable = false;
  }
  if (!state.storageAvailable) {
    setStatus("This browser blocked storage, so new selections may not survive a restart.", "error");
  }
  updateSavedCount();
}

function migrateLegacyFavorites() {
  if (!state.program || readStorage(`${SAVED_KEY}-migrated`) === "true") return;
  let legacy;
  try {
    legacy = JSON.parse(readStorage(LEGACY_KEY, "[]"));
  } catch {
    legacy = [];
  }
  if (!Array.isArray(legacy) || !legacy.length) return;
  const papers = state.program.days.flatMap((day) =>
    day.sessions.flatMap((session) =>
      session.papers.map((paper) => ({ day, session, paper })),
    ),
  );
  for (const oldId of legacy) {
    const [date, sessionCode, time, ...titleParts] = String(oldId).split("|");
    const title = titleParts.join("|");
    const match = papers.find(
      ({ day, session, paper }) =>
        day.date === date &&
        session.code === sessionCode &&
        paper.start === String(time || "").slice(0, 5) &&
        paper.title === title,
    );
    if (match) state.savedPapers.add(match.paper.id);
  }
  persistSavedProgram();
  try {
    localStorage.setItem(`${SAVED_KEY}-migrated`, "true");
  } catch {
    // The regular storage warning already covers this case.
  }
}

function createElement(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

function formatDate(date, options = {}) {
  return new Intl.DateTimeFormat(undefined, {
    timeZone: "UTC",
    ...options,
  }).format(new Date(`${date}T12:00:00Z`));
}

function typeClass(type) {
  if (type.includes("Plenary")) return "plenary";
  if (type.includes("Interactive")) return "interactive";
  if (type.includes("Invited")) return "invited";
  if (type.includes("Special")) return "special";
  if (type.includes("Tutorial") || type.includes("Panel")) return "tutorial";
  return "regular";
}

function shortType(type) {
  return type.replace(" Session", "");
}

function enrichProgram(program) {
  for (const day of program.days) {
    for (const session of day.sessions) {
      const chairText = session.chairs
        .map((chair) => `${chair.name} ${chair.affiliation}`)
        .join(" ");
      const paperText = session.papers
        .map((paper) =>
          [
            paper.code,
            paper.title,
            ...paper.authors.flatMap((author) => [author.name, author.affiliation]),
            ...(paper.keywords || []),
          ].join(" "),
        )
        .join(" ");
      session.searchText = [
        session.code,
        session.title,
        session.type,
        session.room,
        chairText,
        paperText,
      ]
        .join(" ")
        .toLocaleLowerCase();
    }
  }
}

function chooseInitialDay() {
  if (!state.program) return;
  state.dayIndex = Math.max(0, Math.min(state.dayIndex, state.program.days.length - 1));
  if (readStorage(DAY_KEY)) return;
  const seoulDate = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  const exact = state.program.days.findIndex((day) => day.date === seoulDate);
  if (exact >= 0) state.dayIndex = exact;
  else if (seoulDate > state.program.days.at(-1).date) state.dayIndex = state.program.days.length - 1;
}

async function loadProgram(force = false) {
  const button = $("#syncBtn");
  button.disabled = true;
  if (force) setStatus("Checking for a newer program…");
  try {
    if (force && state.program) {
      const versionResponse = await fetch(`${VERSION_URL}?t=${Date.now()}`, { cache: "no-store" });
      if (versionResponse.ok) {
        const version = await versionResponse.json();
        if (version.version === state.program.version) {
          setStatus("Your program is up to date.", "success");
          return;
        }
      }
    }
    const response = await fetch(force ? `${PROGRAM_URL}?t=${Date.now()}` : PROGRAM_URL, {
      cache: force ? "reload" : "default",
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const program = await response.json();
    if (program.schemaVersion !== 2 || !Array.isArray(program.days) || program.days.length !== 5) {
      throw new Error("The stored program did not pass validation");
    }
    enrichProgram(program);
    state.program = program;
    chooseInitialDay();
    migrateLegacyFavorites();
    $("#loadingState").hidden = true;
    $("#app").hidden = false;
    renderDayTabs();
    renderTypeFilter();
    render();
    if (force) setStatus("Program updated and ready offline.", "success");
  } catch (error) {
    if (!state.program) {
      $("#loadingState").innerHTML = "";
      const title = createElement("h2", "", "The program could not be opened");
      const message = createElement(
        "p",
        "",
        "Check your connection once. After a successful visit, the program remains available offline.",
      );
      const retry = createElement("button", "primary-button", "Try again");
      retry.type = "button";
      retry.onclick = () => loadProgram(true);
      $("#loadingState").append(title, message, retry);
    } else {
      setStatus(`Update failed. The stored program was kept. ${error.message}`, "error");
    }
  } finally {
    button.disabled = false;
  }
}

function currentDay() {
  return state.program.days[state.dayIndex];
}

function renderDayTabs() {
  const tabs = $("#dayTabs");
  tabs.innerHTML = "";
  state.program.days.forEach((day, index) => {
    const button = createElement("button", "day-tab");
    button.type = "button";
    button.role = "tab";
    button.setAttribute("aria-selected", String(index === state.dayIndex));
    const dayName = createElement("span", "day-name", day.day.slice(0, 3));
    const date = createElement("span", "day-date", formatDate(day.date, { month: "short", day: "numeric" }));
    button.append(dayName, date);
    button.onclick = () => {
      state.dayIndex = index;
      try {
        localStorage.setItem(DAY_KEY, String(index));
      } catch {
        // Day selection is a convenience preference only.
      }
      renderDayTabs();
      render();
      window.scrollTo({ top: 0, behavior: "smooth" });
    };
    tabs.append(button);
  });
}

function renderTypeFilter() {
  const container = $("#typeFilters");
  container.innerHTML = "";
  const label = createElement("label", "select-field");
  label.append(createElement("span", "visually-hidden", "Session type"));
  const select = createElement("select");
  select.id = "typeFilter";
  select.append(new Option("All session types", ""));
  const types = [...new Set(state.program.days.flatMap((day) => day.sessions.map((session) => session.type)))].sort();
  types.forEach((type) => select.append(new Option(type, type)));
  select.value = state.type;
  select.onchange = (event) => {
    state.type = event.target.value;
    render();
  };
  label.append(select);
  container.append(label);
}

function updateOverview(day, sessionCount) {
  const agenda = state.view === "agenda";
  const explore = state.view === "explore";
  const timedSessions = day.sessions.filter((session) => session.start && session.end);
  const earliest = timedSessions.reduce(
    (value, session) => (!value || session.start < value ? session.start : value),
    "",
  );
  const latest = timedSessions.reduce(
    (value, session) => (!value || session.end > value ? session.end : value),
    "",
  );
  const timeRange = earliest && latest ? `${earliest}–${latest}` : "Times to be confirmed";
  $("#overviewKicker").textContent = `${day.day.toUpperCase()} · ${formatDate(day.date, {
    month: "long",
    day: "numeric",
  }).toUpperCase()}`;
  $("#overviewTitle").textContent = agenda
    ? `Your ${day.day}`
    : explore
      ? "Find the right session"
      : `${day.day} at a glance`;
  $("#overviewText").textContent = agenda
    ? "A chronological plan with overlapping choices clearly marked."
    : explore
      ? `${sessionCount} matching ${sessionCount === 1 ? "session" : "sessions"} on ${day.day}`
      : `${sessionCount} sessions · ${day.paperCount.toLocaleString()} papers · ${timeRange}`;
  updateSavedCount();
}

function updateSavedCount() {
  if (!state.program) return;
  $("#savedCount").textContent = String(getSavedEvents().length);
}

function setStatus(message, kind = "") {
  const status = $("#status");
  status.textContent = message;
  status.className = `status${kind ? ` ${kind}` : ""}`;
}

function sessionIsSaved(session) {
  return state.savedSessions.has(session.id);
}

function paperIsSaved(session, paper) {
  return sessionIsSaved(session) || state.savedPapers.has(paper.id);
}

function toggleSession(session) {
  if (sessionIsSaved(session)) state.savedSessions.delete(session.id);
  else state.savedSessions.add(session.id);
  persistSavedProgram();
  render();
}

function togglePaper(session, paper) {
  if (sessionIsSaved(session)) return;
  if (state.savedPapers.has(paper.id)) state.savedPapers.delete(paper.id);
  else state.savedPapers.add(paper.id);
  persistSavedProgram();
  render();
}

function getSavedEvents(dayFilter = null) {
  if (!state.program) return [];
  const events = [];
  for (const day of state.program.days) {
    if (dayFilter && day.date !== dayFilter) continue;
    for (const session of day.sessions) {
      if (sessionIsSaved(session)) {
        events.push({
          id: `session:${session.id}`,
          kind: "session",
          day,
          session,
          start: session.start,
          end: session.end,
          title: session.title,
        });
        continue;
      }
      for (const paper of session.papers) {
        if (state.savedPapers.has(paper.id)) {
          events.push({
            id: `paper:${paper.id}`,
            kind: "paper",
            day,
            session,
            paper,
            start: paper.start,
            end: paper.end,
            title: paper.title,
          });
        }
      }
    }
  }
  return events.sort((a, b) =>
    `${a.day.date}${a.start || "99:99"}${a.title}`.localeCompare(
      `${b.day.date}${b.start || "99:99"}${b.title}`,
    ),
  );
}

function matchesSearch(session) {
  if (state.type && session.type !== state.type) return false;
  const tokens = state.query.toLocaleLowerCase().trim().split(/\s+/).filter(Boolean);
  return tokens.every((token) => session.searchText.includes(token));
}

function render() {
  if (!state.program) return;
  const day = currentDay();
  const controls = $("#exploreControls");
  const tabs = $("#dayTabs");
  const overview = $("#overview");
  controls.hidden = state.view !== "explore";
  tabs.hidden = state.view === "info";
  overview.hidden = state.view === "info";
  document.querySelectorAll(".bottom-nav button").forEach((button) => {
    const active = button.dataset.view === state.view;
    button.classList.toggle("active", active);
    if (active) button.setAttribute("aria-current", "page");
    else button.removeAttribute("aria-current");
  });

  if (state.view === "info") {
    renderInfo();
    return;
  }
  if (state.view === "agenda") {
    updateOverview(day, day.sessionCount);
    renderAgenda(day);
    return;
  }

  const sessions = day.sessions.filter(state.view === "explore" ? matchesSearch : () => true);
  updateOverview(day, sessions.length);
  renderSessions(day, sessions);
}

function renderSessions(day, sessions) {
  const content = $("#content");
  content.innerHTML = "";
  if (state.view === "explore") {
    const description = sessions.length === 1 ? "1 session found" : `${sessions.length} sessions found`;
    setStatus(description);
  } else {
    setStatus(
      `Program snapshot ${state.program.version.slice(0, 8)} · checked ${new Date(state.program.generatedAt).toLocaleDateString()}`,
    );
  }
  if (!sessions.length) {
    content.append(emptyState("No matching sessions", "Try a different phrase or session type."));
    return;
  }
  let currentTime = null;
  let group;
  for (const session of sessions) {
    const timeKey = session.start || "TBA";
    if (timeKey !== currentTime) {
      currentTime = timeKey;
      group = createElement("section", "time-group");
      const heading = createElement("div", "time-heading");
      heading.append(
        createElement("h3", "", timeKey === "TBA" ? "Time TBA" : timeKey),
        createElement("span", "", timeKey === "TBA" ? "Special events" : timePeriod(timeKey)),
      );
      group.append(heading);
      content.append(group);
    }
    group.append(sessionCard(day, session));
  }
}

function sessionCard(day, session) {
  const card = createElement("article", `session-card ${typeClass(session.type)}`);
  const open = createElement("button", "session-open");
  open.type = "button";
  open.setAttribute("aria-label", `Open ${session.title}`);
  const meta = createElement("div", "session-meta");
  meta.append(
    createElement(
      "span",
      "session-time",
      session.start && session.end ? `${session.start}–${session.end}` : "Time TBA",
    ),
    createElement("span", "room", session.room || "Room to be announced"),
  );
  const title = createElement("h3", "", session.title);
  const footer = createElement("div", "session-footer");
  footer.append(
    createElement("span", `type-pill ${typeClass(session.type)}`, shortType(session.type)),
    createElement("span", "", session.code),
    createElement("span", "", `${session.papers.length} ${session.papers.length === 1 ? "paper" : "papers"}`),
  );
  open.append(meta, title, footer);
  open.onclick = () => openSession(day, session);

  const save = createElement("button", `save-button${sessionIsSaved(session) ? " saved" : ""}`);
  save.type = "button";
  save.setAttribute("aria-pressed", String(sessionIsSaved(session)));
  save.setAttribute("aria-label", `${sessionIsSaved(session) ? "Remove" : "Add"} ${session.title} ${sessionIsSaved(session) ? "from" : "to"} My program`);
  save.textContent = sessionIsSaved(session) ? "★" : "☆";
  save.onclick = () => toggleSession(session);
  card.append(open, save);
  return card;
}

function openSession(day, session) {
  const dialog = $("#detailDialog");
  const sessionTime = session.start && session.end ? `${session.start}–${session.end}` : "Time TBA";
  $("#detailKicker").textContent = `${day.day} · ${sessionTime} · ${session.room}`;
  $("#detailTitle").textContent = session.title;
  const content = $("#detailContent");
  content.innerHTML = "";

  const toolbar = createElement("div", "detail-toolbar");
  toolbar.append(
    createElement("span", `type-pill ${typeClass(session.type)}`, `${session.code} · ${shortType(session.type)}`),
  );
  const saveSession = createElement(
    "button",
    `primary-button${sessionIsSaved(session) ? " selected" : ""}`,
    sessionIsSaved(session) ? "★ Session saved" : "☆ Save whole session",
  );
  saveSession.type = "button";
  saveSession.setAttribute("aria-pressed", String(sessionIsSaved(session)));
  saveSession.onclick = () => {
    toggleSession(session);
    openSession(day, session);
  };
  toolbar.append(saveSession);
  content.append(toolbar);

  if (session.chairs.length) {
    const chairs = createElement("p", "chairs");
    chairs.textContent = session.chairs
      .map((chair) => `${chair.role}: ${chair.name}${chair.affiliation ? ` · ${chair.affiliation}` : ""}`)
      .join("  ·  ");
    content.append(chairs);
  }

  const paperList = createElement("div", "paper-list");
  if (!session.papers.length) {
    paperList.append(
      createElement(
        "p",
        "no-papers",
        "No individual papers are listed for this program item. Save the whole session to add it to My program.",
      ),
    );
  }
  session.papers.forEach((paper) => {
    const row = createElement("article", "paper-row");
    const time = createElement("div", "paper-time", `${paper.start}–${paper.end}`);
    const body = createElement("div", "paper-body");
    body.append(
      createElement("div", "paper-code", paper.code),
      createElement("h3", "", paper.title),
    );
    if (paper.authors.length) {
      body.append(
        createElement(
          "p",
          "paper-authors",
          paper.authors
            .slice(0, 5)
            .map((author) => author.name)
            .join(" · ") + (paper.authors.length > 5 ? ` · +${paper.authors.length - 5}` : ""),
        ),
      );
    }
    const savedWithSession = sessionIsSaved(session);
    const save = createElement(
      "button",
      `paper-save${paperIsSaved(session, paper) ? " saved" : ""}`,
      savedWithSession ? "Included" : paperIsSaved(session, paper) ? "Saved" : "Save",
    );
    save.type = "button";
    save.disabled = savedWithSession;
    save.setAttribute("aria-pressed", String(paperIsSaved(session, paper)));
    save.setAttribute("aria-label", `${paperIsSaved(session, paper) ? "Remove" : "Add"} ${paper.title} ${paperIsSaved(session, paper) ? "from" : "to"} My program`);
    save.onclick = () => {
      togglePaper(session, paper);
      openSession(day, session);
    };
    row.append(time, body, save);
    paperList.append(row);
  });
  content.append(paperList);
  const source = createElement("a", "official-link", "Open this day in the official PaperCept program ↗");
  source.href = day.source;
  source.target = "_blank";
  source.rel = "noopener";
  content.append(source);
  if (!dialog.open) dialog.showModal();
}

function renderAgenda(day) {
  const content = $("#content");
  content.innerHTML = "";
  const events = getSavedEvents(day.date);
  const conflicts = conflictIds(events);
  const controls = createElement("div", "agenda-controls");
  const summary = createElement(
    "p",
    conflicts.size ? "conflict-summary" : "agenda-summary",
    conflicts.size
      ? `${conflicts.size} saved choices overlap. Conflicts are marked below.`
      : events.length
        ? "No time conflicts in this day."
        : "",
  );
  controls.append(summary);
  if (getSavedEvents().length) {
    const exportButton = createElement("button", "secondary-button", "Export calendar");
    exportButton.type = "button";
    exportButton.onclick = exportCalendar;
    controls.append(exportButton);
  }
  content.append(controls);
  setStatus(
    events.length === 1 ? "1 saved event on this day" : `${events.length} saved events on this day`,
    conflicts.size ? "error" : "",
  );
  if (!events.length) {
    const empty = emptyState(
      `Nothing saved for ${day.day}`,
      "Open a session to save the whole session, or select individual papers.",
    );
    const explore = createElement("button", "primary-button", "Explore the program");
    explore.type = "button";
    explore.onclick = () => switchView("explore");
    empty.append(explore);
    content.append(empty);
    return;
  }
  const timeline = createElement("div", "agenda-timeline");
  events.forEach((event) => {
    const card = createElement("article", `agenda-event${conflicts.has(event.id) ? " conflict" : ""}`);
    const time = createElement("div", "agenda-time");
    time.append(
      createElement("strong", "", event.start || "TBA"),
      createElement("span", "", event.end || ""),
    );
    const body = createElement("button", "agenda-open");
    body.type = "button";
    body.append(
      createElement("span", "agenda-kind", event.kind === "session" ? "SESSION" : `PAPER · ${event.paper.code}`),
      createElement("h3", "", event.title),
      createElement("span", "agenda-meta", `${event.session.room} · ${event.session.code}`),
    );
    body.onclick = () => openSession(event.day, event.session);
    const remove = createElement("button", "remove-button", "×");
    remove.type = "button";
    remove.setAttribute("aria-label", `Remove ${event.title} from My program`);
    remove.onclick = () => {
      if (event.kind === "session") state.savedSessions.delete(event.session.id);
      else state.savedPapers.delete(event.paper.id);
      persistSavedProgram();
      render();
    };
    card.append(time, body, remove);
    timeline.append(card);
  });
  content.append(timeline);
}

function timeToMinutes(time) {
  if (!/^\d{2}:\d{2}$/.test(time || "")) return null;
  const [hours, minutes] = time.split(":").map(Number);
  return hours * 60 + minutes;
}

function conflictIds(events) {
  const result = new Set();
  for (let first = 0; first < events.length; first += 1) {
    const firstStart = timeToMinutes(events[first].start);
    const firstEnd = timeToMinutes(events[first].end);
    if (firstStart === null || firstEnd === null) continue;
    for (let second = first + 1; second < events.length; second += 1) {
      const secondStart = timeToMinutes(events[second].start);
      const secondEnd = timeToMinutes(events[second].end);
      if (secondStart === null || secondEnd === null) continue;
      if (secondStart >= firstEnd) break;
      if (
        firstStart < secondEnd &&
        secondStart < firstEnd
      ) {
        result.add(events[first].id);
        result.add(events[second].id);
      }
    }
  }
  return result;
}

function exportCalendar() {
  const events = getSavedEvents();
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//IFAC 2026 Pocket Program//EN", "CALSCALE:GREGORIAN"];
  events.forEach((event) => {
    const date = event.day.date.replaceAll("-", "");
    const timing = event.start && event.end
      ? [
          `DTSTART;TZID=Asia/Seoul:${date}T${event.start.replace(":", "")}00`,
          `DTEND;TZID=Asia/Seoul:${date}T${event.end.replace(":", "")}00`,
        ]
      : [`DTSTART;VALUE=DATE:${date}`];
    lines.push(
      "BEGIN:VEVENT",
      `UID:${event.id.replace(/[^a-zA-Z0-9.-]/g, "-")}@ifac26-pocket-program`,
      ...timing,
      `SUMMARY:${icsEscape(event.title)}`,
      `LOCATION:${icsEscape(event.session.room)}`,
      `DESCRIPTION:${icsEscape(`${event.session.code} · ${event.session.type}`)}`,
      "END:VEVENT",
    );
  });
  lines.push("END:VCALENDAR");
  const blob = new Blob([lines.join("\r\n")], { type: "text/calendar;charset=utf-8" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = "ifac-2026-my-program.ics";
  link.click();
  URL.revokeObjectURL(link.href);
}

function icsEscape(value) {
  return String(value).replaceAll("\\", "\\\\").replaceAll(";", "\\;").replaceAll(",", "\\,").replaceAll("\n", "\\n");
}

function renderInfo() {
  const content = $("#content");
  content.innerHTML = "";
  setStatus("");
  const intro = createElement("section", "info-card hero-info");
  intro.append(
    createElement("div", "overview-kicker", "IFAC WORLD CONGRESS 2026"),
    createElement("h2", "", "The whole program, ready when you need it"),
    createElement(
      "p",
      "",
      "This unofficial app stores a validated conference snapshot for fast browsing and offline use. Your personal program stays in this browser on this device.",
    ),
  );
  content.append(intro);

  const grid = createElement("div", "info-grid");
  const dataCard = createElement("section", "info-card");
  dataCard.append(
    createElement("h3", "", "Program data"),
    createElement("p", "", `${state.program.statistics.sessions.toLocaleString()} sessions · ${state.program.statistics.papers.toLocaleString()} papers`),
    createElement("p", "muted", `Snapshot checked ${new Date(state.program.generatedAt).toLocaleString()}`),
  );
  const official = createElement("a", "secondary-button link-button", "Open official PaperCept program ↗");
  official.href = state.program.days[0].source;
  official.target = "_blank";
  official.rel = "noopener";
  dataCard.append(official);

  const storageCard = createElement("section", "info-card");
  storageCard.append(
    createElement("h3", "", "Your saved program"),
    createElement(
      "p",
      "",
      state.storageAvailable
        ? "Saved automatically on this device. It will still be here the next time you open the app."
        : "This browser is currently blocking persistent storage.",
    ),
    createElement("p", "muted", `${getSavedEvents().length} saved choices`),
  );
  if (getSavedEvents().length) {
    const exportButton = createElement("button", "secondary-button", "Export saved calendar");
    exportButton.type = "button";
    exportButton.onclick = exportCalendar;
    storageCard.append(exportButton);
  }
  grid.append(dataCard, storageCard);
  content.append(grid);

  const install = createElement("section", "info-card");
  install.append(
    createElement("h3", "", "Keep it on your phone"),
    createElement("p", "", "On iPhone, open the hosted app in Safari, tap Share, then Add to Home Screen. Visit once online so the latest program is available offline."),
    createElement("p", "muted", "The technical program is tentative and may change. This is not an official IFAC or PaperCept product."),
  );
  content.append(install);
}

function emptyState(title, description) {
  const empty = createElement("div", "empty-state");
  empty.append(createElement("div", "empty-star", "☆"), createElement("h3", "", title), createElement("p", "", description));
  return empty;
}

function timePeriod(time) {
  const hour = Number(time.slice(0, 2));
  if (hour < 12) return "Morning";
  if (hour < 17) return "Afternoon";
  return "Evening";
}

function switchView(view) {
  state.view = view;
  render();
  window.scrollTo({ top: 0, behavior: "smooth" });
  if (view === "explore") setTimeout(() => $("#search").focus(), 250);
}

loadSavedProgram();
$("#syncBtn").onclick = () => loadProgram(true);
$("#overviewSaved").onclick = () => switchView("agenda");
$("#search").oninput = (event) => {
  state.query = event.target.value;
  window.clearTimeout(state.searchTimer);
  state.searchTimer = window.setTimeout(render, 90);
};
document.querySelectorAll(".bottom-nav button").forEach((button) => {
  button.onclick = () => switchView(button.dataset.view);
});
$("#closeDialog").onclick = () => $("#detailDialog").close();
$("#detailDialog").onclick = (event) => {
  if (event.target === $("#detailDialog")) $("#detailDialog").close();
};

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("sw.js");
}
loadProgram();
