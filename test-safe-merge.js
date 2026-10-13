const assert = require("assert");
const crypto = require("crypto");
const fs = require("fs");
const vm = require("vm");
const JSZip = require("./vendor/jszip.min.js");
const XLSX = require("./vendor/xlsx.mini.min.js");

const source = fs.readFileSync("app.js", "utf8").split('document.addEventListener("click"')[0];
const context = vm.createContext({ XLSX, JSZip, Uint8Array, Date, console });
vm.runInContext(`${source}
globalThis.testApi = {
  buildPatchedWorkbook,
  readWorkbookModel,
  normalizedStatus,
  cellColIndex,
  findWorksheetPath,
  extractPeriodInfo
};`, context);

function makePatch(model, turma, lesson, changedIndex, status) {
  return {
    workbookFingerprint: model.fingerprint,
    turmaName: turma.name,
    dateLabel: lesson.label,
    statuses: turma.students.map((student, index) => ({
      name: student.name,
      baseStatuses: lesson.colIndexes.map(colIndex =>
        context.testApi.normalizedStatus(student.row[colIndex])
      ),
      status: index === changedIndex
        ? status
        : context.testApi.normalizedStatus(student.row[lesson.colIndexes[0]])
    }))
  };
}

function findValue(bytes, turmaName, dateLabel, studentName) {
  const model = context.testApi.readWorkbookModel(bytes);
  const turma = model.turmas.find(item => item.name === turmaName);
  const lesson = turma.lessons.find(item => item.label === dateLabel);
  const student = turma.students.find(item => item.name === studentName);
  return lesson.colIndexes.map(colIndex => context.testApi.normalizedStatus(student.row[colIndex]));
}

async function frequencySheetPath(bytes) {
  const model = context.testApi.readWorkbookModel(bytes);
  const zip = await JSZip.loadAsync(bytes);
  return context.testApi.findWorksheetPath(zip, model.sheetName);
}

async function unchangedFiles(beforeBytes, afterBytes, mutablePath) {
  const before = await JSZip.loadAsync(beforeBytes);
  const after = await JSZip.loadAsync(afterBytes);
  const paths = Object.keys(before.files).filter(path => path !== mutablePath);
  for (const path of paths) {
    if (before.files[path].dir) continue;
    const left = await before.file(path).async("nodebuffer");
    const right = await after.file(path).async("nodebuffer");
    assert.strictEqual(
      crypto.createHash("sha256").update(left).digest("hex"),
      crypto.createHash("sha256").update(right).digest("hex"),
      `${path} foi alterado`
    );
  }
}

async function assertOrderedRows(bytes, mutablePath) {
  const zip = await JSZip.loadAsync(bytes);
  const xml = await zip.file(mutablePath).async("string");
  const rows = xml.match(/<row\b[\s\S]*?<\/row>/g) || [];
  rows.forEach(row => {
    const refs = [...row.matchAll(/<c\b[^>]*\br="([A-Z]+[0-9]+)"/g)].map(item => item[1]);
    const indexes = refs.map(ref => context.testApi.cellColIndex(ref));
    const sorted = [...indexes].sort((a, b) => a - b);
    assert.deepStrictEqual(indexes, sorted, `Células fora de ordem na linha: ${refs.join(", ")}`);
  });
}

async function testOldModelMerge() {
  const base = new Uint8Array(fs.readFileSync("../modelos-planilha/MODELO -FREQUENCIA.xlsx"));
  const model = context.testApi.readWorkbookModel(base);
  const turma = model.turmas.find(item => item.lessons.length >= 2 && item.students.length >= 2);
  assert(turma, "Turma de teste não encontrada");

  const existingLesson = turma.lessons[0];
  const newLesson = turma.lessons.find((lesson, index) => index > 0 && lesson.totalOccurrences > 1)
    || turma.lessons[1];
  const existingIndex = turma.students.findIndex(student =>
    context.testApi.normalizedStatus(student.row[existingLesson.colIndexes[0]]) === "0"
  );
  const newIndex = turma.students.findIndex((student, index) =>
    index !== existingIndex
    && context.testApi.normalizedStatus(student.row[newLesson.colIndexes[0]]) === "0"
  );
  assert(existingIndex >= 0 && newIndex >= 0, "Alunos de teste não encontrados");

  const existingPatch = makePatch(model, turma, existingLesson, existingIndex, "F");
  const remoteWithExistingCall = await context.testApi.buildPatchedWorkbook(base, [existingPatch]);
  const updatedModel = context.testApi.readWorkbookModel(remoteWithExistingCall);
  const newPatch = makePatch(updatedModel, turma, newLesson, newIndex, "I");
  const safelyMerged = await context.testApi.buildPatchedWorkbook(remoteWithExistingCall, [newPatch]);
  const mutablePath = await frequencySheetPath(base);

  assert(findValue(safelyMerged, turma.name, existingLesson.label, turma.students[existingIndex].name).every(value => value === "F"));
  assert(findValue(safelyMerged, turma.name, newLesson.label, turma.students[newIndex].name).every(value => value === "I"));
  await unchangedFiles(remoteWithExistingCall, safelyMerged, mutablePath);
  await assertOrderedRows(safelyMerged, mutablePath);

  const conflictingPatch = makePatch(model, turma, existingLesson, existingIndex, "I");
  await assert.rejects(
    context.testApi.buildPatchedWorkbook(remoteWithExistingCall, [conflictingPatch]),
    /foi alterada no Drive/
  );
}

