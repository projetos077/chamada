// Chamada 16 — o celular faz a chamada, o carteiro grava na Planilha Google.
//
// Até a versão 15 o celular baixava o XLSX inteiro do Drive, encaixava a
// chamada e subia o arquivo de volta, com um login do Google que vencia a cada
// hora. Agora ele fala com o carteiro (`carteiro/Codigo.gs`), que mora na
// planilha: recebe a grade já mastigada e manda só a chamada — turma, data,
// marcas. A planilha continua sendo do Mestrão; este app só preenche a
// frequência.
//
// Nada se perde no caminho: a chamada entra na fila do aparelho **antes** de
// sair, e só sai da fila quando o carteiro responde. Sem internet, ela fica e
// vai sozinha depois.

const VERSAO = "16";
const CHAVES = {
  conexao: "chamada:conexao",
  grade: "chamada:grade",
  conferida: "chamada:conferida",
  fila: "chamada:fila",
  recusas: "chamada:recusas",
  recibos: "chamada:recibos",
  modo: "mestre:horarios"
};
const MOTIVOS = [
  ["I", "Impossibilidade de participação"],
  ["A", "Acompanhar parente ou responsável"],
  ["E", "Enfermidade"],
  ["G", "Gravidez"],
  ["S", "Insegurança"],
  ["T", "Trabalho"],
  ["U", "Sem transporte escolar"],
  ["O", "Ensino remoto"],
  ["P", "Suspeita de COVID"]
];
const NOME_DO_MOTIVO = Object.fromEntries(MOTIVOS);

const $ = (id) => document.getElementById(id);

function lido(chave, padrao) {
  try {
    return JSON.parse(localStorage.getItem(chave)) ?? padrao;
  } catch {
    return padrao;
  }
}

function guardar(chave, valor) {
  try {
    localStorage.setItem(chave, JSON.stringify(valor));
  } catch {
    // Sem armazenamento a chamada ainda vai; só não sobrevive a fechar o app.
  }
}

let conexao = lido(CHAVES.conexao, null);
let grade = lido(CHAVES.grade, null);
let conferidaEm = lido(CHAVES.conferida, 0);
let fila = lido(CHAVES.fila, []);
let recusas = lido(CHAVES.recusas, []);
let recibos = lido(CHAVES.recibos, {});
let aberta = null;
let turmaAberta = null;
let alunoDoMotivo = -1;
let telaAtual = "";

const escapar = (valor) => String(valor ?? "").replace(/[&<>"']/g, (c) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;"
})[c]);

function avisar(texto) {
  const el = $("aviso-rapido");
  el.textContent = texto;
  el.classList.add("mostra");
  clearTimeout(avisar.tempo);
  avisar.tempo = setTimeout(() => el.classList.remove("mostra"), 3200);
}

function mostrar(tela) {
  telaAtual = tela;
  document.querySelectorAll(".tela").forEach((el) => el.classList.toggle("ativa", el.id === `tela-${tela}`));
  window.scrollTo(0, 0);
}

// ── Datas ───────────────────────────────────────────────────────────────────

const dois = (n) => String(n).padStart(2, "0");
const hojeRotulo = () => {
  const d = new Date();
  return `${dois(d.getDate())}/${dois(d.getMonth() + 1)}/${d.getFullYear()}`;
};
const ordenavel = (data) => data.split("/").reverse().join("");
const emMinutos = (hora) => {
  const [h, m] = String(hora || "").split(":");
  return hora ? Number(h) * 60 + Number(m) : 24 * 60;
};
const horaAgora = () => new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
const horaDe = (iso) => new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });

function diaCurto(data) {
  const [d, m, a] = data.split("/").map(Number);
  const dia = new Date(a, m - 1, d);
  const dias = Math.round((new Date().setHours(0, 0, 0, 0) - dia) / 86400000);
  if (dias === 1) return "ontem";
  if (dias > 1 && dias < 7) return dia.toLocaleDateString("pt-BR", { weekday: "short" }).replace(".", "");
  return data.slice(0, 5);
}

function diaDaSemana(data) {
  const [d, m, a] = data.split("/").map(Number);
  return new Date(a, m - 1, d).toLocaleDateString("pt-BR", { weekday: "short" }).replace(".", "");
}

