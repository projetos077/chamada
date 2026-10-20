// Chamada 23 — o menu Notas abre Turmas → Disciplinas → Estudantes.
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
//
// Chamada 20 (16/10/2026): o Mestrão manda no `periodo` as aulas que o diário do
// SIAEP já tem (`lancadas` — CONTRATOS.md §1), e a chamada feita aqui que ainda
// não entrou no diário passa a dizer "Feita · falta lançar" em vez de "✓ Feita".
// Eram dois estados mostrados como um só, e foi assim que 48 colunas do 3º
// período pareceram lançadas quando só estavam preenchidas no celular.
//
// Chamada 21 (16/10/2026): a aba **Notas** — turmas → disciplinas → alunos, com o
// teclado numérico e a nota no lugar do F e do J. A nota é de uma avaliação
// (`turma|disciplina|ordem`), e quem a envia ao SIAEP continua sendo o Mestrão:
// aqui ela só chega à planilha, pela mesma fila da chamada. A aba só aparece
// quando a planilha tem a aba AVALIAÇÕES (CONTRATOS.md §1).
//
// Chamada 22 (19/10/2026): as turmas na ordem do Mestrão — eletiva, 1ª, 2ª e 3ª série.
// Chamada 23 (19/10/2026): Notas identifica os níveis Turmas → Disciplinas → Estudantes.

