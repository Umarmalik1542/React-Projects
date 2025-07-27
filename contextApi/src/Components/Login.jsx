import React, { useState, useContext } from 'react'
import userContext from '../Context/Context'

function Login() {
  const [username, setUserName] = useState('')
  const [password, setPassword] = useState('')
  const { setUser } = useContext(userContext)

  const handlersubmit = (e) => {
    e.preventDefault()
    if (!username || !password) {
      alert('Please fill in all fields!')
      return
    }
    setUser({ username, password })
  }

  const formStyle = {
    width: '300px',
    margin: '50px auto',
    padding: '20px',
    border: '1px solid #ccc',
    borderRadius: '8px',
    backgroundColor: '#f9f9f9',
    textAlign: 'center',
    boxShadow: '0px 2px 6px rgba(0,0,0,0.1)'
  }

  const inputStyle = {
    width: '90%',
    padding: '10px',
    margin: '8px 0',
    border: '1px solid #aaa',
    borderRadius: '4px'
  }

  const buttonStyle = {
    width: '100%',
    padding: '10px',
    marginTop: '10px',
    backgroundColor: '#4CAF50',
    color: 'white',
    border: 'none',
    borderRadius: '4px',
    cursor: 'pointer'
  }

  return (
    <form style={formStyle} onSubmit={handlersubmit}>
      <h2>Login</h2>
      <input
        style={inputStyle}
        placeholder="Username"
        type="text"
        value={username}
        onChange={(e) => setUserName(e.target.value)}
        required
      />
      <input
        style={inputStyle}
        placeholder="Password"
        type="password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        required
      />
      <button style={buttonStyle} type="submit">
        Submit
      </button>
    </form>
  )
}

export default Login