function dataPorExtenso() {
  const texto = new Date().toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "long" });
  const periodo = grade?.periodo?.momento ? ` · ${grade.periodo.momento}º período` : "";
  return texto.charAt(0).toUpperCase() + texto.slice(1).replace("-feira", "") + periodo;
}

// ── A grade em aulas ────────────────────────────────────────────────────────
//
// O carteiro manda uma coluna por horário. Juntar os horários do dia numa
// chamada só, ou não, é escolha do professor (CONTRATOS.md §1, regra 1).

const juntos = () => lido(CHAVES.modo, "juntos") !== "separados";

function colunaFeita(coluna) {
  const temAusencia = coluna.marcas.some((m) => m && m !== "0");
  const toda = coluna.marcas.length > 0 && coluna.marcas.every((m) => m !== "");
  return temAusencia || toda;
}

function aulasDa(turma) {
  const grupos = [];
  const porData = new Map();
  turma.aulas.forEach((coluna, indice) => {
    if (juntos() && porData.has(coluna.data)) {
      porData.get(coluna.data).push(indice);
      return;
    }
    const grupo = [indice];
    porData.set(coluna.data, grupo);
    grupos.push(grupo);
  });
  return grupos.map((indices) => {
    const colunas = indices.map((i) => turma.aulas[i]);
    const primeira = colunas[0];
    const horarios = colunas.map((c) => c.horario);
    const doDia = turma.aulas.filter((c) => c.data === primeira.data).length;
    const chave = `${turma.nome}|${primeira.data}|${horarios.join(",")}`;
    return {
      turma,
      chave,
      data: primeira.data,
      horarios,
      colunas,
      doDia,
      inicio: primeira.inicio,
      disciplina: [...new Set(colunas.map((c) => c.disciplina).filter(Boolean))].join(" e "),
      travada: colunas.every((c) => c.travada),
      feita: colunas.every(colunaFeita),
      naFila: fila.some((item) => item.aula === chave),
      recusada: recusas.find((item) => item.aula === chave)
    };
  });
}

function descricao(aula, comData = false) {
  const partes = [];
  if (comData) partes.push(aula.data.slice(0, 5));
  if (aula.disciplina) partes.push(capitalizar(aula.disciplina));
  if (aula.horarios.length > 1) partes.push(`${aula.horarios.length} horários`);
  else if (aula.doDia > 1) partes.push(`${aula.horarios[0]}º horário`);
  partes.push(`${aula.turma.alunos.length} alunos`);
  return partes.join(" · ");
}

// O SIAEP manda sem acento: FISICA, EDUCACAO DIGITAL(IS).
function capitalizar(texto) {
  return texto.replace(/CAO\b/g, "ÇÃO").replace(/\bFISICA\b/g, "FÍSICA").replace(/\bMATEMATICA\b/g, "MATEMÁTICA")
    .toLowerCase().replace(/(^|\s)(\p{L})/gu, (_, espaco, letra) => espaco + letra.toUpperCase())
    .replace(/\bE\b/g, "e").replace(/\bDo\b/g, "do").replace(/\bNo\b/g, "no");
}

function aulasDeHoje() {
  const hoje = hojeRotulo();
  return (grade?.turmas ?? [])
    .flatMap(aulasDa)
    .filter((aula) => aula.data === hoje)
    .sort((a, b) => emMinutos(a.inicio) - emMinutos(b.inicio));
}

// **Toda aula que o Mestrão gerou se preenche** — dito por ele em 13/10/2026: em dias
// seguidos ou pulados, não interessa. O que falta é "a preencher", por turma; não
// existe aula "atrasada".
const aPreencher = (aula) => !aula.feita && !aula.travada;

/** A próxima depois de enviar: a do dia, se a enviada era de hoje; senão, a seguinte da mesma turma. */
function proximaDepois(chave) {
  const enviada = acharAula(chave);
  const pendente = (aula) => aula.chave !== chave && aPreencher(aula) && !aula.naFila;
  const doDia = aulasDeHoje().find(pendente);
  if (enviada?.data === hojeRotulo() && doDia) return doDia;
  return (enviada ? aulasDa(enviada.turma).find(pendente) : null)
    ?? doDia ?? (grade?.turmas ?? []).flatMap(aulasDa).find(pendente) ?? null;
}

