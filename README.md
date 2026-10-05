# Agro-Monitoring Pro — Atividade SSE2

Sistema web de monitoramento de silos de grãos com arquitetura híbrida: **Server-Sent Events** para telemetria e alarmes em tempo real (servidor → painel) e **HTTP REST** para comandos dos atuadores (painel → servidor).

## Como rodar

Requisito: Node.js 18 ou superior.

```bash
npm install
npm start
```

Abra **http://localhost:3000** (redireciona para a Tela 1). Para testar a sincronização entre painéis, abra as telas em várias abas ou em outro computador da rede.

## Estrutura

```
server.js                 Express: simulador, motor de regras, SSE, rotas REST, log
public/
  tela1-dashboard.html    Tela 1 — Dashboard geral (US-01)
  tela2-detalhe.html      Tela 2 — Corte transversal SVG (US-02)
  tela3-controle.html     Tela 3 — Limiares e controle de atuadores (US-03)
  css/style.css           Estilos compartilhados (responsivo)
  js/comum.js             Utilitários, chamadas à API, alarme sonoro (Web Audio)
  js/sse-client.js        Cliente SSE com reconexão e ressincronização (RNF-02)
  js/dashboard.js         Lógica da Tela 1
  js/detalhe.js           Lógica da Tela 2 (SVG e gráfico em canvas)
  js/controle.js          Lógica da Tela 3
docs/schema.sql           Implementação SQL do diagrama ER (seção 5)
```

O projeto não usa bibliotecas no front-end: o SVG do silo, o gráfico de 24 h e as linhas de tendência são desenhados com JavaScript puro.

## Requisitos atendidos

| Requisito | Onde está |
|---|---|
| RF-01 Simulação de telemetria | `server.js` → `simular()`, executado a cada 2 s para 4 silos. A temperatura sobe pela respiração dos grãos e cai com a exaustão; o CO₂ cresce com temperatura e umidade e cai com a ventilação. |
| RF-02 Endpoint SSE | `GET /api/silos/stream` (alias `GET /events`), `Content-Type: text/event-stream`, evento `sensor_update` com todos os silos. |
| RF-03 Regras de CO₂ | ≥ 1000 ppm gera alerta visual; ≥ 1500 ppm abre a comporta automaticamente (`avaliarRegras()`). |
| RF-04 Regras de temperatura | ≥ 30 °C liga os exaustores; ≥ 35 °C emite o evento `alarme_critico` com alarme sonoro e card piscando. |
| RF-05 Trava de carga | ≥ 98% muda o silo para "Bloqueado para carga" e emite o evento `notificacao` para todos os clientes. O Silo 04 começa carregando para demonstrar. |
| RF-06 Controle manual | `POST /api/silos/:id/atuadores` e as rotas curtas `POST /api/silos/:id/comporta/abrir` e `POST /api/silos/:id/exaustor/ligar`. O modo manual suspende as rotinas automáticas do silo, e todo comando é registrado no log. |
| RF-07 Dashboard dinâmico | Cards, barras de nível, tendência e etiquetas de estado atualizados a cada evento SSE, sem recarregar a página. |
| RF-08 Log de auditoria | Últimas 20 ocorrências em memória, transmitidas por SSE (`log_snapshot` e `log_update`). |
| RNF-01 Separação SSE/HTTP | Dados contínuos passam somente pelo SSE. POST/PUT são usados apenas para comandos e configuração. Os GET de leitura servem apenas para a ressincronização. |
| RNF-02 Tolerância a falhas | O badge muda para "falha" e o cliente tenta reconectar com backoff (2 s, 4 s, 8 s, até 15 s), depois pede `GET /api/silos` e `GET /api/log`. Um watchdog detecta servidor travado (7 s sem dados). |
| RNF-03 JSON padronizado | Todas as respostas seguem `{ sucesso, siloId, ..., mensagem }`. Os erros usam o formato `{ sucesso: false, erro: "CODIGO", mensagem }`. |

## API

### SSE — `GET /api/silos/stream`

| Evento | Quando | Conteúdo |
|---|---|---|
| `sensor_update` | a cada 2 s e após cada comando | `{ timestamp, sensorChuva, silos: [...] }` |
| `alarme_critico` | temperatura ≥ limite crítico | `{ siloId, tipoEvento, nivelSeveridade, temperatura, sonoro, mensagem }` |
| `notificacao` | bloqueio de carga | `{ siloId, tipo, severidade, mensagem }` |
| `log_snapshot` | ao conectar | lista das últimas 20 ocorrências |
| `log_update` | nova ocorrência | uma ocorrência |
| `config_update` | ao conectar e ao salvar limiares | limiares atuais |

Cada item de `silos` contém os campos da seção 7.1 (`siloId`, `temperatura`, `co2`, `umidade`, `comporta`, `exaustor`, `alarme`, `timestamp`), além de extensões usadas pelas telas: `nivel`, `nivelRisco`, `atuadores`, `modo`, `termopares`, `statusCarga` e `comunicacao`.

### REST