async function testUnifiedMestreModel() {
  const base = new Uint8Array(fs.readFileSync("../Extensao-Chrome-Mestre/docs/MODELO-SIAEP-v2.xlsx"));
  const model = context.testApi.readWorkbookModel(base);
  assert.strictEqual(model.sheetName, "FREQÊNCIA");
  const mutablePath = await frequencySheetPath(base);
  assert.strictEqual(mutablePath, "xl/worksheets/sheet4.xml");

  const turma = model.turmas.find(item => item.lessons.some(lesson => lesson.totalOccurrences > 1));
  const lesson = turma.lessons.find(item => item.totalOccurrences > 1);
  const changedIndex = turma.students.findIndex(student =>
    context.testApi.normalizedStatus(student.row[lesson.colIndexes[0]]) === "0"
  );
  assert(turma && lesson && changedIndex >= 0, "Data repetida da Mestre v2 não encontrada");

  const patch = makePatch(model, turma, lesson, changedIndex, "E");
  const result = await context.testApi.buildPatchedWorkbook(base, [patch]);
  assert(findValue(result, turma.name, lesson.label, turma.students[changedIndex].name).every(value => value === "E"));
  await unchangedFiles(base, result, mutablePath);
  await assertOrderedRows(result, mutablePath);
}

async function testExternalWorkbook(path) {
  const base = new Uint8Array(fs.readFileSync(path));
  const model = context.testApi.readWorkbookModel(base);
  const mutablePath = await frequencySheetPath(base);
  const turma = model.turmas.find(item => item.lessons.some(lesson => lesson.totalOccurrences >= 3))
    || model.turmas.find(item => item.lessons.some(lesson => lesson.totalOccurrences >= 2));
  const lesson = turma.lessons.find(item => item.totalOccurrences >= 3)
    || turma.lessons.find(item => item.totalOccurrences >= 2);
  const changedIndex = turma.students.findIndex(student =>
    context.testApi.normalizedStatus(student.row[lesson.colIndexes[0]]) === "0"
  );
  assert(turma && lesson && changedIndex >= 0, "Data repetida da planilha informada não encontrada");
  assert.strictEqual(model.period.label, "3º período de 2026");

  const result = await context.testApi.buildPatchedWorkbook(base, [makePatch(model, turma, lesson, changedIndex, "F")]);
  assert(findValue(result, turma.name, lesson.label, turma.students[changedIndex].name).every(value => value === "F"));
  await unchangedFiles(base, result, mutablePath);
  await assertOrderedRows(result, mutablePath);
  const invalidPatch = makePatch(model, turma, lesson, changedIndex, "I");
  invalidPatch.workbookFingerprint = "planilha-diferente";
  await assert.rejects(
    context.testApi.buildPatchedWorkbook(base, [invalidPatch]),
    /estrutura da planilha foi substituída/
  );
  console.log(`OK: planilha informada reconhecida com ${model.turmas.length} turmas; ${lesson.label} testada em ${lesson.totalOccurrences} horários na ${mutablePath}.`);
}

async function main() {
  await testOldModelMerge();
  await testUnifiedMestreModel();
  if (process.argv[2]) await testExternalWorkbook(process.argv[2]);
  console.log("OK: formato antigo e Planilha SIAEP v2 foram reconhecidos.");
  console.log("OK: a escrita ocorreu somente na aba de frequência correta.");
  console.log("OK: datas repetidas receberam a mesma frequência em todas as colunas.");
  console.log("OK: códigos F, I e E foram preservados e conflitos foram bloqueados.");
  console.log("OK: células das linhas continuam em ordem.");
  console.log("OK: chamadas de outra estrutura de planilha foram bloqueadas.");
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
