# ⚽ Bolão Copa do Mundo 2026

Web app *serverless* para bolão entre amigos: front-end estático no **GitHub Pages**, API no **Google Apps Script** e banco de dados no **Google Sheets**.

```
┌─────────────────┐      fetch (JSON)      ┌──────────────────┐      ┌───────────────┐
│  GitHub Pages   │ ─────────────────────► │ Google Apps      │ ───► │ Google Sheets │
│  (HTML/CSS/JS)  │ ◄───────────────────── │ Script (doGet/   │ ◄─── │ (3 abas)      │
└─────────────────┘                        │ doPost)          │      └───────────────┘
                                           └──────────────────┘
```

## Estrutura do projeto

```
index.html        → telas de login e palpites
css/style.css     → estilos (mobile-first)
js/config.js      → URL da API (você precisa editar!)
js/app.js         → lógica do front-end
backend/Code.gs   → API completa (colar no Apps Script)
```

---

## 1. Configurar a planilha (Google Sheets)

Crie uma planilha com **3 abas** (nomes exatos):

**Aba `Jogadores`**

| Nome | PIN | Campeão | Artilheiro | Pontuacao_Total |
|------|-----|---------|------------|-----------------|
| Lucas | 1234 | | | 0 |
| Maria | 5678 | | | 0 |

> 💡 Formate a coluna **PIN como Texto Simples** (Formatar > Número > Texto simples) para não perder zeros à esquerda (ex.: `0042`).

**Aba `Jogos`**

| ID_Jogo | Grupo | Data_Hora | Time_A | Time_B | Gols_A_Real | Gols_B_Real |
|---------|-------|-----------|--------|--------|-------------|-------------|
| 1 | A | 11/06/2026 13:00:00 | México | Seleção 2 | | |
| 2 | A | 11/06/2026 19:00:00 | Seleção 3 | Seleção 4 | | |

> `Data_Hora` no formato `dd/mm/aaaa hh:mm:ss`. Deixe `Gols_A_Real`/`Gols_B_Real` vazios até o jogo acontecer.

**Aba `Palpites`** — apenas o cabeçalho (o script preenche o resto):

| Nome | ID_Jogo | Palpite_Gols_A | Palpite_Gols_B | Ultima_Atualizacao |
|------|---------|----------------|----------------|--------------------|

---

## 2. Configurar o back-end (Apps Script)

1. Na planilha: **Extensões > Apps Script**.
2. Apague o conteúdo do `Code.gs` e cole o arquivo [`backend/Code.gs`](backend/Code.gs) deste repositório.
3. ⚙️ **Configurações do projeto > Fuso horário**: escolha o mesmo fuso dos horários da aba Jogos (ex.: `America/Sao_Paulo`). **A regra dos 30 minutos depende disso.**
4. **Implantar > Nova implantação > Tipo: App da Web**:
   - *Executar como:* **Eu**
   - *Quem pode acessar:* **Qualquer pessoa** ← obrigatório para o CORS funcionar
5. Autorize as permissões e copie a **URL do App da Web** (termina em `/exec`).

> 🔁 Se alterar o código depois, use **Implantar > Gerenciar implantações > ✏️ > Nova versão** para a URL continuar a mesma.

## 3. Configurar o front-end

1. Edite [`js/config.js`](js/config.js) e cole a URL copiada no passo anterior.
2. Faça commit/push para o GitHub.
3. No repositório: **Settings > Pages > Branch: `main` / root > Save**.
4. Acesse `https://SEU_USUARIO.github.io/app-bolao-copa-26/`.

## 4. Durante a Copa (rotina do admin)

1. Após cada rodada, preencha `Gols_A_Real` e `Gols_B_Real` na aba **Jogos**.
2. No Apps Script, rode a função **`atualizarPontuacao()`** (ou crie um acionador: *Acionadores > Adicionar acionador > atualizarPontuacao > baseado em tempo > a cada hora*).
3. No fim do torneio, preencha as constantes `CAMPEAO_REAL` e `ARTILHEIRO_REAL` no topo do `Code.gs` e rode `atualizarPontuacao()` de novo para aplicar os bônus de 10 pts.

---

## Regras implementadas

| Regra | Onde é aplicada |
|-------|-----------------|
| Placar exato = **3 pts**, vencedor/empate = **1 pt**, erro = **0** | `atualizarPontuacao()` no back-end |
| Bônus Campeão/Artilheiro = **10 pts cada**, travados no pontapé inicial do 1º jogo | back-end valida; front-end desabilita os campos |
| **Regra dos 30 min**: jogo a menos de 30 min (ou já iniciado) rejeita alteração, mas salva o resto do pacote | back-end (`salvarPalpites`) usa o relógio do servidor; front-end "cinza" os jogos |
| **Esquecimento**: sem palpite = **0 ponto** no jogo (um 0x0 automático premiaria quem esqueceu em jogos sem gols) | back-end ignora jogos sem palpite ao pontuar; lista revelada mostra "💤 esqueceu" |
| **Upsert**: nunca duplica linha por (Nome, ID_Jogo) | back-end com `LockService` contra salvamentos simultâneos |
| **Memória**: palpites salvos são carregados no login; rascunhos ficam no `localStorage` enquanto navega | front-end |

### Como o CORS foi resolvido

O Apps Script não responde requisições *preflight* (`OPTIONS`). O front-end contorna isso enviando o JSON com `Content-Type: text/plain` — uma "simple request" que não dispara preflight. Com a implantação acessível a "Qualquer pessoa", o Google adiciona `Access-Control-Allow-Origin: *` automaticamente. Nenhum hack adicional é necessário.

---

## Melhorias incluídas além do pedido 💡

- **Aba de Ranking** 🥇 com a pontuação de todos os jogadores, direto na tela de palpites.
- **Botão "Salvar" fixo no rodapé**, visível em todas as abas (em vez de só na última tela) — reduz palpites perdidos.
- **Sessão lembrada**: o app reloga automaticamente quem já entrou (localStorage).
- **Resultado real exibido** no card do jogo quando o placar é lançado na planilha.
- **Relógio sincronizado**: o front usa o horário do servidor (offset calculado no carregamento), então relógio errado no celular não engana o bloqueio visual — e o back-end revalida tudo de qualquer forma.
- **Re-checagem automática a cada minuto**: jogos que entram na janela de 30 min ficam cinzas sem precisar recarregar a página.

### Ideias futuras (não implementadas)

- Acionador `onEdit`/tempo para recalcular pontos automaticamente ao lançar resultados.
- Hash do PIN na planilha (hoje é texto puro — ok para bolão entre amigos, mas o dono da planilha vê os PINs).
- Fase de mata-mata: basta usar valores como `Oitavas`, `Quartas` etc. na coluna `Grupo` — o app cria as abas dinamicamente.
