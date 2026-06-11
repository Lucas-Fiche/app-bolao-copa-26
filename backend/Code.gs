/**
 * ============================================================
 * BOLÃO COPA DO MUNDO 2026 — BACK-END (Google Apps Script)
 * ============================================================
 *
 * Como usar:
 * 1. Abra a planilha do bolão e vá em Extensões > Apps Script.
 * 2. Cole este arquivo inteiro no Code.gs.
 * 3. Implante: Implantar > Nova implantação > Tipo: App da Web
 *    - Executar como: Eu (sua conta)
 *    - Quem pode acessar: Qualquer pessoa  <-- OBRIGATÓRIO para o CORS funcionar
 * 4. Copie a URL gerada (termina em /exec) e cole em js/config.js no front-end.
 *
 * Sobre CORS: o Apps Script não permite responder requisições "preflight"
 * (OPTIONS). Por isso o front-end envia o JSON como Content-Type text/plain
 * (uma "simple request", que não dispara preflight). Com a implantação
 * acessível a "Qualquer pessoa", o Google adiciona automaticamente o header
 * Access-Control-Allow-Origin: * na resposta. Nada mais é necessário aqui.
 *
 * IMPORTANTE: em Configurações do projeto (ícone de engrenagem), confira se o
 * fuso horário do script é o mesmo usado nos horários da aba "Jogos"
 * (ex.: America/Sao_Paulo). A regra dos 30 minutos depende disso.
 */

// ===================== CONFIGURAÇÃO =====================

// Deixe vazio se o script foi criado de dentro da planilha (Extensões > Apps Script).
// Caso contrário, cole aqui o ID da planilha (o trecho longo da URL dela).
const SPREADSHEET_ID = '';

const ABA_JOGADORES = 'Jogadores';
const ABA_JOGOS = 'Jogos';
const ABA_PALPITES = 'Palpites';
const ABA_HISTORICO = 'Historico'; // criada automaticamente por salvarHistorico()

// URL pública do app (usada nos e-mails de lembrete).
const APP_URL = 'https://lucas-fiche.github.io/app-bolao-copa-26/';

const MINUTOS_BLOQUEIO = 30;
const PONTOS_BONUS = 20;          // acertou campeão ou artilheiro
const PONTOS_BONUS_SOZINHO = 30;  // foi o ÚNICO a acertar aquela categoria

// Cada fase do mata-mata abre para palpites à MEIA-NOITE DO DIA ANTERIOR
// à primeira partida da fase (calculado automaticamente da aba Jogos).

/**
 * Pontuação por fase, definida pelo valor da coluna "Grupo" da aba Jogos.
 * Letras (A–L) = fase de grupos. Para o mata-mata, cadastre os jogos com
 * Grupo = "16 avos", "Oitavas", "Quartas", "Semifinal", "3º lugar", "Final".
 */
function pontuacaoDaFase(grupo) {
  const g = normalizarNome(grupo);
  if (g.length <= 1) return { placar: 3, vencedor: 1 };             // grupos A–L
  if (g.indexOf('16') !== -1) return { placar: 4, vencedor: 2 };     // 16 avos
  if (g.indexOf('oitava') !== -1) return { placar: 5, vencedor: 2 };
  if (g.indexOf('quarta') !== -1) return { placar: 6, vencedor: 3 };
  if (g.indexOf('semi') !== -1) return { placar: 8, vencedor: 4 };
  if (g.indexOf('3') !== -1 || g.indexOf('terceiro') !== -1) return { placar: 6, vencedor: 3 };
  if (g.indexOf('final') !== -1) return { placar: 10, vencedor: 5 };
  return { placar: 3, vencedor: 1 };
}

// Preencha no fim do torneio e rode atualizarPontuacao() para aplicar o bônus.
const CAMPEAO_REAL = '';
const ARTILHEIRO_REAL = '';

// Jogadores "fantasma" (ex.: usuário admin de testes): logam e palpitam
// normalmente, mas não aparecem em rankings, palpites revelados,
// histórico nem recebem lembretes. Use o nome exato da aba Jogadores.
const JOGADORES_OCULTOS = ['Admin'];

function ehOculto(nome) {
  return JOGADORES_OCULTOS.some(function (n) { return mesmoTexto(n, nome); });
}

function jogadoresVisiveis(jogadores) {
  return jogadores.filter(function (j) { return !ehOculto(j.nome); });
}

// ===== The Odds API (the-odds-api.com) — odds e placares automáticos =====
// 1. Crie uma conta gratuita e cole a chave abaixo.
// 2. Rode listarEsportes() e confira no log o sport key da Copa
//    (esperado: 'soccer_fifa_world_cup').
// 3. Adicione as colunas H, I e J na aba Jogos: Odd_A | Odd_Empate | Odd_B.
// 4. Crie acionadores por tempo (Acionadores > Adicionar):
//    - atualizarPlacares: a cada 4 horas  (2 créditos/chamada)
//    - atualizarOdds:     1x por dia      (1 crédito/chamada)
//    Plano gratuito = 500 créditos/mês; essa cadência usa ~390.
const ODDS_API_KEY = 'COLE_SUA_CHAVE_AQUI';
const ODDS_API_SPORT = 'soccer_fifa_world_cup';