// ── Desenhar ────────────────────────────────────────────────────────────────

function linhaDaAula(aula, { agora = false, comData = false, hora, titulo } = {}) {
  let estado = "";
  let lado;
  const recibo = recibos[aula.chave];
  if (aula.recusada) {
    estado = "recusada";
    lado = `<span class="acao">Abrir</span>`;
  } else if (aula.naFila) {
    lado = `<span class="fila">◷ Na fila</span>`;
  } else if (aula.travada) {
    estado = "travada";
    lado = `<span class="fechada">🔒 Fechada</span>`;
  } else if (aula.feita) {
    estado = "enviada";
    lado = `<span class="feita">✓ ${recibo ? `Enviada ${horaDe(recibo.conferidaEm)}` : "Feita"}</span>`;
  } else {
    lado = `<span class="acao ${agora ? "agora" : ""}">${agora ? "Fazer agora" : "Fazer"}</span>`;
  }
  const sub = aula.recusada ? escapar(aula.recusada.erro) : escapar(descricao(aula, comData));
  return `
    <button class="linha ${estado}" data-aula="${escapar(aula.chave)}">
      <span class="hora">${escapar(hora ?? aula.inicio ?? "")}</span>
      <span class="meio"><strong>${escapar(titulo ?? aula.turma.nome)}</strong><span>${sub}</span></span>
      ${lado}
    </button>`;
}

function desenharChip() {
  const chip = $("chip");
  const texto = chip.querySelector("span");
  chip.className = "chip";
  if (recusas.length) {
    chip.classList.add("erro");
    texto.textContent = `${recusas.length} chamada${recusas.length > 1 ? "s" : ""} não entr${recusas.length > 1 ? "aram" : "ou"} na planilha`;
  } else if (fila.length) {
    chip.classList.add("fila");
    const n = fila.length;
    texto.textContent = `${n} chamada${n > 1 ? "s" : ""} aguardando envio${navigator.onLine ? " · toque para enviar" : " · sem internet"}`;
  } else if (conferidaEm) {
    chip.classList.add("ok");
    texto.textContent = `Tudo enviado · planilha conferida às ${horaDe(conferidaEm)}`;
  } else {
    texto.textContent = "Conectando à planilha…";
  }
}

function desenharHoje() {
  $("hoje-data").textContent = dataPorExtenso();
  desenharChip();
  const partes = [];

  if (recusas.length) {
    const linhas = recusas.map((item) => {
      const aula = acharAula(item.aula);
      return aula ? linhaDaAula(aula, { comData: true, hora: diaCurto(aula.data) }) : "";
    }).join("");
    if (linhas) partes.push(`<h2 class="titulo-secao recusa"><i></i>Não entrou</h2><div class="lista">${linhas}</div>`);
  }

  const hoje = aulasDeHoje();
  const agora = hoje.find((aula) => !aula.feita && !aula.travada && !aula.naFila && !aula.recusada);
  partes.push(`<h2 class="titulo-secao"><i></i>Hoje</h2>`);
  partes.push(hoje.length
    ? `<div class="lista">${hoje.map((aula) => linhaDaAula(aula, { agora: aula === agora })).join("")}</div>`
    : `<div class="lista"><p class="vazio">Nenhuma aula hoje.</p></div>`);

  // Uma linha por turma com o que falta preencher; tocar abre as aulas dela.
  const turmas = grade?.turmas ?? [];
  if (turmas.length) {
    const falta = new Map(turmas.map((turma) => [turma.nome, aulasDa(turma).filter(aPreencher).length]));
    const total = [...falta.values()].reduce((a, b) => a + b, 0);
    partes.push(`<h2 class="titulo-secao tras"><i></i>A preencher${total ? ` · ${total} aulas` : ""}</h2>`);
    partes.push(`<div class="lista">${turmas.map((turma) => {
      const n = falta.get(turma.nome);
      return `<button class="linha ${n ? "" : "enviada"}" data-turma="${escapar(turma.nome)}">
        <span class="meio"><strong>${escapar(turma.nome)}</strong><span>${n
          ? `${n} ${n === 1 ? "aula" : "aulas"} a preencher`
          : "Todas preenchidas"}</span></span>
        ${n ? `<span class="acao">${n}</span>` : `<span class="feita">✓</span>`}</button>`;
    }).join("")}</div>`);
  } else if (grade) {
    partes.push(`<div class="lista"><p class="vazio">A planilha ainda não tem turmas. Gere a planilha no Mestrão.</p></div>`);
  }

  $("hoje-conteudo").innerHTML = partes.join("");
}

