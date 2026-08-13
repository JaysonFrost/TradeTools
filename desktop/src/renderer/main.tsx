import React from 'react'
import ReactDOM from 'react-dom/client'
import '@fontsource/jetbrains-mono/400.css'
import '@fontsource/jetbrains-mono/500.css'
import '@fontsource/jetbrains-mono/600.css'
import '@fontsource/jetbrains-mono/700.css'
import { App } from './App'
import { RecordingWidget } from './components/recording/RecordingWidget'
import { applyInterfaceTheme, readStoredInterfaceTheme } from './lib/interfaceTheme'
import './styles/globals.css'

const searchParams = new URLSearchParams(window.location.search)
const isRecordingWidget = searchParams.get('window') === 'recording-widget'
if (isRecordingWidget) {
  document.documentElement.dataset.window = 'recording-widget'
}
applyInterfaceTheme(readStoredInterfaceTheme())
const root = isRecordingWidget ? <RecordingWidget /> : <App />

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    {root}
  </React.StrictMode>
)
