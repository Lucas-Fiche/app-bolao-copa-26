/* ============================================================
 * BOLÃO COPA 2026 — FRONT-END
 * Fluxo: Login → Bônus (campeão/artilheiro, se ainda abertos) → Palpites
 * ============================================================ */

const MINUTOS_BLOQUEIO = 30;
const CHAVE_SESSAO = 'bolao26_sessao';
const chaveRascunho = (nome) => 'bolao26_rascunho_' + nome;
const chaveSalvos = (nome) => 'bolao26_salvos_' + nome; // backup do que já foi salvo

const estado = {
  nome: null,
  pin: null,
  jogos: [],            // vindos da API
  grupos: [],           // letras de grupo, ordenadas
  palpites: {},         // idJogo -> { golsA, golsB }
  campeao: '',
  artilheiro: '',
  bonusBloqueado: false,
  ranking: [],
  serverOffset: 0,      // serverTime - horário local, em ms
  abaAtiva: null
};

// ===================== BANDEIRAS =====================

// Nomes exatamente como estão na aba "Jogos" da planilha.
const BANDEIRAS = {
  'Alemanha': '🇩🇪', 'Argentina': '🇦🇷', 'Argélia': '🇩🇿', 'Arábia Saudita': '🇸🇦',
  'Austrália': '🇦🇺', 'Brasil': '🇧🇷', 'Bélgica': '🇧🇪', 'Bósnia e Herz.': '🇧🇦',
  'Cabo Verde': '🇨🇻', 'Canadá': '🇨🇦', 'Catar': '🇶🇦', 'Colômbia': '🇨🇴',
  'Coreia do Sul': '🇰🇷', 'Costa do Marfim': '🇨🇮', 'Croácia': '🇭🇷', 'Curaçao': '🇨🇼',
  'Egito': '🇪🇬', 'Equador': '🇪🇨', 'Escócia': '🏴󠁧󠁢󠁳󠁣󠁴󠁿', 'Espanha': '🇪🇸',
  'Estados Unidos': '🇺🇸', 'França': '🇫🇷', 'Gana': '🇬🇭', 'Haiti': '🇭🇹',
  'Holanda': '🇳🇱', 'Inglaterra': '🏴󠁧󠁢󠁥󠁮󠁧󠁿', 'Iraque': '🇮🇶', 'Irã': '🇮🇷',
  'Japão': '🇯🇵', 'Jordânia': '🇯🇴', 'Marrocos': '🇲🇦', 'México': '🇲🇽',
  'Noruega': '🇳🇴', 'Nova Zelândia': '🇳🇿', 'Panamá': '🇵🇦', 'Paraguai': '🇵🇾',
  'Portugal': '🇵🇹', 'RD Congo': '🇨🇩', 'Rep. Tcheca': '🇨🇿', 'Senegal': '🇸🇳',
  'Suécia': '🇸🇪', 'Suíça': '🇨🇭', 'Tunísia': '🇹🇳', 'Turquia': '🇹🇷',
  'Uruguai': '🇺🇾', 'Uzbequistão': '🇺🇿', 'África do Sul': '🇿🇦', 'Áustria': '🇦🇹'
};

// Bandeira sempre antes do nome: "🇲🇽 México  [2] x [0]  🇿🇦 África do Sul".
// Times sem bandeira mapeada (ex.: "1º do Grupo A" no mata-mata) ficam sem emoji.
function nomeComBandeira(time) {
  const f = BANDEIRAS[String(time).trim()];
  return f ? f + ' ' + time : time;
}

// ===================== FASES =====================

const normaliza = (s) => String(s).toLowerCase()
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .replace(/[^a-z0-9]+/g, ' ').trim();

const ehGrupoLetra = (g) => normaliza(g).length <= 1;

// "A" -> "Grupo A"; "Oitavas" -> "Oitavas"
const rotuloGrupo = (g) => ehGrupoLetra(g) ? 'Grupo ' + g : g;

// Ordem das abas: grupos A–L primeiro, depois as fases do mata-mata.
function pesoFase(g) {
  const n = normaliza(g);
  if (n.length <= 1) return 0;
  if (n.includes('16')) return 1;
  if (n.includes('oitava')) return 2;
  if (n.includes('quarta')) return 3;
  if (n.includes('semi')) return 4;
  if (n.includes('3') || n.includes('terceiro')) return 5;
  if (n.includes('final')) return 6;
  return 9;
}

// Espelho da tabela de pontuação do back-end (exibição apenas).
function pontuacaoDaFase(g) {
  const n = normaliza(g);
  if (n.length <= 1) return { placar: 3, vencedor: 1 };
  if (n.includes('16')) return { placar: 4, vencedor: 2 };
  if (n.includes('oitava')) return { placar: 5, vencedor: 2 };
  if (n.includes('quarta')) return { placar: 6, vencedor: 3 };
  if (n.includes('semi')) return { placar: 8, vencedor: 4 };
  if (n.includes('3') || n.includes('terceiro')) return { placar: 6, vencedor: 3 };
  if (n.includes('final')) return { placar: 10, vencedor: 5 };
  return { placar: 3, vencedor: 1 };
}

// ===================== HELPERS =====================

const $ = (sel) => document.querySelector(sel);

function mostrarToast(msg, tipo) {
  const toast = $('#toast');
  toast.textContent = msg;
  toast.className = 'toast ' + (tipo || '');
  toast.hidden = false;
  clearTimeout(mostrarToast._t);
  mostrarToast._t = setTimeout(() => { toast.hidden = true; }, 4000);
}