function abrirTurma(nome) {
  const turma = grade?.turmas.find((t) => t.nome === nome);
  if (!turma) return;
  turmaAberta = nome;
  const aulas = aulasDa(turma);
  const hoje = hojeRotulo();
  $("turma-nome").textContent = turma.nome;
  const falta = aulas.filter(aPreencher).length;
  $("turma-resumo").textContent = `${turma.alunos.length} alunos · ${falta ? `${falta} de ${aulas.length} aulas a preencher` : `${aulas.length} aulas, todas preenchidas`}`;
  // Aqui a turma já está no topo: cada linha diz o dia.
  $("turma-aulas").innerHTML = `<div class="lista" style="margin-top:14px">${aulas.map((aula) =>
    linhaDaAula(aula, {
      hora: aula.data === hoje ? "hoje" : diaDaSemana(aula.data),
      titulo: `${aula.data.slice(0, 5)}${aula.inicio ? ` · ${aula.inicio}` : ""}`
    }).replace('class="linha', `class="linha${aula.data === hoje ? " hoje" : ""}`)).join("")}</div>`;
  mostrar("turma");
  // Abre em hoje; sem aula hoje, na primeira que falta preencher.
  (document.querySelector("#turma-aulas .hoje") ?? document.querySelector("#turma-aulas .linha:not(.enviada):not(.travada)"))
    ?.scrollIntoView({ block: "center" });
}

function acharAula(chave) {
  const nome = chave.split("|")[0];
  const turma = grade?.turmas.find((t) => t.nome === nome);
  return turma ? aulasDa(turma).find((aula) => aula.chave === chave) ?? null : null;
}

// ── A chamada ───────────────────────────────────────────────────────────────

const chaveDoRascunho = (aula) => `chamada:rascunho:${aula.chave}`;

function abrirChamada(chave) {
  const aula = acharAula(chave);
  if (!aula) {
    avisar("Essa aula não está mais na planilha.");
    return;
  }
  if (aula.travada) {
    avisar("Aula validada pelo GAF: o SIAEP não aceita mais alteração nela.");
    return;
  }
  // As colunas que o GAF fechou ficam de fora da escrita e da comparação.
  const abertas = aula.colunas.filter((c) => !c.travada);
  // O rascunho guarda só quem ele tocou: o resto vem da planilha, para uma
  // mudança que chegou por lá não ser coberta por um "presente" que ele nem marcou.
  const rascunho = lido(chaveDoRascunho(aula), {});
  aberta = {
    aula,
    abertas,
    tocados: new Set(Object.keys(rascunho)),
    alunos: aula.turma.alunos.map((nome, i) => {
      const marcas = abertas.map((c) => c.marcas[i]);
      const doArquivo = marcas.find((m) => m && m !== "0") ?? "0";
      return {
        nome,
        marca: rascunho[nome] ?? doArquivo,
        antes: Object.fromEntries(abertas.map((c) => [c.horario, c.marcas[i]]))
      };
    })
  };

  const quando = aula.data === hojeRotulo() ? "Hoje" : diaCurto(aula.data);
  $("chamada-quando").textContent = [quando, aula.data.slice(0, 5), aula.inicio, aula.disciplina && capitalizar(aula.disciplina),
    aula.horarios.length > 1 && `${aula.horarios.length} horários`]
    .filter(Boolean).join(" · ");
  $("chamada-turma").textContent = aula.turma.nome;
  const fechados = aula.colunas.filter((c) => c.travada).map((c) => `${c.horario}º`);
  const aviso = $("chamada-aviso");
  aviso.hidden = !(fechados.length || aula.feita);
  aviso.textContent = fechados.length
    ? `O ${fechados.join(" e ")} horário já foi validado pelo GAF e fica como está.`
    : "Esta chamada já está na planilha. Corrija o que precisar e envie de novo.";
  $("btn-enviar").textContent = aula.feita ? "Enviar correção" : "Enviar chamada";
  $("btn-enviar").disabled = false;
  desenharAlunos();
  mostrar("chamada");
}

