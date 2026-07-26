import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import './index.css'

// NOTE: StrictMode removed — it double-fires useEffect in dev causing
// duplicate API requests which hit Catalyst's 429 rate limit.
ReactDOM.createRoot(document.getElementById('root')).render(
  <App />
)