async function apiGet(action) {
  const resp = await fetch(API_URL + '?action=' + encodeURIComponent(action));
  if (!resp.ok) throw new Error('Falha de rede (' + resp.status + ')');
  return resp.json();
}

// JSON enviado como text/plain: evita o preflight CORS que o
// Apps Script não consegue responder. O back-end faz JSON.parse do body.
async function apiPost(payload) {
  const resp = await fetch(API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify(payload)
  });
  if (!resp.ok) throw new Error('Falha de rede (' + resp.status + ')');
  return resp.json();
}

function agoraServidor() {
  return Date.now() + estado.serverOffset;
}

// Identificador da fase de mata-mata, ou null para grupos (A–L).
function chaveDaFase(g) {
  const n = normaliza(g);
  if (n.length <= 1) return null;
  if (n.includes('16')) return 'avos16';
  if (n.includes('oitava')) return 'oitavas';
  if (n.includes('quarta')) return 'quartas';
  if (n.includes('semi')) return 'semifinal';
  if (n.includes('3') || n.includes('terceiro')) return 'terceiro';
  if (n.includes('final')) return 'final';
  return null;
}

function aberturaDaFase(jogo) {
  const chave = chaveDaFase(jogo.grupo);
  if (!chave) return null;
  return (estado.aberturasFases && estado.aberturasFases[chave]) ||
         estado.aberturaMataMata || null; // fallback: back-end antigo
}

function mataMataAindaFechado(jogo) {
  const abertura = aberturaDaFase(jogo);
  return !!abertura && agoraServidor() < abertura;
}

function jogoBloqueado(jogo) {
  if (!jogo.timestamp) return true;
  if (mataMataAindaFechado(jogo)) return true;
  return jogo.timestamp - agoraServidor() < MINUTOS_BLOQUEIO * 60 * 1000;
}

// ===================== INICIALIZAÇÃO =====================

async function init() {
  try {
    const dados = await apiGet('init');
    if (!dados.ok) throw new Error(dados.erro || 'Erro ao carregar dados.');

    estado.serverOffset = dados.serverTime - Date.now();
    estado.aberturaMataMata = dados.aberturaMataMata || null; // back-end antigo
    estado.aberturasFases = dados.aberturasFases || null;
    estado.jogos = dados.jogos;
    estado.ranking = dados.ranking;
    estado.rankingBrasil = dados.rankingBrasil || null; // null = back-end antigo
    estado.historico = dados.historico || [];
    estado.bonusBloqueado = dados.bonusBloqueado;
    estado.grupos = [...new Set(dados.jogos.map(j => j.grupo))]
      .sort((a, b) => pesoFase(a) - pesoFase(b) || a.localeCompare(b, 'pt'));

    const select = $('#select-nome');
    estado.jogadores = dados.jogadores; // ordem de cadastro (cores do gráfico)
    dados.jogadores.forEach(nome => {
      const opt = document.createElement('option');
      opt.value = nome;
      opt.textContent = nome;
      select.appendChild(opt);
    });

    $('#login-carregando').hidden = true;
    $('#form-login').hidden = false;

    // Sessão lembrada: tenta logar de novo automaticamente.
    const sessao = JSON.parse(localStorage.getItem(CHAVE_SESSAO) || 'null');
    if (sessao && sessao.nome && sessao.pin) {
      select.value = sessao.nome;
      $('#input-pin').value = sessao.pin;
      fazerLogin(sessao.nome, sessao.pin, true);
    }
  } catch (err) {
    $('#login-carregando').textContent =
      '⚠️ Não foi possível conectar à API. Verifique a URL em js/config.js. (' + err.message + ')';
  }
}

// ===================== LOGIN =====================

$('#form-login').addEventListener('submit', (ev) => {
  ev.preventDefault();
  fazerLogin($('#select-nome').value, $('#input-pin').value, false);
});

async function fazerLogin(nome, pin, silencioso) {
  const btn = $('#btn-entrar');
  btn.disabled = true;
  btn.textContent = 'Entrando…';
  $('#login-erro').hidden = true;

  try {
    const resp = await apiPost({ action: 'login', nome, pin });
    if (!resp.ok) throw new Error(resp.erro || 'Falha no login.');

    estado.nome = resp.nome;
    estado.pin = pin;
    estado.campeao = resp.campeao || '';
    estado.artilheiro = resp.artilheiro || '';
    estado.palpites = {};
    Object.keys(resp.palpites || {}).forEach(id => {
      estado.palpites[id] = {
        golsA: resp.palpites[id].golsA,
        golsB: resp.palpites[id].golsB
      };
    });

    // Backup local do que já foi salvo: cobre qualquer falha na leitura
    // do servidor. O servidor, quando responde, sempre tem prioridade.
    const salvos = JSON.parse(localStorage.getItem(chaveSalvos(estado.nome)) || '{}');
    Object.keys(salvos).forEach(id => {
      if (estado.palpites[id] === undefined) estado.palpites[id] = salvos[id];
    });

    // Rascunho local (digitado e não salvo) sobrepõe o servidor apenas
    // se estiver completo — um rascunho com campo vazio nunca apaga um
    // palpite já salvo. Jogos bloqueados ignoram rascunho.
    const rascunho = JSON.parse(localStorage.getItem(chaveRascunho(estado.nome)) || 'null');
    if (rascunho) {
      const bloqueadoPorId = {};
      estado.jogos.forEach(j => { bloqueadoPorId[j.id] = jogoBloqueado(j); });
      Object.keys(rascunho.palpites || {}).forEach(id => {
        if (bloqueadoPorId[id]) return;
        const r = rascunho.palpites[id] || {};
        const completo = r.golsA !== '' && r.golsA !== undefined &&
                         r.golsB !== '' && r.golsB !== undefined;
        if (completo || estado.palpites[id] === undefined) estado.palpites[id] = r;
      });
    }

    localStorage.setItem(CHAVE_SESSAO, JSON.stringify({ nome, pin }));

    // A tela de bônus só aparece enquanto faltar campeão ou artilheiro
    // (e o torneio não tiver começado). Depois de salvos, são definitivos.
    const bonusCompleto = !!(estado.campeao && estado.artilheiro);
    if (estado.bonusBloqueado || bonusCompleto) abrirTelaPalpites();
    else abrirTelaBonus();
  } catch (err) {
    localStorage.removeItem(CHAVE_SESSAO);
    if (!silencioso) {
      const elErro = $('#login-erro');
      elErro.textContent = err.message;
      elErro.hidden = false;
    }
  } finally {
    btn.disabled = false;
    btn.textContent = 'Entrar';
  }
}

