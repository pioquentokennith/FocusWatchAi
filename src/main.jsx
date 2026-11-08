import React from 'react'
import ReactDOM from 'react-dom/client'
import AuthGate from './components/AuthGate.jsx'
import TeamWorkspace from './components/TeamWorkspace.jsx'
import './styles.css'
import './team.css'

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <AuthGate>{({ profile, signOut }) => <TeamWorkspace key={profile.id} profile={profile} signOut={signOut} />}</AuthGate>
  </React.StrictMode>,
)