function desenharAlunos() {
  $("chamada-alunos").innerHTML = aberta.alunos.map((aluno, i) => {
    const falta = aluno.marca === "F";
    const just = aluno.marca !== "0" && !falta;
    return `
      <div class="aluno ${falta ? "falta" : just ? "just" : ""}">
        <span class="n">${i + 1}</span>
        <span class="nome">${escapar(aluno.nome)}${just ? `<small>${escapar(NOME_DO_MOTIVO[aluno.marca] ?? aluno.marca)}</small>` : ""}</span>
        <button class="bt bt-f" data-falta="${i}" aria-label="Falta de ${escapar(aluno.nome)}">F</button>
        <button class="bt bt-j" data-justificar="${i}" aria-label="Justificar ${escapar(aluno.nome)}">${just ? escapar(aluno.marca) : "J"}</button>
      </div>`;
  }).join("");
  const faltas = aberta.alunos.filter((a) => a.marca === "F").length;
  const justificadas = aberta.alunos.filter((a) => a.marca !== "0" && a.marca !== "F").length;
  $("conta-presentes").textContent = aberta.alunos.length - faltas - justificadas;
  $("conta-faltas").textContent = faltas;
  $("conta-justificadas").textContent = justificadas;
}

function marcar(indice, marca) {
  const aluno = aberta.alunos[indice];
  aluno.marca = aluno.marca === marca ? "0" : marca;
  aberta.tocados.add(aluno.nome);
  guardar(chaveDoRascunho(aberta.aula), Object.fromEntries(
    aberta.alunos.filter((a) => aberta.tocados.has(a.nome)).map((a) => [a.nome, a.marca])
  ));
  desenharAlunos();
}

function abrirMotivos(indice) {
  alunoDoMotivo = indice;
  const aluno = aberta.alunos[indice];
  $("motivo-aluno").textContent = aluno.nome;
  $("motivos").innerHTML = [["0", "Presente"], ...MOTIVOS].map(([codigo, nome]) => `
    <button type="button" class="${codigo === "0" ? "presente" : ""} ${aluno.marca === codigo ? "ativo" : ""}" data-motivo="${codigo}">
      <b>${codigo === "0" ? "✓" : codigo}</b><span>${nome}</span></button>`).join("");
  $("folha-motivo").showModal();
}

// ── Falar com o carteiro ────────────────────────────────────────────────────

class SemResposta extends Error {}

/** O que aconteceu com cada item, para quem enviou saber mesmo se outro o levou. */
const resultados = new Map();

async function pedir(acao, extra = {}) {
  const controle = new AbortController();
  const prazo = setTimeout(() => controle.abort(), 30000);
  try {
    // `text/plain` não dispara a pergunta prévia do CORS, que o Apps Script não responde.
    const resposta = await fetch(conexao.url, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({ acao, chave: conexao.chave, ...extra }),
      signal: controle.signal
    });
    if (!resposta.ok) throw new SemResposta(`A planilha respondeu ${resposta.status}.`);
    const texto = await resposta.text();
    try {
      return JSON.parse(texto);
    } catch {
      throw new Error("O endereço respondeu, mas não é o carteiro. Confira se o App da Web está para “Qualquer pessoa”.");
    }
  } catch (erro) {
    if (erro.name === "AbortError") throw new SemResposta("A planilha demorou demais para responder.");
    if (erro instanceof TypeError) throw new SemResposta(navigator.onLine ? "Não consegui falar com a planilha." : "Sem internet.");
    throw erro;
  } finally {
    clearTimeout(prazo);
  }
}

let buscando = null;

function atualizarGrade() {
  if (!conexao) return Promise.resolve();
  buscando ??= pedir("grade")
    .then((resposta) => {
      if (!resposta.ok) throw new Error(resposta.erro);
      // Planilha sem turma, quando o aparelho já tinha turmas, é o Mestrão no meio
      // de uma gravação (13/10/2026): a cópia do aparelho continua, e a próxima
      // busca traz a nova. Trocar por vazio apagaria a tela no meio da chamada.
      if (!resposta.turmas?.length && grade?.turmas?.length) return;
      grade = resposta;
      conferidaEm = Date.now();
      guardar(CHAVES.grade, grade);
      guardar(CHAVES.conferida, conferidaEm);
      // A recusa não sai daqui: a aula pode parecer feita pela marca de outro, e a
      // chamada do celular continua fora. Ela só sai quando aquela aula entrar.
    })
    .finally(() => {
      buscando = null;
      if (telaAtual === "hoje") desenharHoje();
      if (telaAtual === "turma" && turmaAberta) abrirTurma(turmaAberta);
    });
  return buscando;
}

