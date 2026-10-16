# Normas do PWA (Chamada) — escritas em 16/10/2026

> Frente **C1** do plano `referencia/ux-ui/lote-e-pwa/PLANO.md` (repositório do Mestrão).
> Em vigor **antes** do código: o que está aqui manda, e mudar o que está aqui é o
> primeiro passo de qualquer mudança no app.

## 0. Só funcionalidade nova — dito por ele em 16/10/2026

> “Quero do jeito que está, quero apenas novas funcionalidades.”

Não se troca tela, texto, botão nem fluxo que existe — **no Mestrão nem no PWA**. O que
entra é acréscimo: uma linha a mais, uma aba a mais, um estado a mais. O que já existe
muda só quando ele pedir, e o pedido fica escrito aqui com a data.

## 1. O menu inferior

- Duas abas hoje: **Hoje** e **Frequência** (`data-aba="hoje"` e `data-aba="frequencia"`).
  A tela da Frequência continua `#tela-turmas`: o nome de dentro não muda.
- A aba **Notas** entra quando o carteiro tiver a aba `NOTAS` — decisão dele em
  16/10/2026; contrato antes do código (`CONTRATOS.md` §1).
- A barra fica à vista em Hoje, Frequência e Turma; **some na chamada** (o botão de
  enviar mora embaixo) e na conexão.
- Trocar de aba **nunca** perde chamada em andamento nem fila: o rascunho é por aula
  (`chamada:rascunho:<aula>`), e a fila só perde item quando o carteiro responde.
- A aba ativa acompanha a tela: Hoje → `hoje`; Frequência e Turma → `frequencia`.

## 2. Voltar

- O botão `‹` está em toda tela de dentro: chamada → turma → Frequência → Hoje.
- O gesto da borda esquerda (C5) **ainda não existe**. Quando entrar: um gesto = uma
  tela; gesto vertical ou curto não navega; com o teclado aberto, o primeiro voltar
  fecha o teclado; e **nunca descarta chamada**. Só se prova em celular físico — no
  desktop não vale como prova.

## 3. Os estados de uma aula

Uma aula é o dia inteiro no modo *juntos* (o padrão), ou um horário no modo *separados*
(Ajustes; `CONTRATOS.md` §1, regra 1).

| Estado | Quem decide | O que a tela diz |
|---|---|---|
| a fazer | a coluna tem célula vazia | “Fazer” (e “Fazer agora” na de hoje) |
| na fila | `chamada:fila` | “◷ Na fila” |
| **feita, falta lançar** | coluna cheia e **fora** de `periodo.lancadas` | “Feita · falta lançar” |
| lançada | coluna cheia e em `periodo.lancadas` | “✓ Feita” / “✓ Enviada hh:mm” |
| validada | a linha GAF da coluna | “🔒 Validada” — abre só para ver |
| recusada | o carteiro recusou | “Abrir” + a frase da recusa |

**Preenchida não é lançada.** “Feita” no celular quer dizer que as marcas estão na
planilha; só o diário do SIAEP diz que a frequência entrou. Enquanto o Mestrão não
mandar `periodo.lancadas`, a planilha é de antes desta data e “feita” vale como
“lançada”, como sempre foi — é o que faz a Chamada 20 abrir uma planilha da 19 sem
mentir.

O cartão da turma conta os três: `N a preencher`, `N feitas, falta lançar no SIAEP`, e
só diz “✓ Todas preenchidas” quando **não há nenhuma das duas**.

## 4. Tela nunca em branco

Toda tela diz o que falta e o que fazer: sem planilha, “Gere a planilha no Mestrão”;
sem aula hoje, “Hoje não tem aula”; sem turmas, “A planilha ainda não tem turmas”.
Vale para toda saída antecipada de um desenho.

## 5. O que sai do aparelho

- Só a chamada: turma, data, horários e as marcas — poucos KB por POST.
- A chave do carteiro é a única credencial: **não há login** no celular.
- Nada de nome de aluno no app publicado: a grade chega do carteiro na hora.
- A recusa do carteiro é mostrada por inteiro; nunca se resolve conflito sozinho.

## 6. Provar antes de publicar

- `node --test testes/*.test.mjs` verde: o carteiro em Node e a tela com o `app.js` de
  verdade (`testes/app.test.mjs`, sobre o DOM de mentira `testes/dom-de-mentira.mjs`).
- Antes de pedir um clique a ele, a prova com o disco dele — e, no Mestrão,
  `npm run conferir`.
- Mudou a tela? Subir **juntos**: `VERSAO` do `app.js`, `CACHE` e `ARQUIVOS` do `sw.js`
  e os `?v=` do `index.html`. Sem isso o iPhone continua na versão velha.
- A chamada real é dele, uma por prova (`CLAUDE.md`, 09/10/2026): nada de “manda de
  novo para ver”.

## 7. O que ainda não existe

- **Aba Notas** (decidida por ele em 16/10/2026): turmas → avaliações → estudantes, com
  teclado numérico, no estilo da Frequência. Exige **aba `NOTAS` nova no carteiro** e
  republicar o Apps Script — contrato antes do código.
- **Gesto de voltar** (C5) e a **validação em celular físico** (C7).
