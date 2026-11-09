# RaptorLink — Simulação IoT dos sensores de um F-22 Raptor

Projeto final de **Internet das Coisas**: cada sensor do F-22 é um nó virtual que publica leituras em um broker MQTT, e um painel web assina esses dados para mostrar o avião no ar em tempo real. O painel também publica comandos que o motor de simulação aplica ao cenário.

```
┌────────────────────┐   f22/nav, f22/atitude, f22/ambiente,   ┌──────────────┐   WebSocket :9001   ┌──────────────────────┐
│ Motor de simulação │ ── f22/motores, f22/combustivel, ─────▶ │   Broker     │ ──────────────────▶ │ Painel web           │
│ Node.js + MQTT.js  │    f22/radar, f22/alertas, f22/status   │  Mosquitto   │                     │ cockpit + estação    │
│ engine/            │ ◀───────────── f22/comandos ─────────── │  :1883/:9001 │ ◀────────────────── │ de solo  (cockpit/)  │
└────────────────────┘                                         └──────────────┘                     └──────────────────────┘
```

Não há ligação direta entre o motor e o painel: tudo passa pelo broker.

## Como rodar

Pré-requisitos: Node.js ≥ 18, Docker (para o broker) e Python 3 (só para servir os arquivos estáticos; qualquer servidor HTTP serve).

```bash
npm install          # instala o MQTT.js do motor
npm run broker       # sobe o Mosquitto (1883 MQTT, 9001 WebSocket)
npm run engine       # inicia o motor de simulação
npm run web          # serve o painel em http://localhost:8080
```

No painel, escolha **MQTT** e clique em **CONECTAR** (padrão `ws://localhost:9001`, prefixo `f22`). Também dá para conectar direto pela URL:

- `http://localhost:8080/?broker=ws://localhost:9001` abre o cockpit já conectado
- `http://localhost:8080/?broker=ws://localhost:9001#solo` abre a estação de solo já conectada

Sem broker, o painel abre em modo **MOCK**: o mesmo núcleo de simulação roda dentro do navegador e gera exatamente as mesmas mensagens do motor.

### Em dois computadores (apresentação)

1. No computador A: `npm run broker` e `npm run engine`.
2. No computador B: abra o painel apontando para o IP do A, por exemplo `http://<ip-A>:8080/?broker=ws://<ip-A>:9001#solo`.

### Broker público (testes)

O motor aceita qualquer broker: `MQTT_URL=mqtt://broker.hivemq.com:1883 TOPIC_ROOT=raptorlink-seunome npm run engine`. No painel, use `wss://broker.hivemq.com:8884/mqtt` com o mesmo prefixo. Use um prefixo próprio, porque em um broker público outras pessoas podem estar usando `f22/`.

### Configuração do motor (variáveis de ambiente)

| Variável | Padrão | Descrição |
|---|---|---|
| `MQTT_URL` | `mqtt://localhost:1883` | broker |
| `PUBLISH_MS` | `1000` | intervalo de publicação |
| `TOPIC_ROOT` | `f22` | prefixo dos tópicos |
| `ENGINE_ID` | `motor-raptor-01` | campo `origem` das mensagens |
| `FUEL_BURN_X` | `6` | acelera o consumo de combustível (para a demo chegar a BINGO em poucos minutos) |
| `MQTT_USER` / `MQTT_PASS` | | credenciais, se o broker exigir |

Para depurar os tópicos: `docker compose exec mosquitto mosquitto_sub -t 'f22/#' -v` ou o **MQTT Explorer** em `localhost:1883`.

## Painel web

**Cockpit** (layout inspirado no cockpit real): HUD, UFDs, teclado ICP, três MFDs (motores/combustível/sistemas/ambiente, situação tática, navegação/atitude/RWR), MFD de armamento e consoles com manete, chaves e HOTAS. A telemetria chega a 1 Hz e o painel interpola os valores para os instrumentos se moverem com suavidade.

**Estação de solo**:
- mapa (Leaflet + OpenStreetMap) com posição, rastro, rota, alvos do radar e vento;
- gráficos de série temporal (Chart.js) de navegação, atitude/G, motores, combustível e ambiente, com linhas de limite;
- **rastreamento de mísseis**: tabela com distância ao alvo, tempo até o impacto e progresso de cada míssil; no mapa, ícone, rastro e linha até o alvo; o botão **Acompanhar** (ou a opção de acompanhar novos lançamentos) faz o mapa enquadrar míssil e alvo até o desfecho;
- alertas ativos e histórico;
- comandos ao motor (rajada de vento, novo alvo, manobra de alto G, pausar/retomar, reiniciar);
- cartão por tópico com valor, unidade, horário, sequência, QoS e retenção;
- log das mensagens MQTT (tópico, QoS, retida, tamanho, payload).

