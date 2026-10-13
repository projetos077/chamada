const state = {
  bytes: null,
  workbook: null,
  sheetName: "",
  workbookFingerprint: "",
  period: { label: "Período selecionado", range: "" },
  fileName: "",
  fileId: "",
  fileVersion: "",
  source: "local",
  turmas: [],
  turma: null,
  aula: null,
  alunos: [],
  history: [],
  accessToken: "",
  tokenExpiresAt: 0,
  syncStatus: "local",
  lastSyncError: "",
  lastConnectionAt: 0,
  reconnectPromise: null,
  pendingPatches: [],
  rosterNotes: []
};

const $ = id => document.getElementById(id);
const views = ["home", "turmas", "aulas", "chamada"];
const CACHE_SCHEMA = "safe-v14";
const APP_VERSION = "15";
const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const GOOGLE_SHEETS_MIME = "application/vnd.google-apps.spreadsheet";
const FREQUENCY_SHEET_NAMES = ["FREQÊNCIA", "FREQUÊNCIA", "FREQUENCIA"];
// A primeira coluna da linha que o Mestrão escreve embaixo de cada turma dizendo
// quais aulas o GAF já validou (CONTRATOS.md §1.1). Planilha sem ela — a da
// extensão, ou uma gerada antes de 09/09/2026 — simplesmente não tem aula
// fechada, e tudo segue como antes.
const GAF_ROW_MARKER = "GAF";
const ABSENCE_OPTIONS = [
  { code: "I", label: "Impossibilidade de participação" },
  { code: "A", label: "Acompanhar parente ou responsável" },
  { code: "E", label: "Enfermidade" },
  { code: "G", label: "Gravidez" },
  { code: "S", label: "Insegurança" },
  { code: "T", label: "Trabalho" },
  { code: "U", label: "Sem transporte escolar" },
  { code: "O", label: "Ensino remoto" },
  { code: "P", label: "Suspeita de COVID" }
];
const ABSENCE_CODES = new Set(["F", ...ABSENCE_OPTIONS.map(option => option.code)]);

// ── Horários do mesmo dia: uma chamada ou duas ──────────────────────────────
//
// A planilha traz uma coluna por horário, e um dia com duas aulas tem duas
// colunas com a mesma data (CONTRATOS.md §1.1). Até a versão 14 o aplicativo
// juntava sempre: uma chamada por data, gravada nos dois horários. Isso apaga a
// diferença quando o professor lançou o primeiro horário no diário e o segundo
// não — a marca de um ia por cima do outro sem ninguém ver.
//
// Agora é escolha dele, do mesmo jeito no Mestrão e aqui:
//   juntos      — uma chamada por dia, gravada em todos os horários (padrão)
//   separados   — uma chamada por horário, cada uma na sua coluna
const LESSON_MODE_KEY = "mestre:horarios";

function lessonsAreJoined() {
  try {
    return localStorage.getItem(LESSON_MODE_KEY) !== "separados";
  } catch (error) {
    return true;
  }
}

function setLessonMode(joined) {
  try {
    localStorage.setItem(LESSON_MODE_KEY, joined ? "juntos" : "separados");
  } catch (error) {
    // Sem armazenamento, a escolha vale só nesta sessão. Não é motivo para parar.
  }
}
let reasonStudentIndex = -1;

function show(view) {
  views.forEach(name => $(`view-${name}`).classList.toggle("active", name === view));
  window.scrollTo({ top: 0, behavior: "instant" });
}

function toast(message) {
  const el = $("toast");
  el.textContent = message;
  el.classList.add("show");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => el.classList.remove("show"), 2800);
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, char => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;"
  })[char]);
}

function dateLabel(value) {
  if (value instanceof Date && !Number.isNaN(value.valueOf())) {
    return `${String(value.getDate()).padStart(2, "0")}/${String(value.getMonth() + 1).padStart(2, "0")}/${value.getFullYear()}`;
  }
  if (typeof value === "number") {
    const parts = XLSX.SSF.parse_date_code(value);
    if (parts) return `${String(parts.d).padStart(2, "0")}/${String(parts.m).padStart(2, "0")}/${parts.y}`;
  }
  const raw = String(value || "").trim();
  let match = raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (match) return `${match[3].padStart(2, "0")}/${match[2].padStart(2, "0")}/${match[1]}`;
  match = raw.match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?$/);
  if (match) {
    const year = match[3]
      ? (match[3].length === 2 ? `20${match[3]}` : match[3])
      : String(new Date().getFullYear());
    return `${match[1].padStart(2, "0")}/${match[2].padStart(2, "0")}/${year}`;
  }
  match = raw.match(/^(\d{1,2})-(\d{1,2})-(\d{2,4})$/);
  if (match) {
    const year = match[3].length === 2 ? `20${match[3]}` : match[3];
    return `${match[2].padStart(2, "0")}/${match[1].padStart(2, "0")}/${year}`;
  }
  return raw;
}

function normalizedStatus(value) {
  const v = String(value ?? "").trim().toUpperCase();
  if (v === "1") return "F";
  if (v === "J") return "I";
  if (!v || v === "0") return "0";
  return v;
}

function isAbsenceStatus(value) {
  return normalizedStatus(value) !== "0";
}

function normalizedSheetName(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .trim();
}

function isFrequencySheetName(value) {
  const name = normalizedSheetName(value);
  return FREQUENCY_SHEET_NAMES.some(candidate => normalizedSheetName(candidate) === name);
}

function hasFrequencyHeaders(rows) {
  return rows.some(row =>
    String(row?.[0] || "").trim().toUpperCase() === "INT"
    && /^TURMA:/i.test(String(row?.[1] || "").trim())
    && normalizedSheetName(row?.[2]) === "NOME"
    && normalizedSheetName(row?.[3]) === "TOTAL"
    && row.slice(4).some(value => value !== null && value !== "")
  );
}

function findFrequencySheet(workbook) {
  const preferred = workbook.SheetNames.filter(isFrequencySheetName);
  const candidates = [...preferred, ...workbook.SheetNames.filter(name => !preferred.includes(name))];
  for (const sheetName of candidates) {
    const sheet = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: null });
    if (hasFrequencyHeaders(rows)) return { sheetName, sheet, rows };
  }
  throw new Error("A aba FREQÊNCIA da nova Mestre não foi encontrada ou está fora do formato esperado.");
}

function extractPeriodInfo(workbook) {
  const instructionsName = workbook.SheetNames.find(name => normalizedSheetName(name) === "INSTRUCOES");
  if (!instructionsName) return { label: "Período selecionado", range: "" };
  const rows = XLSX.utils.sheet_to_json(workbook.Sheets[instructionsName], {
    header: 1,
    raw: false,
    defval: ""
  });
  const text = rows.flat().map(value => String(value || "").trim()).filter(Boolean).join(" ");
  const normalized = normalizedName(text).replace(/[º°]/g, "O");
  const periodMatch = normalized.match(/\b([1-4])\s*O?\s*PERIODO\b/);
  const rangeMatch = text.match(/\bde\s+(\d{1,2}\/\d{1,2}\/\d{4})\s+a\s+(\d{1,2}\/\d{1,2}\/\d{4})\b/i);
  const year = rangeMatch?.[2]?.slice(-4) || "";
  return {
    label: periodMatch ? `${periodMatch[1]}º período${year ? ` de ${year}` : ""}` : "Período selecionado",
    range: rangeMatch ? `${rangeMatch[1]} a ${rangeMatch[2]}` : ""
  };
}

