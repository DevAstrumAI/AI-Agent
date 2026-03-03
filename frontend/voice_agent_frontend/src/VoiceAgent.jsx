import { useState, useEffect, useRef, useCallback } from 'react'
import { Room, RoomEvent } from 'livekit-client'

// ─────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────

// const BACKEND_URL = 'http://localhost:8000'
const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || 'https://ai-agent-itlm.onrender.com'

// Maps agent state names → stepper step index
const STATE_TO_STEP = {
  collect_service:  0,
  collect_date:     1,
  collect_slot:     2,
  show_slots:       2,
  collect_name:     3,
  collect_email:    4,
  collect_phone:    5,
  confirm_booking:  6,
  booking_done:     7,
}

const STEPS = [
  { label: 'Service', icon: '💊' },
  { label: 'Date',    icon: '📅' },
  { label: 'Time',    icon: '🕐' },
  { label: 'Name',    icon: '👤' },
  { label: 'Email',   icon: '📧' },
  { label: 'Phone',   icon: '📞' },
  { label: 'Confirm', icon: '✅' },
  { label: 'Done',    icon: '🎉' },
]

// ─────────────────────────────────────────────────────────────
// Helper: check Web Speech API availability
// ─────────────────────────────────────────────────────────────

const isSpeechRecognitionSupported = () =>
  'SpeechRecognition' in window || 'webkitSpeechRecognition' in window

const SpeechRecognitionAPI =
  window.SpeechRecognition || window.webkitSpeechRecognition


// ─────────────────────────────────────────────────────────────
// Main Component
// ─────────────────────────────────────────────────────────────

