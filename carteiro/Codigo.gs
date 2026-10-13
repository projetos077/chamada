// Carteiro da Chamada — o ponto de encontro entre o Mestrão e o celular.
//
// Mora dentro da Planilha Google do professor (Extensões → Apps Script) e é
// publicado como App da Web. Os dois lados mandam um POST com JSON e a chave:
//
//   Mestrão → {acao: "gerar", abas, periodo}   grava a planilha do período
//   Mestrão → {acao: "ler", desde}             a aba FREQÊNCIA em linhas
//   celular → {acao: "grade"}                  turmas, alunos, aulas e marcas
//   celular → {acao: "chamada", chamada}       grava só as células daquela aula
//
// Substitui o caminho antigo (celular → API do Drive → XLSX inteiro → Drive
// para desktop → Mestrão): o celular manda poucos KB, a trava do script faz as
// gravações esperarem a vez, e a resposta só sai depois de reler o que gravou.
//
// O formato das linhas é o do CONTRATOS.md §1 (Mestrao/referencia): cabeçalho
// `INT | TURMA: - <turma> | NOME | TOTAL | datas…`, uma coluna por horário,
// alunos embaixo, e as linhas sem nome que só o celular lê — `GAF` (aula
// validada, não aceita chamada) e `AULA` (início e disciplina de cada coluna).

const NOMES_DA_ABA = ["FREQÊNCIA", "FREQUÊNCIA", "FREQUENCIA"];
const MARCAS = ["0", "F", "I", "A", "E", "G", "S", "T", "U", "O", "P"];

function doPost(e) {
  let pedido;
  try {
    pedido = JSON.parse(e.postData.contents);
  } catch (erro) {
    return responder({ ok: false, erro: "Pedido ilegível." });
  }
  if (!chaveConfere(pedido.chave)) {
    return responder({ ok: false, erro: "Código de conexão errado. Copie de novo o código da planilha." });
  }

  const escreve = pedido.acao === "gerar" || pedido.acao === "chamada";
  const trava = LockService.getScriptLock();
  if (escreve && !trava.tryLock(25000)) {
    return responder({ ok: false, erro: "A planilha está ocupada com outra gravação. Tente de novo." });
  }
  try {
    const livro = SpreadsheetApp.getActive();
    if (pedido.acao === "ler") return responder(ler(livro, pedido.desde));
    if (pedido.acao === "grade") return responder(grade(livro));
    if (pedido.acao === "chamada") return responder(gravarChamada(livro, pedido.chamada));
    if (pedido.acao === "gerar") return responder(gerar(livro, pedido.abas, pedido.periodo));
    return responder({ ok: false, erro: `Ação desconhecida: ${pedido.acao}` });
  } catch (erro) {
    return responder({ ok: false, erro: String((erro && erro.message) || erro) });
  } finally {
    if (escreve) trava.releaseLock();
  }
}

/** Abrir o endereço no navegador só diz se está no ar — sem dado nenhum. */
function doGet() {
  return ContentService.createTextOutput("Carteiro da Chamada no ar.");
}

/** Edição à mão na planilha também conta como versão nova para o Mestrão. */
function onEdit() {
  novaVersao();
}

function onOpen() {
  SpreadsheetApp.getUi().createMenu("Mestrão").addItem("Código de conexão", "mostrarCodigo").addToUi();
}

// ── A chave ─────────────────────────────────────────────────────────────────
//
// O App da Web roda "como eu" e aceita qualquer pessoa — é o que dispensa o
// login de 1 hora no celular. Quem guarda a porta é a chave: nasce aleatória,
// fica nas propriedades do script, e só quem abre esta planilha a vê.

function chave() {
  const props = PropertiesService.getScriptProperties();
  let valor = props.getProperty("CHAVE");
  if (!valor) {
    valor = Utilities.getUuid().replace(/-/g, "") + Utilities.getUuid().replace(/-/g, "");
    props.setProperty("CHAVE", valor);
  }
  return valor;
}

function chaveConfere(recebida) {
  return typeof recebida === "string" && recebida.length >= 32 && recebida === chave();
}

/**
 * Mostra o código que o Mestrão e o celular colam: `<endereço>#<chave>`.
 *
 * O endereço `/exec` vem da janela de implantação. `ScriptApp.getService()`
 * devolve o `/dev` quando chamado daqui, e o `/dev` só abre para o dono — por
 * isso ele é pedido uma vez e guardado.
 */