const VERSAO = "23";
const CHAVES = {
  conexao: "chamada:conexao",
  grade: "chamada:grade",
  conferida: "chamada:conferida",
  fila: "chamada:fila",
  filaNotas: "chamada:fila-notas",
  recusas: "chamada:recusas",
  recibos: "chamada:recibos",
  modo: "mestre:horarios",
  tema: "chamada:tema"
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
let filaNotas = lido(CHAVES.filaNotas, []);
let recusas = lido(CHAVES.recusas, []);
let recibos = lido(CHAVES.recibos, {});
let aberta = null;
let turmaAberta = null;
let turmaDaNota = null;
let disciplinaDaNota = null;
let avaliacaoDaNota = null;
let alunosDaNota = [];
let notaAluno = -1;
let notaDigitada = "";
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

/** Qual aba do menu corresponde à tela: Hoje, Frequência ou Notas. */
function abaDa(tela) {
  if (tela === "hoje") return "hoje";
  return tela.startsWith("nota") ? "notas" : "frequencia";
}

function mostrar(tela) {
  telaAtual = tela;
  document.querySelectorAll(".tela").forEach((el) => el.classList.toggle("ativa", el.id === `tela-${tela}`));
  // A barra de abas some só na chamada (o botão de enviar mora embaixo) e na conexão.
  $("abas").hidden = !["hoje", "turmas", "turma", "notas", "nota-turma", "nota-disciplina"].includes(tela);
  document.querySelectorAll("[data-aba]").forEach((el) => el.classList.toggle("ativa", el.dataset.aba === abaDa(tela)));
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

/**
 * As aulas que o diário do SIAEP já tem, mandadas pelo Mestrão no `periodo`
 * (CONTRATOS.md §1, `lancadas`: `turma|data|horário`).
 *
 * `null` quando a planilha é de antes disso — e aí "feita" continua querendo dizer
 * "lançada", exatamente como sempre foi. É o que deixa a Chamada 20 abrir uma
 * planilha gerada pela 19 sem mentir nem mudar de comportamento.
 */
const lancadas = () => (Array.isArray(grade?.periodo?.lancadas) ? new Set(grade.periodo.lancadas) : null);
const chaveDaLancada = (turma, data, horario) => `${turma}|${data}|${horario}`;

function colunaFeita(coluna) {
  const temAusencia = coluna.marcas.some((m) => m && m !== "0");
  const toda = coluna.marcas.length > 0 && coluna.marcas.every((m) => m !== "");
  return temAusencia || toda;
}

function aulasDa(turma) {
  const jaLancadas = lancadas();
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
      // O diário tem todos os horários desta aula? `null` = a planilha não diz.
      lancada: jaLancadas ? horarios.every((h) => jaLancadas.has(chaveDaLancada(turma.nome, primeira.data, h))) : null,
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

// O nome que o Mestrão mostra ("ADM-200", "Eletiva"), mandado com o período
// (14/10/2026). A chave continua o número do SIAEP: é ele que o carteiro acha.
const nomeDa = (turma) => grade?.periodo?.nomes?.[turma.nome] || turma.nome;

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
// existe aula "atrasada". Pendência é só a que já chegou: datas passadas e a de hoje; a que
// ainda vem não conta (20/10/2026), mas continua aberta para quem quiser adiantar.
const porVir = (aula) => ordenavel(aula.data) > ordenavel(hojeRotulo());
const aPreencher = (aula) => !aula.feita && !aula.travada && !porVir(aula);

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

/** [classe da linha, o que vai à direita] */
function estadoDa(aula, agora = false) {
  const recibo = recibos[aula.chave];
  if (aula.recusada) return ["recusada", `<span class="acao">Abrir</span>`];
  if (aula.naFila) return ["", `<span class="fila">◷ Na fila</span>`];
  if (aula.travada) return ["travada", `<span class="fechada">🔒 Validada</span>`];
  // Feita no celular, e o diário ainda não tem: o terceiro estado (16/10/2026).
  if (aula.feita && aula.lancada === false) return ["sem-cor", `<span class="falta-lancar">Feita ·<br>falta lançar</span>`];
  if (aula.feita) return ["enviada", `<span class="feita">✓ ${recibo ? `Enviada ${horaDe(recibo.conferidaEm)}` : "Feita"}</span>`];
  if (porVir(aula)) return ["por-vir", `<span class="acao">Por vir</span>`];
  return ["", `<span class="acao ${agora ? "agora" : ""}">${agora ? "Fazer agora" : "Fazer"}</span>`];
}

function linhaDaAula(aula, { agora = false, comData = false, hora } = {}) {
  const [estado, lado] = estadoDa(aula, agora);
  const sub = aula.recusada ? escapar(aula.recusada.erro) : escapar(descricao(aula, comData));
  return `
    <button class="linha ${estado}" data-aula="${escapar(aula.chave)}">
      <span class="hora">${escapar(hora ?? aula.inicio ?? "")}</span>
      <span class="meio"><strong>${escapar(nomeDa(aula.turma))}</strong><span>${sub}</span></span>
      ${lado}
    </button>`;
}

/** Faltas e justificadas da aula, como a chamada abre: a 1ª ausência entre os horários. */
function resumoDasMarcas(aula) {
  let faltas = 0;
  let justificadas = 0;
  aula.turma.alunos.forEach((_, i) => {
    const marca = aula.colunas.map((c) => c.marcas[i]).find((m) => m && m !== "0");
    if (marca === "F") faltas++;
    else if (marca) justificadas++;
  });
  return faltas || justificadas
    ? [faltas && `${faltas} F`, justificadas && `${justificadas} J`].filter(Boolean).join(" · ")
    : "todos presentes";
}

/** Uma data na turma, como na v15: número enquanto falta, ✓ verde quando feita, 🔒 quando validada. */
function linhaDaData(aula, n) {
  const hoje = aula.data === hojeRotulo();
  const [estado, lado] = estadoDa(aula, hoje && aPreencher(aula) && !aula.naFila);
  const sinal = aula.travada ? "🔒" : aula.feita && aula.lancada !== false ? "✓" : n;
  const horarios = aula.horarios.length > 1 ? `${aula.horarios.length} horários` : aula.doDia > 1 ? `${aula.horarios[0]}º horário` : "";
  const sub = aula.recusada
    ? aula.recusada.erro
    : [aula.disciplina && capitalizar(aula.disciplina), horarios, (aula.feita || aula.travada) && resumoDasMarcas(aula)].filter(Boolean).join(" · ");
  return `
    <button class="linha ${estado}${hoje ? " hoje" : ""}" data-aula="${escapar(aula.chave)}">
      <span class="sinal">${sinal}</span>
      <span class="meio"><strong>${hoje ? "Hoje" : diaDaSemana(aula.data)} · ${aula.data.slice(0, 5)}${aula.inicio ? ` · ${escapar(aula.inicio)}` : ""}</strong><span>${escapar(sub)}</span></span>
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
  } else if (fila.length || filaNotas.length) {
    chip.classList.add("fila");
    const partes = [
      fila.length && `${fila.length} chamada${fila.length > 1 ? "s" : ""}`,
      filaNotas.length && `${filaNotas.length} nota${filaNotas.length > 1 ? "s" : ""}`
    ].filter(Boolean);
    texto.textContent = `${partes.join(" e ")} aguardando envio${navigator.onLine ? " · toque para enviar" : " · sem internet"}`;
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

  // A faixa do período que ainda tem chamada feita no celular e não lançada no
  // diário (16/10/2026). Quem sabe a conta é o Mestrão — `periodo.anterior`; sem
  // ele, a faixa não existe, como não existia na Chamada 19.
  const anterior = grade?.periodo?.anterior;
  if (anterior?.aLancar > 0) {
    partes.push(`<button class="faixa-anterior" type="button" data-faixa>
      <span>${escapar(anterior.momento)}º período · ${anterior.aLancar} frequência${anterior.aLancar > 1 ? "s" : ""} a lançar no SIAEP<small>Feitas no celular; o Mestrão ainda não lançou</small></span>
      <span>›</span>
    </button>`);
  }

  if (recusas.length) {
    const linhas = recusas.map((item) => {
      const aula = acharAula(item.aula);
      return aula ? linhaDaAula(aula, { comData: true, hora: diaCurto(aula.data) }) : "";
    }).join("");
    if (linhas) partes.push(`<h2 class="titulo-secao recusa"><i></i>Não entrou</h2><div class="lista">${linhas}</div>`);
  }

  // Só o dia. O período inteiro mora na aba Turmas.
  const hoje = aulasDeHoje();
  const agora = hoje.find((aula) => !aula.feita && !aula.travada && !aula.naFila && !aula.recusada);
  if (hoje.length) {
    partes.push(`<h2 class="titulo-secao"><i></i>Aulas de hoje · ${hoje.length}</h2>`);
    partes.push(`<div class="lista">${hoje.map((aula) => linhaDaAula(aula, { agora: aula === agora })).join("")}</div>`);
  } else if (!grade) {
    partes.push(`<div class="lista"><p class="vazio">Buscando a planilha…</p></div>`);
  } else if (!grade.turmas?.length) {
    partes.push(`<div class="lista"><p class="vazio">A planilha ainda não tem turmas. Gere a planilha no Mestrão.</p></div>`);
  } else {
    partes.push(`<div class="cartao folga"><b>Hoje não tem aula.</b><span>As chamadas do período estão na aba Turmas.</span></div>`);
  }

  $("hoje-conteudo").innerHTML = partes.join("");
}

// As turmas na ordem do Mestrão: eletiva, 1ª, 2ª, 3ª série (pedido dele em 19/10/2026).
// A série sai do número do SIAEP ("26PMI-ADM-200" → 2).
// ponytail: turma sem "-N00" no número vai antes — hoje só a eletiva é assim; se aparecer
// outra, o Mestrão passa a mandar a série no `periodo`.
const posicaoDaSerie = (turma) => Number(/-([1-4])\d\d$/.exec(turma.nome)?.[1] ?? 0);
const emOrdemDeSerie = (turmas) =>
  [...turmas].sort((a, b) => posicaoDaSerie(a) - posicaoDaSerie(b) || a.nome.localeCompare(b.nome, "pt-BR"));

/** Um cartão por turma, como na v15: verde quando tudo está preenchido, contorno azul se a de hoje falta. */
function desenharTurmas() {
  const turmas = emOrdemDeSerie(grade?.turmas ?? []);
  const momento = grade?.periodo?.momento;
  $("turmas-periodo").textContent = [momento && `${momento}º período`, turmas.length && `${turmas.length} turmas`].filter(Boolean).join(" · ");
  if (!turmas.length) {
    $("turmas-conteudo").innerHTML = `<div class="lista" style="margin-top:16px"><p class="vazio">${grade
      ? "A planilha ainda não tem turmas. Gere a planilha no Mestrão."
      : "Buscando a planilha…"}</p></div>`;
    return;
  }
  const hoje = hojeRotulo();
  $("turmas-conteudo").innerHTML = `<div class="cartoes">${turmas.map((turma) => {
    const aulas = aulasDa(turma);
    const falta = aulas.filter(aPreencher).length;
    // Feitas no celular que o diário ainda não tem: contam como pendência, e o
    // cartão não pode dizer "Todas preenchidas" (16/10/2026).
    const lancar = aulas.filter((aula) => aula.feita && aula.lancada === false).length;
    const deHoje = aulas.some((aula) => aula.data === hoje && aPreencher(aula));
    const disciplinas = [...new Set(turma.aulas.map((c) => c.disciplina).filter(Boolean))].map(capitalizar);
    const situacao = !falta && !lancar
      ? `<em class="ok">✓ Todas preenchidas</em>`
      : deHoje ? `<em class="hoje">Chamada de hoje a fazer</em>` : falta ? `<em>${falta} a preencher</em>` : "";
    const aLancar = lancar ? `<em class="lancar">${lancar} feita${lancar > 1 ? "s" : ""}, falta lançar no SIAEP</em>` : "";
    return `
      <button class="cartao-turma ${falta || lancar ? "" : "completa"} ${deHoje ? "hoje" : ""}" data-turma="${escapar(turma.nome)}">
        <span class="sinal">${falta || lancar || "✓"}</span>
        <span class="meio"><strong>${escapar(nomeDa(turma))}</strong><span>${escapar([...disciplinas, `${turma.alunos.length} alunos`].join(" · "))}</span>${situacao}${aLancar}</span>
        <span class="seta">›</span>
      </button>`;
  }).join("")}</div>`;
}

function abrirTurmas() {
  turmaAberta = null;
  desenharTurmas();
  mostrar("turmas");
}

function abrirTurma(nome) {
  const turma = grade?.turmas.find((t) => t.nome === nome);
  if (!turma) return;
  turmaAberta = nome;
  const aulas = aulasDa(turma);
  $("turma-nome").textContent = nomeDa(turma);
  const falta = aulas.filter(aPreencher).length;
  const lancar = aulas.filter((aula) => aula.feita && aula.lancada === false).length;
  const quantasAulas = `${aulas.length} aula${aulas.length > 1 ? "s" : ""}`;
  $("turma-resumo").textContent = [
    `${turma.alunos.length} alunos`,
    falta ? `${falta} de ${quantasAulas} a preencher` : lancar ? quantasAulas : `${quantasAulas}, todas preenchidas`,
    lancar ? `${lancar} feita${lancar > 1 ? "s" : ""}, falta lançar no SIAEP` : ""
  ].filter(Boolean).join(" · ");
  $("turma-aulas").innerHTML = `<div class="lista" style="margin-top:14px">${aulas.map((aula, i) => linhaDaData(aula, i + 1)).join("")}</div>`;
  mostrar("turma");
  // Abre em hoje; sem aula hoje, na primeira que falta preencher.
  (document.querySelector("#turma-aulas .hoje") ?? document.querySelector("#turma-aulas .linha:not(.enviada):not(.travada)"))
    ?.scrollIntoView({ block: "center" });
}

function redesenhar() {
  if (telaAtual === "hoje") desenharHoje();
  if (telaAtual === "turmas") desenharTurmas();
  if (telaAtual === "notas") desenharNotas();
  if (telaAtual === "nota-turma" && turmaDaNota) desenharNotaTurma();
  if (telaAtual === "nota-disciplina" && disciplinaDaNota) {
    // A busca de fundo não pode tirar a lista do lugar onde ele está.
    const onde = window.scrollY;
    desenharNotaDisciplina();
    window.scrollTo(0, onde);
  }
  if (telaAtual === "turma" && turmaAberta) {
    // A busca de fundo não pode tirar a lista do lugar onde ele está.
    const onde = window.scrollY;
    abrirTurma(turmaAberta);
    window.scrollTo(0, onde);
  }
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
  // Validada pelo GAF: abre só para ver quem faltou e por quê.
  const soVer = aula.travada;
  // As colunas que o GAF fechou ficam de fora da escrita e da comparação.
  const abertas = soVer ? aula.colunas : aula.colunas.filter((c) => !c.travada);
  // O rascunho guarda só quem ele tocou: o resto vem da planilha, para uma
  // mudança que chegou por lá não ser coberta por um "presente" que ele nem marcou.
  const rascunho = soVer ? {} : lido(chaveDoRascunho(aula), {});
  aberta = {
    aula,
    abertas,
    soVer,
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
      // Ordem alfabética, o padrão (14/10/2026): a planilha antiga traz quem se
      // matriculou depois no fim. A chamada vai por nome, não por posição.
      .sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"))
  };

  const quando = aula.data === hojeRotulo() ? "Hoje" : diaDaSemana(aula.data);
  $("chamada-quando").textContent = [quando, aula.data.slice(0, 5), aula.inicio, aula.disciplina && capitalizar(aula.disciplina),
    aula.horarios.length > 1 && `${aula.horarios.length} horários`]
    .filter(Boolean).join(" · ");
  $("chamada-turma").textContent = nomeDa(aula.turma);
  const fechados = aula.colunas.filter((c) => c.travada).map((c) => `${c.horario}º`);
  const aviso = $("chamada-aviso");
  aviso.hidden = !(fechados.length || aula.feita);
  aviso.textContent = soVer
    ? "Validada pelo GAF: o SIAEP não aceita mais alteração. Só para ver."
    : fechados.length
      ? `O ${fechados.join(" e ")} horário já foi validado pelo GAF e fica como está.`
      : "Esta chamada já está na planilha. Corrija o que precisar e envie de novo.";
  $("btn-enviar").textContent = aula.feita ? "Enviar correção" : "Enviar chamada";
  $("btn-enviar").disabled = false;
  $("btn-enviar").hidden = soVer;
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
        <button class="bt bt-f" data-falta="${i}" aria-label="Falta de ${escapar(aluno.nome)}" ${aberta.soVer ? "disabled" : ""}>F</button>
        <button class="bt bt-j" data-justificar="${i}" aria-label="Justificar ${escapar(aluno.nome)}" ${aberta.soVer ? "disabled" : ""}>${just ? escapar(aluno.marca) : "J"}</button>
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
      redesenhar();
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
    redesenhar();
  });
  return esvaziando;
}

// ── A fila das notas ────────────────────────────────────────────────────────
//
// A mesma regra da chamada: a nota entra no aparelho antes de sair e só sai da
// fila quando a planilha responde. O que a planilha recusar volta ao que ela tem.

let esvaziandoNotas = null;

/** Uma nota da fila. Devolve o que aconteceu; a nota só sai quando o carteiro responde. */
async function enviarNota(item) {
  let resposta;
  try {
    resposta = await pedir("nota", { nota: { chave: item.chave, aluno: item.aluno, valor: item.valor } });
  } catch (erro) {
    avisar("Guardada no celular: " + erro.message + " A nota de " + item.aluno + " vai sozinha depois.");
    return;
  }
  filaNotas = filaNotas.filter((i) => i.id !== item.id);
  guardar(CHAVES.filaNotas, filaNotas);
  if (!resposta.ok) {
    // Não entrou: a tela volta ao que a planilha tinha, para não mostrar nota que não existe.
    const avaliacao = alvoDaNota(item.chave);
    if (avaliacao) {
      avaliacao.notas = { ...(avaliacao.notas ?? {}) };
      if (item.antes) avaliacao.notas[item.aluno] = item.antes;
      else delete avaliacao.notas[item.aluno];
      guardar(CHAVES.grade, grade);
    }
    avisar(resposta.erro);
    if (telaAtual === "nota-disciplina") desenharNotaAlunos();
    desenharChip();
    return;
  }
  avisar("Nota de " + item.aluno + " salva para o Mestrão.");
  desenharChip();
}

function esvaziarFilaDeNotas() {
  if (!conexao || !filaNotas.length) return Promise.resolve();
  esvaziandoNotas ??= (async () => {
    for (const item of [...filaNotas]) await enviarNota(item);
  })().finally(() => {
    esvaziandoNotas = null;
    desenharChip();
  });
  return esvaziandoNotas;
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
  const quando = `${nomeDa(aula.turma)} · ${aula.data.slice(0, 5)}${aula.inicio ? ` · ${aula.inicio}` : ""}`;
  const volta = turmaAberta ? "Voltar para a turma" : "Voltar para Hoje";
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
      ${proxima ? `<button class="btn pri" type="button" data-proxima="${escapar(proxima.chave)}">Próxima: ${escapar(nomeDa(proxima.turma))}${proxima.data === hojeRotulo() && proxima.inicio ? ` · ${escapar(proxima.inicio)}` : ` · ${escapar(diaCurto(proxima.data))}`}</button>` : ""}
      <button class="btn ${proxima ? "sec" : "pri"}" value="voltar">${volta}</button>`;
  } else if (resultado.tipo === "espera") {
    html = `
      <div class="selo espera">◷</div>
      <h3>Guardada no celular</h3>
      <p>${escapar(resultado.erro)} A chamada de ${escapar(quando)} vai sozinha quando a planilha responder.</p>
      <button class="btn pri" type="button" data-tentar>Tentar agora</button>
      <button class="btn sec" value="voltar">${volta}</button>`;
  } else {
    html = `
      <div class="selo recusa">!</div>
      <h3>Não entrou na planilha</h3>
      <p>${escapar(resultado.erro)}</p>
      <p>Suas marcas continuam guardadas nesta chamada.</p>
      <button class="btn pri" type="button" data-recarregar="${escapar(aula.chave)}">Buscar a planilha e abrir de novo</button>
      <button class="btn sec" value="voltar">${volta}</button>`;
  }
  $("envio-conteudo").innerHTML = html;
  $("folha-envio").returnValue = "";
  $("folha-envio").showModal();
}

// ── Notas (16/10/2026) ──────────────────────────────────────────────────────
//
// Turmas → disciplinas → alunos, como ele pediu, no mesmo desenho da Frequência:
// os mesmos cartões, as mesmas linhas, as mesmas contas no cabeçalho. A nota é de
// uma avaliação (`turma|disciplina|ordem`, CONTRATOS.md §1), e ela se escolhe no
// alto da disciplina. **Guardar não envia ao SIAEP**: o Mestrão lê a planilha e
// lança, com conferência.

// O que aparece (20/10/2026): a avaliação com nome, data e instrumento; a linha só de
// recuperação, como "Recuperação", e só com nota registrada; nada da disciplina sem nota
// (`periodo.semNota`, do Mestrão). Rascunho vazio não conta nem aparece.
const semNotaNoMestrao = (turma, disciplina) => (grade?.periodo?.semNota ?? []).includes(`${turma}|${disciplina}`);
const pronta = (a) => Boolean(a.nome && a.data && a.instrumento);
const soRecuperacao = (a) => !pronta(a) && Boolean(a.recuperacao);
const temNota = (a) => Object.values(a.notas ?? {}).some((nota) => String(nota).trim());
const aparece = (a) => !semNotaNoMestrao(a.turma, a.disciplina) && (pronta(a) || (soRecuperacao(a) && temNota(a)));
const avaliacoesDoPeriodo = () => (grade?.avaliacoes ?? []).filter(aparece);
/** A turma em que toda disciplina é sem nota (a eletiva) não aparece em Notas. */
const turmaSemNota = (turma) => {
  const disciplinas = [...new Set((turma.aulas ?? []).map((c) => c.disciplina).filter(Boolean))];
  return disciplinas.length > 0 && disciplinas.every((d) => semNotaNoMestrao(turma.nome, d));
};
const avaliacoesDaTurma = (nome) => avaliacoesDoPeriodo().filter((a) => a.turma === nome);
// `noDiario` (NO DIÁRIO = SIM) diz que a **avaliação** existe no SIAEP — não que as notas
// entraram (20/10/2026: tudo aparecia "lançado" sem nota nenhuma). É a avaliação no SIAEP que
// deixa o Mestrão lançar a nota, então ela nunca tranca o campo. A régua daqui é a nota digitada.
const alunosDaTurma = (nome) => grade?.turmas.find((t) => t.nome === nome)?.alunos ?? [];
const semNota = (a) => alunosDaTurma(a.turma).filter((aluno) => !a.notas?.[aluno]).length;
const faltaLancar = (a) => semNota(a) > 0;
// A recuperação da avaliação (20/10/2026): depois de guardada alguma nota, se alguém ficou
// abaixo de 6 ou sem nota, aparece a "Rec" ao lado dela, só com esses estudantes. A nota vai
// com a chave "<avaliação>|rec", a mesma de `chaveDaRecuperacao` no Mestre.Core.
const abaixoDe6 = (nota) => !String(nota ?? "").trim() || Number(String(nota).replace(",", ".")) < 6;
const precisaRec = (a) => pronta(a) && temNota(a) && alunosDaTurma(a.turma).some((aluno) => abaixoDe6(a.notas?.[aluno]));
const vistaRec = (a) => ({
  chave: `${a.chave}|rec`, turma: a.turma, disciplina: a.disciplina, ordem: a.ordem, base: a, rec: true,
  nome: `Recuperação · ${a.nome}`, data: a.recuperacao, instrumento: "", noDiario: Boolean(a.recuperacao),
  get notas() { return a.notasRec ?? {}; },
  set notas(valor) { a.notasRec = valor; }
});
/** A avaliação (ou a recuperação dela) pela chave da nota. */
function alvoDaNota(chave) {
  const base = String(chave).replace(/\|rec$/, "");
  const avaliacao = avaliacoesDoPeriodo().find((a) => a.chave === base);
  return avaliacao && base !== chave ? vistaRec(avaliacao) : avaliacao;
}
const rotuloDaAvaliacao = (a) => soRecuperacao(a) ? "Recuperação" : a.nome || `${a.ordem}ª avaliação`;
const plural = (n, um, muitos) => `${n} ${n > 1 ? muitos : um}`;

/** As disciplinas da turma, cada uma com as avaliações dela na ordem do período. */
function disciplinasDaTurma(nome) {
  const porDisciplina = new Map();
  for (const avaliacao of avaliacoesDaTurma(nome)) {
    if (!porDisciplina.has(avaliacao.disciplina)) porDisciplina.set(avaliacao.disciplina, []);
    porDisciplina.get(avaliacao.disciplina).push(avaliacao);
  }
  return [...porDisciplina.entries()].map(([disciplina, lista]) => ({
    disciplina,
    lista: lista.slice().sort((a, b) => a.ordem - b.ordem)
  }));
}

/** Notas · turmas: o menu fica acessível mesmo antes de o Mestrão criar avaliações. */
function desenharNotas() {
  const turmas = emOrdemDeSerie(grade?.turmas ?? []).filter((turma) => !turmaSemNota(turma));
  $("notas-periodo").textContent = [grade?.periodo?.momento && `${grade.periodo.momento}º período`, turmas.length && `${turmas.length} turmas`].filter(Boolean).join(" · ");
  if (!avaliacoesDoPeriodo().length) {
    $("notas-conteudo").innerHTML = `<div class="lista" style="margin-top:16px"><p class="vazio">A planilha ainda não tem avaliações — quem gera é o Mestrão.</p></div>`;
    return;
  }
  $("notas-conteudo").innerHTML = `<div class="cartoes">${turmas.map((turma) => {
    const lista = avaliacoesDaTurma(turma.nome);
    const lancar = lista.filter(faltaLancar).length;
    const foraDoSiaep = lista.filter((a) => !a.noDiario).length;
    const disciplinas = [...new Set(lista.map((a) => a.disciplina))].map(capitalizar);
    const situacao = !lista.length
      ? `<em>Avaliações ainda não lançadas</em>`
      : [
        lancar ? `<em>${plural(lancar, "avaliação com notas a lançar", "avaliações com notas a lançar")}</em>` : `<em class="ok">✓ Notas completas</em>`,
        foraDoSiaep ? `<em>${plural(foraDoSiaep, "avaliação fora do SIAEP", "avaliações fora do SIAEP")}</em>` : ""
      ].join("");
    return `
      <button class="cartao-turma ${lista.length && !lancar ? "completa" : ""}" data-nota-turma="${escapar(turma.nome)}">
        <span class="sinal">${!lista.length ? "—" : lancar || "✓"}</span>
        <span class="meio"><strong>${escapar(nomeDa(turma))}</strong><span>${escapar([...disciplinas, `${turma.alunos.length} alunos`].join(" · "))}</span>${situacao}</span>
        <span class="seta">›</span>
      </button>`;
  }).join("")}</div>`;
}

function abrirNotas() {
  turmaDaNota = null;
  disciplinaDaNota = null;
  avaliacaoDaNota = null;
  desenharNotas();
  mostrar("notas");
}

/** Notas · disciplinas: a turma aberta, uma linha por disciplina. */
function abrirNotaTurma(nome) {
  const turma = grade?.turmas.find((t) => t.nome === nome);
  if (!turma) return;
  turmaDaNota = nome;
  disciplinaDaNota = null;
  avaliacaoDaNota = null;
  desenharNotaTurma();
  mostrar("nota-turma");
}

function desenharNotaTurma() {
  const turma = grade?.turmas.find((t) => t.nome === turmaDaNota);
  if (!turma) return;
  const lista = avaliacoesDaTurma(turmaDaNota);
  const lancar = lista.filter(faltaLancar).length;
  $("nota-turma-nome").textContent = nomeDa(turma);
  $("nota-turma-resumo").textContent = [
    `${turma.alunos.length} alunos`,
    plural(lista.length, "avaliação", "avaliações"),
    !lista.length ? "avaliações ainda não lançadas" : lancar ? `${lancar} com notas a lançar` : "notas completas"
  ].join(" · ");
  if (!lista.length) {
    $("nota-disciplinas").innerHTML = `<div class="lista" style="margin-top:16px"><p class="vazio">As avaliações desta turma ainda não foram lançadas — lance no Mestrão, em Avaliações, e gere a planilha de novo.</p></div>`;
    return;
  }
  $("nota-disciplinas").innerHTML = `<h2 class="titulo-secao">Disciplinas</h2><div class="lista" style="margin-top:14px">${disciplinasDaTurma(turmaDaNota).map(({ disciplina, lista: daDisciplina }) => {
    const falta = daDisciplina.filter(faltaLancar).length;
    const instrumentos = [...new Set(daDisciplina.map((a) => a.instrumento).filter(Boolean))].map(capitalizar);
    return `
      <button class="linha" data-nota-disciplina="${escapar(disciplina)}">
        <span class="sinal">${falta || "✓"}</span>
        <span class="meio"><strong>${escapar(capitalizar(disciplina))}</strong><span>${escapar([plural(daDisciplina.length, "avaliação", "avaliações"), instrumentos.join(", ")].filter(Boolean).join(" · "))}</span></span>
        <span class="acao">${falta ? "Lançar" : "Ver"}</span>
      </button>`;
  }).join("")}</div>`;
}

/** Notas · alunos: a avaliação no alto, os alunos embaixo, a nota no lugar do F/J. */
function abrirNotaDisciplina(disciplina) {
  disciplinaDaNota = disciplina;
  const grupo = disciplinasDaTurma(turmaDaNota).find((d) => d.disciplina === disciplina);
  if (!grupo) return;
  if (!avaliacaoDaNota || !grupo.lista.some((a) => a.chave === (avaliacaoDaNota.base ?? avaliacaoDaNota).chave)) {
    avaliacaoDaNota = grupo.lista[0];
  }
  desenharNotaDisciplina();
  mostrar("nota-disciplina");
}

function desenharNotaDisciplina() {
  const grupo = disciplinasDaTurma(turmaDaNota).find((d) => d.disciplina === disciplinaDaNota);
  const turma = grade?.turmas.find((t) => t.nome === turmaDaNota);
  if (!grupo || !turma || !avaliacaoDaNota) return;
  $("nota-turma-titulo").textContent = nomeDa(turma);
  $("nota-avaliacao").textContent = [
    capitalizar(disciplinaDaNota),
    rotuloDaAvaliacao(avaliacaoDaNota),
    avaliacaoDaNota.data,
    avaliacaoDaNota.instrumento && capitalizar(avaliacaoDaNota.instrumento)
  ].filter(Boolean).join(" · ");
  const botao = (chave, rotulo) => `
    <button type="button" class="${chave === avaliacaoDaNota.chave ? "ativa" : ""}" data-escolher-avaliacao="${escapar(chave)}">${rotulo}</button>`;
  $("nota-avaliacoes").innerHTML = grupo.lista.map((a) => {
    const rotulo = soRecuperacao(a) ? "Rec" : `${grupo.lista.filter(pronta).indexOf(a) + 1}ª`;
    return botao(a.chave, rotulo + (faltaLancar(a) ? "" : " ✓")) + (precisaRec(a) ? botao(`${a.chave}|rec`, `Rec ${rotulo}`) : "");
  }).join("");
  const foraDoSiaep = !avaliacaoDaNota.noDiario;
  const aviso = $("nota-aviso");
  aviso.hidden = !foraDoSiaep;
  aviso.textContent = !foraDoSiaep ? ""
    : avaliacaoDaNota.rec
      ? "A recuperação desta avaliação ainda não está no SIAEP. A nota fica guardada na planilha, e o Mestrão lança depois que ela entrar no diário."
      : "Esta avaliação ainda não está no SIAEP. A nota fica guardada na planilha, e o Mestrão lança depois que a avaliação entrar no diário.";
  desenharNotaAlunos();
}

function desenharNotaAlunos() {
  const notas = avaliacaoDaNota?.notas ?? {};
  // Na recuperação, só quem ficou abaixo de 6 ou sem nota — e quem já tem nota nela.
  alunosDaNota = (grade?.turmas.find((t) => t.nome === turmaDaNota)?.alunos ?? [])
    .filter((aluno) => !avaliacaoDaNota?.rec || abaixoDe6(avaliacaoDaNota.base.notas?.[aluno]) || notas[aluno])
    .sort((a, b) => a.localeCompare(b, "pt-BR"));
  $("nota-alunos").innerHTML = alunosDaNota.map((nome, i) => {
    const valor = notas[nome] ?? "";
    return `
      <div class="aluno">
        <span class="n">${i + 1}</span>
        <span class="nome">${escapar(nome)}</span>
        <button class="bt nota ${valor ? "" : "vazia"}" data-nota="${i}" aria-label="Nota de ${escapar(nome)}">${valor ? escapar(valor) : "—"}</button>
      </div>`;
  }).join("");
  const comNota = alunosDaNota.filter((nome) => notas[nome]).length;
  const valores = alunosDaNota
    .map((nome) => notas[nome])
    .filter(Boolean)
    .map((valor) => Number(String(valor).replace(",", ".")))
    .filter((numero) => !Number.isNaN(numero));
  $("nota-com").textContent = comNota;
  $("nota-sem").textContent = alunosDaNota.length - comNota;
  $("nota-media").textContent = valores.length
    ? (valores.reduce((soma, numero) => soma + numero, 0) / valores.length).toFixed(1).replace(".", ",")
    : "—";
}

// ── O teclado da nota ───────────────────────────────────────────────────────

function abrirTeclado(indice) {
  const nome = alunosDaNota[indice];
  if (!nome || !avaliacaoDaNota) return;
  notaAluno = indice;
  notaDigitada = avaliacaoDaNota.notas?.[nome] ?? "";
  $("nota-aluno").textContent = nome;
  $("nota-visor").textContent = notaDigitada || "—";
  $("folha-nota").showModal();
}

function digitar(digito) {
  if (notaDigitada.length >= 5) return;
  if (digito === "," && notaDigitada.includes(",")) return;
  if (digito === "," && !notaDigitada) notaDigitada = "0";
  notaDigitada += digito;
  $("nota-visor").textContent = notaDigitada;
}

function apagarDigito() {
  notaDigitada = notaDigitada.slice(0, -1);
  $("nota-visor").textContent = notaDigitada || "—";
}

/** Guardar põe a nota na fila do aparelho, como a chamada — e não envia ao SIAEP. */
function guardarNota() {
  const nome = alunosDaNota[notaAluno];
  if (!nome || !avaliacaoDaNota) return;
  const valor = notaDigitada.trim();
  const numero = valor.replace(",", ".");
  if (valor !== "" && (!/^\d{1,2}(\.\d{1,2})?$/.test(numero) || Number(numero) > 10)) {
    avisar("Nota inválida: use 0 a 10, com até duas casas — 8, 8,5 ou 8,75.");
    return;
  }
  const antes = avaliacaoDaNota.notas?.[nome] ?? "";
  const item = { id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, chave: avaliacaoDaNota.chave, aluno: nome, valor, antes };
  filaNotas = [...filaNotas.filter((i) => !(i.chave === item.chave && i.aluno === item.aluno)), item];
  guardar(CHAVES.filaNotas, filaNotas);
  // A tela mostra o que ele digitou; a planilha confirma — ou devolve — depois.
  avaliacaoDaNota.notas = { ...(avaliacaoDaNota.notas ?? {}), [nome]: valor };
  guardar(CHAVES.grade, grade);
  $("folha-nota").close();
  // A faixa também: a nota guardada pode acender a "Rec" da avaliação.
  if (telaAtual === "nota-disciplina") desenharNotaDisciplina();
  desenharChip();
  esvaziarFilaDeNotas();
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
  if (alvo.dataset.aba) {
    if (alvo.dataset.aba === "hoje") voltarParaHoje();
    else if (alvo.dataset.aba === "notas") abrirNotas();
    else abrirTurmas();
  } else if (alvo.hasAttribute("data-faixa")) abrirTurmas();
  else if (alvo.dataset.aula) abrirChamada(alvo.dataset.aula);
  else if (alvo.dataset.turma) abrirTurma(alvo.dataset.turma);
  else if (alvo.dataset.notaTurma) abrirNotaTurma(alvo.dataset.notaTurma);
  else if (alvo.dataset.notaDisciplina) abrirNotaDisciplina(alvo.dataset.notaDisciplina);
  else if (alvo.dataset.escolherAvaliacao) {
    const escolhida = alvoDaNota(alvo.dataset.escolherAvaliacao);
    if (escolhida) {
      avaliacaoDaNota = escolhida;
      desenharNotaDisciplina();
    }
  } else if (alvo.dataset.nota !== undefined) abrirTeclado(Number(alvo.dataset.nota));
  else if (alvo.dataset.digito) digitar(alvo.dataset.digito);
  else if (alvo.hasAttribute("data-apagar")) apagarDigito();
  else if (alvo.hasAttribute("data-limpar")) {
    notaDigitada = "";
    $("nota-visor").textContent = "—";
  } else if (alvo.hasAttribute("data-guardar-nota")) guardarNota();
  else if (alvo.dataset.falta) marcar(Number(alvo.dataset.falta), "F");
  else if (alvo.dataset.justificar) abrirMotivos(Number(alvo.dataset.justificar));
  else if (alvo.dataset.motivo) {
    const aluno = aberta.alunos[alunoDoMotivo];
    if (aluno.marca !== alvo.dataset.motivo) marcar(alunoDoMotivo, alvo.dataset.motivo);
    $("folha-motivo").close();
  } else if (alvo.hasAttribute("data-voltar")) voltar();
  else if (alvo.dataset.proxima) {
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

// A versão de Ajustes sai do ?v= do próprio app.js: escrita à mão, ficou em "Chamada 23" até a 27.
const versaoDoApp = document.currentScript && new URL(document.currentScript.src).searchParams.get("v");
if (versaoDoApp) document.querySelector(".versao")?.replaceChildren(`Chamada ${versaoDoApp}`);

/** O ‹ do alto e o arrastar da borda esquerda fazem o mesmo caminho. */
function voltar() {
  if (telaAtual === "chamada" && turmaAberta) abrirTurma(turmaAberta);
  else if (telaAtual === "nota-disciplina") abrirNotaTurma(turmaDaNota);
  else if (telaAtual === "nota-turma") abrirNotas();
  else if (telaAtual === "turma") abrirTurmas();
  else voltarParaHoje();
}

// Arrastar da borda esquerda para a direita volta, como no iPhone (20/10/2026). Só nas
// telas que têm o ‹, e nunca com uma folha aberta (teclado da nota, motivo, envio).
const TELAS_COM_VOLTAR = new Set(["turma", "chamada", "nota-turma", "nota-disciplina"]);
let arrasto = null;
document.addEventListener("touchstart", (evento) => {
  const toque = evento.touches[0];
  arrasto = evento.touches.length === 1 && toque.clientX < 30 && TELAS_COM_VOLTAR.has(telaAtual) &&
    !document.querySelector("dialog[open]") ? { x: toque.clientX, y: toque.clientY } : null;
}, { passive: true });
document.addEventListener("touchend", (evento) => {
  const toque = evento.changedTouches[0];
  if (!arrasto || !toque) return;
  const dx = toque.clientX - arrasto.x;
  const dy = Math.abs(toque.clientY - arrasto.y);
  arrasto = null;
  if (dx > 70 && dy < dx / 2) voltar();
}, { passive: true });

function voltarParaHoje() {
  turmaAberta = null;
  desenharHoje();
  mostrar("hoje");
}

$("folha-envio").addEventListener("close", () => {
  if ($("folha-envio").returnValue !== "voltar") return;
  if (turmaAberta) abrirTurma(turmaAberta);
  else voltarParaHoje();
});

$("chip").addEventListener("click", () => {
  if (recusas.length) {
    const aula = acharAula(recusas[0].aula);
    if (aula) abrirChamada(aula.chave);
    return;
  }
  esvaziarFila();
  esvaziarFilaDeNotas();
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
  // Sem escolha guardada, o G2 (index.html põe o tema antes do primeiro desenho).
  const tema = document.documentElement.dataset.tema || "g2";
  document.querySelectorAll('input[name="tema"]').forEach((el) => {
    el.checked = el.value === tema;
  });
  $("folha-ajustes").showModal();
});
document.querySelectorAll('input[name="modo"]').forEach((el) => {
  el.addEventListener("change", () => {
    guardar(CHAVES.modo, el.value);
    redesenhar();
  });
});
document.querySelectorAll('input[name="tema"]').forEach((el) => {
  el.addEventListener("change", () => {
    document.documentElement.dataset.tema = el.value;
    guardar(CHAVES.tema, el.value);
  });
});
$("btn-atualizar").addEventListener("click", () => {
  $("folha-ajustes").close();
  esvaziarFila();
  esvaziarFilaDeNotas();
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
  esvaziarFilaDeNotas();
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
  // Versão nova assumiu: recarrega já nesta abertura, para não ficar uma volta
  // na versão velha. Nunca no meio de uma chamada ou do código de conexão.
  const tinhaVersao = Boolean(navigator.serviceWorker.controller);
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (tinhaVersao && telaAtual !== "chamada" && telaAtual !== "conectar") location.reload();
  });
  navigator.serviceWorker.register(`sw.js?v=${VERSAO}`).catch(() => {});
}

if (conexao) {
  desenharHoje();
  mostrar("hoje");
  sincronizar();
} else {
  mostrar("conectar");
}
