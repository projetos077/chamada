// Uma Planilha Google de mentira e o carteiro rodando em cima dela.
//
// Serve aos testes e à prévia local do PWA: o `Codigo.gs` é carregado inteiro
// num `vm`; só SpreadsheetApp, LockService, PropertiesService, ContentService
// e Utilities são nossos.

import { readFileSync } from "node:fs";
import { createContext, runInContext } from "node:vm";

const CODIGO = readFileSync(new URL("../carteiro/Codigo.gs", import.meta.url), "utf8");
export const CHAVE = "c".repeat(64);

function planilhaDeMentira() {
  const abas = [];
  const nova = (nome) => {
    let dados = [];
    const aba = {
      getName: () => nome,
      getLastRow: () => dados.length,
      clearContents: () => { dados = []; },
      getDataRange: () => aba.getRange(1, 1, dados.length, Math.max(0, ...dados.map((l) => l.length))),
      getRange: (linha, coluna, altura, largura) => ({
        setNumberFormat() {},
        getValues: () => Array.from({ length: altura }, (_, i) =>
          Array.from({ length: largura }, (_, j) => dados[linha - 1 + i]?.[coluna - 1 + j] ?? "")),
        setValues(valores) {
          valores.forEach((l, i) => l.forEach((v, j) => {
            while (dados.length < linha + i) dados.push([]);
            dados[linha - 1 + i][coluna - 1 + j] = v;
          }));
        }
      }),
      dados: () => dados
    };
    return aba;
  };
  abas.push(nova("Página1"));
  return {
    getSheets: () => abas.slice(),
    getSheetByName: (nome) => abas.find((a) => a.getName() === nome) ?? null,
    insertSheet(nome) { const a = nova(nome); abas.push(a); return a; },
    deleteSheet(aba) { abas.splice(abas.indexOf(aba), 1); },
    getSpreadsheetTimeZone: () => "America/Fortaleza"
  };
}

export function carteiro() {
  const livro = planilhaDeMentira();
  const props = () => { const m = new Map(); return { getProperty: (k) => m.get(k) ?? null, setProperty: (k, v) => m.set(k, String(v)) }; };
  const doScript = props();
  doScript.setProperty("CHAVE", CHAVE);
  const doDocumento = props();
  const ctx = createContext({
    SpreadsheetApp: { getActive: () => livro, flush() {} },
    LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock() {} }) },
    PropertiesService: { getScriptProperties: () => doScript, getDocumentProperties: () => doDocumento },
    ContentService: {
      MimeType: { JSON: "json" },
      createTextOutput: (texto) => ({ setMimeType: () => JSON.parse(texto) })
    },
    Utilities: { getUuid: () => "x", formatDate: () => "" }
  });
  runInContext(CODIGO, ctx);
  const post = (pedido) => ctx.doPost({ postData: { contents: JSON.stringify({ chave: CHAVE, ...pedido }) } });
  const bruto = (corpo) => ctx.doPost({ postData: { contents: corpo } });
  return { post, bruto, livro };
}

