const fs = require("fs");
const JSZip = require("./vendor/jszip.min.js");

function patchCellInRow(rowXml, address, status) {
  const cellRegex = new RegExp(`<c\\b([^>]*\\br="${address}"[^>]*)>[\\s\\S]*?<\\/c>`);
  const selfClosingRegex = new RegExp(`<c\\b([^>]*\\br="${address}"[^>]*)\\/>`);
  const match = rowXml.match(cellRegex) || rowXml.match(selfClosingRegex);
  const attributes = match ? match[1].replace(/\s+t="[^"]*"/g, "") : ` r="${address}" s="1"`;
  const cell = status === "F" || status === "I"
    ? `<c${attributes} t="inlineStr"><is><t>${status}</t></is></c>`
    : `<c${attributes}><v>0</v></c>`;
  return match ? rowXml.replace(match[0], cell) : rowXml.replace("</row>", `${cell}</row>`);
}

async function main() {
  const input = fs.readFileSync("../modelos-planilha/MODELO -FREQUENCIA.xlsx");
  const zip = await JSZip.loadAsync(input);
  let xml = await zip.file("xl/worksheets/sheet1.xml").async("string");

  for (let row = 31; row <= 62; row++) {
    const address = `G${row}`;
    const status = row === 31 ? "F" : row === 32 ? "I" : "0";
    const rowRegex = new RegExp(`<row\\b([^>]*\\br="${row}"[^>]*)>[\\s\\S]*?<\\/row>`);
    const match = xml.match(rowRegex);
    if (!match) throw new Error(`Linha ${row} ausente`);
    xml = xml.replace(match[0], patchCellInRow(match[0], address, status));
  }

  zip.file("xl/worksheets/sheet1.xml", xml);
  const output = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
  // A saída sai da pasta publicável: ela carrega os nomes do modelo.
  fs.writeFileSync(require("os").tmpdir() + "/teste-saida.xlsx", output);
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
