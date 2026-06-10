/* ============================================================
 * BOLÃO COPA 2026 — FRONT-END
 * ============================================================ */

const MINUTOS_BLOQUEIO = 30;
const CHAVE_SESSAO = 'bolao26_sessao';
const chaveRascunho = (nome) => 'bolao26_rascunho_' + nome;

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

// ===================== HELPERS DE DOM =====================

const $ = (sel) => document.querySelector(sel);

function mostrarToast(msg, tipo) {
  const toast = $('#toast');
  toast.textContent = msg;
  toast.className = 'toast ' + (tipo || '');
  toast.hidden = false;
  clearTimeout(mostrarToast._t);
  mostrarToast._t = setTimeout(() => { toast.hidden = true; }, 4000);
}

// ===================== API =====================

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

// ===================== TEMPO / BLOQUEIO =====================

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

    // Rascunho local (palpites digitados e não salvos) tem prioridade
    // sobre o servidor, exceto em jogos já bloqueados.
    const rascunho = JSON.parse(localStorage.getItem(chaveRascunho(estado.nome)) || 'null');
    if (rascunho) {
      const bloqueadoPorId = {};
      estado.jogos.forEach(j => { bloqueadoPorId[j.id] = jogoBloqueado(j); });
      Object.keys(rascunho.palpites || {}).forEach(id => {
        if (!bloqueadoPorId[id]) estado.palpites[id] = rascunho.palpites[id];
      });
      if (!estado.bonusBloqueado) {
        if (rascunho.campeao) estado.campeao = rascunho.campeao;
        if (rascunho.artilheiro) estado.artilheiro = rascunho.artilheiro;
      }
    }

    localStorage.setItem(CHAVE_SESSAO, JSON.stringify({ nome, pin }));
    abrirTelaPalpites();
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

// ===================== TELA DE PALPITES =====================

function abrirTelaPalpites() {
  $('#tela-login').hidden = true;
  $('#tela-palpites').hidden = false;
  $('#topo-nome').textContent = estado.nome;

  // Bônus
  $('#painel-bonus').hidden = false;
  $('#input-campeao').value = estado.campeao;
  $('#input-artilheiro').value = estado.artilheiro;
  if (estado.bonusBloqueado) {
    $('#input-campeao').disabled = true;
    $('#input-artilheiro').disabled = true;
    $('#bonus-travado').hidden = false;
  }

  montarAbas();
  montarPaineisDeGrupos();
  montarRanking();
  ativarAba(estado.grupos[0] || 'ranking');

  // Reavalia bloqueios a cada minuto para "cinzar" jogos que entram na
  // janela de 30 minutos enquanto o usuário navega.
  setInterval(atualizarBloqueios, 60 * 1000);
}

function montarAbas() {
  const nav = $('#abas');
  nav.innerHTML = '';
  estado.grupos.forEach(grupo => {
    nav.appendChild(criarAba('Grupo ' + grupo, grupo));
  });
  nav.appendChild(criarAba('🥇 Ranking', 'ranking'));
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
  document.querySelectorAll('.aba').forEach(b => {
    b.classList.toggle('ativa', b.dataset.aba === id);
  });
  document.querySelectorAll('[data-painel]').forEach(p => {
    p.hidden = p.dataset.painel !== id;
  });
  $('#painel-bonus').hidden = id === 'ranking';
  $('#conteudo').scrollTop = 0;
}

function montarPaineisDeGrupos() {
  const container = $('#paineis-grupos');
  container.innerHTML = '';

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
      .forEach(jogo => painel.appendChild(criarCardJogo(jogo)));

    container.appendChild(painel);
  });
}

function criarCardJogo(jogo) {
  const card = document.createElement('div');
  card.className = 'jogo';
  card.dataset.idJogo = jogo.id;

  const palpite = estado.palpites[jogo.id] || {};
  const encerrado = jogo.golsAReal !== null && jogo.golsBReal !== null;

  card.innerHTML = `
    <div class="jogo-data">📅 ${jogo.dataHoraTexto}${encerrado
      ? ` <span class="resultado">Resultado: ${jogo.golsAReal} x ${jogo.golsBReal}</span>` : ''}</div>
    <div class="jogo-placar">
      <span class="time time-a">${jogo.timeA}</span>
      <input type="number" min="0" max="99" inputmode="numeric" class="gols"
             data-lado="A" value="${palpite.golsA ?? ''}" placeholder="-" />
      <span class="x">x</span>
      <input type="number" min="0" max="99" inputmode="numeric" class="gols"
             data-lado="B" value="${palpite.golsB ?? ''}" placeholder="-" />
      <span class="time time-b">${jogo.timeB}</span>
    </div>
    <div class="jogo-trava" hidden>🔒 Palpites encerrados</div>
  `;

  card.querySelectorAll('.gols').forEach(input => {
    input.addEventListener('input', () => aoDigitarPalpite(jogo.id, card));
  });

  aplicarBloqueio(card, jogo);
  return card;
}

function aoDigitarPalpite(idJogo, card) {
  const a = card.querySelector('[data-lado="A"]').value;
  const b = card.querySelector('[data-lado="B"]').value;
  estado.palpites[idJogo] = { golsA: a, golsB: b };
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
    const card = document.querySelector(`[data-id-jogo="${jogo.id}"]`);
    if (card) aplicarBloqueio(card, jogo);
  });
}

function montarRanking() {
  const lista = $('#lista-ranking');
  lista.innerHTML = '';
  estado.ranking.forEach((r, i) => {
    const li = document.createElement('li');
    const medalha = ['🥇', '🥈', '🥉'][i] || `${i + 1}º`;
    li.innerHTML = `<span class="pos">${medalha}</span>
                    <span class="nome">${r.nome}</span>
                    <span class="pontos">${r.pontos} pts</span>`;
    lista.appendChild(li);
  });
  if (!estado.ranking.length) {
    lista.innerHTML = '<li class="aviso">Ninguém pontuou ainda.</li>';
  }
}

// ===================== RASCUNHO (localStorage) =====================

function salvarRascunho() {
  if (!estado.nome) return;
  localStorage.setItem(chaveRascunho(estado.nome), JSON.stringify({
    palpites: estado.palpites,
    campeao: $('#input-campeao').value,
    artilheiro: $('#input-artilheiro').value
  }));
}

['#input-campeao', '#input-artilheiro'].forEach(sel => {
  $(sel).addEventListener('input', () => {
    salvarRascunho();
    $('#topo-status').textContent = 'Alterações não salvas';
  });
});

// ===================== SALVAR =====================

$('#btn-salvar').addEventListener('click', async () => {
  const btn = $('#btn-salvar');
  btn.disabled = true;
  btn.textContent = 'Salvando…';

  try {
    // Envia somente jogos com placar completo e ainda não bloqueados.
    // Jogos sem palpite ficam de fora: a Regra do Esquecimento (0x0)
    // é aplicada pelo back-end na hora de pontuar.
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
      campeao: estado.bonusBloqueado ? '' : $('#input-campeao').value.trim(),
      artilheiro: estado.bonusBloqueado ? '' : $('#input-artilheiro').value.trim(),
      palpites
    });

    if (!resp.ok) throw new Error(resp.erro || 'Erro ao salvar.');

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
