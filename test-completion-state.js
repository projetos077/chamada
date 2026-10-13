const assert = require("assert");
const fs = require("fs");
const vm = require("vm");
const JSZip = require("./vendor/jszip.min.js");
const XLSX = require("./vendor/xlsx.mini.min.js");

const source = fs.readFileSync("app.js", "utf8").split('document.addEventListener("click"')[0];
const context = vm.createContext({ XLSX, JSZip, Uint8Array, Date, console });
vm.runInContext(`${source}
globalThis.testApi = { readWorkbookModel, colName, cellColIndex, findWorksheetPath };`, context);

function writeExplicitZero(rowXml, address) {
  const cellRegex = new RegExp(`<c\\b[^>]*\\br="${address}"[^>]*(?:\\/>|>[\\s\\S]*?<\\/c>)`);
  const cell = `<c r="${address}" s="1"><v>0</v></c>`;
  if (cellRegex.test(rowXml)) return rowXml.replace(cellRegex, cell);

  const targetColIndex = context.testApi.cellColIndex(address);
  const cells = [...rowXml.matchAll(/<c\b[^>]*\br="([A-Z]+[0-9]+)"[^>]*(?:\/>|>[\s\S]*?<\/c>)/g)];
  const next = cells.find(item => context.testApi.cellColIndex(item[1]) > targetColIndex);
  if (next) return rowXml.slice(0, next.index) + cell + rowXml.slice(next.index);
  return rowXml.replace("</row>", `${cell}</row>`);
}

async function editLesson(baseBytes, mode) {
  const model = context.testApi.readWorkbookModel(baseBytes);
  const turma = model.turmas.find(item => item.students.length >= 2 && item.lessons.length);
  const lesson = turma.lessons[0];
  const zip = await JSZip.loadAsync(baseBytes);
  const path = await context.testApi.findWorksheetPath(zip, model.sheetName);
  let xml = await zip.file(path).async("string");

  turma.students.forEach((student, studentIndex) => {
    const excelRow = student.rowIndex + 1;
    const rowRegex = new RegExp(`<row\\b([^>]*\\br="${excelRow}"[^>]*)>[\\s\\S]*?<\\/row>`);
    const match = xml.match(rowRegex);
    let rowXml = match[0];
    lesson.colIndexes.forEach(colIndex => {
      const address = `${context.testApi.colName(colIndex)}${excelRow}`;
      if (mode === "blank") {
        const cellRegex = new RegExp(`<c\\b[^>]*\\br="${address}"[^>]*(?:\\/>|>[\\s\\S]*?<\\/c>)`);
        rowXml = rowXml.replace(cellRegex, "");
      } else if (mode === "one-zero") {
        if (studentIndex === 0) rowXml = writeExplicitZero(rowXml, address);
        else {
          const cellRegex = new RegExp(`<c\\b[^>]*\\br="${address}"[^>]*(?:\\/>|>[\\s\\S]*?<\\/c>)`);
          rowXml = rowXml.replace(cellRegex, "");
        }
      } else if (mode === "all-zero") {
        rowXml = writeExplicitZero(rowXml, address);
      } else if (mode === "one-enfermidade") {
        const cellRegex = new RegExp(`<c\\b[^>]*\\br="${address}"[^>]*(?:\\/>|>[\\s\\S]*?<\\/c>)`);
        const cell = `<c r="${address}" t="inlineStr"><is><t>E</t></is></c>`;
        if (studentIndex === 0) {
          rowXml = cellRegex.test(rowXml)
            ? rowXml.replace(cellRegex, cell)
            : rowXml.replace("</row>", `${cell}</row>`);
        } else {
          rowXml = rowXml.replace(cellRegex, "");
        }
      }
    });
    xml = xml.replace(match[0], rowXml);
  });
  zip.file(path, xml);
  return {
    bytes: await zip.generateAsync({ type: "uint8array" }),
    turmaName: turma.name,
    dateLabel: lesson.label
  };
}

function completed(bytes, turmaName, dateLabel) {
  const model = context.testApi.readWorkbookModel(bytes);
  const turma = model.turmas.find(item => item.name === turmaName);
  return turma.lessons.find(item => item.label === dateLabel).completedInFile;
}

async function main() {
  const base = new Uint8Array(fs.readFileSync("../modelos-planilha/MODELO -FREQUENCIA.xlsx"));
  const blank = await editLesson(base, "blank");
  assert.strictEqual(completed(blank.bytes, blank.turmaName, blank.dateLabel), false);

  const oneZero = await editLesson(base, "one-zero");
  assert.strictEqual(completed(oneZero.bytes, oneZero.turmaName, oneZero.dateLabel), false);

  const allZero = await editLesson(base, "all-zero");
  assert.strictEqual(completed(allZero.bytes, allZero.turmaName, allZero.dateLabel), true);

  const unified = new Uint8Array(fs.readFileSync("../Extensao-Chrome-Mestre/docs/MODELO-SIAEP-v2.xlsx"));
  const enfermidade = await editLesson(unified, "one-enfermidade");
  assert.strictEqual(completed(enfermidade.bytes, enfermidade.turmaName, enfermidade.dateLabel), true);

  console.log("OK: data vazia permanece pendente.");
  console.log("OK: uma célula 0 isolada não marca a data como realizada.");
  console.log("OK: frequência completa com 0 marca a data como realizada.");
  console.log("OK: código E da nova Mestre marca a data como realizada.");
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
