// O carteiro rodando em Node, com uma Planilha Google de mentira.
//
// Cada teste é um POST como o celular e o Mestrão mandam.

import test from "node:test";
import assert from "node:assert/strict";

import { carteiro } from "./planilha-de-mentira.mjs";

const ALUNOS = ["ANA GABRIELA SOUSA", "CARLOS DANIEL LIMA", "JOAO PEDRO ALVES"];
const FREQUENCIA = (marcas = [[], [], []], gaf = null) => [
  ["INT", "TURMA: - 26PMI-INT-300", "NOME", "TOTAL", "13/10/2026", "13/10/2026", "15/10/2026"],
  ...ALUNOS.map((nome, i) => [i + 1, "", nome, 0, ...(marcas[i].length ? marcas[i] : ["", "", ""])]),
  ["AULA", "INÍCIO E DISCIPLINA", "", "", "9:20 FISICA", "10:10 FISICA", "9:20 FISICA"],
  ...(gaf ? [["GAF", "AULA VALIDADA PELO GAF", "", "", ...gaf]] : [])
];
const gerar = (c, linhas) => c.post({ acao: "gerar", abas: [{ nome: "INSTRUÇÕES", linhas: [["Leia-me"]] }, { nome: "FREQÊNCIA", linhas }], periodo: { momento: "4" } });
const aba = (c) => c.livro.getSheetByName("FREQÊNCIA").dados();
const chamada = (alunos, extra = {}) => ({
  acao: "chamada",
  chamada: { turma: "26PMI-INT-300", data: "13/10/2026", horarios: [1, 2], alunos, ...extra }
});
const todos = (marcas = {}, antes = { 1: "", 2: "" }) => ALUNOS.map((nome) => ({ nome, marca: marcas[nome] ?? "0", antes }));

test("chave errada não lê nada", () => {
  const c = carteiro();
  const r = c.post({ acao: "grade", chave: "outra".repeat(10) });
  assert.equal(r.ok, false);
  assert.equal(r.turmas, undefined);
});

test("gerar cria as abas, tira a Página1 e o celular recebe a grade com horário e disciplina", () => {
  const c = carteiro();
  assert.equal(gerar(c, FREQUENCIA()).ok, true);
  assert.deepEqual(c.livro.getSheets().map((a) => a.getName()), ["INSTRUÇÕES", "FREQÊNCIA"]);
  const g = c.post({ acao: "grade" });
  assert.deepEqual(g.periodo, { momento: "4" });
  const [turma] = g.turmas;
  assert.equal(turma.nome, "26PMI-INT-300");
  assert.deepEqual(turma.alunos, ALUNOS);
  assert.deepEqual(turma.aulas.map((a) => [a.data, a.horario, a.inicio, a.disciplina]), [
    ["13/10/2026", 1, "9:20", "FISICA"], ["13/10/2026", 2, "10:10", "FISICA"], ["15/10/2026", 1, "9:20", "FISICA"]
  ]);
});

test("a chamada grava só as colunas daquele dia, relê e devolve o recibo", () => {
  const c = carteiro();
  gerar(c, FREQUENCIA());
  const r = c.post(chamada(todos({ "CARLOS DANIEL LIMA": "F", "JOAO PEDRO ALVES": "E" })));
  assert.equal(r.ok, true, r.erro);
  assert.deepEqual([r.presentes, r.faltas, r.justificadas], [1, 1, 1]);
  assert.deepEqual(r.horarios, [1, 2]);
  assert.deepEqual(aba(c).slice(1, 4).map((l) => l.slice(4)), [["0", "0", ""], ["F", "F", ""], ["E", "E", ""]]);
});

test("horários separados: o 2º horário não toca no 1º", () => {
  const c = carteiro();
  gerar(c, FREQUENCIA());
  const r = c.post(chamada(todos({ "ANA GABRIELA SOUSA": "F" }, { 2: "" }), { horarios: [2] }));
  assert.equal(r.ok, true, r.erro);
  assert.deepEqual(aba(c)[1].slice(4), ["", "F", ""]);
});