function hashSignature(value) {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    h1 = Math.imul(h1 ^ code, 2654435761);
    h2 = Math.imul(h2 ^ code, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return `${(h1 >>> 0).toString(16).padStart(8, "0")}${(h2 >>> 0).toString(16).padStart(8, "0")}`;
}

function createWorkbookFingerprint(sheetName, turmas) {
  // **A lista de alunos ficou de fora em 09/09/2026.** Ela entrava aqui, e por
  // isso qualquer matrícula ou transferência trocava a assinatura inteira: os
  // rascunhos sumiam e a chamada ainda não enviada era recusada com "a estrutura
  // da planilha foi substituída". Mas a matrícula muda no meio do período, e
  // isso é rotina (CONTRATOS.md §1.5) — não é planilha nova.
  //
  // O que identifica a planilha são as turmas e as datas. Quem entrou e quem
  // saiu é tratado no envio, aluno por aluno, com aviso.
  const structure = turmas.map(turma => ({
    name: normalizedName(turma.name),
    lessons: turma.lessons.map(lesson => [lesson.label, lesson.totalOccurrences])
  }));
  return hashSignature(JSON.stringify([normalizedSheetName(sheetName), structure]));
}

function openCacheDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("chamada-mestre", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("files");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function saveCachedWorkbook(
  bytes,
  fileName,
  source,
  pendingPatches = [],
  fileId = state.fileId,
  fileVersion = state.fileVersion
) {
  const db = await openCacheDb();
  await new Promise((resolve, reject) => {
    const transaction = db.transaction("files", "readwrite");
    transaction.objectStore("files").put({
      bytes: bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes),
      fileName,
      fileId,
      fileVersion,
      source,
      schemaVersion: CACHE_SCHEMA,
      pendingSync: pendingPatches.length > 0,
      pendingPatches,
      savedAt: Date.now()
    }, "current");
    transaction.oncomplete = resolve;
    transaction.onerror = () => reject(transaction.error);
  });
  db.close();
}

async function loadCachedWorkbook() {
  const db = await openCacheDb();
  const cached = await new Promise((resolve, reject) => {
    const request = db.transaction("files").objectStore("files").get("current");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  db.close();
  return cached;
}

function readWorkbookModel(bytes) {
  const workbook = XLSX.read(bytes, { type: "array", cellDates: true, cellFormula: true, raw: true });
  const { sheetName, rows } = findFrequencySheet(workbook);
  const turmas = [];

  for (let rowIndex = 0; rowIndex < rows.length; rowIndex++) {
    const row = rows[rowIndex] || [];
    const marker = String(row[1] || "").trim();
    const isRealHeader = String(row[0] || "").trim().toUpperCase() === "INT"
      && /^TURMA:/i.test(marker)
      && row.slice(4).some(value => value !== null && value !== "");
    if (!isRealHeader) continue;

    const nextHeader = rows.findIndex((candidate, index) =>
      index > rowIndex
      && String(candidate?.[0] || "").trim().toUpperCase() === "INT"
      && /^TURMA:/i.test(String(candidate?.[1] || "").trim())
    );
    const end = nextHeader < 0 ? rows.length : nextHeader;
    const students = [];
    let gafRow = null;
    for (let r = rowIndex + 1; r < end; r++) {
      const name = rows[r]?.[2];
      if (typeof name === "string" && name.trim()) {
        students.push({ rowIndex: r, name: name.trim(), row: rows[r] });
        continue;
      }
      // Linha sem nome não é aluno. Uma delas o Mestrão usa para dizer o que o
      // GAF fechou.
      if (String(rows[r]?.[0] || "").trim().toUpperCase() === GAF_ROW_MARKER) gafRow = rows[r];
    }
    const isLockedColumn = colIndex =>
      Boolean(gafRow && String(gafRow[colIndex] ?? "").trim());

    // Data repetida são horários distintos, na ordem em que aparecem. Não
    // desduplicar, não reordenar (CONTRATOS.md §1.1).
    const dayColumns = new Map();
    for (let colIndex = 4; colIndex < row.length; colIndex++) {
      const value = row[colIndex];
      if (value === null || value === "") continue;
      const label = dateLabel(value);
      if (!dayColumns.has(label)) dayColumns.set(label, []);
      dayColumns.get(label).push(colIndex);
    }

    const joined = lessonsAreJoined();
    const lessons = [];
    dayColumns.forEach((colIndexes, label) => {
      const total = colIndexes.length;
      if (joined) {
        lessons.push({
          key: label,
          label,
          title: label,
          colIndexes,
          occurrences: colIndexes.map((item, index) => index + 1),
          totalOccurrences: total
        });
        return;
      }
      colIndexes.forEach((colIndex, index) => {
        lessons.push({
          key: `${label}#${index + 1}`,
          label,
          title: total > 1 ? `${label} · ${index + 1}º horário` : label,
          colIndexes: [colIndex],
          occurrences: [index + 1],
          totalOccurrences: total
        });
      });
    });

    lessons.forEach(lesson => {
      // **Aula validada pelo GAF não aceita mais alteração** — o SIAEP fecha os
      // campos, e o que for mudado aqui não entra no diário. As colunas fechadas
      // ficam de fora da escrita; se todas estiverem, a aula não abre.
      lesson.lockedColumns = lesson.colIndexes.filter(isLockedColumn);
      lesson.writableColumns = lesson.colIndexes.filter(colIndex => !isLockedColumn(colIndex));
      lesson.writableOccurrences = lesson.occurrences.filter(
        (occurrence, index) => !isLockedColumn(lesson.colIndexes[index])
      );
      lesson.locked = lesson.lockedColumns.length === lesson.colIndexes.length;
      lesson.completedInFile = lesson.colIndexes.every(colIndex => {
        const values = students.map(student => String(student.row[colIndex] ?? "").trim());
        const hasAbsence = values.some(value => value !== "" && isAbsenceStatus(value));
        const fullyRegistered = values.length > 0 && values.every(value => value !== "");
        return hasAbsence || fullyRegistered;
      });
    });

    turmas.push({
      name: marker.replace(/^TURMA:\s*-?/i, "").trim(),
      headerRow: rowIndex,
      students,
      lessons
    });
  }

  if (!turmas.length) throw new Error("Nenhuma turma compatível com a Mestre foi encontrada.");
  return {
    workbook,
    sheetName,
    turmas,
    period: extractPeriodInfo(workbook),
    fingerprint: createWorkbookFingerprint(sheetName, turmas)
  };
}

function parseWorkbook(bytes, fileName, source = "local", options = {}) {
  const { workbook, sheetName, turmas, period, fingerprint } = readWorkbookModel(bytes);
  state.bytes = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  state.workbook = workbook;
  state.sheetName = sheetName;
  state.workbookFingerprint = fingerprint;
  state.period = period;
  state.fileName = fileName;
  state.fileId = options.fileId || "";
  state.fileVersion = options.fileVersion || "";
  state.source = source;
  state.turmas = turmas;
  state.pendingPatches = Array.isArray(options.pendingPatches) ? options.pendingPatches : [];
  state.syncStatus = options.fromCache
    ? (source === "drive" ? (state.pendingPatches.length ? "pending" : "cached") : "local")
    : (source === "drive" ? "synced" : "local");
  state.lastSyncError = options.unsafeLegacyPending
    ? "Uma gravação antiga foi bloqueada para não sobrescrever a planilha do Drive. Atualize a planilha antes de continuar."
    : "";
  if (options.unsafeLegacyPending) state.syncStatus = "error";
  $("arquivo-nome").textContent = "Prof. Maurício";
  renderWorkbookSummary();
  if (!options.fromCache) saveCachedWorkbook(state.bytes, fileName, source, [], state.fileId).catch(() => {});
  updateSyncUi();
  renderTurmas();
  show("turmas");
}

function refreshWorkbookState(bytes) {
  const currentTurma = state.turma?.name;
  const currentDate = state.aula?.label;
  const { workbook, sheetName, turmas, period, fingerprint } = readWorkbookModel(bytes);
  state.bytes = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  state.workbook = workbook;
  state.sheetName = sheetName;
  state.workbookFingerprint = fingerprint;
  state.period = period;
  state.turmas = turmas;
  state.turma = turmas.find(item => normalizedName(item.name) === normalizedName(currentTurma)) || null;
  state.aula = state.turma?.lessons.find(item => item.label === currentDate) || null;
  renderWorkbookSummary();
}

function renderLessonModeButton() {
  const button = $("btn-horarios");
  if (!button) return;
  const joined = lessonsAreJoined();
  button.textContent = joined
    ? "Horários do mesmo dia: uma chamada"
    : "Horários do mesmo dia: uma chamada para cada";
  button.title = joined
    ? "O dia com duas aulas tem uma chamada só, gravada nos dois horários."
    : "Cada horário tem a sua chamada, gravada só na coluna dele.";
}

function renderWorkbookSummary() {
  const summary = $("arquivo-resumo");
  if (!summary) return;
  const students = state.turmas.reduce((total, turma) => total + turma.students.length, 0);
  const hasAudit = state.workbook?.SheetNames?.some(name => normalizedSheetName(name) === "AUDITORIA");
  const model = hasAudit ? "Modelo v2" : state.sheetName;
  summary.textContent = `${state.period.label} · ${state.turmas.length} turmas · ${students} alunos · ${model}`;
  renderLessonModeButton();
}

function updateSyncUi() {
  const card = $("sync-card");
  if (!card) return;
  card.classList.remove("synced", "pending", "error", "connecting", "offline", "authorization", "remote");
  const title = $("sync-title");
  const message = $("sync-message");
  const button = $("btn-sync-drive");

  if (state.source !== "drive") {
    title.textContent = "Arquivo local";
    message.textContent = "As alterações são baixadas como arquivo XLSX.";
    button.hidden = true;
    return;
  }

  button.hidden = false;
  if (state.syncStatus === "synced") {
    card.classList.add("synced");
    title.textContent = "Google Drive sincronizado";
    const checked = state.lastConnectionAt
      ? ` Conferida às ${new Date(state.lastConnectionAt).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}.`
      : "";
    message.textContent = `A planilha ativa corresponde ao arquivo do Drive.${checked}`;
    button.textContent = "Atualizar";
  } else if (state.syncStatus === "connecting") {
    card.classList.add("connecting");
    title.textContent = "Conectando à planilha do período";
    message.textContent = "Verificando a versão selecionada no Google Drive...";
    button.textContent = "Conectando...";
  } else if (state.syncStatus === "authorization") {
    card.classList.add("authorization");
    title.textContent = "Planilha do período selecionada";
    message.textContent = "Toque em Conectar quando o Google solicitar uma nova autorização.";
    button.textContent = "Conectar";
  } else if (state.syncStatus === "offline") {
    card.classList.add("offline");
    title.textContent = "Sem internet";
    message.textContent = "A cópia deste iPhone continua disponível. A conexão será tentada quando a internet voltar.";
    button.textContent = "Tentar conexão";
  } else if (state.syncStatus === "remote") {
    card.classList.add("remote");
    title.textContent = "Há uma versão nova no Drive";
    message.textContent = "Toque em Atualizar antes de continuar nesta planilha.";
    button.textContent = "Atualizar";
  } else if (state.syncStatus === "pending") {
    card.classList.add("pending");
    title.textContent = "Salva no iPhone";
    const total = state.pendingPatches.length;
    message.textContent = `${total} chamada${total === 1 ? "" : "s"} aguardando envio seguro ao Google Drive.`;
    button.textContent = "Enviar agora";
  } else if (state.syncStatus === "error") {
    card.classList.add("error");
    title.textContent = "Não sincronizada";
    message.textContent = state.lastSyncError || "Não foi possível acessar o Google Drive.";
    button.textContent = "Tentar novamente";
  } else {
    card.classList.add("authorization");
    title.textContent = "Cópia da planilha do período";
    message.textContent = "O arquivo está memorizado. Toque em Conectar para conferir o Google Drive.";
    button.textContent = "Conectar";
  }
}

function renderTurmas() {
  const today = dateLabel(new Date());
  $("turma-grid").innerHTML = state.turmas.map((turma, index) => {
    const completed = turma.lessons.filter(isLessonCompleted.bind(null, turma)).length;
    const pending = turma.lessons.length - completed;
    const todayPending = turma.lessons.some(lesson => lesson.label === today && !isLessonCompleted(turma, lesson));
    const status = pending === 0
      ? `<span class="turma-status complete">✓ Todas realizadas</span>`
      : todayPending
        ? `<span class="turma-status today">Chamada de hoje pendente</span>`
      : `<span class="turma-status">${pending} chamada${pending === 1 ? "" : "s"} pendente${pending === 1 ? "" : "s"}</span>`;
    return `
      <button class="turma-card ${pending === 0 ? "complete" : ""} ${todayPending ? "today" : ""}" data-turma="${index}">
        <span class="turma-icon">${pending === 0 ? "✓" : pending}</span>
        <span class="turma-copy">
          <strong>${escapeHtml(turma.name)}</strong>
          <span>${turma.students.length} alunos · ${completed}/${turma.lessons.length} realizadas</span>
          ${status}
        </span>
        <span class="card-arrow">›</span>
      </button>
    `;
  }).join("");
}

function draftKey(turma, lesson) {
  const fileKey = state.source === "drive" && state.fileId
    ? `drive:${state.fileId}`
    : `local:${state.fileName}`;
  const workbookKey = state.workbookFingerprint || "unknown";
  // `lesson.key` e não `label`: com os horários separados, o 1º e o 2º do mesmo
  // dia são chamadas diferentes e não podem dividir o mesmo rascunho.
  return `mestre:draft:v6:${fileKey}:workbook:${workbookKey}:${turma.name}:${lesson.key}`;
}

function isLessonCompleted(turma, lesson) {
  return lesson.completedInFile;
}

function openTurma(index) {
  state.turma = state.turmas[index];
  const today = dateLabel(new Date());
  $("turma-nome").textContent = state.turma.name;
  $("aula-list").innerHTML = state.turma.lessons.map((lesson, lessonIndex) => {
    // Com os horários separados, o título já diz "1º horário": repetir "de 2 do
    // dia" embaixo é ruído.
    const suffix = lesson.colIndexes.length > 1 ? ` · ${lesson.totalOccurrences} horários` : "";
    const done = isLessonCompleted(state.turma, lesson);
    const isToday = lesson.label === today;
    const locked = Boolean(lesson.locked);
    return `
      <button class="aula-card ${done || locked ? "done" : "pending"} ${isToday && !done && !locked ? "today" : ""}" data-aula="${lessonIndex}">
        <span class="lesson-state">${locked ? "🔒" : done ? "✓" : lessonIndex + 1}</span>
        <span class="lesson-copy">
          <span class="date">${escapeHtml(lesson.title || lesson.label)}</span>
          <span>Aula${suffix}${locked ? " · validada pelo GAF" : isToday ? " · Hoje" : ""}</span>
        </span>
        <span class="lesson-action">${locked ? "Fechada" : done ? "Realizada" : isToday ? "Fazer hoje" : "Fazer chamada"} <b>›</b></span>
      </button>
    `;
  }).join("");
  show("aulas");
}

function openLesson(index) {
  const lesson = state.turma.lessons[index];
  if (lesson.locked) {
    toast("Aula validada pelo GAF: o SIAEP não aceita mais alteração nela.");
    return;
  }
  if (lesson.lockedColumns?.length) {
    toast(`Em ${lesson.label}, ${lesson.lockedColumns.length} horário já foi validado pelo GAF e não será alterado.`);
  }
  if (isLessonCompleted(state.turma, lesson)) {
    const reopen = window.confirm(
      `A chamada de ${lesson.label} já foi realizada.\n\nDeseja abrir mesmo assim para conferir ou corrigir?`
    );
    if (!reopen) return;
  }
  state.aula = lesson;
  // O rascunho é guardado por NOME, não pela posição da linha: quando alguém é
  // matriculado ou transferido, as linhas descem uma casa e o rascunho antigo
  // marcaria a falta na pessoa de baixo.
  const draft = JSON.parse(localStorage.getItem(draftKey(state.turma, state.aula)) || "null");
  state.alunos = state.turma.students.map(student => {
    const originalStatuses = state.aula.colIndexes.map(colIndex => normalizedStatus(student.row[colIndex]));
    const firstAbsence = originalStatuses.find(isAbsenceStatus);
    const originalStatus = firstAbsence || originalStatuses[0] || "0";
    return {
      rowIndex: student.rowIndex,
      name: student.name,
      originalStatuses,
      originalStatus,
      status: normalizedStatus(draft?.[normalizedName(student.name)] ?? originalStatus)
    };
  });
  state.history = [];
  $("chamada-turma").textContent = state.turma.name;
  $("chamada-data").textContent = state.aula.colIndexes.length > 1
    ? `${state.aula.label} · ${state.aula.totalOccurrences} horários`
    : state.aula.title || state.aula.label;
  $("busca").value = "";
  renderStudents();
  show("chamada");
}

function renderStudents(filter = "") {
  const query = filter.trim().toLocaleLowerCase("pt-BR");
  $("aluno-list").innerHTML = state.alunos.map((student, index) => {
    if (query && !student.name.toLocaleLowerCase("pt-BR").includes(query)) return "";
    const justified = isAbsenceStatus(student.status) && student.status !== "F";
    const css = student.status === "F" ? "falta" : justified ? "justificada" : "";
    return `
      <article class="aluno ${css}" data-student="${index}">
        <span class="numero">${index + 1}</span>
        <span class="nome">${escapeHtml(student.name)}</span>
        <div class="status-buttons">
          <button class="f ${student.status === "F" ? "active" : ""}" data-status="F" aria-label="Falta">F</button>
          <button class="i ${justified ? "active" : ""}" data-reason aria-label="Escolher justificativa">${justified ? escapeHtml(student.status) : "I"}</button>
        </div>
      </article>
    `;
  }).join("");
  updateSummary();
}

function setStatus(index, requested, recordHistory = true) {
  const student = state.alunos[index];
  const previous = student.status;
  const next = previous === requested ? "0" : requested;
  if (previous === next) return;
  if (recordHistory) state.history.push({ index, previous });
  student.status = next;
  saveDraft();
  renderStudents($("busca").value);
  $("btn-desfazer").disabled = state.history.length === 0;
}

function saveDraft() {
  const values = Object.fromEntries(state.alunos.map(student => [normalizedName(student.name), student.status]));
  localStorage.setItem(draftKey(state.turma, state.aula), JSON.stringify(values));
  $("draft-state").textContent = `Rascunho salvo às ${new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}`;
}

function updateSummary() {
  const faltas = state.alunos.filter(student => student.status === "F").length;
  const justificadas = state.alunos.filter(student => isAbsenceStatus(student.status) && student.status !== "F").length;
  $("count-faltas").textContent = faltas;
  $("count-justificadas").textContent = justificadas;
  $("count-presentes").textContent = state.alunos.length - faltas - justificadas;
}

function openReasonPicker(index) {
  reasonStudentIndex = index;
  const student = state.alunos[index];
  $("reason-student-name").textContent = student.name;
  document.querySelectorAll("[data-reason-status]").forEach(button => {
    button.classList.toggle("active", button.dataset.reasonStatus === student.status);
  });
  $("reason-dialog").showModal();
}

function colName(index) {
  let name = "";
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) {
    name = String.fromCharCode(65 + ((n - 1) % 26)) + name;
  }
  return name;
}

function colIndexFromName(name) {
  return String(name).split("").reduce((total, char) =>
    total * 26 + char.toUpperCase().charCodeAt(0) - 64, 0
  ) - 1;
}

function cellColIndex(address) {
  return colIndexFromName(String(address).replace(/[0-9]/g, ""));
}

function xmlEscape(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function xmlUnescape(value) {
  return String(value)
    .replace(/&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&gt;/g, ">")
    .replace(/&lt;/g, "<")
    .replace(/&amp;/g, "&");
}

function xmlAttribute(tag, name) {
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = tag.match(new RegExp(`(?:^|\\s)${escapedName}="([^"]*)"`));
  return match ? xmlUnescape(match[1]) : "";
}

function resolveZipPath(basePath, targetPath) {
  if (targetPath.startsWith("/")) return targetPath.replace(/^\/+/, "");
  const parts = basePath.split("/");
  parts.pop();
  targetPath.split("/").forEach(part => {
    if (!part || part === ".") return;
    if (part === "..") parts.pop();
    else parts.push(part);
  });
  return parts.join("/");
}

async function findWorksheetPath(zip, sheetName) {
  const workbookFile = zip.file("xl/workbook.xml");
  const relationshipsFile = zip.file("xl/_rels/workbook.xml.rels");
  if (!workbookFile || !relationshipsFile) {
    throw new Error("A estrutura interna da planilha está incompleta.");
  }
  const workbookXml = await workbookFile.async("string");
  const sheetTag = [...workbookXml.matchAll(/<sheet\b[^>]*\/?\s*>/g)]
    .map(match => match[0])
    .find(tag => normalizedSheetName(xmlAttribute(tag, "name")) === normalizedSheetName(sheetName));
  const relationshipId = sheetTag ? xmlAttribute(sheetTag, "r:id") : "";
  if (!relationshipId) throw new Error(`Não foi possível localizar internamente a aba ${sheetName}.`);

  const relationshipsXml = await relationshipsFile.async("string");
  const relationshipTag = [...relationshipsXml.matchAll(/<Relationship\b[^>]*\/?\s*>/g)]
    .map(match => match[0])
    .find(tag => xmlAttribute(tag, "Id") === relationshipId);
  const target = relationshipTag ? xmlAttribute(relationshipTag, "Target") : "";
  if (!target) throw new Error(`O arquivo interno da aba ${sheetName} não foi encontrado.`);
  return resolveZipPath("xl/workbook.xml", target);
}

function patchCellInRow(rowXml, address, status) {
  const cellRegex = new RegExp(`<c\\b([^>]*\\br="${address}"[^>]*)>[\\s\\S]*?<\\/c>`);
  const selfClosingRegex = new RegExp(`<c\\b([^>]*\\br="${address}"[^>]*)\\/>`);
  const match = rowXml.match(cellRegex) || rowXml.match(selfClosingRegex);
  const normalized = normalizedStatus(status);
  const attributes = match ? match[1].replace(/\s+t="[^"]*"/g, "") : ` r="${address}"`;
  const cell = normalized === "0"
    ? `<c${attributes}><v>0</v></c>`
    : `<c${attributes} t="inlineStr"><is><t>${xmlEscape(normalized)}</t></is></c>`;
  if (match) return rowXml.replace(match[0], cell);

  const targetColIndex = cellColIndex(address);
  const cells = [...rowXml.matchAll(/<c\b[^>]*\br="([A-Z]+[0-9]+)"[^>]*(?:\/>|>[\s\S]*?<\/c>)/g)];
  const next = cells.find(item => cellColIndex(item[1]) > targetColIndex);
  if (next) {
    return rowXml.slice(0, next.index) + cell + rowXml.slice(next.index);
  }
  return rowXml.replace("</row>", `${cell}</row>`);
}

function normalizedName(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();
}

function createAttendancePatch() {
  return {
    workbookFingerprint: state.workbookFingerprint,
    turmaName: state.turma.name,
    dateLabel: state.aula.label,
    // Quais horários daquele dia esta chamada escreve: [1] e [2] quando estão
    // separados, [1, 2] quando juntos. Patch da versão 14 não tem o campo, e
    // continua valendo para o dia inteiro, como valia lá.
    occurrences: state.aula.writableOccurrences ?? state.aula.occurrences,
    statuses: state.alunos.map(student => ({
      name: student.name,
      baseStatuses: (state.aula.writableColumns ?? state.aula.colIndexes).map(colIndex => {
        const sourceStudent = state.turma.students.find(item => item.rowIndex === student.rowIndex);
        return normalizedStatus(sourceStudent?.row[colIndex]);
      }),
      status: normalizedStatus(student.status)
    }))
  };
}

/** Duas chamadas do mesmo dia só se sobrepõem se escreverem os mesmos horários. */
function patchKey(patch) {
  const occurrences = Array.isArray(patch.occurrences) ? patch.occurrences.join(",") : "dia";
  return `${normalizedName(patch.turmaName)}|${patch.dateLabel}|${occurrences}`;
}

function upsertPendingPatch(patches, patch) {
  const key = patchKey(patch);
  const existing = patches.find(item => patchKey(item) === key);
  if (existing) {
    const baseByName = new Map(existing.statuses.map(item => [normalizedName(item.name), item.baseStatuses]));
    patch.statuses.forEach(item => {
      item.baseStatuses = baseByName.get(normalizedName(item.name)) ?? item.baseStatuses;
    });
  }
  return [...patches.filter(item => patchKey(item) !== key), patch];
}

function resolvePatchTarget(model, patch) {
  if (!patch.workbookFingerprint || patch.workbookFingerprint !== model.fingerprint) {
    throw new Error("A estrutura da planilha foi substituída. Atualize o arquivo e refaça essa chamada.");
  }
  const turma = model.turmas.find(item => normalizedName(item.name) === normalizedName(patch.turmaName));
  if (!turma) throw new Error(`A turma ${patch.turmaName} não foi encontrada na versão atual do Drive.`);

  // As colunas daquele dia, na ordem do relógio — independentes de como as aulas
  // estão sendo mostradas agora, juntas ou separadas.
  const columnByOccurrence = new Map();
  const lockedColumns = new Set();
  turma.lessons
    .filter(item => item.label === patch.dateLabel)
    .forEach(lesson => {
      lesson.colIndexes.forEach((colIndex, index) => {
        columnByOccurrence.set(lesson.occurrences[index], colIndex);
      });
      (lesson.lockedColumns ?? []).forEach(colIndex => lockedColumns.add(colIndex));
    });
  if (!columnByOccurrence.size) {
    throw new Error(`A data ${patch.dateLabel} não foi encontrada na turma ${patch.turmaName}.`);
  }

  const occurrences = Array.isArray(patch.occurrences) && patch.occurrences.length
    ? patch.occurrences
    : [...columnByOccurrence.keys()];
  const colIndexes = occurrences
    .map(occurrence => columnByOccurrence.get(occurrence))
    .filter(colIndex => colIndex !== undefined && !lockedColumns.has(colIndex));
  if (!colIndexes.length) {
    // Ou o horário sumiu da planilha, ou o GAF validou a aula enquanto a
    // chamada esperava para ser enviada. Nos dois casos, escrever não serviria
    // para nada — o diário não aceita mais.
    throw new Error(
      `A aula de ${patch.dateLabel} da turma ${patch.turmaName} não aceita mais chamada `
      + "— o GAF validou, ou o horário saiu da planilha."
    );
  }

  const remoteStudents = new Map();
  turma.students.forEach(student => {
    const key = normalizedName(student.name);
    if (remoteStudents.has(key)) {
      throw new Error(`Existem alunos com nome repetido na turma ${patch.turmaName}. O envio foi bloqueado.`);
    }
    remoteStudents.set(key, student);
  });

  // **A lista de alunos muda durante o período, e isso é rotina** — o diretor
  // transfere, matricula e desliga a qualquer momento (CONTRATOS.md §1.5). Até a
  // versão 14 qualquer diferença de tamanho recusava a chamada inteira, e a
  // chamada de 30 alunos se perdia porque um saiu da turma.
  //
  // O que continua bloqueando é o conflito de verdade: a marca daquele aluno
  // mudou no Drive depois que esta chamada foi aberta.
  const students = [];
  const missing = [];
  patch.statuses.forEach(item => {
    const key = normalizedName(item.name);
    const student = remoteStudents.get(key);
    if (!student) {
      missing.push(item.name);
      return;
    }
    remoteStudents.delete(key);
    const base = Array.isArray(item.baseStatuses) ? item.baseStatuses : [];
    const currentStatuses = colIndexes.map(colIndex => normalizedStatus(student.row[colIndex]));
    const requestedStatus = normalizedStatus(item.status);
    const alreadyApplied = currentStatuses.every(status => status === requestedStatus);
    const unchangedSinceOpen = currentStatuses.every((status, index) =>
      status === normalizedStatus(base[index] ?? base[0] ?? "0")
    );
    if (!alreadyApplied && !unchangedSinceOpen) {
      throw new Error(`A chamada de ${patch.dateLabel} foi alterada no Drive. Atualize antes de corrigir novamente.`);
    }
    students.push({ ...student, status: requestedStatus });
  });

  // Quem sobrou na planilha e não estava na chamada entrou na turma depois. Não
  // recebe marca nenhuma: ausência de informação não é presença.
  const added = [...remoteStudents.values()].map(student => student.name);
  return { colIndexes, students, missing, added, dateLabel: patch.dateLabel };
}

async function buildPatchedWorkbook(baseBytes, patches) {
  const model = readWorkbookModel(baseBytes);
  const targets = patches.map(patch => resolvePatchTarget(model, patch));
  // Quem entrou e quem saiu da turma desde que a chamada foi feita. Fica no
  // estado para a tela dizer ao professor depois do envio — em silêncio, ele
  // procuraria um nome que a planilha não tem mais.
  state.rosterNotes = targets.flatMap(target => [
    ...target.missing.map(name => `${name} saiu da turma: a marca dele não foi enviada.`),
    ...target.added.map(name => `${name} entrou na turma: ${target.dateLabel} está sem chamada para ele.`)
  ]);
  const zip = await JSZip.loadAsync(baseBytes);
  const sheetPath = await findWorksheetPath(zip, model.sheetName);
  const file = zip.file(sheetPath);
  if (!file) throw new Error(`A aba ${model.sheetName} não foi encontrada dentro da planilha.`);
  let xml = await file.async("string");

  targets.forEach(({ colIndexes, students }) => {
    students.forEach(student => {
      const excelRow = student.rowIndex + 1;
      const rowRegex = new RegExp(`<row\\b([^>]*\\br="${excelRow}"[^>]*)>[\\s\\S]*?<\\/row>`);
      const match = xml.match(rowRegex);
      if (!match) throw new Error(`Linha ${excelRow} não encontrada no modelo.`);
      let rowXml = match[0];
      colIndexes.forEach(colIndex => {
        const address = `${colName(colIndex)}${excelRow}`;
        rowXml = patchCellInRow(rowXml, address, student.status);
      });
      xml = xml.replace(match[0], rowXml);
    });
  });

  zip.file(sheetPath, xml);
  return zip.generateAsync({
    type: "uint8array",
    compression: "DEFLATE",
    compressionOptions: { level: 6 }
  });
}

function download(bytes) {
  const blob = new Blob([bytes], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = state.fileName || "frequencia.xlsx";
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 1500);
}

function driveConfig() {
  return {
    clientId: localStorage.getItem("mestre:google-client-id") || "",
    apiKey: localStorage.getItem("mestre:google-api-key") || "",
    appId: localStorage.getItem("mestre:google-app-id") || "",
    fileId: localStorage.getItem("mestre:google-file-id") || "",
    fileName: localStorage.getItem("mestre:google-file-name") || "",
    periodLabel: localStorage.getItem("mestre:google-period-label") || ""
  };
}

function updateDriveUi() {
  const config = driveConfig();
  $("btn-drive").textContent = config.fileId
    ? "Conectar à planilha atual"
    : "Selecionar planilha do período";
  document.querySelectorAll("[data-new-period]").forEach(button => {
    button.hidden = !config.fileId;
  });
  const status = $("home-status");
  if (config.fileName) {
    status.querySelector("strong").textContent = config.periodLabel || "Planilha do período memorizada";
    status.querySelector("p").textContent = `${config.fileName} continuará ativa até você carregar uma nova planilha.`;
  } else {
    status.querySelector("strong").textContent = "Pronto";
    status.querySelector("p").textContent = "Selecione a planilha usada pela extensão Mestre.";
  }
}

function requestDriveToken() {
  const { clientId } = driveConfig();
  if (!clientId) return Promise.reject(new Error("Configure o OAuth Client ID."));
  if (!window.google?.accounts?.oauth2) return Promise.reject(new Error("O login Google ainda não carregou."));
  if (state.accessToken && Date.now() < state.tokenExpiresAt - 60000) {
    return Promise.resolve(state.accessToken);
  }
  return new Promise((resolve, reject) => {
    let finished = false;
    const finish = (handler, value) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      handler(value);
    };
    const timer = setTimeout(() => {
      finish(reject, new Error("O Google não respondeu. Verifique se o popup foi bloqueado e tente novamente."));
    }, 20000);
    const client = google.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: "https://www.googleapis.com/auth/drive.file",
      callback: response => {
        if (response.error) finish(reject, new Error(response.error_description || response.error));
        else {
          state.accessToken = response.access_token;
          state.tokenExpiresAt = Date.now() + (Number(response.expires_in) || 3600) * 1000;
          finish(resolve, response.access_token);
        }
      },
      error_callback: error => {
        const message = error?.type === "popup_failed_to_open"
          ? "O iPhone bloqueou a janela do Google. Permita popups para este site."
          : "A autorização do Google foi fechada ou não pôde ser concluída.";
        finish(reject, new Error(message));
      }
    });
    client.requestAccessToken({ prompt: "" });
  });
}

