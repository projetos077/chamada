# Chamada — o celular do Mestrão

O Mestrão gera a planilha do período; este app faz a chamada no iPhone e grava
só a frequência. Os dois se encontram numa **Planilha Google** do professor,
por meio de um script que mora nela — o *carteiro* (`carteiro/Codigo.gs`).

O app publicado não contém dado de aluno: a grade chega do carteiro, na hora.

## Por que mudou (versão 16, 13/10/2026)

Até a versão 15 o celular baixava o XLSX inteiro pela API do Drive, encaixava a
chamada e subia o arquivo de volta, com um login do Google que vencia a cada
hora; depois o Drive para desktop ainda precisava sincronizar no Mac. Qualquer
etapa travava. Agora:

- o celular manda **só a chamada** (turma, data, marcas — poucos KB);
- não há login no celular: o carteiro é protegido por uma **chave**;
- a chamada entra na **fila do aparelho antes de sair**, e só sai da fila
  quando o carteiro responde — sem internet, ela vai sozinha depois;
- a confirmação vem **da planilha**: o carteiro relê as células que gravou
  antes de responder, e a tela mostra presentes, faltas, justificadas e a hora.

## Regras preservadas (CONTRATOS.md §1, no repositório do Mestrão)

- **Toda aula que o Mestrão gerou se preenche** (dito pelo professor em 13/10/2026):
  em dias seguidos ou pulados, não interessa. O que falta aparece como
  **"A preencher"**, por turma, na aba **Turmas** — não existe aula "atrasada".
- Duas abas (versão 17, 13/10/2026): **Hoje** só com as aulas do dia (sem aula,
  diz "Hoje não tem aula"); **Turmas** com um cartão por turma e, dentro, as
  datas do período com a disciplina — verde quando feita, 🔒 quando validada
  pelo GAF. A validada abre só para ver; as outras abrem para corrigir.
- Visual (versão 18, 13/10/2026): o tema **gibi** do Mestrão — papel creme,
  contorno nanquim, faixa amarela. Em **Ajustes → Tema**: G2 papel jornal
  (padrão), G1 clássico, G3 faixa nanquim. A escolha fica no aparelho.
- Vazio ou `0` é presente; `F` falta; `I A E G S T U O P` são os motivos da
  Mestre 1.0.57. Presente é gravado como `0`, para a aula constar como feita.
- Data repetida são horários distintos. **Juntos** (padrão): uma chamada por
  dia, gravada em todos os horários. **Separados**: uma por horário. Em Ajustes.
- Coluna marcada pelo GAF não aceita chamada e nunca é gravada.
- Se a marca de um aluno mudou na planilha depois que a chamada foi aberta,
  nada é gravado, e a tela diz quem.
- Matrícula e transferência não bloqueiam: quem saiu é dito, quem entrou fica
  sem marca.
- O rascunho guarda só os alunos que o professor tocou, por nome.
- Gerar a planilha de novo no Mestrão **não apaga** a chamada feita aqui: o
  carteiro só preenche o que está vazio.

## Versão 20 (16/10/2026) — os três estados

- A chamada feita aqui e ainda **não lançada no SIAEP** passa a dizer **“Feita · falta
  lançar”**, em vez de “✓ Feita”. Eram dois estados mostrados como um só, e 48 colunas
  do 3º período pareceram lançadas quando só estavam preenchidas no celular. Quem sabe
  a diferença é o Mestrão, que manda no `periodo` a lista das aulas que o diário já tem
  (`CONTRATOS.md` §1, no repositório do Mestrão).
- A aba do meio do menu inferior passa a se chamar **Frequência** (era “Turmas”); a tela
  é exatamente a mesma.
- No **Hoje**, a faixa do período anterior enquanto houver frequência feita e não
  lançada. Ela some quando zera.
- Norma do app: `NORMAS.md`. Inventário do que existe: `INVENTARIO.md`.

## Preparar a planilha (uma vez, no Mac)

1. Crie uma Planilha Google em branco (ex.: *Chamada Mestrão*).
2. **Extensões → Apps Script**. Apague o que vier, cole o `carteiro/Codigo.gs`
   inteiro e salve.
3. **Implantar → Nova implantação → App da Web**:
   *Executar como*: **Eu**; *Quem pode acessar*: **Qualquer pessoa**.
   Autorize com a sua conta. Copie o endereço que termina em `/exec`.
4. Volte à planilha e recarregue. No menu **Mestrão → Código de conexão**, cole
   o endereço `/exec` quando ele pedir. Aparece o código: `…/exec#…`.
5. Cole esse código no Mestrão (Configurações) e no celular (primeira tela do
   app). No iPhone, copiar no Mac e colar no celular funciona pela Área de
   Transferência Universal.

Quem tiver o código lê a planilha. Para trocar a chave, apague a propriedade
`CHAVE` em **Apps Script → Configurações do projeto → Propriedades do script**;
uma nova nasce no próximo uso, e o código precisa ser colado de novo.

Ao mudar o `Codigo.gs`: **Implantar → Gerenciar implantações → editar → Nova
versão**. Criar implantação nova muda o endereço.

## Testes

```bash
node --test testes/*.test.mjs
```

O carteiro roda inteiro em Node, sobre uma planilha de mentira
(`testes/planilha-de-mentira.mjs`).

## Instalar no iPhone

Abra o endereço publicado no Safari → Compartilhar → **Adicionar à Tela de
Início**.
