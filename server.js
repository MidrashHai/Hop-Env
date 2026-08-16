const express = require('express');
const path = require('path');
const app = express();
app.use(express.json({ limit: '10mb' }));

// ── FICHIERS STATIQUES · sert index.html et assets depuis la racine du repo ──
app.use(express.static(path.join(__dirname)));

// ── CORS ──────────────────────────────────────────────────────────────────────
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-nvidia-key');
  res.header('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

/* ═══════════════════════════════════════════════════════════════════════════
   HOP AI GATEWAY™ · v3.0 · 16 août 2026
   Architecture : HOP UI → HOP BACKEND → HOP AI GATEWAY → NVIDIA
   Fiche : HOP AI Provider Registry™ v1.0 · Fiche Déploiement v1.0
   Règle : aucun modèle n'est une autorité HOP · les clés restent côté serveur
═══════════════════════════════════════════════════════════════════════════ */

/* ── MODEL REGISTRY · Fiche Architecturale Officielle v1.0 ──────────────────
   SHEM Render   → nom de la variable d'environnement Render / Hop-Env
   model_id      → chaîne exacte envoyée à l'API NVIDIA
   provider_id   → identifiant interne HOP (envoyé par le frontend)
   hop_role      → droit fonctionnel du modèle (jamais autorité normative)
   endpoint      → URL NVIDIA à appeler
   transport     → 'openai-chat' | 'genai-image'
   ─────────────────────────────────────────────────────────────────────────── */
const MODEL_REGISTRY = {
  NVIDIA_GLM: {
    shem_render: 'NVIDIA_GLM_5_2_API_KEY',
    model_id:    'z-ai/glm-5.2',
    hop_role:    'COGNITIVE_MASTER',
    endpoint:    'https://integrate.api.nvidia.com/v1/chat/completions',
    transport:   'openai-chat'
  },
  NVIDIA_LAGUNA: {
    shem_render: 'NVIDIA_LAGUNA_XS_2_1_API_KEY',
    model_id:    'poolside/laguna-xs-2.1',
    hop_role:    'CONSTRUCTOR',
    endpoint:    'https://integrate.api.nvidia.com/v1/chat/completions',
    transport:   'openai-chat'
  },
  NVIDIA_NEMOTRON_OMNI: {
    shem_render: 'NVIDIA_NEMOTRON_OMNI_API_KEY',
    model_id:    'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning',
    hop_role:    'OBSERVER',
    endpoint:    'https://integrate.api.nvidia.com/v1/chat/completions',
    transport:   'openai-chat'
  },
  NVIDIA_FLUX_2_KLEIN_4B: {
    shem_render: 'NVIDIA_FLUX_2_KLEIN_4B_API_KEY',
    model_id:    'flux.2-klein-4b',
    hop_role:    'DESIGN_INITIAL',
    endpoint:    'https://ai.api.nvidia.com/v1/genai/black-forest-labs/flux.2-klein-4b',
    transport:   'genai-image'
  },
  NVIDIA_FLUX_KONTEXT: {
    shem_render: 'NVIDIA_FLUX_KONTEXT_API_KEY',
    model_id:    'black-forest-labs/flux.1-kontext-dev',
    hop_role:    'DESIGN_REVISION',
    endpoint:    'https://ai.api.nvidia.com/v1/genai/black-forest-labs/flux.1-kontext-dev',
    transport:   'genai-image'
  },
  NVIDIA_NEMOTRON_3_SUPER: {
    shem_render: 'NVIDIA_NEMOTRON_3_SUPER_API_KEY',
    model_id:    'nvidia/nemotron-3-super-120b-a12b',
    hop_role:    'CONVERSATION',
    endpoint:    'https://integrate.api.nvidia.com/v1/chat/completions',
    transport:   'openai-chat'
  }
};

/* ── HELPER · lire la clé Render selon le shem ───────────────────────────── */
function getKey(shem_render) {
  return process.env[shem_render] || null;
}

/* ── HELPER · appel openai-chat ───────────────────────────────────────────── */
async function callOpenAIChat(endpoint, model_id, apiKey, messages, max_tokens, extra) {
  const body = {
    model: model_id,
    messages,
    temperature:  extra.temperature  ?? 1,
    top_p:        extra.top_p        ?? 1,
    max_tokens:   Math.min(max_tokens || 1500, 4096),
    seed:         extra.seed         ?? 42,
    stream:       false,
    ...( extra.enable_thinking !== undefined && { enable_thinking: extra.enable_thinking }),
    ...( extra.reasoning_effort !== undefined && { reasoning_effort: extra.reasoning_effort })
  };
  const r = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + apiKey },
    body: JSON.stringify(body)
  });
  return { status: r.status, data: await r.json() };
}

/* ── HELPER · appel genai-image ───────────────────────────────────────────── */
async function callGenAIImage(endpoint, apiKey, payload) {
  const r = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + apiKey },
    body: JSON.stringify(payload)
  });
  return { status: r.status, data: await r.json() };
}