// A API usa nomes em inglês; a planilha, em português.
const NOMES_API = {
  'Germany': 'Alemanha', 'Argentina': 'Argentina', 'Algeria': 'Argélia',
  'Saudi Arabia': 'Arábia Saudita', 'Australia': 'Austrália', 'Brazil': 'Brasil',
  'Belgium': 'Bélgica', 'Bosnia and Herzegovina': 'Bósnia e Herz.',
  'Bosnia & Herzegovina': 'Bósnia e Herz.', 'Bosnia-Herzegovina': 'Bósnia e Herz.',
  'Bosnia Herzegovina': 'Bósnia e Herz.', 'Bosnia': 'Bósnia e Herz.',
  'Bosnia and Herz.': 'Bósnia e Herz.',
  'Cape Verde': 'Cabo Verde', 'Canada': 'Canadá', 'Qatar': 'Catar',
  'Colombia': 'Colômbia', 'South Korea': 'Coreia do Sul',
  'Korea Republic': 'Coreia do Sul',
  'Ivory Coast': 'Costa do Marfim', "Cote d'Ivoire": 'Costa do Marfim',
  'Croatia': 'Croácia', 'Curacao': 'Curaçao', 'Curaçao': 'Curaçao',
  'Egypt': 'Egito', 'Ecuador': 'Equador', 'Scotland': 'Escócia',
  'Spain': 'Espanha', 'United States': 'Estados Unidos', 'USA': 'Estados Unidos',
  'United States of America': 'Estados Unidos',
  'France': 'França', 'Ghana': 'Gana', 'Haiti': 'Haiti',
  'Netherlands': 'Holanda', 'England': 'Inglaterra', 'Iraq': 'Iraque',
  'Iran': 'Irã', 'IR Iran': 'Irã',
  'Japan': 'Japão', 'Jordan': 'Jordânia', 'Morocco': 'Marrocos',
  'Mexico': 'México', 'Norway': 'Noruega', 'New Zealand': 'Nova Zelândia',
  'Panama': 'Panamá', 'Paraguay': 'Paraguai', 'Portugal': 'Portugal',
  'DR Congo': 'RD Congo', 'Congo DR': 'RD Congo',
  'Democratic Republic of the Congo': 'RD Congo', 'Czech Republic': 'Rep. Tcheca',
  'Czechia': 'Rep. Tcheca', 'Senegal': 'Senegal', 'Sweden': 'Suécia',
  'Switzerland': 'Suíça', 'Tunisia': 'Tunísia', 'Turkey': 'Turquia',
  'Türkiye': 'Turquia', 'Uruguay': 'Uruguai', 'Uzbekistan': 'Uzbequistão',
  'South Africa': 'África do Sul', 'Austria': 'Áustria'
};

// ===================== PONTOS DE ENTRADA (API) =====================

/**
 * GET — dados públicos: lista de jogadores (sem PIN), jogos e ranking.
 * Uso: <URL_DO_APP>?action=init
 */
function doGet(e) {
  try {
    const action = (e && e.parameter && e.parameter.action) || 'init';
    if (action === 'init') return responderJson(montarInit());
    if (action === 'debug') return responderJson(montarDebug());
    return responderJson({ ok: false, erro: 'Ação desconhecida: ' + action });
  } catch (err) {
    return responderJson({ ok: false, erro: String(err) });
  }
}

/**
 * POST — ações autenticadas. Body: JSON (enviado como text/plain).
 *   { action: 'login',  nome, pin }
 *   { action: 'salvar', nome, pin, campeao, artilheiro,
 *     palpites: [{ idJogo, golsA, golsB }, ...] }
 */
function doPost(e) {
  try {
    const payload = JSON.parse(e.postData.contents);
    switch (payload.action) {
      case 'login':  return responderJson(fazerLogin(payload));
      case 'salvar': return responderJson(salvarPalpites(payload));
      default:       return responderJson({ ok: false, erro: 'Ação desconhecida.' });
    }
  } catch (err) {
    return responderJson({ ok: false, erro: 'Requisição inválida: ' + String(err) });
  }
}

// ===================== AÇÕES =====================

function montarInit() {
  const jogadores = lerJogadores();
  const jogos = lerJogos();
  const agora = new Date();
  // Estatísticas consideram só os jogadores visíveis (admin fica de fora).
  const visiveis = jogadoresVisiveis(jogadores);
  const rankings = montarRankings(visiveis, jogos);
  const palpitesPorJogo = montarPalpitesRevelados(visiveis, jogos, agora);
  const aberturas = aberturasDasFases(jogos);

  // Quem já palpitou em cada jogo (só os nomes — nunca os placares).
  // Permite ao app mostrar a lista de quem fez/falta sem vazar palpites.
  const nomesVisiveis = {};
  visiveis.forEach(function (j) { nomesVisiveis[j.nome] = true; });
  const palpitaramPorJogo = {};
  lerPalpites().forEach(function (p) {
    if (!nomesVisiveis[p.nome]) return;
    if (!palpitaramPorJogo[p.idJogo]) palpitaramPorJogo[p.idJogo] = [];
    if (palpitaramPorJogo[p.idJogo].indexOf(p.nome) === -1) {
      palpitaramPorJogo[p.idJogo].push(p.nome);
    }
  });
  return {
    ok: true,
    serverTime: agora.getTime(),
    aberturasFases: (function () {
      const out = {};
      Object.keys(aberturas).forEach(function (k) { out[k] = aberturas[k].getTime(); });
      return out;
    })(),
    bonusBloqueado: bonusBloqueado(jogos, agora),
    jogadores: jogadores.map(function (j) { return j.nome; }),
    ranking: rankings.geral,
    rankingBrasil: rankings.brasil,
    historico: lerHistorico(),
    jogos: jogos.map(function (j) {
      return {
        id: j.id,
        grupo: j.grupo,
        timestamp: j.dataHora ? j.dataHora.getTime() : null,
        dataHoraTexto: j.dataHora ? formatarDataHora(j.dataHora) : '',
        timeA: j.timeA,
        timeB: j.timeB,
        golsAReal: j.golsA === '' ? null : Number(j.golsA),
        golsBReal: j.golsB === '' ? null : Number(j.golsB),
        odds: (Number(j.oddA) > 0 && Number(j.oddX) > 0 && Number(j.oddB) > 0)
          ? { a: Number(j.oddA), x: Number(j.oddX), b: Number(j.oddB) }
          : null,
        bloqueado: jogoBloqueado(j, agora, aberturas),
        palpitaram: palpitaramPorJogo[j.id] || [],
        palpites: palpitesPorJogo[j.id] || null
      };
    })
  };
}

/**
 * Palpites revelados: somente de jogos que JÁ COMEÇARAM (e que portanto
 * estão travados há pelo menos 30 minutos — impossível copiar). Jogos
 * futuros nunca têm os palpites enviados ao app. Quem não palpitou
 * aparece como "esqueceu" e marca 0 ponto; com resultado lançado, cada
 * palpite recebe os pontos ganhos.
 */
