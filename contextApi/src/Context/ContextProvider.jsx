import React from 'react'
import userContext from './Context'
import { useState } from 'react'

function ContextProvider({children}) {
    const [user ,setUser] = useState(null)
  return (
    <userContext.Provider value={{user,setUser}}>
    {children}
    </userContext.Provider>
  )
}

export default ContextProvider