/* ═══════════════════════════════════════════════════════════════════════════
   ROUTE : /gateway   ← HOP AI GATEWAY™ · point d'entrée unique v3
   Body attendu :
   {
     provider_id : "NVIDIA_GLM" | "NVIDIA_LAGUNA" | ... (requis)
     messages    : [{role, content}]                    (openai-chat)
     max_tokens  : number                               (optionnel)
     prompt      : string                               (genai-image)
     model_id    : string                               (optionnel · override)
   }
   Réponse : même format que l'API NVIDIA distale
═══════════════════════════════════════════════════════════════════════════ */
app.post('/gateway', async (req, res) => {
  const { provider_id, messages, max_tokens, prompt, ...extra } = req.body;

  // 1. Vérifier que le provider_id est connu
  const reg = MODEL_REGISTRY[provider_id];
  if (!reg) {
    return res.status(400).json({
      error: 'PROVIDER_UNKNOWN',
      detail: `provider_id "${provider_id}" non référencé dans le MODEL_REGISTRY HOP`,
      known_providers: Object.keys(MODEL_REGISTRY)
    });
  }

  // 2. Lire la clé Render correspondante
  const apiKey = getKey(reg.shem_render);
  if (!apiKey) {
    return res.status(500).json({
      error: 'KEY_NOT_CONFIGURED',
      detail: `Variable Render "${reg.shem_render}" absente ou vide`,
      provider_id,
      hop_role: reg.hop_role
    });
  }

  // 3. Appeler NVIDIA selon le transport
  try {
    let result;

    if (reg.transport === 'openai-chat') {
      if (!messages || !Array.isArray(messages)) {
        return res.status(400).json({ error: 'MESSAGES_REQUIRED', detail: 'Le champ messages[] est requis pour un appel openai-chat' });
      }
      result = await callOpenAIChat(reg.endpoint, reg.model_id, apiKey, messages, max_tokens, extra);

    } else if (reg.transport === 'genai-image') {
      if (!prompt) {
        return res.status(400).json({ error: 'PROMPT_REQUIRED', detail: 'Le champ prompt est requis pour un appel genai-image' });
      }
      result = await callGenAIImage(reg.endpoint, apiKey, { prompt, ...extra });

    } else {
      return res.status(500).json({ error: 'TRANSPORT_UNKNOWN', detail: reg.transport });
    }

    // Log minimal côté serveur (sans clé)
    console.log(`[HOP GATEWAY] ${provider_id} · ${reg.hop_role} · HTTP ${result.status}`);
    return res.status(result.status).json(result.data);

  } catch (err) {
    console.error(`[HOP GATEWAY ERROR] ${provider_id} ·`, err.message);
    return res.status(500).json({ error: 'GATEWAY_ERROR', detail: err.message, provider_id });
  }
});

/* ═══════════════════════════════════════════════════════════════════════════
   ROUTE : /nvidia   ← rétrocompatibilité v2
   Conservée pour ne pas casser les appels existants de l'ancienne interface.
   Lit NVIDIA_KEY_1 / NVIDIA_KEY_2 si présents · sinon tente NVIDIA_GLM_5_2_API_KEY
═══════════════════════════════════════════════════════════════════════════ */
app.post('/nvidia', async (req, res) => {
  const key1 = process.env.NVIDIA_KEY_1 || process.env.NVIDIA_GLM_5_2_API_KEY;
  const key2 = process.env.NVIDIA_KEY_2 || process.env.NVIDIA_LAGUNA_XS_2_1_API_KEY;
  const keyToUse = req.headers['x-nvidia-key'] === '2' ? (key2 || key1) : (key1 || key2);

  if (!keyToUse) {
    return res.status(500).json({ error: 'NVIDIA keys not configured on server' });
  }
  try {
    const response = await fetch('https://integrate.api.nvidia.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + keyToUse },
      body: JSON.stringify(req.body)
    });
    const data = await response.json();
    console.log(`[/nvidia legacy] HTTP ${response.status}`);
    res.status(response.status).json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ── HEALTH · /status retourne le JSON des providers ─────────────────────── */
app.get('/status', (req, res) => {
  const status = Object.entries(MODEL_REGISTRY).map(([id, reg]) => ({
    provider_id: id,
    hop_role:    reg.hop_role,
    key_present: !!process.env[reg.shem_render]
  }));
  res.json({
    service:   'HOP AI Gateway™ · v3.0',
    date:      '16 août 2026',
    corpus:    'Mishkan haRouah beOlam · 771',
    providers: status
  });
});

app.get('/health', (req, res) => res.json({ status: 'ok', version: '3.0' }));

// ── FALLBACK · toute route non reconnue sert index.html ───────────────────
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

/* ── START ───────────────────────────────────────────────────────────────── */
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`HOP AI Gateway™ v3.0 · port ${PORT}`));