function montarPalpitesRevelados(jogadores, jogos, agora) {
  const porJogo = {};
  const iniciados = jogos.filter(function (j) {
    return j.dataHora && j.dataHora.getTime() <= agora.getTime();
  });
  if (!iniciados.length) return porJogo;

  const palpitesDe = {};
  lerPalpites().forEach(function (p) {
    palpitesDe[p.nome + '|' + String(p.idJogo)] = p;
  });

  iniciados.forEach(function (jogo) {
    const temResultado = jogo.golsA !== '' && jogo.golsB !== '';
    const fase = pontuacaoDaFase(jogo.grupo);
    porJogo[jogo.id] = jogadores.map(function (j) {
      const p = palpitesDe[j.nome + '|' + String(jogo.id)];
      if (!p) {
        return { nome: j.nome, golsA: null, golsB: null, esqueceu: true,
                 pontos: temResultado ? 0 : null, exato: false };
      }
      const pts = temResultado
        ? pontosDoPalpite(Number(p.golsA), Number(p.golsB), Number(jogo.golsA), Number(jogo.golsB), fase)
        : null;
      return {
        nome: j.nome,
        golsA: Number(p.golsA),
        golsB: Number(p.golsB),
        pontos: pts,
        exato: pts !== null && pts === fase.placar
      };
    }).sort(function (a, b) {
      return (b.pontos || 0) - (a.pontos || 0) || a.nome.localeCompare(b.nome);
    });
  });
  return porJogo;
}

function fazerLogin(payload) {
  const jogador = autenticar(payload.nome, payload.pin);
  if (!jogador) return { ok: false, erro: 'Nome ou PIN incorretos.' };

  const palpites = {};
  lerPalpites().forEach(function (p) {
    if (p.nome === jogador.nome) palpites[p.idJogo] = { golsA: p.golsA, golsB: p.golsB };
  });

  return {
    ok: true,
    nome: jogador.nome,
    campeao: jogador.campeao,
    artilheiro: jogador.artilheiro,
    palpites: palpites
  };
}

function salvarPalpites(payload) {
  const jogador = autenticar(payload.nome, payload.pin);
  if (!jogador) return { ok: false, erro: 'Nome ou PIN incorretos.' };

  // Evita que dois salvamentos simultâneos dupliquem linhas no upsert.
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const agora = new Date();
    const jogos = lerJogos();
    const aberturas = aberturasDasFases(jogos);
    const mapaJogos = {};
    jogos.forEach(function (j) { mapaJogos[String(j.id)] = j; });

    const sheet = getAba(ABA_PALPITES);
    const valores = sheet.getDataRange().getValues();
    const linhaDe = {}; // "nome|idJogo" -> número da linha (1-based)
    for (var i = 1; i < valores.length; i++) {
      linhaDe[String(valores[i][0]) + '|' + String(valores[i][1])] = i + 1;
    }

    const salvos = [];
    const rejeitados = [];

    (payload.palpites || []).forEach(function (p) {
      const jogo = mapaJogos[String(p.idJogo)];
      if (!jogo) {
        rejeitados.push({ idJogo: p.idJogo, motivo: 'Jogo não encontrado.' });
        return;
      }
      // Cada fase do mata-mata só abre na véspera da primeira partida dela.
      if (mataMataAindaFechado(jogo.grupo, agora, aberturas)) {
        rejeitados.push({ idJogo: p.idJogo,
          motivo: 'Palpites desta fase abrem em ' +
            formatarDataHora(aberturas[chaveDaFase(jogo.grupo)]) + '.' });
        return;
      }
      // Regra dos 30 minutos: jogo prestes a começar, em andamento ou
      // encerrado não aceita alteração — o palpite anterior é mantido.
      if (jogoBloqueado(jogo, agora, aberturas)) {
        rejeitados.push({ idJogo: p.idJogo, motivo: 'Palpites encerrados para este jogo.' });
        return;
      }
      const golsA = normalizarGols(p.golsA);
      const golsB = normalizarGols(p.golsB);
      if (golsA === null || golsB === null) {
        rejeitados.push({ idJogo: p.idJogo, motivo: 'Placar inválido.' });
        return;
      }
      const chave = jogador.nome + '|' + String(jogo.id);
      const linha = [jogador.nome, jogo.id, golsA, golsB, agora];
      if (linhaDe[chave]) {
        sheet.getRange(linhaDe[chave], 1, 1, 5).setValues([linha]); // upsert: atualiza
      } else {
        sheet.appendRow(linha); // upsert: insere
        linhaDe[chave] = sheet.getLastRow();
      }
      salvos.push(jogo.id);
    });

    // Bônus (Campeão/Artilheiro): cada campo só pode ser gravado UMA vez
    // (palpite definitivo) e, no máximo, até o 1º jogo do torneio.
    var bonusSalvo = false;
    const novoCampeao = temTexto(payload.campeao) && !temTexto(jogador.campeao)
      ? payload.campeao : '';
    const novoArtilheiro = temTexto(payload.artilheiro) && !temTexto(jogador.artilheiro)
      ? payload.artilheiro : '';
    if ((novoCampeao || novoArtilheiro) && !bonusBloqueado(jogos, agora)) {
      gravarBonus(jogador.nome, novoCampeao, novoArtilheiro);
      bonusSalvo = true;
    }

    return { ok: true, salvos: salvos, rejeitados: rejeitados, bonusSalvo: bonusSalvo };
  } finally {
    lock.releaseLock();
  }
}

// ===================== PONTUAÇÃO =====================

/**
 * Pontos de bônus (campeão/artilheiro): 20 por acerto, 30 se o jogador
 * for o único do bolão a acertar aquela categoria. Retorna uma função
 * que calcula o bônus de cada jogador (as contagens são feitas uma vez).
 */
function pontosDeBonus(jogadores) {
  const acertouCampeao = function (j) {
    return temTexto(CAMPEAO_REAL) && mesmoTexto(j.campeao, CAMPEAO_REAL);
  };
  const acertouArtilheiro = function (j) {
    return temTexto(ARTILHEIRO_REAL) && mesmoTexto(j.artilheiro, ARTILHEIRO_REAL);
  };
  const nCampeao = jogadores.filter(acertouCampeao).length;
  const nArtilheiro = jogadores.filter(acertouArtilheiro).length;
  return function (j) {
    var pts = 0;
    if (acertouCampeao(j)) pts += (nCampeao === 1 ? PONTOS_BONUS_SOZINHO : PONTOS_BONUS);
    if (acertouArtilheiro(j)) pts += (nArtilheiro === 1 ? PONTOS_BONUS_SOZINHO : PONTOS_BONUS);
    return pts;
  };
}