$('#btn-sair').addEventListener('click', () => {
  localStorage.removeItem(CHAVE_SESSAO);
  location.reload();
});

// Recarrega o app — útil no PWA, onde não há botão de atualizar do navegador.
$('#btn-atualizar').addEventListener('click', () => {
  mostrarToast('🔄 Atualizando…');
  setTimeout(() => location.reload(), 300);
});

// ===================== TELA DE BÔNUS =====================

function abrirTelaBonus() {
  $('#tela-login').hidden = true;
  $('#tela-palpites').hidden = true;
  $('#tela-bonus').hidden = false;

  // Popula o select de campeão com as seleções da planilha (uma vez).
  const select = $('#input-campeao');
  if (select.options.length <= 1) {
    [...new Set(estado.jogos.flatMap(j => [j.timeA, j.timeB]))]
      .map(t => String(t).trim())
      .filter(t => BANDEIRAS[t]) // ignora placeholders do mata-mata ("1º do A" etc.)
      .sort((a, b) => a.localeCompare(b, 'pt'))
      .forEach(t => {
        const opt = document.createElement('option');
        opt.value = t;
        opt.textContent = nomeComBandeira(t);
        select.appendChild(opt);
      });
  }

  select.value = estado.campeao || '';
  $('#input-artilheiro').value = estado.artilheiro;

  // Bônus já salvo é definitivo: trava o campo correspondente.
  select.disabled = !!estado.campeao;
  $('#input-artilheiro').disabled = !!estado.artilheiro;
}

$('#btn-continuar').addEventListener('click', async () => {
  const btn = $('#btn-continuar');
  // Campos travados (já salvos) não são reenviados.
  const campeao = $('#input-campeao').disabled ? '' : $('#input-campeao').value.trim();
  const artilheiro = $('#input-artilheiro').disabled ? '' : $('#input-artilheiro').value.trim();
  $('#bonus-erro').hidden = true;

  // Palpites de bônus são obrigatórios: não deixa continuar em branco.
  const campeaoFinal = estado.campeao || campeao;
  const artilheiroFinal = estado.artilheiro || artilheiro;
  if (!campeaoFinal || !artilheiroFinal) {
    const elErro = $('#bonus-erro');
    elErro.textContent = !campeaoFinal && !artilheiroFinal
      ? 'Escolha o campeão e o artilheiro para continuar — são obrigatórios e valem 20 pts cada!'
      : (!campeaoFinal ? 'Falta escolher o campeão!' : 'Falta digitar o artilheiro!');
    elErro.hidden = false;
    return;
  }

  btn.disabled = true;
  btn.textContent = 'Salvando…';
  try {
    const resp = await apiPost({
      action: 'salvar',
      nome: estado.nome,
      pin: estado.pin,
      campeao,
      artilheiro,
      palpites: []
    });
    if (!resp.ok) throw new Error(resp.erro || 'Erro ao salvar o bônus.');

    if (campeao) estado.campeao = campeao;
    if (artilheiro) estado.artilheiro = artilheiro;
    if (resp.bonusSalvo) mostrarToast('🏆 Bônus salvos!', 'sucesso');
    abrirTelaPalpites();
  } catch (err) {
    const elErro = $('#bonus-erro');
    elErro.textContent = err.message;
    elErro.hidden = false;
  } finally {
    btn.disabled = false;
    btn.textContent = 'Continuar →';
  }
});

// ===================== TELA DE PALPITES =====================

function abrirTelaPalpites() {
  $('#tela-login').hidden = true;
  $('#tela-bonus').hidden = true;
  $('#tela-palpites').hidden = false;
  $('#topo-nome').textContent = estado.nome;

  montarAbas();
  montarPaineisDeGrupos();
  montarRanking();
  ativarAba('hoje');

  // Reavalia bloqueios a cada minuto para "cinzar" jogos que entram na
  // janela de 30 minutos enquanto o usuário navega.
  if (!abrirTelaPalpites._timer) {
    abrirTelaPalpites._timer = setInterval(atualizarBloqueios, 60 * 1000);
  }
}

function montarAbas() {
  const nav = $('#abas');
  nav.innerHTML = '';
  nav.appendChild(criarAba('📅 Hoje', 'hoje'));
  nav.appendChild(criarAba('🇧🇷', 'brasil'));
  estado.grupos.forEach(grupo => {
    nav.appendChild(criarAba(rotuloGrupo(grupo), grupo));
  });
}

