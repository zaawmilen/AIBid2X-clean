import Anthropic from '@anthropic-ai/sdk';
import { env } from '../config/env.js';
import { logger } from './logger.js';
let _client = null;
export function getAnthropicClient() {
    if (!_client) {
        if (!env.ANTHROPIC_API_KEY)
            throw new Error('ANTHROPIC_API_KEY is not set');
        _client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
    }
    return _client;
}
export const ANALYSIS_MODEL = 'claude-sonnet-4-20250514';
export const MAX_TOKENS = 1000;
export const ANALYST_SYSTEM_PROMPT = `You are an expert auction analyst with deep knowledge of
collectibles, antiques, and high-value goods markets. You provide concise, data-driven analysis
to help bidders and sellers make informed decisions. Always base observations on the specific
numbers and patterns provided — avoid generic statements. Use markdown with bold headers.`;
export async function streamAnalysis(prompt, onText, onDone) {
    const client = getAnthropicClient();
    await new Promise((resolve, reject) => {
        const stream = client.messages.stream({
            model: ANALYSIS_MODEL,
            max_tokens: MAX_TOKENS,
            system: ANALYST_SYSTEM_PROMPT,
            messages: [{ role: 'user', content: prompt }],
        });
        stream.on('text', (textDelta) => { onText(textDelta); });
        stream.on('finalMessage', (message) => {
            logger.info({
                model: ANALYSIS_MODEL,
                inputTokens: message.usage.input_tokens,
                outputTokens: message.usage.output_tokens,
                estimatedCostUSD: ((message.usage.input_tokens / 1_000_000) * 3 +
                    (message.usage.output_tokens / 1_000_000) * 15).toFixed(6),
            }, 'Analysis stream completed');
            onDone({ inputTokens: message.usage.input_tokens, outputTokens: message.usage.output_tokens });
            resolve();
        });
        stream.on('error', (err) => { reject(err); });
    });
}
export async function streamMockAnalysis(currentPrice, startingPrice, reservePrice, bidCount, endTimeMinutes, similarCount, onText, onDone) {
    const priceIncreasePct = Number(startingPrice) > 0
        ? (((Number(currentPrice) - Number(startingPrice)) / Number(startingPrice)) * 100).toFixed(1)
        : '0';
    const timeNote = endTimeMinutes !== null
        ? endTimeMinutes < 60
            ? `With under an hour remaining, expect accelerated last-minute bidding.`
            : `With ${Math.floor(endTimeMinutes / 60)} hour(s) remaining, significant movement is possible.`
        : '';
    const mockText = `**Bidding Momentum**\n\n` +
        `This auction has attracted ${bidCount} bid${bidCount !== 1 ? 's' : ''}, ` +
        `${bidCount === 0
            ? `sitting at its opening price of $${startingPrice} — no buyer signal yet.`
            : `driving the price ${priceIncreasePct}% above the $${startingPrice} starting point to $${currentPrice}.`} ${timeNote}\n\n` +
        `**Market Positioning**\n\n` +
        `${similarCount > 0
            ? `Hybrid search (pgvector + full-text) found ${similarCount} comparable auction(s) for context. `
            : `No directly comparable items are currently active — external research recommended. `}` +
        `The current price of $${currentPrice} reflects ` +
        `${bidCount === 0 ? 'seller expectations only — no buyer validation yet.' : 'active buyer interest.'}\n\n` +
        `**Price Forecast**\n\n` +
        `${bidCount === 0
            ? 'Without initial bids, final price is uncertain. First bids typically catalyse further activity.'
            : `Based on current momentum, expect continued upward pressure. Auctions with ${bidCount}+ early bids typically see 15-35% additional increases before close.`} ${reservePrice ? `Reserve of $${reservePrice} must be met.` : 'No reserve — guaranteed sale.'}\n\n` +
        `**Key Observations**\n\n` +
        `Running in mock mode (no ANTHROPIC_API_KEY). All figures reflect live auction data. ` +
        `Add your API key for full AI-powered analysis.`;
    for (const word of mockText.split(' ')) {
        onText(word + ' ');
        await new Promise((resolve) => setTimeout(resolve, 25));
    }
    onDone({ inputTokens: 0, outputTokens: 0 });
}
//# sourceMappingURL=anthropic.js.map