function waitForGoogleLibrary(name, test) {
  if (test()) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const timer = setInterval(() => {
      if (test()) {
        clearInterval(timer);
        resolve();
      } else if (Date.now() - started > 10000) {
        clearInterval(timer);
        reject(new Error(`${name} não carregou. Verifique sua internet e tente novamente.`));
      }
    }, 100);
  });
}

async function fetchWithTimeout(url, options = {}, timeout = 20000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } catch (error) {
    if (error.name === "AbortError") {
      throw new Error("O Google Drive demorou para responder. Verifique a internet e tente novamente.");
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function loadPickerApi() {
  await waitForGoogleLibrary("O seletor do Google", () => Boolean(window.gapi?.load));
  if (window.google?.picker) return;
  await new Promise((resolve, reject) => {
    gapi.load("picker", {
      callback: resolve,
      onerror: () => reject(new Error("Não foi possível carregar o seletor do Google.")),
      timeout: 10000,
      ontimeout: () => reject(new Error("O seletor do Google demorou para responder."))
    });
  });
}

async function pickDriveFile() {
  const { clientId, apiKey, appId } = driveConfig();
  if (!clientId || !apiKey || !appId) {
    throw new Error("Complete a configuração do Google Drive.");
  }
  await waitForGoogleLibrary("O login Google", () => Boolean(window.google?.accounts?.oauth2));
  const token = await requestDriveToken();
  await loadPickerApi();

  return new Promise((resolve, reject) => {
    const view = new google.picker.DocsView(google.picker.ViewId.DOCS)
      .setMimeTypes("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
      .setIncludeFolders(false)
      .setSelectFolderEnabled(false);
    const picker = new google.picker.PickerBuilder()
      .addView(view)
      .setOAuthToken(token)
      .setDeveloperKey(apiKey)
      .setAppId(appId)
      .setTitle("Escolha a planilha de frequência")
      .setCallback(data => {
        if (data.action === google.picker.Action.PICKED) {
          const document = data.docs?.[0];
          if (!document?.id) {
            reject(new Error("O Google não informou o arquivo selecionado."));
            return;
          }
          resolve({ id: document.id, name: document.name || "frequencia.xlsx" });
        } else if (data.action === google.picker.Action.CANCEL) {
          resolve(null);
        }
      })
      .build();
    picker.setVisible(true);
  });
}

function ensureDriveTarget() {
  const configuredFileId = driveConfig().fileId;
  if (!state.fileId || !configuredFileId || state.fileId !== configuredFileId) {
    throw new Error("A planilha aberta não corresponde ao arquivo memorizado no Drive. Atualize antes de salvar.");
  }
  return state.fileId;
}

async function getDriveMetadata(token, fileId = state.fileId || driveConfig().fileId) {
  if (!fileId) throw new Error("Escolha uma planilha no Google Drive.");
  const response = await fetchWithTimeout(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?fields=name,mimeType,version,modifiedTime,size`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!response.ok) {
    if (response.status === 401) {
      state.accessToken = "";
      state.tokenExpiresAt = 0;
      throw new Error("A sessão do Google expirou. Toque em Conectar para continuar.");
    }
    if (response.status === 403) {
      throw new Error("O Google não autorizou o acesso à planilha selecionada.");
    }
    throw new Error("Não foi possível localizar o arquivo no Drive.");
  }
  return response.json();
}

function validateDriveWorkbook(meta) {
  const name = String(meta?.name || "arquivo");
  const mimeType = String(meta?.mimeType || "");
  if (mimeType === GOOGLE_SHEETS_MIME) {
    throw new Error("Esse arquivo foi convertido em Planilhas Google. Selecione o arquivo .xlsx original para preservar o formato da Mestre.");
  }
  if (mimeType !== XLSX_MIME && !name.toLowerCase().endsWith(".xlsx")) {
    throw new Error(`O arquivo ${name} não é uma planilha .xlsx compatível com a Mestre.`);
  }
}

function validateXlsxBytes(bytes) {
  const isZip = bytes?.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b;
  if (!isZip) {
    throw new Error("O Drive não devolveu um arquivo .xlsx válido. Selecione novamente a planilha original do período.");
  }
}

async function downloadLatestDriveWorkbook(token, fileId = state.fileId || driveConfig().fileId) {
  const before = await getDriveMetadata(token, fileId);
  validateDriveWorkbook(before);
  const response = await fetchWithTimeout(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!response.ok) {
    if (response.status === 401) {
      state.accessToken = "";
      state.tokenExpiresAt = 0;
      throw new Error("A sessão do Google expirou. Toque em Conectar para continuar.");
    }
    throw new Error("Não foi possível baixar a planilha do Drive.");
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  validateXlsxBytes(bytes);
  const after = await getDriveMetadata(token, fileId);
  validateDriveWorkbook(after);
  if (String(before.version) !== String(after.version)) {
    throw new Error("A planilha mudou enquanto era baixada. Tente novamente.");
  }
  return { bytes, meta: after };
}

async function openFromDrive(file) {
  const fileId = file?.id || driveConfig().fileId;
  if (!fileId) throw new Error("Escolha uma planilha no Google Drive.");
  const token = await requestDriveToken();
  const { bytes, meta } = await downloadLatestDriveWorkbook(token, fileId);
  // Só substitui a planilha ativa depois de validar todo o arquivo.
  try {
    readWorkbookModel(bytes);
  } catch (error) {
    if (error.message === "Nenhuma turma compatível com a Mestre foi encontrada.") {
      throw new Error(`O arquivo ${meta.name} foi baixado, mas a aba de frequência não corresponde à versão atual da Mestre.`);
    }
    throw error;
  }
  parseWorkbook(bytes, meta.name, "drive", { fileId, fileVersion: String(meta.version || "") });
  localStorage.setItem("mestre:google-file-id", fileId);
  localStorage.setItem("mestre:google-file-name", meta.name);
  localStorage.setItem("mestre:google-period-label", state.period.label);
  state.lastConnectionAt = Date.now();
  state.syncStatus = "synced";
  updateDriveUi();
  updateSyncUi();
}

async function selectPeriodWorkbook() {
  if (state.pendingPatches.length) {
    throw new Error("Existe uma chamada aguardando envio. Conecte a planilha atual antes de trocar de período.");
  }
  const file = await pickDriveFile();
  if (!file) return false;
  await openFromDrive(file);
  toast(`${state.period.label} carregado e definido como período ativo.`);
  return true;
}

function hasUsableDriveToken() {
  return Boolean(state.accessToken) && Date.now() < state.tokenExpiresAt - 60000;
}

function activeViewId() {
  return document.querySelector(".view.active")?.id || "";
}

async function attemptDriveReconnect() {
  const config = driveConfig();
  if (state.source !== "drive" || !state.fileId || state.fileId !== config.fileId) return false;
  if (navigator.onLine === false) {
    state.syncStatus = "offline";
    updateSyncUi();
    return false;
  }
  if (!hasUsableDriveToken()) {
    state.syncStatus = state.pendingPatches.length ? "pending" : "authorization";
    updateSyncUi();
    return false;
  }
  if (state.reconnectPromise) return state.reconnectPromise;

  state.syncStatus = "connecting";
  updateSyncUi();
  state.reconnectPromise = (async () => {
    try {
      const meta = await getDriveMetadata(state.accessToken, state.fileId);
      state.lastConnectionAt = Date.now();
      if (String(meta.version || "") === String(state.fileVersion || "")) {
        state.syncStatus = state.pendingPatches.length ? "pending" : "synced";
        return true;
      }
      if (state.pendingPatches.length || activeViewId() !== "view-turmas") {
        state.syncStatus = state.pendingPatches.length ? "pending" : "remote";
        return false;
      }
      const latest = await downloadLatestDriveWorkbook(state.accessToken, state.fileId);
      parseWorkbook(latest.bytes, latest.meta.name, "drive", {
        fileId: state.fileId,
        fileVersion: String(latest.meta.version || "")
      });
      localStorage.setItem("mestre:google-file-name", latest.meta.name);
      localStorage.setItem("mestre:google-period-label", state.period.label);
      state.lastConnectionAt = Date.now();
      state.syncStatus = "synced";
      updateDriveUi();
      return true;
    } catch (error) {
      if (String(error.message || "").toLocaleLowerCase("pt-BR").includes("sessão do google expirou")) {
        state.accessToken = "";
        state.tokenExpiresAt = 0;
        state.syncStatus = "authorization";
      } else {
        state.syncStatus = "error";
        state.lastSyncError = error.message;
      }
      return false;
    } finally {
      state.reconnectPromise = null;
      updateSyncUi();
    }
  })();
  return state.reconnectPromise;
}

async function saveToDrive(bytes, authorizedToken = "", expectedVersion = "", fileId = state.fileId) {
  if (!fileId) throw new Error("Nenhuma planilha do Drive está memorizada.");
  const token = authorizedToken || await requestDriveToken();
  if (expectedVersion) {
    const current = await getDriveMetadata(token, fileId);
    if (String(current.version) !== String(expectedVersion)) {
      throw new Error("A planilha foi alterada em outro lugar. O envio foi bloqueado; tente novamente.");
    }
  }
  const response = await fetchWithTimeout(`https://www.googleapis.com/upload/drive/v3/files/${encodeURIComponent(fileId)}?uploadType=media&fields=id,version,modifiedTime`, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    },
    body: bytes
  });
  if (!response.ok) {
    if (response.status === 401) {
      state.accessToken = "";
      state.tokenExpiresAt = 0;
      throw new Error("A sessão do Google expirou. Toque em Enviar agora para autorizar novamente.");
    }
    let detail = "";
    try {
      const body = await response.json();
      detail = body?.error?.message || "";
    } catch (_) {}
    throw new Error(detail || `O Google Drive recusou a gravação (${response.status}).`);
  }
  return response.json();
}

async function saveAttendance() {
  const button = $("btn-salvar");
  button.disabled = true;
  button.textContent = state.source === "drive" ? "Conectando..." : "Salvando...";
  try {
    // No Safari/iPhone, o OAuth precisa começar diretamente no toque.
    let driveToken = "";
    let driveFileId = "";
    let driveAuthError = null;
    if (state.source === "drive") {
      driveFileId = ensureDriveTarget();
      try {
        driveToken = await requestDriveToken();
      } catch (error) {
        driveAuthError = error;
      }
    }
    button.textContent = "Salvando...";
    const patch = createAttendancePatch();
    const pendingPatches = state.source === "drive"
      ? upsertPendingPatch(state.pendingPatches, patch)
      : [];
    const localBytes = await buildPatchedWorkbook(state.bytes, [patch]);
    state.bytes = localBytes;
    state.pendingPatches = pendingPatches;
    await saveCachedWorkbook(localBytes, state.fileName, state.source, pendingPatches, state.fileId);
    state.aula.completedInFile = true;
    localStorage.removeItem(draftKey(state.turma, state.aula));
    state.alunos.forEach(student => {
      const sourceStudent = state.turma.students.find(item => item.rowIndex === student.rowIndex);
      if (sourceStudent) {
        (state.aula.writableColumns ?? state.aula.colIndexes).forEach(colIndex => {
          sourceStudent.row[colIndex] = student.status;
        });
      }
    });
    if (state.rosterNotes?.length) toast(state.rosterNotes.join(" "));

    if (state.source === "drive") {
      try {
        state.syncStatus = "pending";
        updateSyncUi();
        if (driveAuthError) throw driveAuthError;
        const latest = await downloadLatestDriveWorkbook(driveToken, driveFileId);
        const mergedBytes = await buildPatchedWorkbook(latest.bytes, pendingPatches);
        const savedMeta = await saveToDrive(mergedBytes, driveToken, latest.meta.version, driveFileId);
        refreshWorkbookState(mergedBytes);
        state.fileVersion = String(savedMeta.version || "");
        state.lastConnectionAt = Date.now();
        state.pendingPatches = [];
        state.syncStatus = "synced";
        state.lastSyncError = "";
        await saveCachedWorkbook(
          mergedBytes,
          state.fileName,
          state.source,
          [],
          state.fileId,
          state.fileVersion
        );
        const gravados = (state.aula.writableColumns ?? state.aula.colIndexes).length;
        toast(`Enviada ao Drive em ${gravados} horário${gravados > 1 ? "s" : ""}.`);
      } catch (error) {
        state.syncStatus = "error";
        state.lastSyncError = error.message;
        toast("Salva no iPhone. O Drive não foi alterado.");
      }
    } else {
      download(localBytes);
      toast("Planilha salva sem alterar o modelo.");
    }
    updateSyncUi();
    $("draft-state").textContent = "Chamada salva";
    renderTurmas();
  } catch (error) {
    toast(error.message);
  } finally {
    button.disabled = false;
    button.textContent = "Salvar chamada";
  }
}

document.addEventListener("click", event => {
  const lessonModeButton = event.target.closest("[data-lesson-mode]");
  if (lessonModeButton) {
    setLessonMode(!lessonsAreJoined());
    renderLessonModeButton();
    // A planilha aberta é relida: as aulas nascem juntas ou separadas na
    // leitura, e nada mais precisa saber da escolha.
    if (state.bytes) {
      refreshWorkbookState(state.bytes);
      renderTurmas();
      if (activeViewId() !== "home") show("turmas");
    }
    return;
  }
  const newPeriodButton = event.target.closest("[data-new-period]");
  if (newPeriodButton) {
    selectPeriodWorkbook().catch(error => {
      toast(error.message);
      const { clientId, apiKey, appId } = driveConfig();
      if (!clientId || !apiKey || !appId) $("config-dialog").showModal();
    });
    return;
  }
  const turmaButton = event.target.closest("[data-turma]");
  if (turmaButton) openTurma(Number(turmaButton.dataset.turma));
  const aulaButton = event.target.closest("[data-aula]");
  if (aulaButton) openLesson(Number(aulaButton.dataset.aula));
  const reasonButton = event.target.closest("[data-reason]");
  if (reasonButton) {
    const row = reasonButton.closest("[data-student]");
    openReasonPicker(Number(row.dataset.student));
  }
  const reasonOption = event.target.closest("[data-reason-status]");
  if (reasonOption && reasonStudentIndex >= 0) {
    if (state.alunos[reasonStudentIndex].status !== reasonOption.dataset.reasonStatus) {
      setStatus(reasonStudentIndex, reasonOption.dataset.reasonStatus);
    }
    reasonStudentIndex = -1;
    $("reason-dialog").close();
  }
  const statusButton = event.target.closest("[data-status]");
  if (statusButton) {
    const row = statusButton.closest("[data-student]");
    setStatus(Number(row.dataset.student), statusButton.dataset.status);
  }
  const back = event.target.closest("[data-go]");
  if (back) {
    if (back.dataset.go === "home") show("home");
    if (back.dataset.go === "turmas") show("turmas");
    if (back.dataset.go === "aulas") {
      renderStudents("");
      openTurma(state.turmas.indexOf(state.turma));
    }
  }
});

$("file-input").addEventListener("change", async event => {
  const file = event.target.files[0];
  if (!file) return;
  try {
    parseWorkbook(new Uint8Array(await file.arrayBuffer()), file.name, "local");
  } catch (error) {
    toast(error.message);
  }
});

$("btn-drive").addEventListener("click", async () => {
  try {
    const config = driveConfig();
    if (config.fileId) {
      await openFromDrive();
    } else {
      await selectPeriodWorkbook();
    }
  } catch (error) {
    toast(error.message);
    const { clientId, apiKey, appId } = driveConfig();
    if (!clientId || !apiKey || !appId) $("config-dialog").showModal();
  }
});

$("btn-sync-drive").addEventListener("click", async () => {
  const button = $("btn-sync-drive");
  button.disabled = true;
  button.textContent = "Aguarde...";
  try {
    if (state.pendingPatches.length) {
      const driveFileId = ensureDriveTarget();
      const token = await requestDriveToken();
      const latest = await downloadLatestDriveWorkbook(token, driveFileId);
      const mergedBytes = await buildPatchedWorkbook(latest.bytes, state.pendingPatches);
      const savedMeta = await saveToDrive(mergedBytes, token, latest.meta.version, driveFileId);
      refreshWorkbookState(mergedBytes);
      state.fileVersion = String(savedMeta.version || "");
      state.lastConnectionAt = Date.now();
      state.pendingPatches = [];
      state.syncStatus = "synced";
      state.lastSyncError = "";
      await saveCachedWorkbook(
        mergedBytes,
        state.fileName,
        state.source,
        [],
        state.fileId,
        state.fileVersion
      );
      toast("Alterações enviadas ao Google Drive.");
    } else {
      await openFromDrive();
      toast("Planilha atualizada pelo Google Drive.");
    }
  } catch (error) {
    state.syncStatus = "error";
    state.lastSyncError = error.message;
    toast(error.message);
  } finally {
    button.disabled = false;
    updateSyncUi();
  }
});

$("btn-change-drive-file").addEventListener("click", async () => {
  try {
    if (await selectPeriodWorkbook()) $("config-dialog").close();
  } catch (error) {
    toast(error.message);
  }
});

$("btn-config").addEventListener("click", () => {
  const config = driveConfig();
  $("google-client-id").value = config.clientId;
  $("google-api-key").value = config.apiKey;
  $("google-app-id").value = config.appId;
  $("selected-drive-file").hidden = !config.fileName;
  $("selected-drive-file").textContent = config.fileName
    ? `Planilha ativa (${config.periodLabel || "período atual"}): ${config.fileName}`
    : "";
  $("config-dialog").showModal();
});

$("btn-save-config").addEventListener("click", event => {
  event.preventDefault();
  const clientId = $("google-client-id").value.trim();
  const apiKey = $("google-api-key").value.trim();
  const appId = $("google-app-id").value.trim();
  if (!clientId || !apiKey || !appId) {
    toast("Preencha os três dados do Google Cloud.");
    return;
  }
  localStorage.setItem("mestre:google-client-id", clientId);
  localStorage.setItem("mestre:google-api-key", apiKey);
  localStorage.setItem("mestre:google-app-id", appId);
  state.accessToken = "";
  updateDriveUi();
  $("config-dialog").close();
  toast("Configuração salva neste aparelho.");
});

$("busca").addEventListener("input", event => renderStudents(event.target.value));
$("btn-salvar").addEventListener("click", saveAttendance);
$("btn-desfazer").addEventListener("click", () => {
  const action = state.history.pop();
  if (!action) return;
  state.alunos[action.index].status = action.previous;
  saveDraft();
  renderStudents($("busca").value);
  $("btn-desfazer").disabled = state.history.length === 0;
});

if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
  let reloadingForUpdate = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (reloadingForUpdate) return;
    reloadingForUpdate = true;
    location.reload();
  });
  navigator.serviceWorker
    .register(`sw.js?v=${APP_VERSION}`, { updateViaCache: "none" })
    .then(registration => registration.update())
    .catch(() => {});
}