function criarAba(rotulo, id) {
  const btn = document.createElement('button');
  btn.className = 'aba';
  btn.dataset.aba = id;
  btn.textContent = rotulo;
  btn.addEventListener('click', () => ativarAba(id));
  return btn;
}

function ativarAba(id) {
  estado.abaAtiva = id;
  if (id === 'hoje') montarPainelHoje(); // reconstrói com data/bloqueios atuais
  if (id === 'historico') montarPainelHistorico();
  document.querySelectorAll('.aba').forEach(b => {
    b.classList.toggle('ativa', b.dataset.aba === id);
  });
  document.querySelectorAll('[data-painel]').forEach(p => {
    p.hidden = p.dataset.painel !== id;
  });
  $('#btn-ranking').classList.toggle('ativa', id === 'ranking');
  $('#btn-historico').classList.toggle('ativa', id === 'historico');
  $('#conteudo').scrollTop = 0;
}

$('#btn-ranking').addEventListener('click', () => ativarAba('ranking'));
$('#btn-historico').addEventListener('click', () => ativarAba('historico'));

function montarPaineisDeGrupos() {
  const container = $('#paineis-grupos');
  container.innerHTML = '';

  // Painel "Hoje" (conteúdo montado em montarPainelHoje a cada ativação)
  const painelHoje = document.createElement('div');
  painelHoje.className = 'painel';
  painelHoje.dataset.painel = 'hoje';
  painelHoje.id = 'painel-hoje';
  painelHoje.hidden = true;
  container.appendChild(painelHoje);

  // Painel "Histórico" (conteúdo montado ao ativar pelo botão do topo).
  const painelHist = document.createElement('div');
  painelHist.className = 'painel';
  painelHist.dataset.painel = 'historico';
  painelHist.id = 'painel-historico';
  painelHist.hidden = true;
  container.appendChild(painelHist);

  // Painel "Brasil": só os jogos da Seleção, em qualquer fase.
  const painelBrasil = document.createElement('div');
  painelBrasil.className = 'painel';
  painelBrasil.dataset.painel = 'brasil';
  painelBrasil.hidden = true;
  const tituloBrasil = document.createElement('h2');
  tituloBrasil.textContent = '🇧🇷 Jogos do Brasil';
  painelBrasil.appendChild(tituloBrasil);
  const jogosBrasil = estado.jogos
    .filter(j => [j.timeA, j.timeB].some(t => String(t).trim() === 'Brasil'))
    .sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
  if (jogosBrasil.length) {
    jogosBrasil.forEach(jogo => painelBrasil.appendChild(criarCardJogo(jogo, true)));
  } else {
    const p = document.createElement('p');
    p.className = 'aviso';
    p.textContent = 'Nenhum jogo do Brasil cadastrado.';
    painelBrasil.appendChild(p);
  }
  container.appendChild(painelBrasil);

  estado.grupos.forEach(grupo => {
    const painel = document.createElement('div');
    painel.className = 'painel';
    painel.dataset.painel = grupo;
    painel.hidden = true;

    const f = pontuacaoDaFase(grupo);
    const titulo = document.createElement('h2');
    titulo.innerHTML = `${rotuloGrupo(grupo)} <small>🎯 placar ${f.placar} pts · ✅ vencedor ${f.vencedor} pt${f.vencedor > 1 ? 's' : ''}</small>`;
    painel.appendChild(titulo);

    estado.jogos
      .filter(j => j.grupo === grupo)
      .sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0))
      .forEach(jogo => painel.appendChild(criarCardJogo(jogo, false)));

    container.appendChild(painel);
  });
}

function montarPainelHoje() {
  const painel = $('#painel-hoje');
  painel.innerHTML = '';

  const mesmoDia = (ts, ref) => {
    const a = new Date(ts), b = new Date(ref);
    return a.getFullYear() === b.getFullYear() &&
           a.getMonth() === b.getMonth() &&
           a.getDate() === b.getDate();
  };

  const agora = agoraServidor();
  let jogosDoDia = estado.jogos.filter(j => j.timestamp && mesmoDia(j.timestamp, agora));
  let titulo = '📅 Jogos de hoje';

  if (!jogosDoDia.length) {
    // Sem jogos hoje: mostra o próximo dia com jogos.
    const futuros = estado.jogos
      .filter(j => j.timestamp && j.timestamp > agora)
      .sort((a, b) => a.timestamp - b.timestamp);
    if (futuros.length) {
      jogosDoDia = futuros.filter(j => mesmoDia(j.timestamp, futuros[0].timestamp));
      const d = new Date(futuros[0].timestamp);
      titulo = '📅 Sem jogos hoje — próximos jogos: ' +
        String(d.getDate()).padStart(2, '0') + '/' + String(d.getMonth() + 1).padStart(2, '0');
    }
  }

  const h2 = document.createElement('h2');
  h2.textContent = titulo;
  painel.appendChild(h2);

  if (!jogosDoDia.length) {
    const p = document.createElement('p');
    p.className = 'aviso';
    p.textContent = 'Nenhum jogo encontrado. Navegue pelos grupos acima. 👆';
    painel.appendChild(p);
    return;
  }

  jogosDoDia
    .sort((a, b) => a.timestamp - b.timestamp)
    .forEach(jogo => painel.appendChild(criarCardJogo(jogo, true)));
}

// ===================== HISTÓRICO DE PALPITES =====================

/**
 * Todos os palpites de um jogador nos jogos já iniciados (o servidor só
 * envia palpites de jogos que começaram, então não há vazamento).
 */
