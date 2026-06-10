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

const MINUTOS_BLOQUEIO = 30;
const PONTOS_PLACAR_EXATO = 3;
const PONTOS_VENCEDOR = 1;
const PONTOS_CAMPEAO = 10;
const PONTOS_ARTILHEIRO = 10;

// Preencha no fim do torneio e rode atualizarPontuacao() para aplicar o bônus.
const CAMPEAO_REAL = '';
const ARTILHEIRO_REAL = '';

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
  return {
    ok: true,
    serverTime: agora.getTime(),
    bonusBloqueado: bonusBloqueado(jogos, agora),
    jogadores: jogadores.map(function (j) { return j.nome; }),
    ranking: jogadores
      .map(function (j) { return { nome: j.nome, pontos: Number(j.pontuacao) || 0 }; })
      .sort(function (a, b) { return b.pontos - a.pontos; }),
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
        bloqueado: jogoBloqueado(j.dataHora, agora)
      };
    })
  };
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
      // Regra dos 30 minutos: jogo prestes a começar, em andamento ou
      // encerrado não aceita alteração — o palpite anterior é mantido.
      if (jogoBloqueado(jogo.dataHora, agora)) {
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
 * Recalcula a Pontuacao_Total de todos os jogadores.
 * Rode manualmente após lançar resultados na aba "Jogos", ou crie um
 * acionador (Acionadores > Adicionar acionador > baseado em tempo, a cada hora).
 *
 * Regra do Esquecimento: jogo encerrado sem palpite conta como 0x0.
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

  for (var i = 1; i < valores.length; i++) {
    const nome = String(valores[i][0]).trim();
    if (!nome) continue;
    var total = 0;

    jogosFinalizados.forEach(function (jogo) {
      const palpite = palpitesDe[nome + '|' + String(jogo.id)] || { golsA: 0, golsB: 0 };
      total += pontosDoPalpite(
        Number(palpite.golsA), Number(palpite.golsB),
        Number(jogo.golsA), Number(jogo.golsB)
      );
    });

    if (temTexto(CAMPEAO_REAL) && mesmoTexto(valores[i][2], CAMPEAO_REAL)) total += PONTOS_CAMPEAO;
    if (temTexto(ARTILHEIRO_REAL) && mesmoTexto(valores[i][3], ARTILHEIRO_REAL)) total += PONTOS_ARTILHEIRO;

    sheet.getRange(i + 1, 5).setValue(total); // coluna Pontuacao_Total
  }
}

function pontosDoPalpite(palpiteA, palpiteB, realA, realB) {
  if (palpiteA === realA && palpiteB === realB) return PONTOS_PLACAR_EXATO;
  const sinal = function (a, b) { return a > b ? 1 : (a < b ? -1 : 0); };
  if (sinal(palpiteA, palpiteB) === sinal(realA, realB)) return PONTOS_VENCEDOR;
  return 0;
}

// ===================== REGRAS DE TEMPO =====================

function jogoBloqueado(dataHora, agora) {
  if (!dataHora) return true; // sem data válida, melhor não aceitar palpite
  return (dataHora.getTime() - agora.getTime()) < MINUTOS_BLOQUEIO * 60 * 1000;
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

/** Jogadores: Nome | PIN | Campeão | Artilheiro | Pontuacao_Total */
function lerJogadores() {
  return getAba(ABA_JOGADORES).getDataRange().getValues().slice(1)
    .filter(function (l) { return String(l[0]).trim() !== ''; })
    .map(function (l) {
      return {
        nome: String(l[0]).trim(),
        pin: String(l[1]).trim(),
        campeao: String(l[2] || ''),
        artilheiro: String(l[3] || ''),
        pontuacao: l[4]
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
      golsB: l[6]
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

function mesmoTexto(a, b) {
  return String(a).trim().toLowerCase() === String(b).trim().toLowerCase();
}

function responderJson(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
