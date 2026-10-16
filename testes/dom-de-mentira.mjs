// Um DOM de mentira, do tamanho exato do que a tela do PWA usa.
//
// ## Por que existe
//
// O app.js do PWA é um script de página: ele monta as telas por innerHTML e lê o
// que está no index.html. Até 16/10/2026 nada aqui o executava — só o carteiro
// tinha teste. Aqui ele roda **de verdade**, num vm, com um document que responde
// o suficiente para a montagem acontecer, e o teste lê o HTML que a tela escreveu.
//
// Não é um navegador: é o bastante para saber se a tela **monta** e o que ela
// **diz**, que é o que o professor vê no celular.
//
// ## Por que não jsdom
//
// Mesma razão do Mestrão (tests/dom-de-mentira.js): o app não tem dependência
// nenhuma para rodar no aparelho, e um DOM de mentira de cem linhas cobre o que
// precisamos. Se um dia a tela usar algo que isto não tem, o teste falha dizendo
// o quê — e aí se acrescenta.

import { readFileSync } from "node:fs";

export const HTML_DO_APP = readFileSync(new URL("../index.html", import.meta.url), "utf8");

const IDS = new Set([...HTML_DO_APP.matchAll(/\bid=["']([^"']+)["']/g)].map((achado) => achado[1]));

/** As abas do menu inferior, na ordem em que o index.html as põe. */
export function abasDoHtml() {
  const nav = HTML_DO_APP.match(/<nav id="abas"[\s\S]*?<\/nav>/)?.[0] ?? "";
  return [...nav.matchAll(/data-aba="([^"]+)"/g)].map((achado) => achado[1]);
}

function criarElemento(tag = "div") {
  const escutas = new Map();
  const filhosPorSeletor = new Map();
  const elemento = {
    tagName: String(tag).toUpperCase(),
    id: "",
    className: "",
    innerHTML: "",
    textContent: "",
    value: "",
    hidden: false,
    disabled: false,
    returnValue: "",
    dataset: {},
    style: {},

    // Mexe no className de verdade: é por classe que se sabe qual tela está
    // ativa e qual linha é "sem-cor".
    classList: {
      add(...nomes) {
        for (const n of nomes) if (!elemento.classList.contains(n)) elemento.className = (elemento.className + " " + n).trim();
      },
      remove(...nomes) {
        elemento.className = String(elemento.className).split(/\s+/).filter((c) => c && !nomes.includes(c)).join(" ");
      },
      toggle(n, forca) {
        const ligar = forca ?? !elemento.classList.contains(n);
        if (ligar) elemento.classList.add(n); else elemento.classList.remove(n);
        return ligar;
      },
      contains: (n) => String(elemento.className).split(/\s+/).includes(n)
    },

    addEventListener(nome, ouvinte) {
      if (!escutas.has(nome)) escutas.set(nome, []);
      escutas.get(nome).push(ouvinte);
    },
    removeEventListener() {},
    dispatchEvent(evento) {
      for (const ouvinte of escutas.get(evento?.type) ?? []) ouvinte(evento);
      return true;
    },
    click() { elemento.dispatchEvent({ type: "click", target: elemento }); },

    // O clique da tela chega pelo documento e sobe do botão (closest).
    closest(seletor) { return seletor === "button" && elemento.tagName === "BUTTON" ? elemento : null; },
    hasAttribute(nome) {
      if (!nome.startsWith("data-")) return false;
      const chave = nome.slice(5).replace(/-(\w)/g, (_, letra) => letra.toUpperCase());
      return elemento.dataset[chave] !== undefined;
    },
    setAttribute() {}, removeAttribute() {}, getAttribute: () => null,
    // O chip escreve no <span> que está dentro dele.
    querySelector(seletor) {
      if (!filhosPorSeletor.has(seletor)) filhosPorSeletor.set(seletor, criarElemento("span"));
      return filhosPorSeletor.get(seletor);
    },
    querySelectorAll: () => [],
    scrollIntoView() {}, focus() {}, select() {}, blur() {},
    showModal() { elemento.open = true; },
    close(valor) { if (valor !== undefined) elemento.returnValue = valor; elemento.open = false; },
    get children() { return []; },
    get firstChild() { return null; }
  };
  return elemento;
}

/**
 * Instala o DOM e o armazenamento de mentira. Devolve o que o teste precisa para
 * clicar e ler a tela.
 *
 * @param {Map<string,string>} [armazem] o localStorage como ele estará quando o
 *   professor abrir o app (conexão, grade, fila).
 */
export function instalarDom(armazem = new Map()) {
  const porId = new Map();

  const secoes = [...IDS].filter((id) => id.startsWith("tela-")).map((id) => {
    const secao = criarElemento("section");
    secao.id = id;
    secao.className = "tela";
    porId.set(id, secao);
    return secao;
  });

  const abas = abasDoHtml().map((nome) => {
    const botao = criarElemento("button");
    botao.dataset.aba = nome;
    return botao;
  });

  const documento = {
    /** Só IDs do index.html existem: erro de digitação devolve null, e a tela quebra. */
    getElementById(id) {
      if (!IDS.has(id)) return null;
      if (!porId.has(id)) {
        const elemento = criarElemento();
        elemento.id = id;
        porId.set(id, elemento);
      }
      return porId.get(id);
    },
    createElement: (tag) => criarElemento(tag),
    querySelector: () => null,
    querySelectorAll(seletor) {
      if (seletor === ".tela") return secoes;
      if (seletor === "[data-aba]") return abas;
      return [];
    },
    addEventListener(nome, ouvinte) {
      if (!documento.escutas.has(nome)) documento.escutas.set(nome, new Set());
      documento.escutas.get(nome).add(ouvinte);
    },
    removeEventListener(nome, ouvinte) { documento.escutas.get(nome)?.delete(ouvinte); },
    dispatchEvent(evento) {
      for (const ouvinte of [...(documento.escutas.get(evento?.type) ?? [])]) ouvinte(evento);
      return true;
    },
    escutas: new Map(),
    body: criarElemento("body")
  };

  const localStorage = {
    getItem: (chave) => armazem.get(chave) ?? null,
    setItem: (chave, valor) => armazem.set(chave, String(valor)),
    removeItem: (chave) => armazem.delete(chave)
  };

  return {
    documento,
    localStorage,
    porId,
    /** A aba do menu pelo nome que o app usa ("hoje", "frequencia"). */
    aba: (nome) => abas.find((botao) => botao.dataset.aba === nome),
    abas,
    /** Um toque de verdade: o clique chega ao documento com o botão como alvo. */
    clicar(alvo) { documento.dispatchEvent({ type: "click", target: alvo }); }
  };
}
