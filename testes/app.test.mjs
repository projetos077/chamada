// A tela do PWA julgada pelo app.js de verdade — Chamada 20, 16/10/2026.
//
// ## Por que este teste existe
//
// Em 16/10/2026 o professor viu o celular dizer "preenchida" e o diário do SIAEP
// sem a frequência: 48 colunas do 3º período estavam feitas aqui e não lançadas.
// Eram dois estados mostrados como um só. Aqui o app.js roda inteiro, com uma
// grade de mentira no aparelho, e o teste lê o que a tela escreve: o terceiro
// estado, a faixa do período anterior e o menu inferior.
//
// A regra do projeto: se existe código do outro lado, ele é o juiz. O juiz é o
// app.js do PWA — não uma cópia das regras dentro do teste.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createContext, runInContext } from "node:vm";

import { abasDoHtml, HTML_DO_APP, instalarDom } from "./dom-de-mentira.mjs";

const FONTE = readFileSync(new URL("../app.js", import.meta.url), "utf8");
const TURMA = "26PMI-INT-300";
const CONEXAO = { url: "https://script.google.com/macros/s/qualquer/exec", chave: "c".repeat(64) };

/** Uma coluna da planilha, como o carteiro a manda. */
const coluna = (data, horario, marcas, extra = {}) => ({
  data, horario, inicio: horario === 1 ? "13:20" : "14:10", disciplina: "FISICA", travada: false, marcas, ...extra
});

/** A grade que o aparelho tem guardada: uma turma, as aulas que o teste montar. */
const gradeCom = (aulas, periodo = {}, alunos = ["ANA GABRIELA SOUSA", "CARLOS DANIEL LIMA"]) =>
  ({ ok: true, versao: 1, periodo, turmas: [{ nome: TURMA, alunos, aulas }] });

/** Abre o app.js como o professor abre o app: com a grade já no aparelho. */
function abrir(grade, { fila = [] } = {}) {
  const armazem = new Map([
    ["chamada:conexao", JSON.stringify(CONEXAO)],
    ["chamada:grade", JSON.stringify(grade)],
    ["chamada:conferida", JSON.stringify(Date.now())],
    ["chamada:fila", JSON.stringify(fila)]
  ]);
  const dom = instalarDom(armazem);
  const contexto = createContext({
    document: dom.documento,
    localStorage: dom.localStorage,
    window: { addEventListener() {}, scrollTo() {} },
    navigator: { onLine: true },
    location: { protocol: "file:" },
    // Sem rede: é a planilha que já está no aparelho que manda.
    fetch: () => Promise.reject(new TypeError("sem rede no teste")),
    setTimeout: () => 0, clearTimeout: () => {},
    setInterval: () => 0, clearInterval: () => {},
    AbortController,
    console
  });
  runInContext(FONTE, contexto, { filename: "app.js" });
  return { ...dom, contexto };
}

/** As duas colunas de uma aula de 18/09 — o dia inteiro preenchido, tudo presente. */
const diaFeito = (data = "18/09/2026") => [
  coluna(data, 1, ["0", "0"]),
  coluna(data, 2, ["0", "0"])
];

test("o menu inferior é Hoje e Frequência", () => {
  assert.deepEqual(abasDoHtml(), ["hoje", "frequencia"]);
  const nav = HTML_DO_APP.match(/<nav id="abas"[\s\S]*?<\/nav>/)[0];
  assert.match(nav, /<\/svg>Hoje</);
  assert.match(nav, /<\/svg>Frequência</);
  assert.doesNotMatch(nav, /<\/svg>Turmas</);
});

test("tocar na aba Frequência abre as turmas, e a barra continua à vista", () => {
  const app = abrir(gradeCom(diaFeito()));
  app.clicar(app.aba("frequencia"));
  assert.match(app.porId.get("turmas-conteudo").innerHTML, /cartao-turma/);
  assert.equal(app.porId.get("abas").hidden, false);
  assert.equal(app.porId.get("tela-turmas").classList.contains("ativa"), true);
  assert.equal(app.porId.get("tela-hoje").classList.contains("ativa"), false);
});

test("feita no celular e fora do diário: a linha diz Feita · falta lançar", () => {
  const app = abrir(gradeCom([...diaFeito("18/09/2026"), ...diaFeito("25/09/2026")], { momento: "4", lancadas: [] }));
  app.contexto.abrirTurma(TURMA);
  const html = app.porId.get("turma-aulas").innerHTML;
  assert.match(html, /class="linha sem-cor"/);
  assert.match(html, /class="falta-lancar">Feita ·<br>falta lançar</);
  assert.doesNotMatch(html, /class="linha enviada"/);
  assert.match(app.porId.get("turma-resumo").textContent, /2 feitas, falta lançar no SIAEP/);
});