function mostrarCodigo() {
  const ui = SpreadsheetApp.getUi();
  const props = PropertiesService.getScriptProperties();
  let url = props.getProperty("URL") || "";
  if (!/^https:\/\/script\.google\.com\/.+\/exec$/.test(url)) {
    const resposta = ui.prompt(
      "Endereço do App da Web",
      "Cole o endereço que termina em /exec (Implantar → Gerenciar implantações → App da Web).",
      ui.ButtonSet.OK_CANCEL
    );
    if (resposta.getSelectedButton() !== ui.Button.OK) return;
    url = resposta.getResponseText().trim();
    if (!/^https:\/\/script\.google\.com\/.+\/exec$/.test(url)) {
      ui.alert("Esse endereço não termina em /exec. Copie o do App da Web.");
      return;
    }
    props.setProperty("URL", url);
  }
  ui.alert(
    "Código de conexão",
    `${url}#${chave()}\n\nCopie e cole no Mestrão (Configurações) e no celular. Quem tiver este código lê a planilha: não mande para mais ninguém.`,
    ui.ButtonSet.OK
  );
}

// ── As quatro ações ─────────────────────────────────────────────────────────

/** Para o Mestrão: a aba como linhas, no mesmo formato que o Rust lia do XLSX. */
function ler(livro, desde) {
  const versao = versaoAtual();
  if (desde !== undefined && desde !== null && Number(desde) === versao) {
    return { ok: true, versao, mudou: false };
  }
  const aba = acharAba(livro);
  return {
    ok: true,
    versao,
    mudou: true,
    aba: aba ? aba.getName() : null,
    abas_disponiveis: livro.getSheets().map((a) => a.getName()),
    linhas: aba ? linhasDa(livro, aba) : []
  };
}

/** Para o celular: o que ele precisa para desenhar, já mastigado. */
function grade(livro) {
  const aba = acharAba(livro);
  const periodo = PropertiesService.getDocumentProperties().getProperty("PERIODO");
  if (!aba) return { ok: true, versao: versaoAtual(), periodo: periodo ? JSON.parse(periodo) : null, turmas: [] };
  const linhas = linhasDa(livro, aba);
  const turmas = lerTurmas(linhas).map((turma) => ({
    nome: turma.nome,
    alunos: turma.alunos.map((aluno) => aluno.nome),
    aulas: turma.colunas.map((coluna) => ({
      data: coluna.data,
      horario: coluna.horario,
      inicio: coluna.inicio,
      disciplina: coluna.disciplina,
      travada: coluna.travada,
      marcas: turma.alunos.map((aluno) => marcaDe(linhas[aluno.linha][coluna.coluna]))
    }))
  }));
  return { ok: true, versao: versaoAtual(), periodo: periodo ? JSON.parse(periodo) : null, turmas };
}

/**
 * O Mestrão grava a planilha do período.
 *
 * **O que já está na FREQÊNCIA não se apaga.** A chamada feita no celular e
 * ainda não lançada no diário só existe aqui; o Mestrão preenche o que está
 * vazio (o que o SIAEP já tem) e acrescenta datas, alunos e aulas fechadas.
 * Marca de uma data que saiu do período é descartada — e contada.
 */
function gerar(livro, abas, periodo) {
  if (!Array.isArray(abas) || !abas.length) throw new Error("Nada para gravar.");
  const frequencia = abas.find((aba) => ehAbaDeFrequencia(aba.nome));
  if (!frequencia) throw new Error("A aba FREQÊNCIA não veio do Mestrão.");

  const antiga = acharAba(livro);
  const anteriores = antiga ? marcasPorChave(linhasDa(livro, antiga)) : new Map();
  const { linhas, mantidas, usadas } = manterMarcas(frequencia.linhas, anteriores);

  abas.forEach((aba) => {
    escreverAba(livro, aba === frequencia && antiga ? antiga.getName() : aba.nome, aba === frequencia ? linhas : aba.linhas);
  });
  removerAbaVaziaPadrao(livro);
  if (periodo) PropertiesService.getDocumentProperties().setProperty("PERIODO", JSON.stringify(periodo));

  return { ok: true, versao: novaVersao(), mantidas, descartadas: anteriores.size - usadas };
}