/**
 * Calcula os rankings em tempo real a partir dos palpites e dos jogos
 * com resultado lançado: o geral (com bônus de campeão/artilheiro) e o
 * só com jogos do Brasil. Desempate: mais placares exatos, depois nome.
 * Quem não palpitou marca 0 ponto no jogo (sem palpite, sem pontos —
 * um 0x0 automático premiaria o esquecimento em jogos sem gols).
 */
function montarRankings(jogadores, jogos) {
  const finalizados = jogos.filter(function (j) {
    return j.golsA !== '' && j.golsB !== '' && j.dataHora;
  });
  const doBrasil = finalizados.filter(function (j) {
    return String(j.timeA).trim() === 'Brasil' || String(j.timeB).trim() === 'Brasil';
  });

  const palpitesDe = {}; // "nome|idJogo" -> { golsA, golsB }
  lerPalpites().forEach(function (p) {
    palpitesDe[p.nome + '|' + String(p.idJogo)] = p;
  });

  function somarPontos(nome, lista) {
    var pontos = 0, exatos = 0;
    lista.forEach(function (jogo) {
      const palpite = palpitesDe[nome + '|' + String(jogo.id)];
      if (!palpite) return; // não palpitou: 0 ponto neste jogo
      const fase = pontuacaoDaFase(jogo.grupo);
      const pts = pontosDoPalpite(
        Number(palpite.golsA), Number(palpite.golsB),
        Number(jogo.golsA), Number(jogo.golsB), fase
      );
      pontos += pts;
      if (pts === fase.placar) exatos++;
    });
    return { pontos: pontos, exatos: exatos };
  }

  const geral = [], brasil = [];
  const bonusDe = pontosDeBonus(jogadores);
  jogadores.forEach(function (j) {
    // Campeão e artilheiro entram no ranking para o detalhe de cada
    // jogador no app (os palpites de bônus são definitivos).
    const g = somarPontos(j.nome, finalizados);
    g.pontos += bonusDe(j);
    geral.push({ nome: j.nome, pontos: g.pontos, exatos: g.exatos,
                 campeao: j.campeao, artilheiro: j.artilheiro });

    const b = somarPontos(j.nome, doBrasil);
    brasil.push({ nome: j.nome, pontos: b.pontos, exatos: b.exatos,
                  campeao: j.campeao, artilheiro: j.artilheiro });
  });

  const ordenar = function (a, b) {
    return b.pontos - a.pontos || b.exatos - a.exatos || a.nome.localeCompare(b.nome);
  };
  geral.sort(ordenar);
  brasil.sort(ordenar);
  return { geral: geral, brasil: brasil };
}

/**
 * Recalcula a Pontuacao_Total de todos os jogadores.
 * Rode manualmente após lançar resultados na aba "Jogos", ou crie um
 * acionador (Acionadores > Adicionar acionador > baseado em tempo, a cada hora).
 *
 * Quem não palpitou marca 0 ponto no jogo (sem palpite, sem pontos).
 */
function atualizarPontuacao() {
  const jogosFinalizados = lerJogos().filter(function (j) {
    return j.golsA !== '' && j.golsB !== '' && j.dataHora;
  });

  const palpitesDe = {}; // "nome|idJogo" -> { golsA, golsB }
  lerPalpites().forEach(function (p) {
    palpitesDe[p.nome + '|' + String(p.idJogo)] = p;
  });

  const sheet = getAba(ABA_JOGADORES);
  const valores = sheet.getDataRange().getValues();
  const bonusDe = pontosDeBonus(lerJogadores());

  for (var i = 1; i < valores.length; i++) {
    const nome = String(valores[i][0]).trim();
    if (!nome) continue;
    var total = 0;

    jogosFinalizados.forEach(function (jogo) {
      const palpite = palpitesDe[nome + '|' + String(jogo.id)];
      if (!palpite) return; // não palpitou: 0 ponto neste jogo
      total += pontosDoPalpite(
        Number(palpite.golsA), Number(palpite.golsB),
        Number(jogo.golsA), Number(jogo.golsB),
        pontuacaoDaFase(jogo.grupo)
      );
    });

    total += bonusDe({ campeao: valores[i][2], artilheiro: valores[i][3] });

    sheet.getRange(i + 1, 5).setValue(total); // coluna Pontuacao_Total
  }
}

function pontosDoPalpite(palpiteA, palpiteB, realA, realB, fase) {
  if (palpiteA === realA && palpiteB === realB) return fase.placar;
  const sinal = function (a, b) { return a > b ? 1 : (a < b ? -1 : 0); };
  if (sinal(palpiteA, palpiteB) === sinal(realA, realB)) return fase.vencedor;
  return 0;
}

// ============== THE ODDS API: ODDS E PLACARES AUTOMÁTICOS ==============

/**
 * Busca as odds 1x2 (casa/empate/fora) e grava nas colunas H/I/J da aba
 * Jogos (Odd_A | Odd_Empate | Odd_B), tirando a média entre as casas de
 * aposta. Rode manualmente ou crie um acionador diário.
 */