export default function VoiceAgent() {

  // ── Connection state ───────────────────────────────────────
  const [connectionStatus, setConnectionStatus] = useState('offline')
  // 'offline' | 'connecting' | 'online'

  // ── Voice state ────────────────────────────────────────────
  const [listening, setListening]           = useState(false)
  const [isAgentSpeaking, setIsAgentSpeaking] = useState(false)
  const [transcript, setTranscript]         = useState('')

  // ── Conversation ───────────────────────────────────────────
  const [messages, setMessages]   = useState([])
  const [agentState, setAgentState] = useState('idle')
  const [language, setLanguage]   = useState('en')
  // language used for STT lang attr and TTS lang attr

  // ── Error ──────────────────────────────────────────────────
  const [error, setError] = useState('')

  // ── Refs (survive re-renders, no re-render on change) ──────
  const roomRef            = useRef(null)
  const recognitionRef     = useRef(null)
  const synthRef           = useRef(window.speechSynthesis)
  const messagesEndRef     = useRef(null)
  const isAgentSpeakingRef = useRef(false)   // used inside callbacks

  // ─────────────────────────────────────────────────────────
  // Auto-scroll chat to bottom whenever messages change
  // ─────────────────────────────────────────────────────────
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  // ─────────────────────────────────────────────────────────
  // Cleanup on unmount
  // ─────────────────────────────────────────────────────────
  useEffect(() => {
    return () => {
      synthRef.current.cancel()
      recognitionRef.current?.abort()
      roomRef.current?.disconnect()
    }
  }, [])

  // ─────────────────────────────────────────────────────────
  // Add a message to the chat log
  // ─────────────────────────────────────────────────────────
  const addMessage = useCallback((role, text) => {
    setMessages(prev => [...prev, { role, text, id: Date.now() + Math.random() }])
  }, [])

  // ─────────────────────────────────────────────────────────
  // Detect language from agent response text
  // ─────────────────────────────────────────────────────────
  const detectLanguage = useCallback((text) => {
    const germanWords = ['ich','bitte','danke','möchte','termin',
                         'ja','nein','willkommen','können','datum']
    const lower = text.toLowerCase()
    const score = germanWords.filter(w => lower.includes(w)).length
    return score >= 2 ? 'de' : 'en'
  }, [])

  // ─────────────────────────────────────────────────────────
  // TTS — speak agent response text
  // ─────────────────────────────────────────────────────────
  const speak = useCallback((text) => {
    if (!text) return

    // Cancel any ongoing speech first
    synthRef.current.cancel()

    const utterance  = new SpeechSynthesisUtterance(text)
    const detectedLang = detectLanguage(text)
    setLanguage(detectedLang)
    utterance.lang  = detectedLang === 'de' ? 'de-DE' : 'en-US'
    utterance.rate  = 0.93
    utterance.pitch = 1.0

    // Try to pick a good voice
    const voices = synthRef.current.getVoices()
    const preferredVoice = voices.find(v =>
      v.lang.startsWith(detectedLang === 'de' ? 'de' : 'en') && v.localService
    ) || voices.find(v =>
      v.lang.startsWith(detectedLang === 'de' ? 'de' : 'en')
    )
    if (preferredVoice) utterance.voice = preferredVoice

    utterance.onstart = () => {
      setIsAgentSpeaking(true)
      isAgentSpeakingRef.current = true
      setListening(false)
      setTranscript('')
    }

    utterance.onend = () => {
      setIsAgentSpeaking(false)
      isAgentSpeakingRef.current = false
      // Auto-start listening after agent finishes speaking
      // Small delay so user hears agent fully
      setTimeout(() => {
        if (roomRef.current) startListening()
      }, 400)
    }

    utterance.onerror = (e) => {
      console.warn('TTS error:', e)
      setIsAgentSpeaking(false)
      isAgentSpeakingRef.current = false
    }

    synthRef.current.speak(utterance)
  }, [detectLanguage])

  // ─────────────────────────────────────────────────────────
  // Send text to agent via LiveKit DataChannel
  // ─────────────────────────────────────────────────────────
  const sendToAgent = useCallback(async (text) => {
    if (!roomRef.current || !text.trim()) return

    addMessage('user', text)
    setTranscript('')

    const payload = JSON.stringify({ type: 'user_message', text })
    await roomRef.current.localParticipant.publishData(
      new TextEncoder().encode(payload),
      { reliable: true }
    )
    console.log('→ Sent to agent:', text)
  }, [addMessage])

  // ─────────────────────────────────────────────────────────
  // STT — start listening with Web Speech API
  // ─────────────────────────────────────────────────────────
  const startListening = useCallback(() => {
    // Don't start if agent is speaking or already listening
    if (isAgentSpeakingRef.current) return
    if (!isSpeechRecognitionSupported()) return
    if (!roomRef.current) return

    // Abort any existing recognition session
    if (recognitionRef.current) {
      try { recognitionRef.current.abort() } catch (_) {}
    }

    const recognition = new SpeechRecognitionAPI()
    recognition.lang           = language === 'de' ? 'de-DE' : 'en-US'
    recognition.interimResults = true   // Show partial results live
    recognition.continuous     = false  // Stop after one utterance
    recognition.maxAlternatives = 1

    recognition.onstart = () => {
      setListening(true)
      setTranscript('Listening...')
    }

    recognition.onresult = (event) => {
      let interimText = ''
      let finalText   = ''

      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i]
        if (result.isFinal) {
          finalText += result[0].transcript
        } else {
          interimText += result[0].transcript
        }
      }

      // Show interim results live in the transcript preview
      if (interimText) setTranscript(interimText)

      // When final result arrives, send to agent
      if (finalText.trim()) {
        setTranscript(finalText)
        setListening(false)
        sendToAgent(finalText.trim())
      }
    }

    recognition.onend = () => {
      setListening(false)
    }

    recognition.onerror = (event) => {
      setListening(false)
      if (event.error === 'no-speech') {
        setTranscript('')
        return
      }
      if (event.error === 'not-allowed') {
        setError('Microphone permission denied. Please allow microphone access.')
        return
      }
      console.warn('STT error:', event.error)
    }

    recognitionRef.current = recognition
    try {
      recognition.start()
    } catch (err) {
      console.warn('Could not start recognition:', err)
    }
  }, [language, sendToAgent])

  // ─────────────────────────────────────────────────────────
  // Connect to LiveKit room
  // ─────────────────────────────────────────────────────────
  const connect = useCallback(async () => {
    if (!isSpeechRecognitionSupported()) {
      setError('Your browser does not support Speech Recognition. Please use Chrome or Edge.')
      return
    }

    setConnectionStatus('connecting')
    setError('')

    try {
      // 1. Get token from FastAPI backend
      const res = await fetch(
        `${BACKEND_URL}/livekit/token?room=room-1&username=patient-${Date.now()}`
      )
      if (!res.ok) throw new Error(`Token fetch failed: ${res.status}`)
      const { token, url } = await res.json()

      // 2. Create LiveKit room
      const room = new Room({
        adaptiveStream: false,
        dynacast:       false,
      })
      roomRef.current = room

      // 3. Listen for DataChannel messages from agent
      room.on(RoomEvent.DataReceived, (payload, participant) => {
        try {
          const msg = JSON.parse(new TextDecoder().decode(payload))
          console.log('← Received from agent:', msg)

          if (msg.type === 'agent_response') {
            // Update booking step indicator
            if (msg.state) setAgentState(msg.state)

            // Add to chat log
            addMessage('agent', msg.text)

            // Speak the response
            speak(msg.text)
          }
        } catch (e) {
          console.warn('Could not parse agent message:', e)
        }
      })

      // 4. Handle disconnection
      room.on(RoomEvent.Disconnected, () => {
        setConnectionStatus('offline')
        setListening(false)
        setIsAgentSpeaking(false)
        synthRef.current.cancel()
        roomRef.current = null
      })

      // 5. Connect to LiveKit server
      await room.connect(url, token)
      setConnectionStatus('online')
      console.log('✅ Connected to LiveKit room')

      // 6. Give voices time to load, then start listening
      // The agent sends a welcome message on connect — wait for it
      setTimeout(() => {
        if (synthRef.current.getVoices().length === 0) {
          synthRef.current.onvoiceschanged = () => {
            console.log('Voices loaded:', synthRef.current.getVoices().length)
          }
        }
      }, 500)

    } catch (err) {
      console.error('Connection error:', err)
      setError(`Could not connect: ${err.message}`)
      setConnectionStatus('offline')
      roomRef.current = null
    }
  }, [addMessage, speak])

  // ─────────────────────────────────────────────────────────
  // Disconnect from LiveKit room
  // ─────────────────────────────────────────────────────────
  const disconnect = useCallback(async () => {
    synthRef.current.cancel()
    if (recognitionRef.current) {
      try { recognitionRef.current.abort() } catch (_) {}
    }
    if (roomRef.current) {
      await roomRef.current.disconnect()
      roomRef.current = null
    }
    setConnectionStatus('offline')
    setListening(false)
    setIsAgentSpeaking(false)
    setTranscript('')
    setAgentState('idle')
  }, [])

  // ─────────────────────────────────────────────────────────
  // Manual mic button click (when auto-start doesn't trigger)
  // ─────────────────────────────────────────────────────────
  const handleMicClick = useCallback(() => {
    if (listening) {
      recognitionRef.current?.stop()
      setListening(false)
    } else if (!isAgentSpeaking) {
      startListening()
    }
  }, [listening, isAgentSpeaking, startListening])

  // ─────────────────────────────────────────────────────────
  // Derive current booking step from agent state
  // ─────────────────────────────────────────────────────────
  const currentStep = STATE_TO_STEP[agentState] ?? -1

  // ─────────────────────────────────────────────────────────
  // Status badge content
  // ─────────────────────────────────────────────────────────
  const statusLabels = {
    offline:    'Disconnected',
    connecting: 'Connecting...',
    online:     'Connected',
  }

  // ─────────────────────────────────────────────────────────
  // Mic button content
  // ─────────────────────────────────────────────────────────
  const micButtonState = isAgentSpeaking ? 'speaking'
                       : listening       ? 'listening'
                       : 'idle'

  const micButtonIcon  = isAgentSpeaking ? '🔊'
                       : listening       ? '🎙️'
                       : '🎤'

  const micStatusText  = isAgentSpeaking ? 'Agent is speaking...'
                       : listening       ? 'Listening — speak now'
                       : connectionStatus === 'online'
                         ? 'Tap mic to speak'
                         : 'Not connected'

  // ─────────────────────────────────────────────────────────
  // Render
  // ─────────────────────────────────────────────────────────
  return (
    <div className="app-wrapper">

      {/* ── Header ── */}
      <header className="header">
        <div className="header-left">
          <span className="header-logo">🏥</span>
          <div className="header-title">
            <h1>Functiomed</h1>
            <p>Voice Appointment Assistant</p>
          </div>
        </div>
        <div className={`status-badge ${connectionStatus}`}>
          <span className={`status-dot ${connectionStatus === 'connecting' ? 'pulse' : ''}`} />
          {statusLabels[connectionStatus]}
        </div>
      </header>

      {/* ── Browser compatibility warning ── */}
      {!isSpeechRecognitionSupported() && (
        <div className="browser-warning">
          ⚠️ Speech Recognition requires Chrome or Edge. Other browsers are not supported.
        </div>
      )}

      {/* ── Error banner ── */}
      {error && (
        <div className="error-banner">
          ❌ {error}
        </div>
      )}

      {/* ── Booking Progress Stepper ── */}
      {connectionStatus === 'online' && currentStep >= 0 && (
        <div className="stepper-card">
          <h3>Booking Progress</h3>
          <div className="stepper">
            {STEPS.map((step, idx) => {
              const stepClass = idx < currentStep  ? 'done'
                              : idx === currentStep ? 'active'
                              : 'upcoming'
              return (
                <div key={step.label} className={`step ${stepClass}`}>
                  <div className="step-circle">
                    {idx < currentStep ? '✓' : step.icon}
                  </div>
                  <span className="step-label">{step.label}</span>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* ── Chat Messages ── */}
      <div className="messages-card">
        {messages.length === 0 ? (
          <div className="empty-chat">
            <div className="empty-icon">💬</div>
            <p>
              {connectionStatus === 'online'
                ? 'Waiting for the agent to greet you...'
                : 'Start a call to talk to the assistant.'}
            </p>
          </div>
        ) : (
          messages.map(msg => (
            <div key={msg.id} className={`message ${msg.role}`}>
              <div className="message-avatar">
                {msg.role === 'agent' ? '🤖' : '👤'}
              </div>
              <div className="message-bubble">
                {msg.text}
              </div>
            </div>
          ))
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* ── Live transcript preview ── */}
      {connectionStatus === 'online' && (
        <div className="transcript-preview">
          <span className="mic-icon">{listening ? '🎙️' : '💬'}</span>
          <span>
            {transcript || (isAgentSpeaking ? 'Agent is responding...' : 'Tap the mic button to speak')}
          </span>
        </div>
      )}

      {/* ── Controls ── */}
      <div className="controls-card">
        {connectionStatus !== 'online' ? (
          /* ── Connect button ── */
          <div className="btn-row">
            <button
              className="btn-connect"
              onClick={connect}
              disabled={connectionStatus === 'connecting'}
            >
              {connectionStatus === 'connecting' ? '⏳ Connecting...' : '📞 Start Call'}
            </button>
          </div>
        ) : (
          /* ── Online controls ── */
          <>
            {/* Big microphone button */}
            <button
              className={`btn-mic-main ${micButtonState}`}
              onClick={handleMicClick}
              disabled={isAgentSpeaking}
              title={micStatusText}
            >
              {micButtonIcon}
            </button>

            <p className={`mic-status-text ${micButtonState}`}>
              {micStatusText}
            </p>

            {/* Disconnect button */}
            <div className="btn-row">
              <button className="btn-disconnect" onClick={disconnect}>
                📵 End Call
              </button>
            </div>
          </>
        )}
      </div>

    </div>
  )
}