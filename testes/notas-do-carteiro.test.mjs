// A nota do celular julgada pelas **duas pontas de verdade**: o carteiro rodando em
// Node sobre a planilha de mentira, e o `app.js` rodando no DOM de mentira.
//
// É a regra do projeto: se existe código do outro lado, ele é o juiz. Aqui os dois
// lados são os arquivos de produção (carteiro/Codigo.gs e app.js) — nada é copiado
// para dentro do teste.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createContext, runInContext } from "node:vm";

import { carteiro } from "./planilha-de-mentira.mjs";
import { instalarDom } from "./dom-de-mentira.mjs";

const FONTE = readFileSync(new URL("../app.js", import.meta.url), "utf8");
const TURMA = "26PMI-INT-300";
const ALUNOS = ["ANA GABRIELA SOUSA", "CARLOS DANIEL LIMA"];

const FREQUENCIA = [
  ["INT", "TURMA: - " + TURMA, "NOME", "TOTAL", "13/10/2026"],
  [1, "", ALUNOS[0], 0, ""],
  [2, "", ALUNOS[1], 0, ""],
  ["AULA", "INÍCIO E DISCIPLINA", "", "", "9:20 FISICA"]
];
const AVALIACOES = [
  ["CHAVE", "TURMA", "DISCIPLINA", "ORDEM", "NOME", "DATA", "INSTRUMENTO", "RECUPERAÇÃO", "NO DIÁRIO"],
  [TURMA + "|FISICA|1", TURMA, "FISICA", 1, "1ª avaliação", "14/08/2026", "Prova", "", "NÃO"]
];

/** O app.js de verdade, com a grade que o carteiro acabou de devolver. */
function abrirApp(grade) {
  const armazem = new Map([
    ["chamada:conexao", JSON.stringify({ url: "https://script.google.com/x/exec", chave: "c".repeat(64) })],
    ["chamada:grade", JSON.stringify(grade)]
  ]);
  const dom = instalarDom(armazem);
  const contexto = createContext({
    document: dom.documento,
    localStorage: dom.localStorage,
    window: { addEventListener() {}, scrollTo() {} },
    navigator: { onLine: true },
    location: { protocol: "file:" },
    fetch: () => Promise.reject(new TypeError("sem rede no teste")),
    setTimeout: () => 0, clearTimeout: () => {},
    setInterval: () => 0, clearInterval: () => {},
    AbortController, console
  });
  runInContext(FONTE, contexto, { filename: "app.js" });
  return { ...dom, contexto };
}

test("a nota gravada pelo celular volta na grade e na tela", () => {
  const c = carteiro();
  const gerado = c.post({
    acao: "gerar",
    abas: [
      { nome: "INSTRUÇÕES", linhas: [["Leia-me"]] },
      { nome: "FREQÊNCIA", linhas: FREQUENCIA },
      { nome: "AVALIAÇÕES", linhas: AVALIACOES }
    ],
    periodo: { momento: "4" }
  });
  assert.equal(gerado.ok, true, gerado.erro);

  // Antes de qualquer nota: a aba Notas nasce com as avaliações, e ninguém tem nota.
  const antes = abrirApp(c.post({ acao: "grade" }));
  assert.doesNotMatch(readFileSync(new URL("../index.html", import.meta.url), "utf8").match(/<button[^>]*id="aba-notas"[^>]*>/)[0], /hidden/, "a aba Notas nasce com as avaliações");
  antes.contexto.abrirNotaTurma(TURMA);
  antes.contexto.abrirNotaDisciplina("FISICA");
  assert.match(antes.porId.get("nota-alunos").innerHTML, /class="bt nota vazia"/);

  // O celular grava a nota, como grava a chamada.
  const gravada = c.post({ acao: "nota", nota: { chave: TURMA + "|FISICA|1", aluno: ALUNOS[0], valor: "8,5" } });
  assert.equal(gravada.ok, true, gravada.erro);

  // A próxima busca do celular traz a nota, e a tela a mostra.
  const depois = abrirApp(c.post({ acao: "grade" }));
  depois.contexto.abrirNotaTurma(TURMA);
  depois.contexto.abrirNotaDisciplina("FISICA");
  assert.equal(depois.porId.get("nota-alunos").innerHTML.includes(">8,5</button>"), true);
  assert.equal(depois.porId.get("nota-com").textContent, 1);
  assert.equal(depois.porId.get("nota-media").textContent, "8,5");
});
