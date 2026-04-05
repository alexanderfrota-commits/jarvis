const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json({ limit: '5mb' }));

const DNA_DIR = '/opt/jarvis/dna';
const MEMORY_FILE = '/opt/jarvis/dna/MEMORY.json';
const INSIGHTS_DIR = '/opt/jarvis/dna/insights';
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY || 'COLE_SUA_KEY_AQUI';
const ELEVEN_KEY = process.env.ELEVEN_KEY || '';
const VOICE_ID = 'ycxdm1PRMs962FxyyuJ0';

const AGENTS = {
  cfo: { keywords: ['financeiro','financeira','receita','custo','margem','lucro','caixa','fluxo de caixa','investimento','roi','burn rate','runway','valuation'], role: 'CFO', soul: 'Analise financeira rigorosa. Sempre quantifique. Questione gastos sem ROI.' },
  cmo: { keywords: ['marketing','marca','branding','campanha','posicionamento','lead','trafego','cpl','cac'], role: 'CMO', soul: 'Estrategia de marketing e aquisicao. Foque em CAC, LTV e canais.' },
  cro: { keywords: ['revenue','mrr','arr','churn','upsell','pipeline de vendas','forecast','meta de vendas'], role: 'CRO', soul: 'Estrategia de receita. Una marketing e vendas. Pipeline e conversao.' },
  coo: { keywords: ['operacao','processo','eficiencia','automacao','escala','equipe','contratacao','kpi','okr','workflow'], role: 'COO', soul: 'Eficiencia operacional e processos. Elimine gargalos. Pense em escala.' },
  closer: { keywords: ['fechar','fechamento','negociacao','objecao','proposta','contrato','deal','venda','vender'], role: 'Closer', soul: 'Expert em fechamento. DNA Cole Gordon + Jeremy Miner. Use NEPQ. Nunca force.' },
  bdr: { keywords: ['prospeccao','prospectar','outbound','cold call','cold email','qualificacao','lead frio'], role: 'BDR', soul: 'Prospeccao outbound. ICP, personalizacao e volume com qualidade.' },
  'paid-media': { keywords: ['ads','anuncio','facebook ads','google ads','meta ads','trafego pago','roas','ctr','criativo','copy'], role: 'Paid Media', soul: 'Midia paga. Otimize ROAS e criativos. Dados > opiniao. Teste antes de escalar.' },
  'cole-gordon': { keywords: ['cole gordon','scalable','tsc','script de vendas','sales script'], role: 'Cole Gordon', soul: 'Frameworks de vendas escalaveis e scripts de alta conversao.' },
  'alex-hormozi': { keywords: ['hormozi','oferta irresistivel','grand slam offer','100m','lead magnet'], role: 'Alex Hormozi', soul: 'Ofertas irresistiveis. Valor > preco. Empilhe bonus. Escala massiva.' },
  'jeremy-miner': { keywords: ['nepq','miner','neuro emotional','pergunta neuro'], role: 'Jeremy Miner', soul: 'NEPQ: Situation, Problem, Solution, Consequence. Perguntas > pitches.' },
  beendi: { keywords: ['beendi','gateway','pagamento','transacao','saque','merchant','webhook','pagar.me'], role: 'Beendi Expert', soul: 'Gateway de pagamentos single-tenant. Supabase, Edge Functions, webhooks.' },
  bloopi: { keywords: ['bloopi','checkout','mor','merchant of record','stripe','cross-border'], role: 'Bloopi Expert', soul: 'Checkout white-label, Merchant of Record. Stripe Connect, entidade Irlanda.' }
};

const CONCLAVE = {
  critico: 'Avalie o PROCESSO. A evidencia e solida? Gaps no raciocinio? Score 0-100.',
  advogado: 'Questione TUDO. Riscos ocultos, premissas nao testadas.',
  sintetizador: 'Integre perspectivas em UMA recomendacao. Convergencias e divergencias.'
};

function loadDNA() {
  try {
    return fs.readdirSync(DNA_DIR).filter(f => (f.endsWith('.md') || f.endsWith('.yaml')) && f !== 'MEMORY.json').map(f => { try { return fs.readFileSync(path.join(DNA_DIR, f), 'utf8'); } catch(e) { return ''; } }).join('\n---\n');
  } catch(e) { return ''; }
}

function loadInsights(name) {
  try { const f = path.join(INSIGHTS_DIR, name + '-insights.json'); if (fs.existsSync(f)) return fs.readFileSync(f, 'utf8'); } catch(e) {} return '';
}

function loadMemory() {
  try { if (fs.existsSync(MEMORY_FILE)) return JSON.parse(fs.readFileSync(MEMORY_FILE, 'utf8')); } catch(e) {} return { facts: [], history: [] };
}

function saveMemory(m) { try { fs.writeFileSync(MEMORY_FILE, JSON.stringify(m, null, 2)); } catch(e) {} }

function addToMemory(fact) { const m = loadMemory(); m.facts.push({ text: fact, date: new Date().toISOString() }); if (m.facts.length > 200) m.facts = m.facts.slice(-200); saveMemory(m); }

