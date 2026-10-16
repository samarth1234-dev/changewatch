function compact(value, max = 300) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function fallbackSummary(summary, percent) {
  const added = compact(summary?.added, 110);
  const removed = compact(summary?.removed, 110);
  if (added && removed) return `${percent}% changed: added “${added}” and removed “${removed}”.`;
  if (added) return `${percent}% changed: added “${added}”.`;
  if (removed) return `${percent}% changed: removed “${removed}”.`;
  return `${percent}% of the monitored content changed.`;
}

async function summarizeChange({ targetName, summary, percent, enabled }) {
  const fallback = fallbackSummary(summary, percent);
  if (!enabled || !process.env.OPENAI_API_KEY) return { text: fallback, provider: 'local' };

  try {
    const response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: process.env.OPENAI_SUMMARY_MODEL || 'gpt-5-mini',
        instructions: 'Write one neutral, factual sentence describing the detected webpage change. Do not invent information. Keep it under 140 characters.',
        input: `Monitor: ${targetName}\nChange: ${percent}%\nAdded: ${compact(summary?.added, 700)}\nRemoved: ${compact(summary?.removed, 700)}`,
        max_output_tokens: 80,
      }),
      signal: AbortSignal.timeout(12_000),
    });
    if (!response.ok) throw new Error(`OpenAI returned ${response.status}`);
    const data = await response.json();
    const text = compact(data.output_text, 180);
    return text ? { text, provider: 'openai' } : { text: fallback, provider: 'local' };
  } catch (error) {
    console.warn(`AI summary fallback: ${error.message}`);
    return { text: fallback, provider: 'local' };
  }
}

module.exports = { summarizeChange };
