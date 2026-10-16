# Inventário do PWA — Chamada 20 (16/10/2026)

> Frente **C0** do plano `referencia/ux-ui/lote-e-pwa/PLANO.md` (repositório do Mestrão).
> Isto é o que existe hoje, lido do código — a base para não refazer nem perder nada.
> Norma: `NORMAS.md`. Contrato da planilha: `CONTRATOS.md` §1 (no Mestrão).

## As telas

| Tela | id | Como se chega | O que faz |
|---|---|---|---|
| Conectar | `#tela-conectar` | primeira abertura, ou Ajustes → Trocar o código | cola o código `/exec#chave` do carteiro |
| Hoje | `#tela-hoje` | abertura; aba Hoje | as aulas do dia, pela hora; a faixa do período anterior |
| Frequência | `#tela-turmas` | aba Frequência | um cartão por turma, com os três estados |
| Turma | `#tela-turma` | toque no cartão | as datas da turma, com disciplina e horário |
| Chamada | `#tela-chamada` | toque numa data | alunos em ordem alfabética, F e J, e o botão de enviar |
| Folha do motivo | `#folha-motivo` | botão J | os nove códigos da Mestre 1.0.57 mais “Presente” |
| Folha do envio | `#folha-envio` | ao enviar | recibo, fila ou recusa |
| Folha de Ajustes | `#folha-ajustes` | ⚙︎ | tema, horários juntos/separados, buscar agora, trocar o código |

O menu inferior (`#abas`) fica à vista em Hoje, Frequência e Turma; **some na chamada**
(o botão de enviar mora embaixo) e na conexão.

## O que a tela diz de cada aula (os estados)

| Estado | Quando | O que se lê |
|---|---|---|
| a fazer | a coluna tem célula vazia | “Fazer” / “Fazer agora” |
| na fila | está em `chamada:fila` | “◷ Na fila” |
| feita, falta lançar | coluna cheia **e** fora de `periodo.lancadas` | “Feita · falta lançar” |
| lançada | coluna cheia e em `periodo.lancadas` (ou planilha sem a lista) | “✓ Feita” / “✓ Enviada hh:mm” |
| validada | a linha GAF daquela coluna | “🔒 Validada” — abre só para ver |
| recusada | o carteiro recusou | “Abrir” + a frase da recusa |

## O que fica no aparelho (localStorage)

| Chave | O que é |
|---|---|
| `chamada:conexao` | `{url, chave}` do carteiro |
| `chamada:grade` | a última grade recebida: turmas, alunos, aulas, marcas e período |
| `chamada:conferida` | quando a planilha foi conferida pela última vez |
| `chamada:fila` | chamadas que ainda não saíram |
| `chamada:recusas` | chamadas que a planilha recusou |
| `chamada:recibos` | o recibo de cada chamada enviada |
| `chamada:rascunho:<aula>` | só os alunos que ele tocou, por nome |
| `mestre:horarios` | “juntos” (padrão) ou “separados” |
| `chamada:tema` | g1, g2 (padrão) ou g3 |

## A fila offline — o que não se perde

1. a chamada entra em `chamada:fila` **antes** de sair;
2. `enviarItem` manda ao carteiro e só tira o item da fila quando ele responde;
3. sem rede ou sem resposta, o item fica, e o chip diz “N chamadas aguardando envio”;
4. `online`, `visibilitychange` e o toque no chip chamam `esvaziarFila`;
5. recusa do carteiro (conflito, aula validada, turma fora do período) vai para
   `chamada:recusas`, e só sai quando aquela aula entrar.

## O recibo

A resposta do carteiro é lida **depois de reler as células que gravou**
(`carteiro/Codigo.gs`, `gravarChamada`): presentes, faltas, justificadas, os ausentes
por nome, quem saiu, quem entrou e que horário estava validado pelo GAF. A tela mostra
isso na folha do envio e guarda em `chamada:recibos`.

## Gestos por tarefa comum

| Tarefa | Gestos hoje |
|---|---|
| fazer a chamada de hoje | abrir o app → toque na linha do dia → F/J → Enviar |
| corrigir uma chamada já enviada | Frequência → turma → data → F/J → “Enviar correção” |
| ver o que falta preencher no período | aba Frequência (o cartão conta “N a preencher”) |
| ver o que falta lançar no SIAEP | idem, mais a linha “N feitas, falta lançar no SIAEP” |
| mandar o que ficou na fila | toque no chip |
| ver o recibo de uma chamada antiga | não há tela de recibos: só a folha no momento do envio |

## O que o PWA não faz — e é de propósito

- **não fala com o SIAEP**: o envio da frequência é do Mestrão, com conferência;
- **não escreve nota**: a aba Notas é a próxima funcionalidade, e exige contrato novo no carteiro;
- **não pede login**: a chave do carteiro é a porta;
- **não guarda nome de aluno no app publicado**: a grade chega do carteiro na hora.