function montarChamada() {
  const { aula, abertas, alunos } = aberta;
  return {
    turma: aula.turma.nome,
    data: aula.data,
    horarios: abertas.map((c) => c.horario),
    alunos: alunos.map(({ nome, marca, antes }) => ({ nome, marca, antes }))
  };
}

/** O que a planilha passou a ter, já na grade do aparelho — sem esperar outra busca. */
function aplicarNaGrade(chamada) {
  const turma = grade?.turmas.find((t) => t.nome === chamada.turma);
  if (!turma) return;
  const marcaDe = new Map(chamada.alunos.map((a) => [a.nome, a.marca]));
  turma.aulas
    .filter((c) => c.data === chamada.data && chamada.horarios.includes(c.horario) && !c.travada)
    .forEach((c) => {
      c.marcas = c.marcas.map((m, i) => marcaDe.get(turma.alunos[i]) ?? m);
    });
  guardar(CHAVES.grade, grade);
}

/** Um item da fila. Devolve o que aconteceu; a fila só perde o item quando o carteiro responde. */
async function enviarItem(item) {
  let resposta;
  try {
    resposta = await pedir("chamada", { chamada: item.chamada });
  } catch (erro) {
    const espera = { tipo: "espera", erro: erro.message };
    resultados.set(item.id, espera);
    return espera;
  }
  fila = fila.filter((i) => i.id !== item.id);
  guardar(CHAVES.fila, fila);
  recusas = recusas.filter((i) => i.aula !== item.aula);
  if (!resposta.ok) {
    recusas.push({ aula: item.aula, erro: resposta.erro, conflito: Boolean(resposta.conflito) });
    guardar(CHAVES.recusas, recusas);
    resultados.set(item.id, { tipo: "recusa", erro: resposta.erro });
    return resultados.get(item.id);
  }
  guardar(CHAVES.recusas, recusas);
  aplicarNaGrade(item.chamada);
  recibos[item.aula] = resposta;
  guardar(CHAVES.recibos, recibos);
  try {
    localStorage.removeItem(`chamada:rascunho:${item.aula}`);
  } catch {}
  resultados.set(item.id, { tipo: "ok", recibo: resposta });
  return resultados.get(item.id);
}

let esvaziando = null;

function esvaziarFila() {
  if (!conexao || !fila.length) return Promise.resolve();
  esvaziando ??= (async () => {
    for (const item of [...fila]) {
      const resultado = await enviarItem(item);
      if (resultado.tipo === "espera") break;
    }
  })().finally(() => {
    esvaziando = null;
    if (telaAtual === "hoje") desenharHoje();
  });
  return esvaziando;
}

async function enviar() {
  const botao = $("btn-enviar");
  if (botao.disabled) return;
  const aula = aberta.aula;
  const item = { id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, aula: aula.chave, chamada: montarChamada() };
  // Primeiro no aparelho, depois na rede: fechar o app no meio não perde a chamada.
  fila = [...fila.filter((i) => i.aula !== item.aula), item];
  guardar(CHAVES.fila, fila);

  botao.disabled = true;
  botao.innerHTML = `<span class="gira"></span>Enviando…`;
  const devagar = setTimeout(() => {
    botao.innerHTML = `<span class="gira"></span>A planilha está respondendo…`;
  }, 4000);
  await esvaziando?.catch(() => {});
  const resultado = fila.some((i) => i.id === item.id) ? await enviarItem(item) : resultados.get(item.id);
  clearTimeout(devagar);
  botao.disabled = false;
  botao.textContent = "Enviar chamada";
  mostrarResultado(aula, resultado);
}