function atualizarOdds() {
  // Economia de créditos: sem jogos futuros, não há odds para buscar.
  const futuros = lerJogos().filter(function (j) {
    return j.dataHora && j.dataHora.getTime() > Date.now();
  });
  if (!futuros.length) {
    Logger.log('atualizarOdds: nenhum jogo futuro — chamada à API poupada.');
    return;
  }

  const eventos = chamarOddsApi('odds', '&regions=eu&markets=h2h&oddsFormat=decimal');
  const aba = getAba(ABA_JOGOS);

  // Antes de gravar odds, usa os mesmos eventos para substituir os
  // placeholders do mata-mata ("1º Grupo A" etc.) pelos confrontos reais.
  preencherConfrontosMataMata(eventos, aba);

  const linhaDe = indexarJogosPorTimes(aba);
  var gravados = 0;

  eventos.forEach(function (ev) {
    const casa = traduzirTime(ev.home_team);
    const fora = traduzirTime(ev.away_team);

    // Média das odds entre os bookmakers (mais estável que pegar um só).
    var soma = { casa: 0, empate: 0, fora: 0 }, n = 0;
    (ev.bookmakers || []).forEach(function (bk) {
      const h2h = (bk.markets || []).filter(function (m) { return m.key === 'h2h'; })[0];
      if (!h2h) return;
      var oCasa, oEmpate, oFora;
      h2h.outcomes.forEach(function (o) {
        if (o.name === ev.home_team) oCasa = o.price;
        else if (o.name === ev.away_team) oFora = o.price;
        else oEmpate = o.price; // 'Draw'
      });
      if (oCasa && oEmpate && oFora) {
        soma.casa += oCasa; soma.empate += oEmpate; soma.fora += oFora; n++;
      }
    });
    if (!n) return;

    const odd = function (x) { return Math.round((x / n) * 100) / 100; };
    var alvo = linhaDe[chaveTimes(casa, fora)];
    if (alvo) {
      aba.getRange(alvo, 8, 1, 3).setValues([[odd(soma.casa), odd(soma.empate), odd(soma.fora)]]);
      gravados++;
      return;
    }
    alvo = linhaDe[chaveTimes(fora, casa)]; // planilha com mando invertido
    if (alvo) {
      aba.getRange(alvo, 8, 1, 3).setValues([[odd(soma.fora), odd(soma.empate), odd(soma.casa)]]);
      gravados++;
      return;
    }
    // Nome fora do mapa NOMES_API: registre para ajustar o mapa.
    Logger.log('atualizarOdds: sem correspondência para "' + ev.home_team +
      ' x ' + ev.away_team + '" (traduzido: ' + casa + ' x ' + fora + ')');
  });
  Logger.log('atualizarOdds: odds gravadas em ' + gravados + ' jogo(s).');
}

/**
 * Busca os jogos encerrados nas últimas 48h e preenche Gols_A_Real e
 * Gols_B_Real automaticamente. Só escreve em células vazias — uma
 * correção manual sua nunca é sobrescrita. Acionador sugerido: a cada 4h.
 */
function atualizarPlacares() {
  // Economia de créditos: só chama a API se existir jogo iniciado há
  // mais de 2h (tempo de acabar) ainda sem resultado na planilha.
  // Em dias sem jogos, o acionador roda e não gasta nada.
  const agora = Date.now();
  const pendentes = lerJogos().filter(function (j) {
    return j.dataHora && (agora - j.dataHora.getTime()) > 2 * 3600000 &&
           (j.golsA === '' || j.golsB === '');
  });
  if (!pendentes.length) {
    Logger.log('atualizarPlacares: nenhum resultado pendente — chamada à API poupada.');
    return;
  }

  const eventos = chamarOddsApi('scores', '&daysFrom=2');
  const aba = getAba(ABA_JOGOS);
  const valores = aba.getDataRange().getValues();
  const linhaDe = indexarJogosPorTimes(aba);
  var gravados = 0;

  eventos.forEach(function (ev) {
    if (!ev.completed || !ev.scores) return;
    const casa = traduzirTime(ev.home_team);
    const fora = traduzirTime(ev.away_team);
    var golsCasa = null, golsFora = null;
    ev.scores.forEach(function (s) {
      if (s.name === ev.home_team) golsCasa = Number(s.score);
      else if (s.name === ev.away_team) golsFora = Number(s.score);
    });
    if (golsCasa === null || golsFora === null || isNaN(golsCasa) || isNaN(golsFora)) return;

    var linha = linhaDe[chaveTimes(casa, fora)], golsA = golsCasa, golsB = golsFora;
    if (!linha) {
      linha = linhaDe[chaveTimes(fora, casa)];
      golsA = golsFora; golsB = golsCasa;
    }
    if (!linha) {
      Logger.log('atualizarPlacares: sem correspondência para "' + ev.home_team +
        ' x ' + ev.away_team + '" (traduzido: ' + casa + ' x ' + fora + ')');
      return;
    }
    // Não sobrescreve resultado já lançado (manual ou de execução anterior).
    if (valores[linha - 1][5] !== '' && valores[linha - 1][6] !== '') return;
    aba.getRange(linha, 6, 1, 2).setValues([[golsA, golsB]]);
    gravados++;
  });
  Logger.log('atualizarPlacares: ' + gravados + ' resultado(s) lançado(s).');
}

/**
 * Substitui automaticamente os placeholders do mata-mata pelos confrontos
 * reais publicados pela API. O casamento é por DIA: a linha de fase com
 * os dois times ainda em placeholder, no mesmo dia do evento, recebe os
 * times reais E o horário oficial (a Data_Hora estimada é corrigida).
 * Com vários jogos no dia, os eventos são atribuídos em ordem de horário.
 */