/**
 * O celular grava uma chamada.
 *
 * `chamada = {turma, data, horarios: [1, 2], alunos: [{nome, marca, antes: {"1": "", "2": "F"}}]}`
 *
 * Regras do CONTRATOS.md §1, as mesmas da versão 15 do PWA: só as colunas
 * daquela aula; coluna validada pelo GAF não é tocada; quem saiu da turma é
 * dito, quem entrou não recebe marca; e se a marca de um aluno mudou na
 * planilha depois que a chamada foi aberta, nada é gravado.
 */
function gravarChamada(livro, chamada) {
  if (!chamada || !chamada.turma || !chamada.data || !Array.isArray(chamada.alunos)) {
    throw new Error("Chamada incompleta.");
  }
  const aba = acharAba(livro);
  if (!aba) return recusa("A planilha ainda não foi gerada pelo Mestrão.");
  const linhas = linhasDa(livro, aba);
  const turma = lerTurmas(linhas).find((t) => normalizado(t.nome) === normalizado(chamada.turma));
  if (!turma) return recusa(`A turma ${chamada.turma} não está mais na planilha.`);

  const doDia = turma.colunas.filter((coluna) => coluna.data === chamada.data);
  if (!doDia.length) return recusa(`A data ${chamada.data} não está mais na turma ${turma.nome}.`);
  const pedidos = Array.isArray(chamada.horarios) && chamada.horarios.length
    ? chamada.horarios.map(Number)
    : doDia.map((coluna) => coluna.horario);
  const alvo = doDia.filter((coluna) => pedidos.includes(coluna.horario) && !coluna.travada);
  if (!alvo.length) {
    return recusa(`A aula de ${chamada.data} da turma ${turma.nome} não aceita mais chamada — o GAF validou.`);
  }

  const porNome = new Map();
  for (const aluno of turma.alunos) {
    const k = normalizado(aluno.nome);
    if (porNome.has(k)) return recusa(`Há dois alunos com o nome ${aluno.nome} na turma ${turma.nome}. Nada foi gravado.`);
    porNome.set(k, aluno);
  }

  const gravar = [];
  const saiu = [];
  for (const item of chamada.alunos) {
    const aluno = porNome.get(normalizado(item.nome));
    if (!aluno) {
      saiu.push(item.nome);
      continue;
    }
    porNome.delete(normalizado(item.nome));
    const marca = marcaDe(item.marca) || "0";
    if (!MARCAS.includes(marca)) return recusa(`Marca desconhecida para ${item.nome}: ${item.marca}.`);
    const antes = item.antes || {};
    for (const coluna of alvo) {
      const agora = linhas[aluno.linha][coluna.coluna];
      const jaGravada = mesmaMarca(agora, marca);
      const intocada = mesmaMarca(agora, antes[coluna.horario]);
      if (!jaGravada && !intocada) {
        return recusa(
          `A chamada de ${chamada.data} mudou na planilha depois que você a abriu (${aluno.nome}). Abra de novo para conferir.`,
          true
        );
      }
    }
    gravar.push({ aluno, marca });
  }
  if (!gravar.length) return recusa("Nenhum aluno da chamada está mais na turma. Nada foi gravado.");

  // Uma escrita por coluna: a faixa dos alunos, com o que já estava nela e as
  // marcas novas por cima. Com a trava do script, ninguém escreveu no meio.
  const primeira = Math.min(...turma.alunos.map((a) => a.linha));
  const ultima = Math.max(...turma.alunos.map((a) => a.linha));
  const esperado = new Map();
  for (const coluna of alvo) {
    const faixa = [];
    for (let r = primeira; r <= ultima; r++) faixa.push([linhas[r][coluna.coluna] === undefined ? "" : linhas[r][coluna.coluna]]);
    gravar.forEach(({ aluno, marca }) => {
      faixa[aluno.linha - primeira][0] = marca;
    });
    const faixaDaPlanilha = aba.getRange(primeira + 1, coluna.coluna + 1, faixa.length, 1);
    faixaDaPlanilha.setNumberFormat("@");
    faixaDaPlanilha.setValues(faixa);
    esperado.set(coluna.coluna, faixa);
  }
  SpreadsheetApp.flush();

  // A confirmação é da planilha, não do pedido: relê o que acabou de gravar.
  for (const [coluna, faixa] of esperado) {
    const relida = aba.getRange(primeira + 1, coluna + 1, faixa.length, 1).getValues();
    for (const { aluno, marca } of gravar) {
      if (!mesmaMarca(relida[aluno.linha - primeira][0], marca)) {
        return recusa(`A planilha não guardou a marca de ${aluno.nome}. Tente enviar de novo.`);
      }
    }
  }

  const ausentes = gravar
    .filter(({ marca }) => marca !== "0")
    .map(({ aluno, marca }) => ({ nome: aluno.nome, marca }));
  return {
    ok: true,
    versao: novaVersao(),
    turma: turma.nome,
    data: chamada.data,
    horarios: alvo.map((coluna) => coluna.horario),
    travados: doDia.filter((c) => c.travada && pedidos.includes(c.horario)).map((c) => c.horario),
    presentes: gravar.length - ausentes.length,
    faltas: ausentes.filter((a) => a.marca === "F").length,
    justificadas: ausentes.filter((a) => a.marca !== "F").length,
    ausentes,
    saiu,
    entrou: [...porNome.values()].map((aluno) => aluno.nome),
    conferidaEm: new Date().toISOString()
  };
}

