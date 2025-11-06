import { useState, useEffect } from 'react'
import { signIn, signUp, signOut, getCurrentUser } from './services/authService'
import './App.css'

function App() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [user, setUser] = useState(getCurrentUser())
  const [error, setError] = useState('')
  const [status, setStatus] = useState('Checking connection...')

  useEffect(() => {
    // Check PocketBase connection
    fetch(import.meta.env.VITE_POCKETBASE_URL + '/api/health')
      .then(() => setStatus('✅ Connected to PocketBase'))
      .catch(() => setStatus('❌ Cannot connect to PocketBase'))
  }, [])

  const handleSignIn = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    try {
      const result = await signIn(email, password)
      setUser(result.user)
      alert(`Signed in as ${result.role}`)
    } catch (err: any) {
      setError(err.message)
    }
  }

  const handleSignUp = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    try {
      await signUp(email, password, password, 'manager')
      alert('Account created! Please sign in.')
    } catch (err: any) {
      setError(err.message)
    }
  }

  const handleSignOut = () => {
    signOut()
    setUser(null)
  }

  return (
    <div className="App">
      <h1>Dealer AI Sales Coach</h1>
      <p>{status}</p>
      <p>PocketBase URL: {import.meta.env.VITE_POCKETBASE_URL}</p>

      {user ? (
        <div>
          <h2>Logged in as: {user.email}</h2>
          <p>Role: {user.role}</p>
          <button onClick={handleSignOut}>Sign Out</button>
        </div>
      ) : (
        <div>
          <h2>Sign In / Sign Up</h2>
          <form>
            <input
              type="email"
              placeholder="Email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
            <input
              type="password"
              placeholder="Password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            <button onClick={handleSignIn}>Sign In</button>
            <button onClick={handleSignUp}>Sign Up (Manager)</button>
          </form>
          {error && <p style={{ color: 'red' }}>{error}</p>}
        </div>
      )}
    </div>
  )
}

export default App
