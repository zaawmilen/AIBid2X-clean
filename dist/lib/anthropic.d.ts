import Anthropic from '@anthropic-ai/sdk';
export declare function getAnthropicClient(): Anthropic;
export declare const ANALYSIS_MODEL = "claude-sonnet-4-20250514";
export declare const MAX_TOKENS = 1000;
export declare const ANALYST_SYSTEM_PROMPT = "You are an expert auction analyst with deep knowledge of\ncollectibles, antiques, and high-value goods markets. You provide concise, data-driven analysis\nto help bidders and sellers make informed decisions. Always base observations on the specific\nnumbers and patterns provided \u2014 avoid generic statements. Use markdown with bold headers.";
export declare function streamAnalysis(prompt: string, onText: (text: string) => void, onDone: (usage: {
    inputTokens: number;
    outputTokens: number;
}) => void): Promise<void>;
export declare function streamMockAnalysis(currentPrice: string, startingPrice: string, reservePrice: string | null, bidCount: number, endTimeMinutes: number | null, similarCount: number, onText: (text: string) => void, onDone: (usage: {
    inputTokens: number;
    outputTokens: number;
}) => void): Promise<void>;
//# sourceMappingURL=anthropic.d.ts.map