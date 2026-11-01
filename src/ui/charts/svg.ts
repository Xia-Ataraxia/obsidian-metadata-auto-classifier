const PROVIDER_CLASSES: Record<string, string> = {
	OpenAI: 'mac-provider-openai',
	Anthropic: 'mac-provider-anthropic',
	Gemini: 'mac-provider-gemini',
	DeepSeek: 'mac-provider-deepseek',
	OpenRouter: 'mac-provider-openrouter',
	Codex: 'mac-provider-openai',
	TypeSafe: 'mac-provider-typesafe',
};

export function providerClass(provider: string): string {
	return PROVIDER_CLASSES[provider] ?? 'mac-provider-other';
}

export interface SvgTextOptions {
	x: number;
	y: number;
	cls: string;
	anchor?: 'start' | 'end' | 'middle';
}

export function svgText(parent: SVGElement, content: string, options: SvgTextOptions): SVGElement {
	const text = parent.createSvg('text', {
		cls: options.cls.split(' '),
		attr: { x: options.x, y: options.y, 'text-anchor': options.anchor ?? 'start' },
	});
	text.textContent = content;
	return text;
}
