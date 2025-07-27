import { useState } from 'react'
import React from 'react'
import './App.css'
import Login from './Components/Login'
import Profile from './Components/Profile'
import UserContextProvider from './Context/ContextProvider'

function App() {


  return (
    <UserContextProvider>
     <p>context api</p>
     <Login/>
     <Profile/>
    </UserContextProvider>
  )
}

export default App
