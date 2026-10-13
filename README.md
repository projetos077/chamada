# Chamada Mestre

PWA para realizar chamadas no iPhone usando a planilha XLSX da extensão Mestre.

O aplicativo publicado não contém a extensão Mestre nem planilhas com dados de
alunos. A planilha é selecionada pelo próprio usuário no aparelho ou no Drive.

## Regras preservadas

- Compatível com a Planilha SIAEP unificada da Mestre 1.0.57, incluindo a aba
  `AUDITORIA`, e com o modelo antigo que contém somente a frequência.
- A aba é localizada pelos nomes `FREQÊNCIA`, `FREQUÊNCIA` ou `FREQUENCIA` e
  validada pelos cabeçalhos `INT | TURMA | NOME | TOTAL`.
- A planilha mantém a estrutura e as datas originais.
- Datas repetidas continuam sendo datas iguais no Excel.
- **Horários do mesmo dia são escolha do professor** (versão 15), no botão da
  tela de turmas: *uma chamada* por data, gravada em todos os horários daquele
  dia (padrão, como nas versões anteriores), ou *uma chamada para cada horário*,
  gravada só na coluna dele. O arquivo não muda — continua uma coluna por
  horário.
- Vazio ou `0` significa presente.
- `F` significa falta.
- Os códigos da Mestre 1.0.57 são preservados: `I` impossibilidade, `A`
  acompanhar responsável, `E` enfermidade, `G` gravidez, `S` insegurança,
  `T` trabalho, `U` transporte, `O` ensino remoto e `P` suspeita de COVID.
- Ao salvar, somente as células da aula selecionada são alteradas no XML da
  aba de frequência. As demais abas da Planilha SIAEP não são regravadas.
- Antes de enviar, o aplicativo baixa a versão mais recente do Drive e reaplica
  somente as chamadas pendentes.
- Se a mesma turma/data mudou no Drive, ou se a marca daquele aluno mudou depois
  de a chamada ser aberta, o envio é bloqueado para impedir a perda de chamadas.
- **Matrícula, transferência e desligamento não bloqueiam mais o envio** (versão
  15): quem continua na turma é lançado, e o aplicativo diz quem saiu e quem
  entrou. Antes, um único aluno a mais ou a menos recusava a chamada inteira.
- **Aula validada pelo GAF não abre para chamada** (versão 15). O Mestrão escreve,
  embaixo de cada turma, uma linha começando por `GAF` com a palavra `VALIDADA` na
  coluna de cada aula fechada; o aplicativo mostra o cadeado, recusa abrir e nunca
  grava nessas colunas. Planilha sem essa linha se comporta como antes.
- O estado `Realizada` é calculado novamente pelo conteúdo da versão atual do
  arquivo; marcações e rascunhos de outra planilha ou versão não são reutilizados.
- Ao salvar uma chamada, os presentes são gravados como `0`. A Mestre aceita
  esse valor como presença e o app consegue reconhecer a data como realizada
  depois de fechar ou trocar de aparelho.
- A escrita das células mantém a ordem original das colunas dentro do XML.
- Cada planilha recebe uma assinatura estrutural baseada em turmas e datas —
  **sem a lista de alunos**, que muda durante o período. Rascunhos ou chamadas
  pendentes de uma planilha anterior são bloqueados.
- O rascunho da chamada é guardado por nome do aluno, não pela posição da linha.
- A gravação no Drive usa obrigatoriamente o mesmo ID do arquivo que está aberto
  no PWA; divergências interrompem o envio.
- Uma única planilha fica definida como a planilha ativa do período. O PWA tenta
  reconectá-la ao abrir, ao voltar para a tela e quando a internet retorna.
- Enquanto o token temporário do Google estiver válido, a conferência e a
  atualização da planilha ativa são automáticas. Quando ele expira, basta tocar
  em `Conectar`; não é necessário selecionar novamente o arquivo.
- `Carregar nova planilha do período` abre o seletor somente na troca de período.
  A nova seleção só substitui a anterior depois de o XLSX ser baixado e validado.
- A troca de período é bloqueada enquanto existir chamada aguardando envio.

## Executar localmente

Na pasta do projeto:

```bash
python3 -m http.server 8080
```

Abra `http://localhost:8080`.

Para instalar no iPhone, publique a pasta em um endereço HTTPS e use
`Safari > Compartilhar > Adicionar à Tela de Início`.

## Google Drive

1. Crie um projeto no Google Cloud.
2. Ative a Google Drive API e a Google Picker API.
3. Crie um OAuth Client ID do tipo aplicativo Web.
4. Adicione o domínio HTTPS do aplicativo às origens JavaScript autorizadas.
5. Crie uma chave de API restrita ao domínio do aplicativo e à Google Picker API.
6. No aplicativo, abra a engrenagem e informe:
   - OAuth Client ID;
   - chave de API;
   - número do projeto Google Cloud.
7. Toque em `Escolher planilha no Google Drive` e selecione o arquivo XLSX.

O aplicativo usa o escopo limitado `drive.file`. Ele pode abrir e atualizar
somente a planilha escolhida pelo usuário no seletor oficial do Google. Para
uso pessoal, a conta deve ser adicionada como usuária de teste na tela de
consentimento OAuth enquanto o projeto estiver em teste.

A planilha escolhida fica memorizada no aparelho. Uma cópia privada também é
mantida no armazenamento local do PWA, permitindo abrir e fazer chamadas sem
selecionar o arquivo novamente. Quando o acesso temporário do Google expirar,
o aplicativo solicitará uma nova autorização somente ao sincronizar.

Uma chamada feita sem conexão fica armazenada como uma operação pendente
(turma, data e alunos), e não como um arquivo inteiro pronto para substituir o
Drive. Na sincronização, ela é aplicada sobre a versão mais recente da planilha.