| Método e rota | Função |
|---|---|
| `POST /api/silos/:id/atuadores` | Comando manual (seção 7.2). Corpo: `siloId`, `comportaComando`, `exaustorComando`, `exaustor2Comando` (opcional) e `operadorId`. |
| `POST /api/silos/:id/comporta/:acao` | `abrir` ou `fechar` (RF-06). |
| `POST /api/silos/:id/exaustor/:acao` | `ligar` ou `desligar`; use `?n=1` ou `?n=2` para um exaustor específico. |
| `POST /api/silos/:id/modo` | `{ modo: "MANUAL" \| "AUTOMATICO", operadorId }`. |
| `PUT /api/config` | Altera os limiares de temperatura e CO₂. |
| `GET /api/silos`, `/api/silos/:id`, `/api/silos/:id/historico`, `/api/log`, `/api/config`, `/api/status` | Leitura do estado. |
| `POST /api/simulacao/:id/cenario` | Uso exclusivo para demonstração (ver abaixo). |

Códigos de erro: `400` para dados inválidos, `404` para silo inexistente, `409` quando o silo está em modo automático, `423` quando a ação está bloqueada (chuva ou sobrecarga do motor) e `503` quando o CLP está sem comunicação.

Exemplo de comando via terminal:

```bash
curl -X POST localhost:3000/api/silos/2/modo -H "Content-Type: application/json" \
     -d '{"modo":"MANUAL","operadorId":"OP-882"}'
curl -X POST localhost:3000/api/silos/2/atuadores -H "Content-Type: application/json" \
     -d '{"siloId":2,"comportaComando":"ABRIR","exaustorComando":"LIGAR","operadorId":"OP-882"}'
```

## Roteiro de demonstração

1. **Tela 1.** O Silo 02 (soja) começa com CO₂ alto. Em poucos segundos a automação liga os exaustores e abre a comporta, e o card muda de cor.
2. **Tela 1.** O Silo 04 está carregando e, em cerca de 1 minuto, chega a 98% e recebe a etiqueta "Bloqueado para carga".
3. Clique em **Ver detalhes** do Silo 02 para abrir a **Tela 2**, com o corte SVG, os termopares, o foco de calor e o gráfico de 24 h.
4. Clique em **Acessar controle de atuadores** para abrir a **Tela 3**. Passe para o modo manual e use os botões; o log registra *"Exaustor 01 LIGADO por Operador OP-882"*.
5. Em **Ferramentas de demonstração** (Tela 3), dispare os fluxos alternativos e de exceção:
   - pico térmico, com alarme sonoro e card piscando;
   - sensor de chuva, que bloqueia a abertura da comporta;
   - sobrecarga do exaustor, que trava o botão em vermelho;
   - perda de sinal do CLP, que mostra a etiqueta de falha e mantém os últimos dados;
   - termopar rompido, que exibe "ERR" no SVG.
6. Pare o servidor (Ctrl+C) com as telas abertas: o badge fica vermelho e mostra as tentativas de reconexão. Suba de novo com `npm start` e o painel se ressincroniza sozinho.

> O som do alarme só toca depois de alguma interação com a página (regra dos navegadores). Clique em qualquer lugar uma vez.

## Decisões sobre inconsistências da especificação

- **Endpoint SSE.** O RF-02 cita `GET /events` e a seção 7 cita `GET /api/silos/stream`. As duas rotas existem e usam o mesmo handler. As telas usam `/api/silos/stream`.
- **Endpoint de comando.** O RF-06 cita `/comporta/abrir` e `/exaustor/ligar`; a seção 7.2 cita `/atuadores`. As duas formas foram implementadas sobre a mesma função de validação e execução.
- **Formato do `sensor_update`.** O RF-02 pede um objeto consolidado com todos os silos, e a seção 7.1 mostra um silo por evento. O sistema envia o consolidado (`silos: [...]`), e cada item mantém exatamente os campos da seção 7.1.
- **Quantidade de silos.** O protótipo mostra 4 silos e o fluxo feliz cita silos 01 a 06. O sistema usa 4, o que atende ao mínimo de 3 do RF-01.
- **Classificação de 1450 ppm.** O protótipo da Tela 2 chama 1450 ppm de "crítico". Pelo RF-03, esse valor é alerta, pois fica abaixo de 1500. Prevalecem os requisitos formais.
- **Temperatura exibida.** É a maior leitura entre os termopares (topo, meio e fundo), porque o foco de calor é o que importa para as regras do RF-04. Os três valores individuais também são enviados.
- **Exaustores.** A Tela 3 pede dois exaustores, e o payload da seção 7.1 tem um campo `exaustor`. O campo `exaustor` vale `LIGADO` se qualquer um dos dois estiver ligado, e `atuadores.exaustor1` e `atuadores.exaustor2` trazem o detalhe.
- **Histerese.** No modo automático, os exaustores desligam abaixo de 27 °C e a comporta fecha abaixo de 700 ppm. Isso evita que os atuadores liguem e desliguem a cada leitura.