function addToHistory(role, content) { const m = loadMemory(); m.history.push({ role, content, date: new Date().toISOString() }); if (m.history.length > 100) m.history = m.history.slice(-100); saveMemory(m); }

function routeQuestion(q) {
  const n = q.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  if (n.includes('conclave') || n.includes('/board')) return { mode: 'conclave', agents: [] };
  const matched = [];
  for (const [id, a] of Object.entries(AGENTS)) {
    const score = a.keywords.filter(kw => n.includes(kw)).length;
    if (score > 0) matched.push({ id, score, ...a });
  }
  matched.sort((a, b) => b.score - a.score);
  if (matched.length === 0) return { mode: 'jarvis', agents: [] };
  if (matched.length === 1 || matched[0].score > matched[1].score) return { mode: 'single', agents: [matched[0]] };
  return { mode: 'debate', agents: matched.slice(0, 3) };
}

function buildPrompt(mode, agents, question) {
  const dna = loadDNA();
  const mem = loadMemory();
  const facts = mem.facts.length > 0 ? '\nMEMORIAS:\n' + mem.facts.slice(-30).map(f => '- ' + f.text).join('\n') : '';
  const base = 'Voce e JARVIS, assistente pessoal de Alexander. Portugues brasileiro. MAXIMO 3 frases (voz). Trate como "senhor". Direto e pratico.\n' + dna + facts;

  if (mode === 'jarvis') return base + '\nResponda como JARVIS.';
  if (mode === 'single') {
    const a = agents[0];
    let extra = '';
    if (a.id === 'beendi') extra = '\n' + loadInsights('BEENDI-001');
    if (a.id === 'bloopi') extra = '\n' + loadInsights('BLOOPI-001');
    return base + '\nAGENTE: ' + a.role + '\n' + a.soul + extra + '\nResponda COMO este agente. Identifique-se em 2 palavras no inicio.';
  }
  if (mode === 'debate') {
    const list = agents.map(a => a.role + ': ' + a.soul).join('\n');
    return base + '\nDEBATE:\n' + list + '\n1 frase por agente + sintese. Max 5 frases.';
  }
  if (mode === 'conclave') {
    return base + '\nCONCLAVE:\nCritico: ' + CONCLAVE.critico + '\nAdvogado: ' + CONCLAVE.advogado + '\nSintetizador: ' + CONCLAVE.sintetizador + '\n1-2 frases por membro + sintese. Max 6 frases. Comece com "Conclave convocado, senhor."';
  }
  return base;
}

app.post('/ask', async (req, res) => {
  const { question, history } = req.body;
  if (!question) return res.status(400).json({ error: 'question required' });

  const isMemorize = question.startsWith('[MEMORIZAR]');
  const route = routeQuestion(question);
  console.log('[ROUTE] mode=' + route.mode + ' agents=' + (route.agents.map(a => a.id).join(',') || 'jarvis'));

  const messages = [];
  if (history && Array.isArray(history)) history.slice(-6).forEach(h => messages.push({ role: h.role === 'user' ? 'user' : 'assistant', content: h.content }));
  messages.push({ role: 'user', content: question });

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: 'claude-sonnet-4-20250514', max_tokens: 400, system: buildPrompt(route.mode, route.agents, question), messages })
    });

    const data = await response.json();
    if (data.error) { console.error('Claude erro:', data.error); return res.status(500).json({ error: data.error.message }); }

    const reply = data.content[0].text;
    console.log('[' + route.mode.toUpperCase() + '] ' + reply.substring(0, 80));

    if (isMemorize) addToMemory(question.replace('[MEMORIZAR]', '').trim());
    addToHistory('user', question.replace('[MEMORIZAR] ', ''));
    addToHistory('assistant', reply);

    let audioBase64 = null;
    if (ELEVEN_KEY) {
      try {
        const ar = await fetch('https://api.elevenlabs.io/v1/text-to-speech/' + VOICE_ID, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'xi-api-key': ELEVEN_KEY },
          body: JSON.stringify({ text: reply, model_id: 'eleven_multilingual_v2', voice_settings: { stability: 0.5, similarity_boost: 0.75 } })
        });
        if (ar.ok) { const buf = await ar.arrayBuffer(); audioBase64 = Buffer.from(buf).toString('base64'); }
      } catch(e) {}
    }

    res.json({ reply, audio: audioBase64, route: route.mode, agents: route.agents.map(a => a.id) });
  } catch(e) {
    console.error('ERRO:', e.message);
    res.status(500).json({ error: e.message });
  }
});

app.get('/health', (req, res) => { const m = loadMemory(); res.json({ status: 'online', engine: 'claude-sonnet-4', agents: Object.keys(AGENTS).length, memory: { facts: m.facts.length, history: m.history.length } }); });
app.get('/memory', (req, res) => res.json(loadMemory()));
app.get('/agents', (req, res) => res.json({ agents: Object.entries(AGENTS).map(([id, a]) => ({ id, role: a.role })), conclave: Object.keys(CONCLAVE) }));

app.listen(3000, () => console.log('JARVIS API (Claude + Agents) rodando na porta 3000'));