function montarPainelHistorico() {
  const painel = $('#painel-historico');
  const jogadores = (estado.ranking || []).map(r => r.nome);
  if (!estado.jogadorHistorico || !jogadores.includes(estado.jogadorHistorico)) {
    estado.jogadorHistorico = jogadores.includes(estado.nome) ? estado.nome : jogadores[0];
  }

  const opcoes = jogadores.map(n =>
    `<option value="${n}"${n === estado.jogadorHistorico ? ' selected' : ''}>${n}</option>`).join('');

  const iniciados = estado.jogos
    .filter(j => j.palpites && j.palpites.length)
    .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));

  let corpo;
  if (!iniciados.length) {
    corpo = '<p class="aviso">📜 Os palpites de todos ficam visíveis aqui depois que cada jogo começa.<br />Volte após a primeira partida!</p>';
  } else {
    corpo = '<ul class="historico-lista">' + iniciados.map(jogo => {
      const p = jogo.palpites.find(x => x.nome === estado.jogadorHistorico);
      const esqueceu = !p || p.esqueceu || p.golsA === null;
      const palpite = esqueceu ? '💤' : `${p.golsA} x ${p.golsB}`;
      const pontos = p ? p.pontos : null;
      const selo = pontos === null ? ''
        : (p.exato ? `<span class="pts pts-3">🎯 +${pontos}</span>`
        : pontos > 0 ? `<span class="pts pts-1">+${pontos}</span>`
        : esqueceu ? '<span class="pts pts-zzz">0</span>'
        : '<span class="pts pts-0">0</span>');
      const resultado = (jogo.golsAReal !== null && jogo.golsBReal !== null)
        ? `Resultado: ${jogo.golsAReal} x ${jogo.golsBReal}`
        : 'Aguardando resultado';
      return `<li class="hist-item">
        <div class="hist-jogo">
          <small>${jogo.dataHoraTexto} · ${rotuloGrupo(jogo.grupo)} · ${resultado}</small>
          <span>${nomeComBandeira(jogo.timeA)} <b class="hist-palpite">${palpite}</b> ${nomeComBandeira(jogo.timeB)}</span>
        </div>${selo}</li>`;
    }).join('') + '</ul>';
  }

  painel.innerHTML = `
    <h2>📜 Histórico de palpites</h2>
    <label for="select-historico">Ver palpites de</label>
    <select id="select-historico">${opcoes}</select>
    <div class="hist-corpo">${corpo}</div>`;

  painel.querySelector('#select-historico').addEventListener('change', (ev) => {
    estado.jogadorHistorico = ev.target.value;
    montarPainelHistorico();
  });
}

// ===================== FINANCEIRO =====================

const VALOR_ENTRADA = 15; // R$ por participante
const PREMIOS = [
  { rotulo: '🥇 1º lugar', pct: 0.60 },
  { rotulo: '🥈 2º lugar', pct: 0.30 },
  { rotulo: '🥉 3º lugar', pct: 0.10 }
];

function montarPainelFinanceiro() {
  const alvo = $('#financeiro-conteudo');
  const n = (estado.ranking || []).length;
  const total = n * VALOR_ENTRADA;
  const fmt = (v) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

  const linhas = PREMIOS.map(p => `
    <li>
      <span class="premio-pos">${p.rotulo}</span>
      <span class="premio-pct">${Math.round(p.pct * 100)}%</span>
      <b class="premio-valor">${fmt(total * p.pct)}</b>
    </li>`).join('');

  alvo.innerHTML = `
    <div class="premio-total">
      <small>Prêmio total</small>
      <strong>${fmt(total)}</strong>
      <span>${n} participantes × ${fmt(VALOR_ENTRADA)}</span>
    </div>
    <ul class="premios">${linhas}</ul>
    <p class="aviso">Critério de desempate: mais placares exatos (🎯).</p>`;
}