function preencherConfrontosMataMata(eventos, aba) {
  const valores = aba.getDataRange().getValues();

  // Seleções conhecidas (nomes PT do mapa, normalizados).
  const selecoes = {};
  Object.keys(NOMES_API).forEach(function (k) {
    selecoes[normalizarNome(NOMES_API[k])] = true;
  });
  const ehPlaceholder = function (nome) {
    return !selecoes[normalizarNome(nome)];
  };

  // Confrontos que já existem na planilha (para não duplicar).
  const jaExiste = indexarJogosPorTimes(aba);

  // Linhas de mata-mata ainda com placeholders, em ordem de horário.
  const vagas = [];
  for (var i = 1; i < valores.length; i++) {
    const l = valores[i];
    if (String(l[0]).trim() === '') continue;
    if (normalizarNome(l[1]).length <= 1) continue; // fase de grupos
    if (!ehPlaceholder(l[3]) || !ehPlaceholder(l[4])) continue;
    const dataHora = parseDataHora(l[2]);
    if (dataHora) vagas.push({ linha: i + 1, dataHora: dataHora, usada: false });
  }
  if (!vagas.length) return;
  vagas.sort(function (a, b) { return a.dataHora - b.dataHora; });

  const mesmoDia = function (d1, d2) {
    return d1.getFullYear() === d2.getFullYear() &&
           d1.getMonth() === d2.getMonth() && d1.getDate() === d2.getDate();
  };

  var preenchidos = 0;
  eventos
    .slice()
    .sort(function (a, b) { return new Date(a.commence_time) - new Date(b.commence_time); })
    .forEach(function (ev) {
      const casa = traduzirTime(ev.home_team);
      const fora = traduzirTime(ev.away_team);
      if (ehPlaceholder(casa) || ehPlaceholder(fora)) return; // evento sem times reais
      if (jaExiste[chaveTimes(casa, fora)] || jaExiste[chaveTimes(fora, casa)]) return;

      const inicio = new Date(ev.commence_time);
      if (isNaN(inicio.getTime())) return;

      const vaga = vagas.filter(function (v) {
        return !v.usada && mesmoDia(v.dataHora, inicio);
      })[0]; // primeira vaga livre do dia (eventos chegam em ordem de horário)
      if (!vaga) return;

      vaga.usada = true;
      aba.getRange(vaga.linha, 3, 1, 3).setValues([[inicio, casa, fora]]);
      jaExiste[chaveTimes(casa, fora)] = vaga.linha;
      preenchidos++;
      Logger.log('Mata-mata: linha ' + vaga.linha + ' -> ' + casa + ' x ' + fora +
        ' (' + formatarDataHora(inicio) + ')');
    });

  if (preenchidos) {
    Logger.log('Mata-mata: ' + preenchidos + ' confronto(s) preenchido(s) automaticamente.');
  }
}

/**
 * Diagnóstico: lista no log os esportes disponíveis na sua conta
 * (chamada gratuita) para confirmar o sport key da Copa, e mostra
 * quantos créditos restam no mês.
 */
function listarEsportes() {
  const resp = UrlFetchApp.fetch(
    'https://api.the-odds-api.com/v4/sports/?apiKey=' + ODDS_API_KEY,
    { muteHttpExceptions: true });
  Logger.log('Créditos restantes: ' + resp.getHeaders()['x-requests-remaining']);
  JSON.parse(resp.getContentText()).forEach(function (e) {
    if (e.key.indexOf('soccer') === 0) Logger.log(e.key + ' -> ' + e.title);
  });
}

function chamarOddsApi(endpoint, params) {
  if (ODDS_API_KEY === 'COLE_SUA_CHAVE_AQUI') {
    throw new Error('Configure ODDS_API_KEY no topo do Code.gs.');
  }
  const url = 'https://api.the-odds-api.com/v4/sports/' + ODDS_API_SPORT +
    '/' + endpoint + '/?apiKey=' + ODDS_API_KEY + params;
  const resp = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
  if (resp.getResponseCode() !== 200) {
    throw new Error('The Odds API (' + endpoint + '): ' + resp.getContentText());
  }
  const headers = resp.getHeaders();
  const restantes = Number(headers['x-requests-remaining'] || headers['X-Requests-Remaining']);
  Logger.log('Créditos restantes: ' + restantes);
  if (restantes && restantes < 50) avisarCotaBaixa(restantes);
  return JSON.parse(resp.getContentText());
}

/** Avisa por e-mail (1x por mês) quando a cota da The Odds API ficar baixa. */
function avisarCotaBaixa(restantes) {
  try {
    const props = PropertiesService.getScriptProperties();
    const mes = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM');
    if (props.getProperty('avisoCotaOdds') === mes) return;
    props.setProperty('avisoCotaOdds', mes);
    MailApp.sendEmail(Session.getEffectiveUser().getEmail(),
      '⚠️ Bolão: créditos da The Odds API acabando',
      'Restam apenas ' + restantes + ' créditos neste mês.\n\n' +
      'Se zerarem, o app continua funcionando normalmente — apenas as ' +
      'odds e o lançamento automático de placares param até a cota ' +
      'renovar; nesse período, lance os resultados manualmente na aba Jogos.');
  } catch (e) {
    Logger.log('Falha ao enviar aviso de cota: ' + e);
  }
}

/**
 * Normaliza nomes de seleções para comparação: minúsculas, sem acentos
 * e sem pontuação. Assim "Bósnia e Herz.", "Bosnia & Herzegovina" e
 * variações com acento/abreviação casam entre si.
 */
function normalizarNome(s) {
  return String(s).toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // remove acentos
    .replace(/[^a-z0-9]+/g, ' ')                       // pontuação vira espaço
    .trim();
}

var _mapaNomesNormalizado = null;
function traduzirTime(nomeApi) {
  if (!_mapaNomesNormalizado) {
    _mapaNomesNormalizado = {};
    Object.keys(NOMES_API).forEach(function (k) {
      _mapaNomesNormalizado[normalizarNome(k)] = NOMES_API[k];
    });
  }
  return _mapaNomesNormalizado[normalizarNome(nomeApi)] || String(nomeApi).trim();
}

function chaveTimes(a, b) {
  return normalizarNome(a) + '|' + normalizarNome(b);
}

/** Mapa "timeA|timeB" -> número da linha na aba Jogos (1-based). */
function indexarJogosPorTimes(aba) {
  const valores = aba.getDataRange().getValues();
  const mapa = {};
  for (var i = 1; i < valores.length; i++) {
    if (String(valores[i][0]).trim() === '') continue;
    mapa[chaveTimes(valores[i][3], valores[i][4])] = i + 1;
  }
  return mapa;
}

// ============== LEMBRETES E HISTÓRICO (acionadores diários) ==============

/**
 * Envia e-mail para quem ainda não palpitou nos jogos de AMANHÃ.
 * Requer a coluna F (Email) na aba Jogadores — sem e-mail, é ignorado.
 * Acionador sugerido: diário, entre 18h e 19h.
 */
