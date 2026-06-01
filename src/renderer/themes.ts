import type { Monaco } from '@monaco-editor/react'

export type StrataTheme = {
  id: string
  label: string
  group: 'dark' | 'light'
  base: 'vs-dark' | 'vs'
  ui: {
    bg: string
    sidebar: string
    tabBar: string
    tabActive: string
    border: string
    statusBar: string
    text: string
    accent: string
  }
  editor: {
    bg: string
    fg: string
  }
  tokens: {
    keyword: string
    string: string
    number: string
    comment: string
    function: string
    variable: string
    type: string
  }
}

export const THEMES: StrataTheme[] = [
  // ── Dark ──────────────────────────────────────────────────────────────────
  {
    id: 'one-dark-pro', label: 'One Dark Pro', group: 'dark', base: 'vs-dark',
    ui: { bg: '#282c34', sidebar: '#21252b', tabBar: '#21252b', tabActive: '#282c34', border: '#181a1f', statusBar: '#21252b', text: '#abb2bf', accent: '#61afef' },
    editor: { bg: '#282c34', fg: '#abb2bf' },
    tokens: { keyword: '#c678dd', string: '#98c379', number: '#d19a66', comment: '#5c6370', function: '#61afef', variable: '#e06c75', type: '#e5c07b' },
  },
  {
    id: 'dracula', label: 'Dracula', group: 'dark', base: 'vs-dark',
    ui: { bg: '#282a36', sidebar: '#21222c', tabBar: '#21222c', tabActive: '#282a36', border: '#191a21', statusBar: '#21222c', text: '#f8f8f2', accent: '#bd93f9' },
    editor: { bg: '#282a36', fg: '#f8f8f2' },
    tokens: { keyword: '#ff79c6', string: '#f1fa8c', number: '#bd93f9', comment: '#6272a4', function: '#50fa7b', variable: '#ffb86c', type: '#8be9fd' },
  },
  {
    id: 'nord', label: 'Nord', group: 'dark', base: 'vs-dark',
    ui: { bg: '#2e3440', sidebar: '#272c36', tabBar: '#2e3440', tabActive: '#3b4252', border: '#232730', statusBar: '#272c36', text: '#d8dee9', accent: '#88c0d0' },
    editor: { bg: '#2e3440', fg: '#d8dee9' },
    tokens: { keyword: '#81a1c1', string: '#a3be8c', number: '#b48ead', comment: '#616e88', function: '#88c0d0', variable: '#bf616a', type: '#8fbcbb' },
  },
  {
    id: 'tokyo-night', label: 'Tokyo Night', group: 'dark', base: 'vs-dark',
    ui: { bg: '#1a1b26', sidebar: '#16161e', tabBar: '#16161e', tabActive: '#1a1b26', border: '#13131a', statusBar: '#16161e', text: '#a9b1d6', accent: '#7aa2f7' },
    editor: { bg: '#1a1b26', fg: '#a9b1d6' },
    tokens: { keyword: '#bb9af7', string: '#9ece6a', number: '#ff9e64', comment: '#565f89', function: '#7aa2f7', variable: '#f7768e', type: '#2ac3de' },
  },
  {
    id: 'monokai', label: 'Monokai', group: 'dark', base: 'vs-dark',
    ui: { bg: '#272822', sidebar: '#1e1f1c', tabBar: '#1e1f1c', tabActive: '#272822', border: '#1a1b18', statusBar: '#1e1f1c', text: '#f8f8f2', accent: '#a6e22e' },
    editor: { bg: '#272822', fg: '#f8f8f2' },
    tokens: { keyword: '#f92672', string: '#e6db74', number: '#ae81ff', comment: '#75715e', function: '#a6e22e', variable: '#fd971f', type: '#66d9ef' },
  },
  {
    id: 'solarized-dark', label: 'Solarized Dark', group: 'dark', base: 'vs-dark',
    ui: { bg: '#002b36', sidebar: '#073642', tabBar: '#073642', tabActive: '#002b36', border: '#01313f', statusBar: '#073642', text: '#839496', accent: '#268bd2' },
    editor: { bg: '#002b36', fg: '#839496' },
    tokens: { keyword: '#859900', string: '#2aa198', number: '#d33682', comment: '#586e75', function: '#268bd2', variable: '#cb4b16', type: '#b58900' },
  },
  {
    id: 'catppuccin-mocha', label: 'Catppuccin Mocha', group: 'dark', base: 'vs-dark',
    ui: { bg: '#1e1e2e', sidebar: '#181825', tabBar: '#181825', tabActive: '#1e1e2e', border: '#11111b', statusBar: '#181825', text: '#cdd6f4', accent: '#cba6f7' },
    editor: { bg: '#1e1e2e', fg: '#cdd6f4' },
    tokens: { keyword: '#cba6f7', string: '#a6e3a1', number: '#fab387', comment: '#6c7086', function: '#89b4fa', variable: '#f38ba8', type: '#89dceb' },
  },
  {
    id: 'github-dark', label: 'GitHub Dark', group: 'dark', base: 'vs-dark',
    ui: { bg: '#0d1117', sidebar: '#161b22', tabBar: '#161b22', tabActive: '#0d1117', border: '#21262d', statusBar: '#161b22', text: '#c9d1d9', accent: '#58a6ff' },
    editor: { bg: '#0d1117', fg: '#c9d1d9' },
    tokens: { keyword: '#ff7b72', string: '#a5d6ff', number: '#79c0ff', comment: '#8b949e', function: '#d2a8ff', variable: '#ffa657', type: '#79c0ff' },
  },
  {
    id: 'palenight', label: 'Palenight', group: 'dark', base: 'vs-dark',
    ui: { bg: '#292d3e', sidebar: '#232635', tabBar: '#232635', tabActive: '#292d3e', border: '#1c1f2b', statusBar: '#232635', text: '#a6accd', accent: '#82aaff' },
    editor: { bg: '#292d3e', fg: '#a6accd' },
    tokens: { keyword: '#c792ea', string: '#c3e88d', number: '#f78c6c', comment: '#676e95', function: '#82aaff', variable: '#f07178', type: '#ffcb6b' },
  },
  {
    id: 'ayu-dark', label: 'Ayu Dark', group: 'dark', base: 'vs-dark',
    ui: { bg: '#0f1419', sidebar: '#0d1017', tabBar: '#0d1017', tabActive: '#0f1419', border: '#0a0e14', statusBar: '#0d1017', text: '#e6e1cf', accent: '#ffb454' },
    editor: { bg: '#0f1419', fg: '#e6e1cf' },
    tokens: { keyword: '#ff8f40', string: '#aad94c', number: '#e6b673', comment: '#626a73', function: '#ffb454', variable: '#f07171', type: '#59c2ff' },
  },
  // ── Light ─────────────────────────────────────────────────────────────────
  {
    id: 'github-light', label: 'GitHub Light', group: 'light', base: 'vs',
    ui: { bg: '#ffffff', sidebar: '#f6f8fa', tabBar: '#f6f8fa', tabActive: '#ffffff', border: '#d0d7de', statusBar: '#f6f8fa', text: '#24292f', accent: '#0969da' },
    editor: { bg: '#ffffff', fg: '#24292f' },
    tokens: { keyword: '#cf222e', string: '#0a3069', number: '#0550ae', comment: '#6e7781', function: '#8250df', variable: '#953800', type: '#0550ae' },
  },
  {
    id: 'solarized-light', label: 'Solarized Light', group: 'light', base: 'vs',
    ui: { bg: '#fdf6e3', sidebar: '#eee8d5', tabBar: '#eee8d5', tabActive: '#fdf6e3', border: '#e5dfc8', statusBar: '#eee8d5', text: '#657b83', accent: '#268bd2' },
    editor: { bg: '#fdf6e3', fg: '#657b83' },
    tokens: { keyword: '#859900', string: '#2aa198', number: '#d33682', comment: '#93a1a1', function: '#268bd2', variable: '#cb4b16', type: '#b58900' },
  },
  {
    id: 'one-light', label: 'One Light', group: 'light', base: 'vs',
    ui: { bg: '#fafafa', sidebar: '#f0f0f0', tabBar: '#f0f0f0', tabActive: '#fafafa', border: '#e5e5e5', statusBar: '#f0f0f0', text: '#383a42', accent: '#4078f2' },
    editor: { bg: '#fafafa', fg: '#383a42' },
    tokens: { keyword: '#a626a4', string: '#50a14f', number: '#986801', comment: '#a0a1a7', function: '#4078f2', variable: '#e45649', type: '#0184bb' },
  },
  {
    id: 'catppuccin-latte', label: 'Catppuccin Latte', group: 'light', base: 'vs',
    ui: { bg: '#eff1f5', sidebar: '#e6e9ef', tabBar: '#e6e9ef', tabActive: '#eff1f5', border: '#dce0e8', statusBar: '#e6e9ef', text: '#4c4f69', accent: '#1e66f5' },
    editor: { bg: '#eff1f5', fg: '#4c4f69' },
    tokens: { keyword: '#8839ef', string: '#40a02b', number: '#fe640b', comment: '#9ca0b0', function: '#1e66f5', variable: '#d20f39', type: '#179299' },
  },
  {
    id: 'ayu-light', label: 'Ayu Light', group: 'light', base: 'vs',
    ui: { bg: '#fafafa', sidebar: '#f3f4f5', tabBar: '#f3f4f5', tabActive: '#fafafa', border: '#e7e8e9', statusBar: '#f3f4f5', text: '#5c6773', accent: '#ff9940' },
    editor: { bg: '#fafafa', fg: '#5c6773' },
    tokens: { keyword: '#fa8d3e', string: '#86b300', number: '#a37acc', comment: '#abb0b6', function: '#f2ae49', variable: '#f07171', type: '#55b4d4' },
  },
  {
    id: 'min-light', label: 'Min Light', group: 'light', base: 'vs',
    ui: { bg: '#f8f8f8', sidebar: '#efefef', tabBar: '#efefef', tabActive: '#f8f8f8', border: '#e2e2e2', statusBar: '#efefef', text: '#333333', accent: '#005cc5' },
    editor: { bg: '#f8f8f8', fg: '#333333' },
    tokens: { keyword: '#005cc5', string: '#032f62', number: '#005cc5', comment: '#999988', function: '#6f42c1', variable: '#e36209', type: '#22863a' },
  },
  {
    id: 'quiet-light', label: 'Quiet Light', group: 'light', base: 'vs',
    ui: { bg: '#f5f5f5', sidebar: '#ebebeb', tabBar: '#ebebeb', tabActive: '#f5f5f5', border: '#dedede', statusBar: '#ebebeb', text: '#333333', accent: '#4b83cd' },
    editor: { bg: '#f5f5f5', fg: '#333333' },
    tokens: { keyword: '#4b83cd', string: '#448c27', number: '#ab6526', comment: '#aaaaaa', function: '#aa3731', variable: '#7a3e9d', type: '#4b83cd' },
  },
  {
    id: 'papercolor-light', label: 'Papercolor Light', group: 'light', base: 'vs',
    ui: { bg: '#eeeeee', sidebar: '#e4e4e4', tabBar: '#e4e4e4', tabActive: '#eeeeee', border: '#d8d8d8', statusBar: '#e4e4e4', text: '#444444', accent: '#0087af' },
    editor: { bg: '#eeeeee', fg: '#444444' },
    tokens: { keyword: '#af0000', string: '#008700', number: '#875f00', comment: '#878787', function: '#0087af', variable: '#d75f00', type: '#005f87' },
  },
  {
    id: 'rose-pine-dawn', label: 'Rosé Pine Dawn', group: 'light', base: 'vs',
    ui: { bg: '#faf4ed', sidebar: '#f2e9e1', tabBar: '#f2e9e1', tabActive: '#faf4ed', border: '#dfdad9', statusBar: '#f2e9e1', text: '#575279', accent: '#907aa9' },
    editor: { bg: '#faf4ed', fg: '#575279' },
    tokens: { keyword: '#286983', string: '#56949f', number: '#ea9d34', comment: '#9893a5', function: '#d7827e', variable: '#b4637a', type: '#907aa9' },
  },
  {
    id: 'flexoki-light', label: 'Flexoki Light', group: 'light', base: 'vs',
    ui: { bg: '#fffcf0', sidebar: '#f2f0e5', tabBar: '#f2f0e5', tabActive: '#fffcf0', border: '#e6e4d9', statusBar: '#f2f0e5', text: '#100f0f', accent: '#4385be' },
    editor: { bg: '#fffcf0', fg: '#100f0f' },
    tokens: { keyword: '#8b7ec8', string: '#3aa99f', number: '#df8e1d', comment: '#b7b5ac', function: '#4385be', variable: '#d14d41', type: '#3aa99f' },
  },
]