function criarCardJogo(jogo, comGrupo) {
  const card = document.createElement('div');
  card.className = 'jogo';
  card.dataset.idJogo = jogo.id;
  if ([jogo.timeA, jogo.timeB].some(t => String(t).trim() === 'Brasil')) {
    card.classList.add('brasil');
  }

  const palpite = estado.palpites[jogo.id] || {};
  const encerrado = jogo.golsAReal !== null && jogo.golsBReal !== null;

  // Odds (casa/empate/fora) para ajudar na escolha; somem com o resultado.
  const fmtOdd = (n) => Number(n).toFixed(2);
  const linhaOdds = (jogo.odds && !encerrado)
    ? `<div class="jogo-odds">
        <div class="odd"><small>Casa</small><b>${fmtOdd(jogo.odds.a)}</b></div>
        <div class="odd"><small>Empate</small><b>${fmtOdd(jogo.odds.x)}</b></div>
        <div class="odd"><small>Fora</small><b>${fmtOdd(jogo.odds.b)}</b></div>
      </div>` : '';

  card.innerHTML = `
    <div class="jogo-data">📅 ${jogo.dataHoraTexto}${comGrupo
      ? ` <span class="badge-grupo">${rotuloGrupo(jogo.grupo)}</span>` : ''}</div>
    ${encerrado
      ? `<div class="jogo-resultado">⚽ Placar final: <b>${jogo.golsAReal} x ${jogo.golsBReal}</b></div>` : ''}
    <div class="jogo-placar">
      <span class="time time-a">${nomeComBandeira(jogo.timeA)}</span>
      <input type="number" min="0" max="99" inputmode="numeric" class="gols"
             data-lado="A" value="${palpite.golsA ?? ''}" placeholder="-" />
      <span class="x">x</span>
      <input type="number" min="0" max="99" inputmode="numeric" class="gols"
             data-lado="B" value="${palpite.golsB ?? ''}" placeholder="-" />
      <span class="time time-b">${nomeComBandeira(jogo.timeB)}</span>
    </div>
    ${linhaOdds}
    <div class="jogo-trava" hidden>🔒 Palpites encerrados</div>
  `;

  card.querySelectorAll('.gols').forEach(input => {
    input.addEventListener('input', () => aoDigitarPalpite(jogo.id, card));
  });

  // Botão "quem já palpitou": mostra só os nomes (nunca os placares).
  if (Array.isArray(jogo.palpitaram)) {
    const btnQuem = document.createElement('button');
    btnQuem.type = 'button';
    btnQuem.className = 'quem-palpitou';
    btnQuem.dataset.id = jogo.id;
    btnQuem.textContent = `✅ ${jogo.palpitaram.length}/${(estado.ranking || []).length}`;

    const listaQuem = document.createElement('div');
    listaQuem.className = 'lista-quem';
    listaQuem.hidden = true;

    btnQuem.addEventListener('click', () => {
      if (listaQuem.hidden) {
        // Monta na hora, para refletir palpites salvos nesta sessão.
        const todos = (estado.ranking || []).map(r => r.nome);
        const fizeram = todos.filter(n => jogo.palpitaram.includes(n));
        const faltam = todos.filter(n => !jogo.palpitaram.includes(n));
        listaQuem.innerHTML = `
          <p><b>✅ Já palpitaram (${fizeram.length}):</b> ${fizeram.join(' · ') || 'ninguém ainda'}</p>
          <p><b>⏳ Ainda faltam (${faltam.length}):</b> ${faltam.join(' · ') || 'ninguém — todos palpitaram! 🎉'}</p>`;
      }
      listaQuem.hidden = !listaQuem.hidden;
    });

    const linhaData = card.querySelector('.jogo-data');
    linhaData.appendChild(btnQuem);
    linhaData.insertAdjacentElement('afterend', listaQuem);
  }

  // Palpites revelados (o servidor só os envia para jogos já iniciados).
  if (jogo.palpites && jogo.palpites.length) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'ver-palpites';
    const rotulo = (aberto) =>
      `👀 Palpites da galera (${jogo.palpites.length}) ${aberto ? '▴' : '▾'}`;
    btn.textContent = rotulo(false);

    const ul = document.createElement('ul');
    ul.className = 'lista-palpites';
    ul.hidden = true;
    jogo.palpites.forEach(p => {
      const li = document.createElement('li');
      const esqueceu = p.esqueceu || p.golsA === null;
      const selo = p.pontos === null ? ''
        : p.exato ? `<span class="pts pts-3">🎯 +${p.pontos}</span>`
        : p.pontos > 0 ? `<span class="pts pts-1">+${p.pontos}</span>`
        : esqueceu ? '<span class="pts pts-zzz">0</span>'
        : '<span class="pts pts-0">0</span>';
      const eu = p.nome === estado.nome ? ' <small>(você)</small>' : '';
      const placar = esqueceu
        ? '<span class="p-placar p-esqueceu">💤</span>'
        : `<span class="p-placar">${p.golsA} x ${p.golsB}</span>`;
      li.innerHTML = `<span class="p-nome">${p.nome}${eu}</span>${placar}${selo}`;
      ul.appendChild(li);
    });

    btn.addEventListener('click', () => {
      ul.hidden = !ul.hidden;
      btn.textContent = rotulo(!ul.hidden);
    });
    card.appendChild(btn);
    card.appendChild(ul);
  }

  aplicarBloqueio(card, jogo);
  return card;
}

function aoDigitarPalpite(idJogo, cardOrigem) {
  const a = cardOrigem.querySelector('[data-lado="A"]').value;
  const b = cardOrigem.querySelector('[data-lado="B"]').value;
  estado.palpites[idJogo] = { golsA: a, golsB: b };

  // O mesmo jogo pode aparecer em "Hoje" e na aba do grupo: sincroniza.
  document.querySelectorAll(`[data-id-jogo="${idJogo}"]`).forEach(card => {
    if (card === cardOrigem) return;
    card.querySelector('[data-lado="A"]').value = a;
    card.querySelector('[data-lado="B"]').value = b;
  });

  salvarRascunho();
  $('#topo-status').textContent = 'Alterações não salvas';
}

function aplicarBloqueio(card, jogo) {
  const bloqueado = jogoBloqueado(jogo);
  card.classList.toggle('bloqueado', bloqueado);
  card.querySelectorAll('.gols').forEach(i => { i.disabled = bloqueado; });
  const trava = card.querySelector('.jogo-trava');
  trava.hidden = !bloqueado;
  if (bloqueado && mataMataAindaFechado(jogo)) {
    const d = new Date(aberturaDaFase(jogo));
    trava.textContent = `🔒 Palpites desta fase abrem em ${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`;
  } else {
    trava.textContent = '🔒 Palpites encerrados';
  }
}

function atualizarBloqueios() {
  estado.jogos.forEach(jogo => {
    document.querySelectorAll(`[data-id-jogo="${jogo.id}"]`)
      .forEach(card => aplicarBloqueio(card, jogo));
  });
}

