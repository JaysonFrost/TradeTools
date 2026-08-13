import type { InterfaceTheme } from '../../main/services/settings/settings'

export const interfaceThemeStorageKey = 'tradetools.interface-theme'

export const normalizeInterfaceTheme = (value: unknown): InterfaceTheme => (
  value === 'engineering-blueprint' ? 'engineering-blueprint' : 'classic'
)

export const readStoredInterfaceTheme = (): InterfaceTheme => {
  try {
    return normalizeInterfaceTheme(window.localStorage.getItem(interfaceThemeStorageKey))
  } catch {
    return 'classic'
  }
}

export const applyInterfaceTheme = (theme: InterfaceTheme): void => {
  document.documentElement.dataset.interfaceTheme = theme
}

export const rememberInterfaceTheme = (theme: InterfaceTheme): void => {
  try {
    window.localStorage.setItem(interfaceThemeStorageKey, theme)
  } catch {
    // Settings persistence remains the source of truth when browser storage is unavailable.
  }
}