// ── Ler as linhas ───────────────────────────────────────────────────────────

function ehCabecalho(linha) {
  return texto(linha[0]).toUpperCase() === "INT" && /^TURMA:/i.test(texto(linha[1]));
}

/**
 * As turmas da aba, com as colunas de cada uma.
 *
 * Data repetida são horários distintos, na ordem em que aparecem — o 1º e o 2º
 * daquele dia. Não desduplicar, não reordenar (CONTRATOS.md §1, regra 1).
 */
function lerTurmas(linhas) {
  const turmas = [];
  for (let r = 0; r < linhas.length; r++) {
    const cabecalho = linhas[r] || [];
    if (!ehCabecalho(cabecalho)) continue;
    let fim = r + 1;
    while (fim < linhas.length && !ehCabecalho(linhas[fim] || [])) fim++;

    const alunos = [];
    let gaf = null;
    let aula = null;
    for (let i = r + 1; i < fim; i++) {
      const linha = linhas[i] || [];
      const nome = typeof linha[2] === "string" ? linha[2].trim() : "";
      if (nome) {
        alunos.push({ linha: i, nome });
        continue;
      }
      const marca = texto(linha[0]).toUpperCase();
      if (marca === "GAF") gaf = linha;
      if (marca === "AULA") aula = linha;
    }

    const colunas = [];
    const porData = new Map();
    for (let c = 4; c < cabecalho.length; c++) {
      if (texto(cabecalho[c]) === "") continue;
      const data = rotuloDeData(cabecalho[c]);
      const horario = (porData.get(data) || 0) + 1;
      porData.set(data, horario);
      const descricao = texto(aula && aula[c]).match(/^(\d{1,2}:\d{2})?\s*(.*)$/);
      colunas.push({
        coluna: c,
        data,
        horario,
        travada: Boolean(gaf && texto(gaf[c])),
        inicio: descricao[1] || "",
        disciplina: descricao[2] || ""
      });
    }
    if (!colunas.length) continue;
    turmas.push({ nome: texto(cabecalho[1]).replace(/^TURMA:\s*-?/i, "").trim(), linha: r, alunos, colunas });
  }
  return turmas;
}

function chaveDaMarca(turma, nome, data, horario) {
  return `${normalizado(turma)}|${normalizado(nome)}|${data}#${horario}`;
}

function marcasPorChave(linhas) {
  const marcas = new Map();
  lerTurmas(linhas).forEach((turma) => {
    turma.alunos.forEach((aluno) => {
      turma.colunas.forEach((coluna) => {
        const valor = texto(linhas[aluno.linha][coluna.coluna]);
        if (valor) marcas.set(chaveDaMarca(turma.nome, aluno.nome, coluna.data, coluna.horario), valor);
      });
    });
  });
  return marcas;
}

function manterMarcas(novas, anteriores) {
  const linhas = novas.map((linha) => linha.slice());
  let mantidas = 0;
  let usadas = 0;
  lerTurmas(linhas).forEach((turma) => {
    turma.alunos.forEach((aluno) => {
      turma.colunas.forEach((coluna) => {
        const k = chaveDaMarca(turma.nome, aluno.nome, coluna.data, coluna.horario);
        if (!anteriores.has(k)) return;
        usadas++;
        const antiga = anteriores.get(k);
        if (texto(linhas[aluno.linha][coluna.coluna]) === "") {
          linhas[aluno.linha][coluna.coluna] = antiga;
          mantidas++;
        }
      });
    });
  });
  return { linhas, mantidas, usadas };
}