function montarRanking(tipo) {
  tipo = tipo || 'geral';
  document.querySelectorAll('.sub-aba').forEach(b => {
    b.classList.toggle('ativa', b.dataset.ranking === tipo);
  });
  // Back-end antigo não envia o ranking do Brasil: esconde o seletor.
  $('#sub-aba-brasil').hidden = !estado.rankingBrasil;

  // Tema verde-amarelo na visão "Jogos do Brasil".
  const ehBrasil = tipo === 'brasil';
  $('#painel-ranking').classList.toggle('tema-brasil', ehBrasil);
  $('#ranking-brasil-chamada').hidden = !ehBrasil;

  // Visões "Evolução" e "Prêmio" ocupam o lugar da lista.
  const ehEvolucao = tipo === 'evolucao';
  const ehFinanceiro = tipo === 'financeiro';
  $('#grafico-evolucao').hidden = !ehEvolucao;
  $('#financeiro-conteudo').hidden = !ehFinanceiro;
  $('#lista-ranking').hidden = ehEvolucao || ehFinanceiro;
  if (ehEvolucao) {
    desenharEvolucao();
    return;
  }
  if (ehFinanceiro) {
    montarPainelFinanceiro();
    return;
  }

  const dados = (ehBrasil && estado.rankingBrasil) || estado.ranking;
  const lista = $('#lista-ranking');
  lista.innerHTML = '';
  dados.forEach((r, i) => {
    const li = document.createElement('li');
    const medalha = ['🥇', '🥈', '🥉'][i] || `${i + 1}º`;
    const exatos = r.exatos > 0
      ? `<small class="exatos">🎯 ${r.exatos} na mosca</small>` : '';
    // Campeão e artilheiro sempre visíveis (palpites de bônus são definitivos).
    const detalhe = 'campeao' in r ? `
      <div class="detalhe">
        <span>🏆 <strong>${r.campeao ? nomeComBandeira(r.campeao) : 'ainda não escolheu'}</strong></span>
        <span>⚽ <strong>${r.artilheiro || 'ainda não escolheu'}</strong></span>
      </div>` : '';
    li.innerHTML = `
      <div class="rank-linha">
        <span class="pos">${medalha}</span>
        <span class="nome">${r.nome}${exatos}</span>
        <span class="pontos">${r.pontos} pts</span>
      </div>${detalhe}`;
    lista.appendChild(li);
  });
  if (!dados.length) {
    lista.innerHTML = '<li class="aviso">Ninguém pontuou ainda.</li>';
  }
}

document.querySelectorAll('.sub-aba').forEach(btn => {
  btn.addEventListener('click', () => montarRanking(btn.dataset.ranking));
});

// ===================== GRÁFICO DE EVOLUÇÃO =====================

/**
 * Cor fixa por jogador, derivada da posição de cadastro na aba Jogadores
 * (novos entram no fim da planilha, então ninguém muda de cor). O ângulo
 * de ouro espalha os matizes; a luminosidade varia para reforçar a
 * diferença entre cores vizinhas.
 */
function corDoJogador(nome) {
  const idx = Math.max(0, (estado.jogadores || []).indexOf(nome));
  const hue = Math.round(idx * 137.508) % 360;
  // Bandas fortes de saturação/luminosidade: matizes vizinhos caem em
  // bandas diferentes, então "dois verdes" ficam claramente distintos.
  const sat = [72, 85, 55][idx % 3];
  const luz = [38, 52, 27][idx % 3];
  return `hsl(${hue}, ${sat}%, ${luz}%)`;
}

function desenharEvolucao() {
  const cont = $('#grafico-evolucao');
  const hist = estado.historico || [];
  if (hist.length < 1) {
    cont.innerHTML = '<p class="aviso">📈 O histórico começa a ser gravado no primeiro dia da Copa.<br />Volte aqui depois da primeira rodada!</p>';
    return;
  }

  const datas = [...new Set(hist.map(h => h.data))];
  const porNome = {};
  hist.forEach(h => {
    (porNome[h.nome] = porNome[h.nome] || {})[h.data] = h.pontos;
  });
  // Ordena pela pontuação mais recente (legenda na ordem do ranking).
  const ultima = datas[datas.length - 1];
  const nomes = Object.keys(porNome)
    .sort((a, b) => (porNome[b][ultima] || 0) - (porNome[a][ultima] || 0));

  const maxPts = Math.max(1, ...hist.map(h => h.pontos));
  const W = 620, H = 250, PL = 34, PR = 14, PT = 12, PB = 26;
  const x = (i) => PL + i * (W - PL - PR) / Math.max(datas.length - 1, 1);
  const y = (v) => PT + (1 - v / maxPts) * (H - PT - PB);

  let svg = `<svg viewBox="0 0 ${W} ${H}" class="grafico">`;
  // Eixos e linhas-guia
  [0, 0.5, 1].forEach(f => {
    const v = Math.round(maxPts * f);
    svg += `<line x1="${PL}" y1="${y(v)}" x2="${W - PR}" y2="${y(v)}" class="guia" />
            <text x="${PL - 6}" y="${y(v) + 4}" class="eixo" text-anchor="end">${v}</text>`;
  });
  // Rótulos de datas (primeira, meio e última, para não poluir)
  [0, Math.floor((datas.length - 1) / 2), datas.length - 1]
    .filter((v, i, arr) => arr.indexOf(v) === i)
    .forEach(i => {
      svg += `<text x="${x(i)}" y="${H - 8}" class="eixo" text-anchor="middle">${datas[i]}</text>`;
    });
  // Uma linha por jogador. A destacada (toque na legenda) vai por último,
  // para ficar por cima; as demais ficam translúcidas.
  const destaque = estado.destaqueEvolucao;
  const ordemDesenho = destaque
    ? [...nomes.filter(n => n !== destaque), destaque]
    : nomes;
  ordemDesenho.forEach(nome => {
    const cor = corDoJogador(nome);
    const apagada = destaque && nome !== destaque;
    const pontos = datas.map((d, i) =>
      `${x(i)},${y(porNome[nome][d] !== undefined ? porNome[nome][d] : 0)}`);
    svg += `<polyline points="${pontos.join(' ')}" fill="none" stroke="${cor}"
             stroke-width="${nome === destaque ? 4 : 2.5}"
             stroke-opacity="${apagada ? 0.15 : 1}"
             stroke-linejoin="round" stroke-linecap="round" />`;
    const fim = porNome[nome][ultima] !== undefined ? porNome[nome][ultima] : 0;
    svg += `<circle cx="${x(datas.length - 1)}" cy="${y(fim)}" r="${nome === destaque ? 5 : 4}"
             fill="${cor}" fill-opacity="${apagada ? 0.15 : 1}" />`;
  });
  svg += '</svg>';

  // Legenda na ordem do ranking atual; toque destaca a linha do jogador.
  const legenda = nomes.map(nome =>
    `<span class="legenda-item${destaque === nome ? ' ativa' : ''}${destaque && destaque !== nome ? ' apagada' : ''}"
       data-nome="${nome}"><i style="background:${corDoJogador(nome)}"></i>
      ${nome} <b>${porNome[nome][ultima] !== undefined ? porNome[nome][ultima] : 0}</b></span>`).join('');

  cont.innerHTML = svg +
    `<p class="aviso aviso-legenda">Toque num nome para destacar a linha 👇</p>` +
    `<div class="legenda">${legenda}</div>`;

  cont.querySelectorAll('.legenda-item').forEach(el => {
    el.addEventListener('click', () => {
      estado.destaqueEvolucao =
        estado.destaqueEvolucao === el.dataset.nome ? null : el.dataset.nome;
      desenharEvolucao();
    });
  });
}

