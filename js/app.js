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

function jogoBloqueado(jogo) {
  if (!jogo.timestamp) return true;
  return jogo.timestamp - agoraServidor() < MINUTOS_BLOQUEIO * 60 * 1000;
}

// ===================== INICIALIZAÇÃO =====================

async function init() {
  try {
    const dados = await apiGet('init');
    if (!dados.ok) throw new Error(dados.erro || 'Erro ao carregar dados.');

    estado.serverOffset = dados.serverTime - Date.now();
    estado.jogos = dados.jogos;
    estado.ranking = dados.ranking;
    estado.rankingBrasil = dados.rankingBrasil || null; // null = back-end antigo
    estado.bonusBloqueado = dados.bonusBloqueado;
    estado.grupos = [...new Set(dados.jogos.map(j => j.grupo))].sort();

    const select = $('#select-nome');
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

  // Nada preenchido e nada salvo antes: segue direto, sem chamar a API.
  if (!campeao && !artilheiro) {
    abrirTelaPalpites();
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
    nav.appendChild(criarAba('Grupo ' + grupo, grupo));
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
  document.querySelectorAll('.aba').forEach(b => {
    b.classList.toggle('ativa', b.dataset.aba === id);
  });
  document.querySelectorAll('[data-painel]').forEach(p => {
    p.hidden = p.dataset.painel !== id;
  });
  $('#btn-ranking').classList.toggle('ativa', id === 'ranking');
  $('#conteudo').scrollTop = 0;
}

$('#btn-ranking').addEventListener('click', () => ativarAba('ranking'));

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

    const titulo = document.createElement('h2');
    titulo.textContent = 'Grupo ' + grupo;
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

function criarCardJogo(jogo, comGrupo) {
  const card = document.createElement('div');
  card.className = 'jogo';
  card.dataset.idJogo = jogo.id;
  if ([jogo.timeA, jogo.timeB].some(t => String(t).trim() === 'Brasil')) {
    card.classList.add('brasil');
  }

  const palpite = estado.palpites[jogo.id] || {};
  const encerrado = jogo.golsAReal !== null && jogo.golsBReal !== null;

  card.innerHTML = `
    <div class="jogo-data">📅 ${jogo.dataHoraTexto}${comGrupo
      ? ` <span class="badge-grupo">Grupo ${jogo.grupo}</span>` : ''}${encerrado
      ? ` <span class="resultado">Resultado: ${jogo.golsAReal} x ${jogo.golsBReal}</span>` : ''}</div>
    <div class="jogo-placar">
      <span class="time time-a">${nomeComBandeira(jogo.timeA)}</span>
      <input type="number" min="0" max="99" inputmode="numeric" class="gols"
             data-lado="A" value="${palpite.golsA ?? ''}" placeholder="-" />
      <span class="x">x</span>
      <input type="number" min="0" max="99" inputmode="numeric" class="gols"
             data-lado="B" value="${palpite.golsB ?? ''}" placeholder="-" />
      <span class="time time-b">${nomeComBandeira(jogo.timeB)}</span>
    </div>
    <div class="jogo-trava" hidden>🔒 Palpites encerrados</div>
  `;

  card.querySelectorAll('.gols').forEach(input => {
    input.addEventListener('input', () => aoDigitarPalpite(jogo.id, card));
  });

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
        : p.pontos === 3 ? '<span class="pts pts-3">🎯 +3</span>'
        : p.pontos === 1 ? '<span class="pts pts-1">+1</span>'
        : esqueceu ? '<span class="pts pts-zzz">0</span>'
        : '<span class="pts pts-0">0</span>';
      const eu = p.nome === estado.nome ? ' <small>(você)</small>' : '';
      const placar = esqueceu
        ? '<span class="p-placar p-esqueceu">💤 esqueceu</span>'
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
  card.querySelector('.jogo-trava').hidden = !bloqueado;
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

  const dados = (ehBrasil && estado.rankingBrasil) || estado.ranking;
  const lista = $('#lista-ranking');
  lista.innerHTML = '';
  dados.forEach((r, i) => {
    const li = document.createElement('li');
    const medalha = ['🥇', '🥈', '🥉'][i] || `${i + 1}º`;
    const exatos = r.exatos > 0
      ? `<small class="exatos">🎯 ${r.exatos} na mosca</small>` : '';
    // Detalhe expansível com os palpites de bônus (se o back-end enviar).
    const temDetalhe = 'campeao' in r;
    const detalhe = temDetalhe ? `
      <div class="detalhe">
        <span>🏆 Campeão: <strong>${r.campeao ? nomeComBandeira(r.campeao) : 'ainda não escolheu'}</strong></span>
        <span>⚽ Artilheiro: <strong>${r.artilheiro || 'ainda não escolheu'}</strong></span>
      </div>` : '';
    li.innerHTML = `
      <div class="rank-linha">
        <span class="pos">${medalha}</span>
        <span class="nome">${r.nome}${exatos}</span>
        <span class="pontos">${r.pontos} pts</span>
        ${temDetalhe ? '<span class="seta">▾</span>' : ''}
      </div>${detalhe}`;
    if (temDetalhe) {
      li.classList.add('clicavel');
      li.querySelector('.rank-linha').addEventListener('click', () => {
        li.classList.toggle('aberto');
      });
    }
    lista.appendChild(li);
  });
  if (!dados.length) {
    lista.innerHTML = '<li class="aviso">Ninguém pontuou ainda.</li>';
  }
}

document.querySelectorAll('.sub-aba').forEach(btn => {
  btn.addEventListener('click', () => montarRanking(btn.dataset.ranking));
});

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

init();