function mostrarResultado(aula, resultado) {
  const quando = `${aula.turma.nome} · ${aula.data.slice(0, 5)}${aula.inicio ? ` · ${aula.inicio}` : ""}`;
  let html;
  if (resultado.tipo === "ok") {
    const r = resultado.recibo;
    const nomes = r.ausentes.map((a) => `${escapar(a.nome)} — ${a.marca === "F" ? "falta" : `${a.marca} · ${escapar(NOME_DO_MOTIVO[a.marca] ?? "")}`}`);
    const notas = [
      r.saiu?.length ? `Saíram da turma: ${r.saiu.map(escapar).join(", ")}.` : "",
      r.entrou?.length ? `Entraram depois e ficaram sem marca: ${r.entrou.map(escapar).join(", ")}.` : "",
      r.travados?.length ? `O ${r.travados.join(" e ")}º horário estava validado pelo GAF e não foi tocado.` : ""
    ].filter(Boolean);
    const proxima = proximaDepois(aula.chave);
    html = `
      <div class="selo">✓</div>
      <h3>Chamada enviada</h3>
      <p>${escapar(quando)}</p>
      <div class="recibo">
        <div><em>Presentes</em><b>${r.presentes}</b></div>
        <div class="f"><em>Faltas</em><b>${r.faltas}</b></div>
        <div class="j"><em>Justificadas</em><b>${r.justificadas}</b></div>
        ${nomes.length ? `<div><span class="nomes">${nomes.join("<br>")}</span></div>` : ""}
        <div><em>Conferida na planilha</em><b>${horaDe(r.conferidaEm)}</b></div>
      </div>
      ${notas.map((n) => `<p>${n}</p>`).join("")}
      ${proxima ? `<button class="btn pri" type="button" data-proxima="${escapar(proxima.chave)}">Próxima: ${escapar(proxima.turma.nome)}${proxima.data === hojeRotulo() && proxima.inicio ? ` · ${escapar(proxima.inicio)}` : ` · ${escapar(diaCurto(proxima.data))}`}</button>` : ""}
      <button class="btn ${proxima ? "sec" : "pri"}" value="hoje">Voltar para Hoje</button>`;
  } else if (resultado.tipo === "espera") {
    html = `
      <div class="selo espera">◷</div>
      <h3>Guardada no celular</h3>
      <p>${escapar(resultado.erro)} A chamada de ${escapar(quando)} vai sozinha quando a planilha responder.</p>
      <button class="btn pri" type="button" data-tentar>Tentar agora</button>
      <button class="btn sec" value="hoje">Voltar para Hoje</button>`;
  } else {
    html = `
      <div class="selo recusa">!</div>
      <h3>Não entrou na planilha</h3>
      <p>${escapar(resultado.erro)}</p>
      <p>Suas marcas continuam guardadas nesta chamada.</p>
      <button class="btn pri" type="button" data-recarregar="${escapar(aula.chave)}">Buscar a planilha e abrir de novo</button>
      <button class="btn sec" value="hoje">Voltar para Hoje</button>`;
  }
  $("envio-conteudo").innerHTML = html;
  $("folha-envio").returnValue = "";
  $("folha-envio").showModal();
}

// ── Conectar ────────────────────────────────────────────────────────────────

