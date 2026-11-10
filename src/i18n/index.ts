// Multi-language (§15): original key names preserved, switching takes effect immediately
// locales/*.json are the source of truth, checked in directly (ENG converted from the upstream
// program's Lang/*.txt files; POL is our addition). WebSpectrometer2.0 ships English and Polish only.
import { useAppState } from '../app/store'
import { EXTRA_KEYS } from './extra'
import ENG from './locales/ENG.json'
import POL from './locales/POL.json'

export type LangCode = 'ENG' | 'POL'

export const LANGUAGES: LangCode[] = ['ENG', 'POL']

const dicts: Record<LangCode, Record<string, string>> = {
  ENG: ENG as Record<string, string>,
  POL: POL as Record<string, string>,
}

export function translate(lang: LangCode, key: string): string {
  return (
    dicts[lang]?.[key] ??
    EXTRA_KEYS[lang]?.[key] ??
    dicts.ENG[key] ??
    EXTRA_KEYS.ENG[key] ??
    key
  )
}

// For components: translation function reading the current language from the store (centralizes the language resolution rule)
export function useT(): (key: string) => string {
  const { settings } = useAppState()
  const lang = settings.Language as LangCode
  return (key) => translate(lang, key)
}
