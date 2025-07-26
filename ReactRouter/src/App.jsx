import React from 'react'
import './App.css'
import Header from './Components/Header/Header'
import Footer from './Components/Footer/Footer'
import { Outlet } from 'react-router'
function App() {
  return (
    <>
    <Header/>
    <Outlet/>     
    <Footer/>
    </>
  )
}

export default App