test("o cartão da turma não diz Todas preenchidas com chamada faltando lançar", () => {
  const app = abrir(gradeCom([...diaFeito("18/09/2026"), ...diaFeito("25/09/2026")], { momento: "4", lancadas: [] }));
  app.contexto.desenharTurmas();
  const html = app.porId.get("turmas-conteudo").innerHTML;
  assert.match(html, /em class="lancar">2 feitas, falta lançar no SIAEP</);
  assert.doesNotMatch(html, /✓ Todas preenchidas/);
  assert.doesNotMatch(html, /cartao-turma completa/);
});

test("com o diário tendo a aula, a linha volta a ser ✓ e o cartão fica completo", () => {
  const lancadas = [TURMA + "|18/09/2026|1", TURMA + "|18/09/2026|2"];
  const app = abrir(gradeCom(diaFeito("18/09/2026"), { momento: "4", lancadas }));
  app.contexto.abrirTurma(TURMA);
  const html = app.porId.get("turma-aulas").innerHTML;
  assert.match(html, /class="linha enviada"/);
  assert.doesNotMatch(html, /falta lançar/);
  app.contexto.desenharTurmas();
  assert.match(app.porId.get("turmas-conteudo").innerHTML, /✓ Todas preenchidas/);
});

test("meio lançada ainda falta lançar: os dois horários contam", () => {
  const app = abrir(gradeCom(diaFeito(), { momento: "4", lancadas: [TURMA + "|18/09/2026|1"] }));
  app.contexto.abrirTurma(TURMA);
  assert.match(app.porId.get("turma-aulas").innerHTML, /falta-lancar/);
  assert.match(app.porId.get("turma-resumo").textContent, /1 feita, falta lançar no SIAEP/);
});

test("aula por fazer continua Fazer, e não vira falta lançar", () => {
  const app = abrir(gradeCom([coluna("25/09/2026", 1, ["", ""]), coluna("25/09/2026", 2, ["", ""])], { momento: "4", lancadas: [] }));
  app.contexto.abrirTurma(TURMA);
  const html = app.porId.get("turma-aulas").innerHTML;
  assert.match(html, /class="acao/);
  assert.doesNotMatch(html, /falta-lancar/);
});

test("a chamada que está na fila continua dizendo Na fila", () => {
  const fila = [{ id: "1", aula: TURMA + "|18/09/2026|1,2", chamada: {} }];
  const app = abrir(gradeCom(diaFeito(), { momento: "4", lancadas: [] }), { fila });
  app.contexto.abrirTurma(TURMA);
  const html = app.porId.get("turma-aulas").innerHTML;
  assert.match(html, /◷ Na fila/);
  assert.doesNotMatch(html, /falta-lancar/);
});

test("planilha gerada sem a lista do diário: nada muda (é a Chamada 19)", () => {
  const app = abrir(gradeCom(diaFeito(), { momento: "4" }));
  app.contexto.abrirTurma(TURMA);
  const html = app.porId.get("turma-aulas").innerHTML;
  assert.match(html, /class="linha enviada"/);
  assert.doesNotMatch(html, /falta lançar/);
  assert.match(app.porId.get("turma-resumo").textContent, /todas preenchidas/);
});

test("a faixa do período anterior aparece com pendência, e some quando zera", () => {
  const com12 = abrir(gradeCom(diaFeito(), { momento: "4", lancadas: [], anterior: { momento: "3", aLancar: 12 } }));
  const html = com12.porId.get("hoje-conteudo").innerHTML;
  assert.match(html, /class="faixa-anterior"/);
  assert.match(html, /3º período · 12 frequências a lançar no SIAEP/);
  assert.match(html, /Feitas no celular; o Mestrão ainda não lançou/);

  const com1 = abrir(gradeCom(diaFeito(), { momento: "4", lancadas: [], anterior: { momento: "3", aLancar: 1 } }));
  assert.match(com1.porId.get("hoje-conteudo").innerHTML, /1 frequência a lançar no SIAEP/);

  const zerada = abrir(gradeCom(diaFeito(), { momento: "4", lancadas: [], anterior: { momento: "3", aLancar: 0 } }));
  assert.doesNotMatch(zerada.porId.get("hoje-conteudo").innerHTML, /faixa-anterior/);

  const semAnterior = abrir(gradeCom(diaFeito(), { momento: "4", lancadas: [] }));
  assert.doesNotMatch(semAnterior.porId.get("hoje-conteudo").innerHTML, /faixa-anterior/);
});

test("tocar na faixa leva às turmas", () => {
  const app = abrir(gradeCom(diaFeito(), { momento: "4", lancadas: [], anterior: { momento: "3", aLancar: 12 } }));
  const faixa = { tagName: "BUTTON", dataset: {}, hasAttribute: (nome) => nome === "data-faixa", closest: (s) => (s === "button" ? faixa : null) };
  app.clicar(faixa);
  assert.match(app.porId.get("turmas-conteudo").innerHTML, /cartao-turma/);
  assert.equal(app.porId.get("abas").hidden, false);
});