function enviarLembretes() {
  const agora = new Date();
  const iniAmanha = new Date(agora.getFullYear(), agora.getMonth(), agora.getDate() + 1);
  const fimAmanha = new Date(agora.getFullYear(), agora.getMonth(), agora.getDate() + 2);

  const todosJogos = lerJogos();
  const aberturas = aberturasDasFases(todosJogos);
  const jogosAmanha = todosJogos.filter(function (j) {
    return j.dataHora && j.dataHora >= iniAmanha && j.dataHora < fimAmanha &&
           !mataMataAindaFechado(j.grupo, agora, aberturas);
  });
  if (!jogosAmanha.length) {
    Logger.log('enviarLembretes: sem jogos amanhã.');
    return;
  }

  const temPalpite = {};
  lerPalpites().forEach(function (p) {
    temPalpite[p.nome + '|' + String(p.idJogo)] = true;
  });

  var enviados = 0;
  jogadoresVisiveis(lerJogadores()).forEach(function (j) {
    if (!temTexto(j.email)) return;
    const pendentes = jogosAmanha.filter(function (g) {
      return !temPalpite[j.nome + '|' + String(g.id)];
    });
    if (!pendentes.length) return;

    const lista = pendentes.map(function (g) {
      return '  • ' + formatarDataHora(g.dataHora) + ' — ' + g.timeA + ' x ' + g.timeB;
    }).join('\n');

    MailApp.sendEmail(j.email,
      '⚽ Bolão do PRTTS: faltam seus palpites de amanhã!',
      'Olá, ' + j.nome + '!\n\n' +
      'Você ainda não palpitou nestes jogos de amanhã:\n\n' + lista + '\n\n' +
      'Lembre-se: os palpites travam 30 minutos antes de cada jogo, e quem ' +
      'não palpita fica com 0 ponto na partida. 💤\n\n' +
      'Palpite agora: ' + APP_URL + '\n\n— Bolão do PRTTS 🥇');
    enviados++;
  });
  Logger.log('enviarLembretes: ' + enviados + ' lembrete(s) enviado(s).');
}

/**
 * Grava um retrato diário do ranking geral na aba "Historico"
 * (Data | Nome | Pontos), usada pelo gráfico de evolução do app.
 * Rodar de novo no mesmo dia sobrescreve o retrato do dia.
 * Acionador sugerido: diário, entre 6h e 7h.
 */
function salvarHistorico() {
  const ranking = montarRankings(jogadoresVisiveis(lerJogadores()), lerJogos()).geral;
  var aba = getPlanilha().getSheetByName(ABA_HISTORICO);
  if (!aba) {
    aba = getPlanilha().insertSheet(ABA_HISTORICO);
    aba.appendRow(['Data', 'Nome', 'Pontos']);
  }

  const hoje = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'dd/MM/yyyy');
  const valores = aba.getDataRange().getValues();
  for (var i = valores.length - 1; i >= 1; i--) {
    if (dataCurta(valores[i][0], true) === hoje) aba.deleteRow(i + 1);
  }
  ranking.forEach(function (r) {
    aba.appendRow([hoje, r.nome, r.pontos]);
  });
  Logger.log('salvarHistorico: retrato de ' + hoje + ' gravado (' + ranking.length + ' jogadores).');
}

/** Histórico para o gráfico do app: [{ data: 'dd/MM', nome, pontos }] */
function lerHistorico() {
  const aba = getPlanilha().getSheetByName(ABA_HISTORICO);
  if (!aba) return [];
  return aba.getDataRange().getValues().slice(1)
    .filter(function (l) { return String(l[1] || '').trim() !== ''; })
    .map(function (l) {
      return {
        data: dataCurta(l[0], false),
        nome: String(l[1]).trim(),
        pontos: Number(l[2]) || 0
      };
    });
}

/** Normaliza a célula de data do histórico ("dd/MM" ou "dd/MM/yyyy"). */
function dataCurta(valor, completa) {
  const fmt = completa ? 'dd/MM/yyyy' : 'dd/MM';
  if (valor instanceof Date) {
    return Utilities.formatDate(valor, Session.getScriptTimeZone(), fmt);
  }
  const s = String(valor).trim();
  return completa ? s : s.slice(0, 5);
}

// ===================== REGRAS DE TEMPO =====================

function jogoBloqueado(jogo, agora, aberturas) {
  if (!jogo.dataHora) return true; // sem data válida, melhor não aceitar palpite
  if (mataMataAindaFechado(jogo.grupo, agora, aberturas)) return true;
  return (jogo.dataHora.getTime() - agora.getTime()) < MINUTOS_BLOQUEIO * 60 * 1000;
}

/** Identificador da fase de mata-mata, ou null para grupos (A–L). */
function chaveDaFase(grupo) {
  const g = normalizarNome(grupo);
  if (g.length <= 1) return null;
  if (g.indexOf('16') !== -1) return 'avos16';
  if (g.indexOf('oitava') !== -1) return 'oitavas';
  if (g.indexOf('quarta') !== -1) return 'quartas';
  if (g.indexOf('semi') !== -1) return 'semifinal';
  if (g.indexOf('3') !== -1 || g.indexOf('terceiro') !== -1) return 'terceiro';
  if (g.indexOf('final') !== -1) return 'final';
  return null;
}

/**
 * Abertura de cada fase: 00:00 do dia anterior à primeira partida dela.
 * Calculado da própria aba Jogos — mudou a data lá, a abertura acompanha.
 */
function aberturasDasFases(jogos) {
  const primeira = {};
  jogos.forEach(function (j) {
    const chave = chaveDaFase(j.grupo);
    if (!chave || !j.dataHora) return;
    if (!primeira[chave] || j.dataHora < primeira[chave]) primeira[chave] = j.dataHora;
  });
  const aberturas = {};
  Object.keys(primeira).forEach(function (k) {
    const d = primeira[k];
    aberturas[k] = new Date(d.getFullYear(), d.getMonth(), d.getDate() - 1, 0, 0, 0);
  });
  return aberturas;
}

function mataMataAindaFechado(grupo, agora, aberturas) {
  const chave = chaveDaFase(grupo);
  const abertura = (chave && aberturas) ? aberturas[chave] : null;
  return !!abertura && agora.getTime() < abertura.getTime();
}

function bonusBloqueado(jogos, agora) {
  var primeiro = null;
  jogos.forEach(function (j) {
    if (j.dataHora && (!primeiro || j.dataHora < primeiro)) primeiro = j.dataHora;
  });
  if (!primeiro) return false;
  return agora.getTime() >= primeiro.getTime();
}

