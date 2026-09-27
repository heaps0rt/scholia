const MAX_LANGUAGE_SAMPLE_CHARACTERS = 16_000;
const MIN_LANGUAGE_SAMPLE_CHARACTERS = 24;

const LEGACY_LANGUAGE_CODES = Object.freeze({
  iw: 'he',
  in: 'id',
  ji: 'yi'
});

function balancedSlice(value, limit) {
  const text = String(value || '');
  if (text.length <= limit) return text;
  const part = Math.max(1, Math.floor(limit / 3));
  const middle = Math.max(part, Math.floor((text.length - part) / 2));
  return `${text.slice(0, part)}\n${text.slice(middle, middle + part)}\n${text.slice(-part)}`;
}

function cleanLanguageText(value, limit) {
  return balancedSlice(value, limit)
    .replace(/<[^>]{0,240}>/g, ' ')
    .replace(/\b(?:https?|file):\/\/\S+/gi, ' ')
    .replace(/\[(?:PDF page|Rendered page text|Sanitized page HTML)[^\]]*\]/gi, ' ')
    .replace(/[\p{N}\p{P}\p{S}_]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function canonicalDocumentLanguage(value) {
  const raw = String(value || '').trim().replace(/_/g, '-');
  if (!/^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$/i.test(raw)) return '';
  const legacy = LEGACY_LANGUAGE_CODES[raw.toLowerCase()];
  if (legacy) return legacy;
  try {
    return Intl.getCanonicalLocales(raw)[0] || '';
  } catch {
    return raw.toLowerCase();
  }
}

export function documentLanguageSample({ context = '', visibleContext = '', selection = '' } = {}) {
  return [
    cleanLanguageText(context, 10_000),
    cleanLanguageText(visibleContext, 4_000),
    cleanLanguageText(selection, 2_000)
  ].filter(Boolean).join('\n').slice(0, MAX_LANGUAGE_SAMPLE_CHARACTERS);
}

export function detectedDocumentLanguage(result, fallback = '', sampleLength = 0) {
  const fallbackLanguage = canonicalDocumentLanguage(fallback);
  const candidates = (Array.isArray(result?.languages) ? result.languages : [])
    .map((entry) => ({
      language: canonicalDocumentLanguage(entry?.language),
      percentage: Math.max(0, Number(entry?.percentage) || 0)
    }))
    .filter((entry) => entry.language && entry.language !== 'und')
    .sort((left, right) => right.percentage - left.percentage);
  const best = candidates[0];
  if (!best) return fallbackLanguage;
  const sameAsFallback = fallbackLanguage
    && best.language.split('-', 1)[0] === fallbackLanguage.split('-', 1)[0];
  if (result?.isReliable || best.percentage >= 60 || (sampleLength >= 240 && best.percentage >= 40) || sameAsFallback) {
    return best.language;
  }
  return fallbackLanguage;
}

export async function detectDocumentLanguage(
  source = {},
  detector = globalThis.chrome?.i18n?.detectLanguage?.bind(globalThis.chrome.i18n)
) {
  const fallback = canonicalDocumentLanguage(source.fallback);
  const sample = documentLanguageSample(source);
  if (sample.length < MIN_LANGUAGE_SAMPLE_CHARACTERS || typeof detector !== 'function') return fallback;
  try {
    return detectedDocumentLanguage(await detector(sample), fallback, sample.length) || fallback;
  } catch {
    return fallback;
  }
}

export function documentLanguageLabel(value, displayLocale = 'en') {
  const language = canonicalDocumentLanguage(value);
  if (!language) return '';
  try {
    return new Intl.DisplayNames([displayLocale], { type: 'language' }).of(language) || language;
  } catch {
    return language;
  }
}
