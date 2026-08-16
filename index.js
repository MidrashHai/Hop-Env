const express = require('express');
const app = express();

app.use(express.json());

// CORS - autoriser GitHub Pages
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.header('Access-Control-Allow-Methods', 'POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

// Proxy NVIDIA
app.post('/nvidia', async (req, res) => {
  const key1 = process.env.NVIDIA_KEY_1;
  const key2 = process.env.NVIDIA_KEY_2;

  const keyToUse = req.headers['x-nvidia-key'] === '2' ? (key2 || key1) : (key1 || key2);

  if (!keyToUse) {
    return res.status(500).json({ error: 'NVIDIA keys not configured on server' });
  }

  try {
    const response = await fetch('https://integrate.api.nvidia.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + keyToUse
      },
      body: JSON.stringify(req.body)
    });

    const data = await response.json();
    res.status(response.status).json(data);

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/', (req, res) => res.send('HOP Model Router · NVIDIA Proxy · actif'));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('HOP Proxy · port ' + PORT));