// ===================== RASCUNHO (localStorage) =====================

function salvarRascunho() {
  if (!estado.nome) return;
  localStorage.setItem(chaveRascunho(estado.nome), JSON.stringify({
    palpites: estado.palpites
  }));
}

// ===================== SALVAR =====================

$('#btn-salvar').addEventListener('click', async () => {
  const btn = $('#btn-salvar');
  btn.disabled = true;
  btn.textContent = 'Salvando…';

  try {
    // Envia somente jogos com placar completo e ainda não bloqueados.
    // Jogos sem palpite ficam de fora e simplesmente não pontuam.
    const palpites = [];
    estado.jogos.forEach(jogo => {
      if (jogoBloqueado(jogo)) return;
      const p = estado.palpites[jogo.id];
      if (!p || p.golsA === '' || p.golsB === '') return;
      palpites.push({ idJogo: jogo.id, golsA: Number(p.golsA), golsB: Number(p.golsB) });
    });

    const resp = await apiPost({
      action: 'salvar',
      nome: estado.nome,
      pin: estado.pin,
      campeao: estado.bonusBloqueado ? '' : estado.campeao,
      artilheiro: estado.bonusBloqueado ? '' : estado.artilheiro,
      palpites
    });

    if (!resp.ok) throw new Error(resp.erro || 'Erro ao salvar.');

    // Marca o jogador nos contadores de "quem já palpitou" dos jogos aceitos.
    (resp.salvos || []).forEach(id => {
      const jogo = estado.jogos.find(j => String(j.id) === String(id));
      if (jogo && Array.isArray(jogo.palpitaram) && !jogo.palpitaram.includes(estado.nome)) {
        jogo.palpitaram.push(estado.nome);
      }
    });
    document.querySelectorAll('.quem-palpitou[data-id]').forEach(btn => {
      const jogo = estado.jogos.find(j => String(j.id) === btn.dataset.id);
      if (jogo && Array.isArray(jogo.palpitaram)) {
        btn.textContent = `✅ ${jogo.palpitaram.length}/${(estado.ranking || []).length}`;
      }
    });

    // Backup local do que acabou de ser salvo (só os aceitos pelo servidor).
    const aceitos = new Set((resp.salvos || []).map(String));
    const backup = JSON.parse(localStorage.getItem(chaveSalvos(estado.nome)) || '{}');
    palpites.forEach(p => {
      if (aceitos.has(String(p.idJogo))) {
        backup[p.idJogo] = { golsA: p.golsA, golsB: p.golsB };
      }
    });
    localStorage.setItem(chaveSalvos(estado.nome), JSON.stringify(backup));

    localStorage.removeItem(chaveRascunho(estado.nome));
    $('#topo-status').textContent = 'Tudo salvo ✔';

    if (resp.rejeitados && resp.rejeitados.length) {
      mostrarToast(`✅ ${resp.salvos.length} palpite(s) salvos. ` +
        `⚠️ ${resp.rejeitados.length} rejeitado(s) (jogo já bloqueado).`, 'alerta');
      atualizarBloqueios();
    } else {
      mostrarToast(`✅ ${resp.salvos.length} palpite(s) salvos com sucesso!`, 'sucesso');
    }
  } catch (err) {
    mostrarToast('❌ ' + err.message, 'erro');
  } finally {
    btn.disabled = false;
    btn.textContent = '💾 Salvar Meus Palpites';
  }
});

// Service worker mínimo: torna o app instalável (PWA), sem cachear nada.
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}

init();