Atalhos do cockpit: `L` travar alvo · `N` próximo alvo · `W` arma · `Espaço` disparar · `A` master arm · `F`/`C` flare/chaff · `R` modo radar · `[` `]` alcance · `G` trem · `K` flaps · `B` freio · `PgUp`/`PgDn` manete · `Esc` reconhecer alertas · `M` som.

## Contrato MQTT

### Envelope

Toda leitura publicada pelo motor segue o mesmo formato JSON. Valores escalares levam **valor e unidade**, e o envelope leva o **horário**:

```json
{
  "ts": "2026-11-05T14:00:00.000Z",
  "seq": 812,
  "origem": "motor-raptor-01",
  "dados": {
    "altitude":   { "valor": 28450, "unidade": "ft" },
    "velocidade": { "valor": 540,   "unidade": "kt" }
  }
}
```

### Tópicos, QoS e retenção

| Tópico | QoS | Retido | Dados |
|---|---|---|---|
| `f22/nav` | 0 | não | `altitude` ft, `velocidade` kt, `mach`, `rumo` °, `razaoSubida` ft/min, `latitude` °, `longitude` °, `velocidadeSolo` kt, `trajetoria` °, `waypoint {nome, indice, marcacao, distancia, ete}`, `rota [{nome, lat, lon}]` |
| `f22/atitude` | 0 | não | `arfagem` °, `rolagem` °, `guinada` ° (ângulo de yaw = rumo), `forcaG`, `forcaGMax`, `anguloAtaque` ° |
| `f22/ambiente` | 0 | não | `ventoVelocidade` kt, `ventoDirecao` ° (de onde sopra), `temperaturaExterna` °C, `turbulencia` 0–1, `rajadaAtiva` |
| `f22/motores` | 0 | não | `manete` %; `esquerdo` / `direito`: `empuxo` %, `temperatura` °C, `rpm` %, `consumo` kg/min, `posCombustao` |
| `f22/combustivel` | 1 | **sim** | `quantidade` kg, `consumo` kg/min, `bingo` kg, `autonomia` min |
| `f22/radar` | 1 | não | `modo` (RWS/TWS/STT), `alcance` NM, `estadoMira` (`buscando`/`travado`), `alvos [{id, tipo, marcacao, distancia, altitude, rumo, velocidade, codigo}]`, `alvoTravado {id, distancia, marcacao, aproximacao, aspecto, emAlcance, podeDisparar}` ou `null`, `ameaca {lancamento, marcacao}` |
| `f22/alertas` | 1 | **sim** | `lista [{nivel: aviso\|cuidado\|info, codigo, mensagem}]` |
| `f22/status` | 1 | **sim** + LWT | `online`, `pausado`, `id`, `versao` (versão do contrato; o painel avisa "MOTOR DESATUALIZADO" se não bater), `intervaloMs` |
| `f22/comandos` | 1 | não | painel → motor (ver abaixo) |
| `f22/misseis` | 0 | não | rastreamento: `emVoo`, `lista [{id, lado, tipo, estado, lancadoPor, alvo, latitude, longitude, altitude, rumo, velocidade, marcacao, distancia, distanciaAlvo, tempoImpacto, tempoVoo}]`. Sai a cada 1 s, e a cada **250 ms** enquanto houver míssil no ar |
| `f22/armamento` | 1 | não | extra do cockpit: `masterArm`, `armaSelecionada`, `baias`, `estacoes`, `canhao`, `flares`, `chaff` |
| `f22/sistemas` | 1 | não | extra do cockpit: `trem`, `flaps`, `freioAerodinamico`, `hidraulicaA/B` psi, `tensaoEletrica` V, `apu`, `oxigenio` % |
| `f22/comunicacao` | 1 | não | extra do cockpit: `com1`, `com2`, `iff` |

Na lista de alvos, `marcacao` é absoluta (graus a partir do norte), `distancia` em NM, `altitude` em ft, `rumo` em °, `velocidade` em kt e `tipo` é `hostil`, `amigo` ou `desconhecido`.

Na lista de mísseis, `lado` é `proprio` ou `inimigo` e `estado` é `em voo`, `acertou`, `errou` ou `despistado`. `marcacao` e `distancia` são medidas a partir do F-22; `distanciaAlvo` (NM) e `tempoImpacto` (s) até o alvo; `velocidade` em kt e `altitude` em ft. Depois do desfecho o míssil fica cerca de 6 s na lista, para o painel mostrar o resultado. Mísseis inimigos perseguem o F-22: flare ou chaff tem 85% de chance de despistar cada um, e um impacto causa falha na hidráulica A.

**Por que 4 Hz só com míssil no ar:** a 1 Hz um míssil a Mach 3 anda cerca de 0,6 NM entre leituras, o que é pouco para acompanhar. O motor publica mais rápido só enquanto isso importa e volta a 1 Hz depois, poupando banda.

