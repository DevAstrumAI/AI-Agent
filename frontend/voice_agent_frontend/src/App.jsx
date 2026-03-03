
import VoiceAgent from './VoiceAgent'
import Admin from './Admin'

export default function App() {
  const isAdmin = window.location.pathname === '/admin'
  return isAdmin ? <Admin /> : <VoiceAgent />
}