// ── Planilha ────────────────────────────────────────────────────────────────

function normalizadoSemAcento(valor) {
  return String(valor || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().trim();
}

function ehAbaDeFrequencia(nome) {
  return NOMES_DA_ABA.some((candidato) => normalizadoSemAcento(candidato) === normalizadoSemAcento(nome));
}

function acharAba(livro) {
  return livro.getSheets().find((aba) => ehAbaDeFrequencia(aba.getName())) || null;
}

function linhasDa(livro, aba) {
  const fuso = livro.getSpreadsheetTimeZone();
  if (aba.getLastRow() === 0) return [];
  return aba.getDataRange().getValues().map((linha) =>
    linha.map((valor) => (valor instanceof Date ? Utilities.formatDate(valor, fuso, "dd/MM/yyyy") : valor))
  );
}

/** Grava a aba inteira como texto: "03/09/2026" não pode virar data, nem "0" virar número. */
function escreverAba(livro, nome, linhas) {
  const aba = livro.getSheetByName(nome) || livro.insertSheet(nome);
  aba.clearContents();
  if (!linhas.length) return;
  const largura = Math.max(...linhas.map((linha) => linha.length));
  const retangulo = linhas.map((linha) => {
    const cheia = linha.map((valor) => (valor === null || valor === undefined ? "" : valor));
    while (cheia.length < largura) cheia.push("");
    return cheia;
  });
  const faixa = aba.getRange(1, 1, retangulo.length, largura);
  faixa.setNumberFormat("@");
  faixa.setValues(retangulo);
}

/** A planilha nova vem com uma "Página1" vazia; depois da primeira geração ela só atrapalha. */
function removerAbaVaziaPadrao(livro) {
  livro.getSheets()
    .filter((aba) => /^(Página|Sheet|Planilha)\s*1$/i.test(aba.getName()) && aba.getLastRow() === 0)
    .forEach((aba) => {
      if (livro.getSheets().length > 1) livro.deleteSheet(aba);
    });
}

// ── Pequenos ────────────────────────────────────────────────────────────────

function versaoAtual() {
  return Number(PropertiesService.getDocumentProperties().getProperty("VERSAO") || 0);
}

function novaVersao() {
  const versao = versaoAtual() + 1;
  PropertiesService.getDocumentProperties().setProperty("VERSAO", String(versao));
  return versao;
}

function texto(valor) {
  return valor === null || valor === undefined ? "" : String(valor).trim();
}

function normalizado(valor) {
  return String(valor || "").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim().toUpperCase();
}

/** "" fica "" (ainda sem chamada); `1` é falta e `J` é a justificativa antiga, como no PWA v15. */
function marcaDe(valor) {
  const v = texto(valor).toUpperCase();
  if (v === "1") return "F";
  if (v === "J") return "I";
  return v;
}

/** Vazio e 0 são a mesma coisa — presente — na hora de comparar. */
function mesmaMarca(a, b) {
  return (marcaDe(a) || "0") === (marcaDe(b) || "0");
}

function rotuloDeData(valor) {
  const dois = (n) => String(n).padStart(2, "0");
  if (valor instanceof Date) return `${dois(valor.getDate())}/${dois(valor.getMonth() + 1)}/${valor.getFullYear()}`;
  if (typeof valor === "number") {
    const d = new Date(Date.UTC(1899, 11, 30) + Math.round(valor) * 86400000);
    return `${dois(d.getUTCDate())}/${dois(d.getUTCMonth() + 1)}/${d.getUTCFullYear()}`;
  }
  const cru = texto(valor);
  let achado = cru.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (achado) return `${dois(achado[3])}/${dois(achado[2])}/${achado[1]}`;
  achado = cru.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (achado) return `${dois(achado[1])}/${dois(achado[2])}/${achado[3].length === 2 ? `20${achado[3]}` : achado[3]}`;
  return cru;
}

function recusa(erro, conflito = false) {
  return { ok: false, erro, conflito };
}

function responder(objeto) {
  return ContentService.createTextOutput(JSON.stringify(objeto)).setMimeType(ContentService.MimeType.JSON);
}
