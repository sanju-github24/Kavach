import { useState, useRef, useEffect } from 'react'
import { synthesizeSpeech } from '../../api.js'
import { IconSpeaker, IconSpeakerOff } from './Icons'

// Voice playback powered by Catalyst Zia TTS instead of the browser's Web
// Speech API. That matters for Kannada: browser voices for kn-IN are absent on
// most desktops, so field officers would silently get nothing. The synthesised
// audio is cached per instance so replaying costs no extra call.
export default function SpeakButton({ text, label = 'Listen', className = '' }) {
  const [state, setState] = useState({ busy: false, playing: false, err: null })
  const audioRef = useRef(null)
  const cacheRef = useRef(null)

  useEffect(() => () => { audioRef.current?.pause(); audioRef.current = null }, [])
  // A different message means the cached audio no longer matches the text.
  useEffect(() => { cacheRef.current = null }, [text])

  const stop = () => {
    audioRef.current?.pause()
    if (audioRef.current) audioRef.current.currentTime = 0
    setState(s => ({ ...s, playing: false }))
  }

  const play = (src) => {
    const a = new Audio(src)
    audioRef.current = a
    a.onended = () => setState(s => ({ ...s, playing: false }))
    a.onerror = () => setState({ busy: false, playing: false, err: 'Could not play the audio.' })
    a.play().then(() => setState(s => ({ ...s, playing: true })))
      .catch(() => setState({ busy: false, playing: false, err: 'Playback was blocked by the browser.' }))
  }

  const onClick = async () => {
    if (state.playing) { stop(); return }
    if (cacheRef.current) { play(cacheRef.current); return }
    setState({ busy: true, playing: false, err: null })
    try {
      const r = await synthesizeSpeech(text)
      if (r?.audio) {
        const src = `data:${r.mime || 'audio/wav'};base64,${r.audio}`
        cacheRef.current = src
        setState({ busy: false, playing: false, err: null })
        play(src)
      } else {
        setState({ busy: false, playing: false, err: 'Voice is unavailable right now.' })
      }
    } catch {
      setState({ busy: false, playing: false, err: 'Voice request failed.' })
    }
  }

  if (!text || !String(text).trim()) return null

  return (
    <span className={className}>
      <button onClick={onClick} disabled={state.busy}
        title={state.playing ? 'Stop' : 'Listen — Catalyst Zia voice'}
        className={`text-[10px] flex items-center gap-1.5 transition disabled:opacity-50 ${
          state.playing ? 'text-accent' : 'text-ink-faint hover:text-accent'}`}>
        {state.playing ? <IconSpeakerOff /> : <IconSpeaker />}
        {state.busy ? 'Generating voice…' : state.playing ? 'Stop' : label}
      </button>
      {state.err && <span className="text-[10px] text-risk-high ml-2">{state.err}</span>}
    </span>
  )
}