Por que cada escolha:
- **QoS 0** na telemetria contínua: chega uma leitura nova a cada segundo, então perder uma não faz falta.
- **QoS 1** em estado e eventos (combustível, radar, alertas, comandos), que precisam chegar.
- **Mensagens retidas** em combustível, alertas e status: um painel que acabou de se conectar já recebe o último valor, sem esperar o próximo ciclo.
- **Last Will (LWT)**: ao conectar, o motor registra no broker uma mensagem `status.online = false`. Se ele cair sem se despedir, o broker a publica e o painel mostra **MOTOR OFFLINE**.

### Comandos (`f22/comandos`)

```json
{ "comando": "rajada", "valor": { "intensidade": 45, "duracao": 10 }, "origem": "painel", "ts": "…" }
```

| Comando | Valor |
|---|---|
| `rajada` | `{ intensidade: kt, duracao: s }` |
| `novoAlvo` | `{ tipo?: hostil\|amigo\|desconhecido, marcacao?: °, distancia?: NM }` (campos omitidos = aleatório) |
| `pausa` / `retomar` / `reiniciar` | — |
| `manobra` | — (curva de alto G, dispara o alerta de excesso de G) |
| `ameaca` | — (um caça hostil lança um míssil contra o F-22) |
| `manete` | 0–100 |
| `masterArm`, `freioAerodinamico`, `apu` | `"alternar"` ou `true`/`false` |
| `selecionarArma` | `"proximo"`, `"AIM-120"`, `"AIM-9"`, `"GUN"` |
| `baia` | `"principal"`, `"lateralEsquerda"`, `"lateralDireita"` |
| `modoRadar` | `"proximo"`, `"RWS"`, `"TWS"` |
| `alcanceRadar` | `"aumentar"`, `"diminuir"` ou 10/20/40/80/160 |
| `travarAlvo` | `"alternar"`, `"maisProximo"`, `"proximo"`, `"desligar"` ou id do alvo |
| `disparar` | — |
| `contramedida` | `"flare"`, `"chaff"` |
| `trem` | `"alternar"`, `"baixado"`, `"recolhido"` |
| `flaps` | `"proximo"`, `"recolhido"`, `"decolagem"`, `"pouso"` |
| `waypoint` | `"proximo"`, `"anterior"` ou número |
| `icp` | `{ campo: com1\|com2\|iff\|stpt\|marca, valor: "25150" }` |

Teste pelo terminal: `docker compose exec mosquitto mosquitto_pub -t f22/comandos -q 1 -m '{"comando":"novoAlvo","valor":{"tipo":"hostil","distancia":15}}'`

### Alertas e limites

O motor publica os alertas em `f22/alertas`, e o painel também verifica os limites por conta própria (`cockpit/js/alerts.js`). Os dois conjuntos são mesclados pelo `codigo`:

| Código | Nível | Limite |
|---|---|---|
| `EXCESSO_G` / `G_ALTO` | aviso / cuidado | G > 9 / G > 7,5 |
| `COMBUSTIVEL_BAIXO` / `COMBUSTIVEL_BINGO` | aviso / cuidado | < 900 kg / < bingo (1 800 kg) |
| `SUPERAQUECIMENTO_E/D` / `TEMP_ALTA_E/D` | aviso / cuidado | > 1 000 °C / > 950 °C (pós-combustão prolongada) |
| `AMEACA_MISSIL` | aviso | lançamento de míssil detectado |
| `AERONAVE_ATINGIDA` | aviso | míssil inimigo atingiu o F-22 → painel **CAÇA ATINGIDO** na tela (cockpit e estação de solo) + falha na hidráulica A |
| `TURBULENCIA` | cuidado | turbulência > 0,6 (rajadas fortes) |
| `MIRA_TRAVADA` | info | radar em STT |
| `MOTOR_OFFLINE` / `SEM_TELEMETRIA` | cuidado | LWT recebido / nenhuma leitura há 3,5 s |

Os valores são fictícios e didáticos: o objetivo é reproduzir o fluxo de dados de um ambiente IoT, não as especificações reais da aeronave.

## Estrutura

```
├── docker-compose.yml           # Mosquitto
├── mosquitto/config/mosquitto.conf
├── engine/index.js              # motor de simulação (Node.js + MQTT.js)
└── cockpit/                     # painel web (estático)
    ├── index.html
    ├── css/cockpit.css
    └── js/
        ├── sim/core.js          # núcleo da simulação (compartilhado: motor e modo MOCK)
        ├── sim/runner.js        # laço de passos e publicação periódica
        ├── protocol.js          # tópicos, QoS, envelope, decodificação
        ├── state.js             # estado do painel, metadados por tópico, log
        ├── alerts.js            # limites e mescla de alertas
        ├── smooth.js            # interpolação entre leituras
        ├── mqtt-client.js       # MQTT sobre WebSocket
        ├── main.js              # inicialização, abas, cockpit, comandos
        ├── displays/            # telas do cockpit (canvas)
        └── ground/              # estação de solo: mapa, gráficos, painéis
```