function lerCodigo(texto) {
  const achado = String(texto || "").trim().match(/^(https:\/\/script\.google(?:usercontent)?\.com\/\S+?\/exec)#([A-Za-z0-9]{32,})$/);
  return achado ? { url: achado[1], chave: achado[2] } : null;
}

async function conectar() {
  const erro = $("erro-conectar");
  erro.hidden = true;
  const lida = lerCodigo($("campo-codigo").value);
  if (!lida) {
    erro.textContent = "Esse não é o código da planilha. Ele começa com https://script.google.com e tem um # no meio.";
    erro.hidden = false;
    return;
  }
  const botao = $("btn-conectar");
  botao.disabled = true;
  botao.textContent = "Conectando…";
  const anterior = conexao;
  conexao = lida;
  try {
    const resposta = await pedir("grade");
    if (!resposta.ok) throw new Error(resposta.erro);
    guardar(CHAVES.conexao, conexao);
    grade = resposta;
    conferidaEm = Date.now();
    guardar(CHAVES.grade, grade);
    guardar(CHAVES.conferida, conferidaEm);
    desenharHoje();
    mostrar("hoje");
  } catch (falha) {
    conexao = anterior;
    erro.textContent = falha.message;
    erro.hidden = false;
  } finally {
    botao.disabled = false;
    botao.textContent = "Conectar";
  }
}

// ── Toques ──────────────────────────────────────────────────────────────────

document.addEventListener("click", (evento) => {
  const alvo = evento.target.closest("button");
  if (!alvo) return;
  if (alvo.dataset.aula) abrirChamada(alvo.dataset.aula);
  else if (alvo.dataset.turma) abrirTurma(alvo.dataset.turma);
  else if (alvo.dataset.falta) marcar(Number(alvo.dataset.falta), "F");
  else if (alvo.dataset.justificar) abrirMotivos(Number(alvo.dataset.justificar));
  else if (alvo.dataset.motivo) {
    const aluno = aberta.alunos[alunoDoMotivo];
    if (aluno.marca !== alvo.dataset.motivo) marcar(alunoDoMotivo, alvo.dataset.motivo);
    $("folha-motivo").close();
  } else if (alvo.hasAttribute("data-voltar")) {
    if (telaAtual === "chamada" && turmaAberta) abrirTurma(turmaAberta);
    else voltarParaHoje();
  } else if (alvo.dataset.proxima) {
    $("folha-envio").close();
    abrirChamada(alvo.dataset.proxima);
  } else if (alvo.hasAttribute("data-tentar")) {
    $("folha-envio").close();
    const item = fila.find((i) => i.aula === aberta?.aula.chave);
    if (item) enviarItem(item).then((resultado) => mostrarResultado(aberta.aula, resultado));
  } else if (alvo.dataset.recarregar) {
    $("folha-envio").close();
    const chave = alvo.dataset.recarregar;
    atualizarGrade().then(() => abrirChamada(chave)).catch((erro) => avisar(erro.message));
  }
});

function voltarParaHoje() {
  turmaAberta = null;
  desenharHoje();
  mostrar("hoje");
}

$("folha-envio").addEventListener("close", () => {
  if ($("folha-envio").returnValue === "hoje") voltarParaHoje();
});

$("chip").addEventListener("click", () => {
  if (recusas.length) {
    const aula = acharAula(recusas[0].aula);
    if (aula) abrirChamada(aula.chave);
    return;
  }
  esvaziarFila();
  atualizarGrade().catch((erro) => avisar(erro.message));
});

$("btn-enviar").addEventListener("click", enviar);
$("btn-conectar").addEventListener("click", conectar);
$("btn-colar").addEventListener("click", async () => {
  try {
    $("campo-codigo").value = await navigator.clipboard.readText();
  } catch {
    $("campo-codigo").focus();
  }
});

$("btn-ajustes").addEventListener("click", () => {
  document.querySelectorAll('input[name="modo"]').forEach((el) => {
    el.checked = el.value === (juntos() ? "juntos" : "separados");
  });
  $("folha-ajustes").showModal();
});
document.querySelectorAll('input[name="modo"]').forEach((el) => {
  el.addEventListener("change", () => {
    guardar(CHAVES.modo, el.value);
    desenharHoje();
  });
});
$("btn-atualizar").addEventListener("click", () => {
  $("folha-ajustes").close();
  esvaziarFila();
  atualizarGrade().then(() => avisar("Planilha conferida agora.")).catch((erro) => avisar(erro.message));
});
$("btn-trocar-codigo").addEventListener("click", () => {
  $("folha-ajustes").close();
  if (fila.length) {
    avisar("Há chamada aguardando envio. Envie antes de trocar a planilha.");
    return;
  }
  $("campo-codigo").value = "";
  mostrar("conectar");
});

// ── Ao abrir, ao voltar para a tela e quando a internet volta ───────────────

function sincronizar() {
  if (!conexao) return;
  esvaziarFila();
  atualizarGrade().catch(() => desenharChip());
}

window.addEventListener("online", sincronizar);
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") sincronizar();
});
setInterval(() => {
  if (document.visibilityState === "visible" && telaAtual !== "chamada") sincronizar();
}, 5 * 60 * 1000);

if ("serviceWorker" in navigator && location.protocol === "https:") {
  navigator.serviceWorker.register(`sw.js?v=${VERSAO}`).catch(() => {});
}

if (conexao) {
  desenharHoje();
  mostrar("hoje");
  sincronizar();
} else {
  mostrar("conectar");
}
