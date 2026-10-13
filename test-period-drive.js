const assert = require("assert");
const fs = require("fs");
const vm = require("vm");
const JSZip = require("./vendor/jszip.min.js");
const XLSX = require("./vendor/xlsx.mini.min.js");

const storage = new Map();
const strong = { textContent: "" };
const paragraph = { textContent: "" };
const periodButtons = [{ hidden: true }, { hidden: true }];
const elements = {
  "btn-drive": { textContent: "" },
  "home-status": {
    querySelector(selector) {
      return selector === "strong" ? strong : paragraph;
    }
  },
  "sync-card": {
    classList: {
      values: new Set(),
      add(value) { this.values.add(value); },
      remove(...values) { values.forEach(value => this.values.delete(value)); }
    }
  },
  "sync-title": { textContent: "" },
  "sync-message": { textContent: "" },
  "btn-sync-drive": { hidden: false, textContent: "" }
};
let activeView = "view-turmas";

const context = vm.createContext({
  XLSX,
  JSZip,
  Uint8Array,
  Date,
  console,
  navigator: { onLine: true },
  localStorage: {
    getItem(key) { return storage.get(key) || ""; },
    setItem(key, value) { storage.set(key, String(value)); }
  },
  document: {
    getElementById(id) { return elements[id]; },
    querySelectorAll(selector) { return selector === "[data-new-period]" ? periodButtons : []; },
    querySelector(selector) { return selector === ".view.active" ? { id: activeView } : null; }
  },
  window: {}
});

const source = fs.readFileSync("app.js", "utf8").split('document.addEventListener("click"')[0];
vm.runInContext(`${source}
globalThis.testApi = {
  state,
  readWorkbookModel,
  validateDriveWorkbook,
  validateXlsxBytes,
  updateDriveUi,
  attemptDriveReconnect,
  selectPeriodWorkbook
};`, context);

async function main() {
  const bytes = new Uint8Array(fs.readFileSync(process.argv[2]));
  const model = context.testApi.readWorkbookModel(bytes);
  assert.strictEqual(model.period.label, "3º período de 2026");
  context.testApi.validateDriveWorkbook({
    name: "PLANILHA-SIAEP-3P-2026.xlsx",
    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  });
  context.testApi.validateXlsxBytes(bytes);
  assert.throws(
    () => context.testApi.validateDriveWorkbook({ name: "PLANILHA-SIAEP-3P-2026", mimeType: "application/vnd.google-apps.spreadsheet" }),
    /convertido em Planilhas Google/
  );
  assert.throws(
    () => context.testApi.validateXlsxBytes(new Uint8Array([1, 2, 3, 4])),
    /\.xlsx válido/
  );

  storage.set("mestre:google-file-id", "arquivo-periodo-3");
  storage.set("mestre:google-file-name", "PLANILHA-SIAEP-3P-2026.xlsx");
  storage.set("mestre:google-period-label", model.period.label);
  context.testApi.updateDriveUi();
  assert.strictEqual(elements["btn-drive"].textContent, "Conectar à planilha atual");
  assert(periodButtons.every(button => button.hidden === false));
  assert.strictEqual(strong.textContent, "3º período de 2026");

  Object.assign(context.testApi.state, {
    source: "drive",
    fileId: "arquivo-periodo-3",
    fileVersion: "15",
    pendingPatches: [],
    accessToken: "",
    tokenExpiresAt: 0
  });
  await context.testApi.attemptDriveReconnect();
  assert.strictEqual(context.testApi.state.syncStatus, "authorization");

  context.navigator.onLine = false;
  await context.testApi.attemptDriveReconnect();
  assert.strictEqual(context.testApi.state.syncStatus, "offline");

  context.navigator.onLine = true;
  context.testApi.state.accessToken = "token-temporario";
  context.testApi.state.tokenExpiresAt = Date.now() + 3600000;
  vm.runInContext("getDriveMetadata = async () => ({ version: '15' });", context);
  await context.testApi.attemptDriveReconnect();
  assert.strictEqual(context.testApi.state.syncStatus, "synced");
  assert(context.testApi.state.lastConnectionAt > 0);

  activeView = "view-chamada";
  vm.runInContext("getDriveMetadata = async () => ({ version: '16' });", context);
  await context.testApi.attemptDriveReconnect();
  assert.strictEqual(context.testApi.state.syncStatus, "remote");

  context.testApi.state.pendingPatches = [{}];
  await assert.rejects(
    context.testApi.selectPeriodWorkbook(),
    /aguardando envio/
  );

  console.log("OK: período da nova planilha foi identificado.");
  console.log("OK: o Drive aceita apenas o arquivo XLSX original e valida o conteúdo baixado.");
  console.log("OK: a planilha ativa permanece memorizada entre períodos.");
  console.log("OK: autorização expirada e modo offline têm estados próprios.");
  console.log("OK: a reconexão automática reconhece versões iguais e novas.");
  console.log("OK: troca de período com chamada pendente foi bloqueada.");
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