// ===================== ACESSO À PLANILHA =====================

function getPlanilha() {
  return SPREADSHEET_ID
    ? SpreadsheetApp.openById(SPREADSHEET_ID)
    : SpreadsheetApp.getActiveSpreadsheet();
}

function getAba(nome) {
  const aba = getPlanilha().getSheetByName(nome);
  if (!aba) throw new Error('Aba não encontrada: ' + nome);
  return aba;
}

/** Jogadores: Nome | PIN | Campeão | Artilheiro | Pontuacao_Total | Email */
function lerJogadores() {
  return getAba(ABA_JOGADORES).getDataRange().getValues().slice(1)
    .filter(function (l) { return String(l[0]).trim() !== ''; })
    .map(function (l) {
      return {
        nome: String(l[0]).trim(),
        pin: String(l[1]).trim(),
        campeao: String(l[2] || ''),
        artilheiro: String(l[3] || ''),
        pontuacao: l[4],
        email: String(l[5] || '').trim()
      };
    });
}

/** Jogos: ID_Jogo | Grupo | Data_Hora | Time_A | Time_B | Gols_A_Real | Gols_B_Real */
function lerJogos() {
  const intervalo = getAba(ABA_JOGOS).getDataRange();
  const valores = intervalo.getValues();
  // Plano B para a Data_Hora: se o valor bruto não puder ser interpretado,
  // tenta o texto exibido na célula (ex.: "11/06/2026 16:00:00").
  const exibidos = intervalo.getDisplayValues();
  const jogos = [];
  for (var i = 1; i < valores.length; i++) {
    const l = valores[i];
    if (String(l[0]).trim() === '') continue;
    jogos.push({
      id: String(l[0]).trim(),
      grupo: String(l[1]).trim(),
      dataHora: parseDataHora(l[2]) || parseDataHora(exibidos[i][2]),
      timeA: String(l[3]),
      timeB: String(l[4]),
      golsA: l[5],
      golsB: l[6],
      oddA: l[7], // colunas H/I/J (Odd_A | Odd_Empate | Odd_B), opcionais
      oddX: l[8],
      oddB: l[9]
    });
  }
  return jogos;
}

/** Palpites: Nome | ID_Jogo | Palpite_Gols_A | Palpite_Gols_B | Ultima_Atualizacao */
function lerPalpites() {
  return getAba(ABA_PALPITES).getDataRange().getValues().slice(1)
    .filter(function (l) { return String(l[0]).trim() !== ''; })
    .map(function (l) {
      return {
        nome: String(l[0]).trim(),
        idJogo: String(l[1]).trim(),
        golsA: Number(l[2]),
        golsB: Number(l[3])
      };
    });
}

function gravarBonus(nome, campeao, artilheiro) {
  const sheet = getAba(ABA_JOGADORES);
  const valores = sheet.getDataRange().getValues();
  for (var i = 1; i < valores.length; i++) {
    if (String(valores[i][0]).trim() === nome) {
      if (temTexto(campeao)) sheet.getRange(i + 1, 3).setValue(String(campeao).trim());
      if (temTexto(artilheiro)) sheet.getRange(i + 1, 4).setValue(String(artilheiro).trim());
      return;
    }
  }
}

// ===================== UTILITÁRIOS =====================

function autenticar(nome, pin) {
  if (!temTexto(nome) || !temTexto(pin)) return null;
  const jogador = lerJogadores().filter(function (j) {
    return j.nome === String(nome).trim();
  })[0];
  if (!jogador || jogador.pin !== String(pin).trim()) return null;
  return jogador;
}

/**
 * Aceita células de data reais, números seriais do Sheets e texto
 * "dd/mm/aaaa hh:mm:ss" (segundos opcionais, vírgula tolerada, ano com
 * 2 ou 4 dígitos). Interpreta no fuso horário do script.
 */
function parseDataHora(valor) {
  if (valor instanceof Date && !isNaN(valor.getTime())) return valor;
  if (typeof valor === 'number' && isFinite(valor) && valor > 1) {
    // Serial do Sheets: dias decorridos desde 30/12/1899.
    return new Date(new Date(1899, 11, 30).getTime() + Math.round(valor * 86400000));
  }
  const s = String(valor).trim().replace(',', ' ').replace(/\s+/g, ' ');
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4}) (\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (!m) return null;
  var ano = +m[3];
  if (ano < 100) ano += 2000;
  return new Date(ano, +m[2] - 1, +m[1], +m[4], +m[5], +(m[6] || 0));
}

/**
 * Diagnóstico: <URL_DO_APP>?action=debug
 * Mostra como o servidor enxerga a célula C2 (Data_Hora do 1º jogo).
 */
function montarDebug() {
  const celula = getAba(ABA_JOGOS).getRange(2, 3);
  const valor = celula.getValue();
  const exibido = celula.getDisplayValue();
  const interpretado = parseDataHora(valor) || parseDataHora(exibido);
  return {
    ok: true,
    fusoScript: Session.getScriptTimeZone(),
    fusoPlanilha: getPlanilha().getSpreadsheetTimeZone(),
    c2_tipo: Object.prototype.toString.call(valor),
    c2_valor: String(valor),
    c2_json: JSON.stringify(valor),
    c2_exibido: exibido,
    c2_interpretado: interpretado ? interpretado.toString() : null,
    horaServidor: new Date().toString()
  };
}

function formatarDataHora(data) {
  return Utilities.formatDate(data, Session.getScriptTimeZone(), 'dd/MM/yyyy HH:mm');
}

function normalizarGols(valor) {
  if (valor === '' || valor === null || valor === undefined) return null;
  const n = Number(valor);
  if (!isFinite(n) || n < 0 || n > 99 || n !== Math.floor(n)) return null;
  return n;
}

function temTexto(v) {
  return v !== null && v !== undefined && String(v).trim() !== '';
}

// Compara ignorando maiúsculas, acentos e pontuação ("Mbappé" == "mbappe").
function mesmoTexto(a, b) {
  return normalizarNome(a) !== '' && normalizarNome(a) === normalizarNome(b);
}

function responderJson(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