updateDriveUi();
renderLessonModeButton();

loadCachedWorkbook()
  .then(cached => {
    if (!cached?.bytes || state.bytes) return;
    const configuredFileId = driveConfig().fileId;
    if (cached.source === "drive" && (!cached.fileId || cached.fileId !== configuredFileId)) {
      toast("A planilha do Drive mudou. Atualize antes de abrir as turmas.");
      return;
    }
    const cacheIsCurrent = cached.schemaVersion === CACHE_SCHEMA;
    const pendingPatches = cacheIsCurrent && Array.isArray(cached.pendingPatches) ? cached.pendingPatches : [];
    parseWorkbook(new Uint8Array(cached.bytes), cached.fileName, cached.source || "local", {
      fromCache: true,
      fileId: cached.fileId || "",
      fileVersion: cached.fileVersion || "",
      pendingPatches,
      unsafeLegacyPending: Boolean(cached.pendingSync) && !cacheIsCurrent
    });
    toast("Planilha aberta do armazenamento seguro deste aparelho.");
    attemptDriveReconnect();
  })
  .catch(() => {});

window.addEventListener("online", () => attemptDriveReconnect());
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") attemptDriveReconnect();
});
setInterval(() => {
  if (document.visibilityState === "visible") attemptDriveReconnect();
}, 5 * 60 * 1000);

if ((location.hostname === "localhost" || location.hostname === "127.0.0.1") && location.search === "?test-model") {
  fetch("MODELO -FREQUENCIA.xlsx")
    .then(response => response.arrayBuffer())
    .then(bytes => parseWorkbook(new Uint8Array(bytes), "MODELO -FREQUENCIA.xlsx", "local"))
    .catch(error => toast(error.message));
}