export const DARK_THEMES = THEMES.filter((t) => t.group === 'dark')
export const LIGHT_THEMES = THEMES.filter((t) => t.group === 'light')

export function getTheme(id: string): StrataTheme {
  return THEMES.find((t) => t.id === id) ?? THEMES[0]
}

export function applyThemeCSSVars(id: string): void {
  const theme = getTheme(id)
  const s = document.documentElement.style
  s.setProperty('--strata-bg', theme.ui.bg)
  s.setProperty('--strata-sidebar', theme.ui.sidebar)
  s.setProperty('--strata-tab-bar', theme.ui.tabBar)
  s.setProperty('--strata-tab-active', theme.ui.tabActive)
  s.setProperty('--strata-border', theme.ui.border)
  s.setProperty('--strata-status-bar', theme.ui.statusBar)
  s.setProperty('--strata-text', theme.ui.text)
  s.setProperty('--strata-accent', theme.ui.accent)
}

export function defineMonacoThemes(monaco: Monaco): void {
  const strip = (c: string) => c.replace('#', '')
  for (const theme of THEMES) {
    monaco.editor.defineTheme(theme.id, {
      base: theme.base,
      inherit: true,
      rules: [
        { token: 'keyword', foreground: strip(theme.tokens.keyword) },
        { token: 'keyword.operator', foreground: strip(theme.tokens.keyword) },
        { token: 'keyword.control', foreground: strip(theme.tokens.keyword) },
        { token: 'storage', foreground: strip(theme.tokens.keyword) },
        { token: 'storage.type', foreground: strip(theme.tokens.keyword) },
        { token: 'string', foreground: strip(theme.tokens.string) },
        { token: 'string.escape', foreground: strip(theme.tokens.string) },
        { token: 'string.template', foreground: strip(theme.tokens.string) },
        { token: 'number', foreground: strip(theme.tokens.number) },
        { token: 'number.hex', foreground: strip(theme.tokens.number) },
        { token: 'number.float', foreground: strip(theme.tokens.number) },
        { token: 'comment', foreground: strip(theme.tokens.comment), fontStyle: 'italic' },
        { token: 'comment.line', foreground: strip(theme.tokens.comment), fontStyle: 'italic' },
        { token: 'comment.block', foreground: strip(theme.tokens.comment), fontStyle: 'italic' },
        { token: 'comment.doc', foreground: strip(theme.tokens.comment), fontStyle: 'italic' },
        { token: 'type', foreground: strip(theme.tokens.type) },
        { token: 'type.identifier', foreground: strip(theme.tokens.type) },
        { token: 'entity.name.type', foreground: strip(theme.tokens.type) },
        { token: 'entity.name.class', foreground: strip(theme.tokens.type) },
        { token: 'entity.name.function', foreground: strip(theme.tokens.function) },
        { token: 'support.function', foreground: strip(theme.tokens.function) },
        { token: 'variable', foreground: strip(theme.tokens.variable) },
        { token: 'variable.parameter', foreground: strip(theme.tokens.variable) },
        { token: 'variable.language', foreground: strip(theme.tokens.variable) },
        { token: 'tag', foreground: strip(theme.tokens.keyword) },
        { token: 'tag.id', foreground: strip(theme.tokens.function) },
        { token: 'tag.class', foreground: strip(theme.tokens.function) },
        { token: 'attribute.name', foreground: strip(theme.tokens.function) },
        { token: 'attribute.value', foreground: strip(theme.tokens.string) },
        { token: 'metatag', foreground: strip(theme.tokens.keyword) },
        { token: 'delimiter', foreground: strip(theme.editor.fg) },
        { token: 'punctuation', foreground: strip(theme.editor.fg) },
      ],
      colors: {
        'editor.background': theme.editor.bg,
        'editor.foreground': theme.editor.fg,
        'editor.lineHighlightBackground': theme.ui.tabActive + '80',
        'editorLineNumber.foreground': theme.tokens.comment,
        'editorLineNumber.activeForeground': theme.ui.text,
        'editorCursor.foreground': theme.ui.accent,
        'editor.selectionBackground': theme.ui.accent + '40',
        'editor.inactiveSelectionBackground': theme.ui.accent + '20',
        'editorWidget.background': theme.ui.sidebar,
        'editorWidget.border': theme.ui.border,
        'editorWidget.foreground': theme.ui.text,
        'editorSuggestWidget.background': theme.ui.sidebar,
        'editorSuggestWidget.border': theme.ui.border,
        'editorSuggestWidget.foreground': theme.ui.text,
        'editorSuggestWidget.selectedBackground': theme.ui.tabActive,
        'editorHoverWidget.background': theme.ui.sidebar,
        'editorHoverWidget.border': theme.ui.border,
        'input.background': theme.ui.bg,
        'input.foreground': theme.ui.text,
        'input.border': theme.ui.border,
        'inputOption.activeBorder': theme.ui.accent,
        'list.hoverBackground': theme.ui.tabActive,
        'list.activeSelectionBackground': theme.ui.accent + '30',
        'list.activeSelectionForeground': theme.ui.text,
        'list.inactiveSelectionBackground': theme.ui.tabActive,
        'scrollbarSlider.background': theme.ui.text + '20',
        'scrollbarSlider.hoverBackground': theme.ui.text + '40',
        'scrollbarSlider.activeBackground': theme.ui.text + '60',
        'minimap.background': theme.editor.bg,
        'minimapSlider.background': theme.ui.text + '20',
        'editorGutter.background': theme.editor.bg,
        'diffEditor.insertedTextBackground': theme.tokens.string + '20',
        'diffEditor.removedTextBackground': theme.tokens.variable + '20',
        'diffEditor.insertedLineBackground': theme.tokens.string + '10',
        'diffEditor.removedLineBackground': theme.tokens.variable + '10',
      },
    })
  }
}