test("coluna validada pelo GAF fica de fora; aula toda validada é recusada", () => {
  const c = carteiro();
  gerar(c, FREQUENCIA(undefined, ["VALIDADA", "", ""]));
  const r = c.post(chamada(todos({ "ANA GABRIELA SOUSA": "F" })));
  assert.equal(r.ok, true, r.erro);
  assert.deepEqual(r.travados, [1]);
  assert.deepEqual(aba(c)[1].slice(4), ["", "F", ""]);
  const fechada = c.post(chamada(todos(), { horarios: [1] }));
  assert.equal(fechada.ok, false);
  assert.match(fechada.erro, /GAF/);
});

test("se a marca mudou na planilha depois de aberta, nada é gravado", () => {
  const c = carteiro();
  gerar(c, FREQUENCIA([["F", "F", ""], [], []]));
  const r = c.post(chamada(todos({}, { 1: "", 2: "" })));
  assert.equal(r.ok, false);
  assert.equal(r.conflito, true);
  assert.deepEqual(aba(c)[1].slice(4), ["F", "F", ""]);
});

test("reenviar a mesma chamada (resposta perdida no caminho) não é conflito", () => {
  const c = carteiro();
  gerar(c, FREQUENCIA());
  const pedido = chamada(todos({ "ANA GABRIELA SOUSA": "F" }));
  assert.equal(c.post(pedido).ok, true);
  assert.equal(c.post(pedido).ok, true);
});

test("quem saiu é dito, quem entrou não recebe marca", () => {
  const c = carteiro();
  gerar(c, FREQUENCIA());
  const alunos = [...todos().slice(0, 2), { nome: "ALUNO QUE SAIU", marca: "F", antes: {} }];
  const r = c.post(chamada(alunos));
  assert.equal(r.ok, true, r.erro);
  assert.deepEqual(r.saiu, ["ALUNO QUE SAIU"]);
  assert.deepEqual(r.entrou, ["JOAO PEDRO ALVES"]);
  assert.deepEqual(aba(c)[3].slice(4), ["", "", ""]);
});

test("gerar de novo mantém a chamada do celular e só preenche o vazio", () => {
  const c = carteiro();
  gerar(c, FREQUENCIA());
  c.post(chamada(todos({ "ANA GABRIELA SOUSA": "F" })));
  const r = gerar(c, FREQUENCIA([[], [], ["", "", "F"]]));
  assert.equal(r.ok, true);
  assert.equal(r.mantidas, 6);
  assert.deepEqual(aba(c).slice(1, 4).map((l) => l.slice(4)), [["F", "F", ""], ["0", "0", ""], ["0", "0", "F"]]);
});

// O terceiro estado (CONTRATOS.md §1, 16/10/2026): o Mestrão manda no `periodo` as
// aulas que o diário já tem, e o celular as recebe de volta — **sem republicar o
// Apps Script**. Se este teste falhar, o professor teria que colar o código de novo.
test("o período volta inteiro para o celular, com lancadas e anterior", () => {
  const c = carteiro();
  const periodo = {
    momento: "4",
    nomes: { "26PMI-INT-300": "ADM-200" },
    lancadas: ["26PMI-INT-300|13/10/2026|1"],
    anterior: { momento: "3", aLancar: 12 }
  };
  const r = c.post({
    acao: "gerar",
    abas: [{ nome: "INSTRUÇÕES", linhas: [["Leia-me"]] }, { nome: "FREQÊNCIA", linhas: FREQUENCIA() }],
    periodo
  });
  assert.equal(r.ok, true, r.erro);
  assert.deepEqual(c.post({ acao: "grade" }).periodo, periodo);
});

test("ler devolve as linhas para o Mestrão, e nada quando a versão não mudou", () => {
  const c = carteiro();
  const { versao } = gerar(c, FREQUENCIA());
  const r = c.post({ acao: "ler" });
  assert.equal(r.aba, "FREQÊNCIA");
  assert.equal(r.linhas[1][2], "ANA GABRIELA SOUSA");
  assert.deepEqual(c.post({ acao: "ler", desde: versao }), { ok: true, versao, mudou: false });
});
