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
const gradeCom = (aulas, periodo = {}, alunos = ["ANA GABRIELA SOUSA", "CARLOS DANIEL LIMA"], avaliacoes = []) =>
  ({ ok: true, versao: 1, periodo, turmas: [{ nome: TURMA, alunos, aulas }], avaliacoes });

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

test("o menu inferior é Hoje, Frequência e Notas", () => {
  assert.deepEqual(abasDoHtml(), ["hoje", "frequencia", "notas"]);
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

// ── As notas (Chamada 21, 16/10/2026) ───────────────────────────────────────
//
// Turmas → disciplinas → alunos, no mesmo desenho da Frequência. A nota é de uma
// avaliação, e quem a envia ao SIAEP é o Mestrão: aqui ela só chega à planilha.

const AVALIACOES = (noDiario = false) => [
  { chave: TURMA + "|FISICA|1", turma: TURMA, disciplina: "FISICA", ordem: 1, nome: "1ª avaliação", data: "14/08/2026", instrumento: "Prova", recuperacao: "", noDiario, notas: {} },
  { chave: TURMA + "|FISICA|2", turma: TURMA, disciplina: "FISICA", ordem: 2, nome: "2ª avaliação", data: "11/09/2026", instrumento: "Trabalho", recuperacao: "", noDiario, notas: { "ANA GABRIELA SOUSA": "8,5" } },
  { chave: TURMA + "|EDUCACAO DIGITAL(IS)|1", turma: TURMA, disciplina: "EDUCACAO DIGITAL(IS)", ordem: 1, nome: "1ª avaliação", data: "20/08/2026", instrumento: "Projeto", recuperacao: "", noDiario, notas: {} }
];

test("a aba Notas permanece disponível sem avaliações e mostra orientação", () => {
  const sem = abrir(gradeCom(diaFeito()));
  assert.doesNotMatch(readFileSync(new URL("../index.html", import.meta.url), "utf8").match(/<button[^>]*id="aba-notas"[^>]*>/)[0], /hidden/, "Notas fica sempre acessível");
  sem.contexto.abrirNotas();
  assert.match(sem.porId.get("notas-conteudo").innerHTML, /A planilha ainda não tem avaliações/);

  const com = abrir(gradeCom(diaFeito(), { momento: "4" }, undefined, AVALIACOES()));
  assert.doesNotMatch(readFileSync(new URL("../index.html", import.meta.url), "utf8").match(/<button[^>]*id="aba-notas"[^>]*>/)[0], /hidden/);
});

test("Notas · turmas: o cartão conta as avaliações com notas a lançar", () => {
  const app = abrir(gradeCom(diaFeito(), { momento: "4" }, undefined, AVALIACOES()));
  app.contexto.abrirNotas();
  const html = app.porId.get("notas-conteudo").innerHTML;
  assert.match(html, /data-nota-turma="26PMI-INT-300"/);
  assert.match(html, /3 avaliações com notas a lançar/);
  assert.match(html, /3 avaliações fora do SIAEP/);
  assert.match(html, /Física · Educação Digital/);
});

// 20/10/2026: NO DIÁRIO é a avaliação no SIAEP, não a nota. Avaliações lançadas sem nota
// nenhuma apareciam "✓ Todas lançadas".
test("Notas · turmas: avaliação no SIAEP sem nota continua com notas a lançar", () => {
  const app = abrir(gradeCom(diaFeito(), { momento: "4" }, undefined, AVALIACOES(true)));
  app.contexto.abrirNotas();
  const html = app.porId.get("notas-conteudo").innerHTML;
  assert.match(html, /3 avaliações com notas a lançar/);
  assert.doesNotMatch(html, /lançadas|fora do SIAEP/);
});

test("Notas · turmas: com nota de todos, o cartão diz Notas completas", () => {
  const todas = AVALIACOES(true).map((a) => ({ ...a, notas: { "ANA GABRIELA SOUSA": "7", "CARLOS DANIEL LIMA": "9" } }));
  const app = abrir(gradeCom(diaFeito(), { momento: "4" }, undefined, todas));
  app.contexto.abrirNotas();
  assert.match(app.porId.get("notas-conteudo").innerHTML, /✓ Notas completas/);
});

test("Notas · turmas: a turma sem avaliação aparece e diz que elas não foram lançadas", () => {
  const grade = gradeCom(diaFeito(), { momento: "4" }, undefined, AVALIACOES(true));
  grade.turmas.push({ nome: "26PMI-INT-100", alunos: ["BRUNO ALVES"], aulas: [] });
  const app = abrir(grade);
  app.contexto.abrirNotas();
  const html = app.porId.get("notas-conteudo").innerHTML;
  assert.match(html, /data-nota-turma="26PMI-INT-100"[\s\S]*Avaliações ainda não lançadas/);
  app.contexto.abrirNotaTurma("26PMI-INT-100");
  assert.match(app.porId.get("nota-disciplinas").innerHTML, /ainda não foram lançadas/);
});

test("Notas · disciplinas: uma linha por disciplina, com as avaliações dela", () => {
  const app = abrir(gradeCom(diaFeito(), { momento: "4" }, undefined, AVALIACOES()));
  app.contexto.abrirNotaTurma(TURMA);
  const html = app.porId.get("nota-disciplinas").innerHTML;
  assert.match(html, /data-nota-disciplina="FISICA"/);
  assert.match(html, /data-nota-disciplina="EDUCACAO DIGITAL\(IS\)"/);
  assert.match(html, /2 avaliações · Prova, Trabalho/);
  assert.match(app.porId.get("nota-turma-resumo").textContent, /2 alunos · 3 avaliações/);
});

test("Notas · alunos: a nota que já existe, o campo vazio e as contas", () => {
  const app = abrir(gradeCom(diaFeito(), { momento: "4" }, undefined, AVALIACOES()));
  app.contexto.abrirNotaTurma(TURMA);
  app.contexto.abrirNotaDisciplina("FISICA");
  // Abre na 1ª avaliação, que ainda não tem nota de ninguém.
  assert.match(app.porId.get("nota-avaliacao").textContent, /Física · 1ª avaliação · 14\/08\/2026 · Prova/);
  assert.equal(app.porId.get("nota-com").textContent, 0);
  // A faixa das avaliações troca para a 2ª, que já tem a nota de uma aluna.
  const faixa = { tagName: "BUTTON", dataset: { escolherAvaliacao: TURMA + "|FISICA|2" }, hasAttribute: () => false, closest: (s) => (s === "button" ? faixa : null) };
  app.clicar(faixa);
  const html = app.porId.get("nota-alunos").innerHTML;
  assert.match(html, /ANA GABRIELA SOUSA/);
  assert.match(html, /class="bt nota "[^>]*>8,5<\/button>/);
  assert.match(html, /class="bt nota vazia"[^>]*>—<\/button>/);
  assert.equal(app.porId.get("nota-com").textContent, 1);
  assert.equal(app.porId.get("nota-sem").textContent, 1);
  assert.equal(app.porId.get("nota-media").textContent, "8,5");
  assert.match(app.porId.get("nota-avaliacao").textContent, /Física · 2ª avaliação · 11\/09\/2026 · Trabalho/);
});

test("avaliação no SIAEP abre para digitar a nota, sem aviso", () => {
  const app = abrir(gradeCom(diaFeito(), { momento: "4" }, undefined, AVALIACOES(true)));
  app.contexto.abrirNotaTurma(TURMA);
  app.contexto.abrirNotaDisciplina("FISICA");
  assert.doesNotMatch(app.porId.get("nota-alunos").innerHTML, /disabled/);
  assert.equal(app.porId.get("nota-aviso").hidden, true);
});

test("avaliação fora do SIAEP também aceita nota, e a tela avisa", () => {
  const app = abrir(gradeCom(diaFeito(), { momento: "4" }, undefined, AVALIACOES()));
  app.contexto.abrirNotaTurma(TURMA);
  app.contexto.abrirNotaDisciplina("FISICA");
  assert.doesNotMatch(app.porId.get("nota-alunos").innerHTML, /disabled/);
  assert.equal(app.porId.get("nota-aviso").hidden, false);
  assert.match(app.porId.get("nota-aviso").textContent, /ainda não está no SIAEP/);
});

test("tocar no campo da nota abre o teclado", () => {
  const app = abrir(gradeCom(diaFeito(), { momento: "4" }, undefined, AVALIACOES()));
  app.contexto.abrirNotaTurma(TURMA);
  app.contexto.abrirNotaDisciplina("FISICA");
  const campo = { tagName: "BUTTON", dataset: { nota: "1" }, hasAttribute: () => false, closest: (s) => (s === "button" ? campo : null) };
  app.clicar(campo);
  assert.equal(app.porId.get("folha-nota").open, true);
  assert.equal(app.porId.get("nota-aluno").textContent, "CARLOS DANIEL LIMA");
});

test("o teclado digita a nota e Guardar põe na fila do aparelho", () => {
  const app = abrir(gradeCom(diaFeito(), { momento: "4" }, undefined, AVALIACOES()));
  app.contexto.abrirNotaTurma(TURMA);
  app.contexto.abrirNotaDisciplina("FISICA");
  app.contexto.abrirTeclado(1);
  assert.equal(app.porId.get("nota-visor").textContent, "—");
  app.contexto.digitar("7");
  app.contexto.digitar(",");
  app.contexto.digitar("5");
  assert.equal(app.porId.get("nota-visor").textContent, "7,5");
  app.contexto.guardarNota();

  const fila = JSON.parse(app.localStorage.getItem("chamada:fila-notas"));
  assert.equal(fila.length, 1);
  assert.deepEqual([fila[0].chave, fila[0].aluno, fila[0].valor], [TURMA + "|FISICA|1", "CARLOS DANIEL LIMA", "7,5"]);
  assert.equal(fila[0].antes, "", "a nota anterior viaja com o item, para voltar se a planilha recusar");
  // A tela mostra o que ele digitou; a planilha confirma — ou devolve — depois.
  assert.match(app.porId.get("nota-alunos").innerHTML, />7,5<\/button>/);
});

test("nota fora da régua não entra na fila", () => {
  const app = abrir(gradeCom(diaFeito(), { momento: "4" }, undefined, AVALIACOES()));
  app.contexto.abrirNotaTurma(TURMA);
  app.contexto.abrirNotaDisciplina("FISICA");
  app.contexto.abrirTeclado(0);
  app.contexto.digitar("1");
  app.contexto.digitar("1");
  app.contexto.guardarNota();
  assert.equal(app.localStorage.getItem("chamada:fila-notas"), null);
  assert.equal(app.porId.get("nota-alunos").innerHTML.includes(">11</button>"), false);
});

test("as turmas em ordem de série: eletiva, 1ª, 2ª, 3ª (19/10/2026)", () => {
  const turma = (nome) => ({ nome, alunos: ["ANA GABRIELA SOUSA"], aulas: [coluna("18/09/2026", 1, ["0"])] });
  // Na ordem em que a planilha vem: pelo número do SIAEP.
  const nomes = ["26EI11", "26PMI-ADM-200", "26PMI-ADM-300", "26PMI-EPT-100", "26PMI-INT-200"];
  const app = abrir({ ok: true, versao: 1, periodo: {}, turmas: nomes.map(turma), avaliacoes: [] });
  app.contexto.desenharTurmas();
  const ordem = [...app.porId.get("turmas-conteudo").innerHTML.matchAll(/data-turma="([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(ordem, ["26EI11", "26PMI-EPT-100", "26PMI-ADM-200", "26PMI-INT-200", "26PMI-ADM-300"]);
});
