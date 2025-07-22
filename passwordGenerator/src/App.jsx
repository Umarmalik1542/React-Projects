import React from 'react'
import { useState, useCallback,useEffect, useRef } from 'react';

export default function App() {
  const [lengthOfPass,setLengthOfPass] = useState(8)
  const [numbersAllow,setNumbersAllow] = useState(false)
  const [charactersAllow,setCharactersAllow] = useState(false)
  const [password,setPassword] = useState("")

  const passwordGenrator = useCallback(() =>{
    let str = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'
    let pass = ''

    if (numbersAllow) str += '123456789'
    if (charactersAllow) str += '`~!@#$%^&*(){}[]/?'

    for (let i = 1; i <= lengthOfPass; i++) {
      let char =Math.floor(Math.random() * str.length)
      pass += str.charAt(char)
      
    }
    
    setPassword(pass)

  },[lengthOfPass,numbersAllow,charactersAllow,password])

  useEffect(() =>{
    passwordGenrator()
  },[lengthOfPass,numbersAllow,charactersAllow,setPassword])

  const passwordRef = useRef(null)
  const copyclipboardpass = useCallback(() => {
    passwordRef.current?.select();
    window.navigator.clipboard.writeText(password)
  }, [password])

  return (
    <>
    <div className="w-full height: 200px; max-w-md mx-auto shadow-md rounded-lg px-4 py-3 my-8 bg-gray-600 text-orange-500">
      <h1 className='text-white text-center my-3'>Password generator</h1>
    <div className="flex bg-white shadow rounded-lg overflow-hidden mb-4">
        <input
            type="text"
            value={password}
            className="outline-none w-full py-1 px-3"
            placeholder="Password"
            readOnly
            ref={passwordRef}
            
        />
        <button
        onClick={copyclipboardpass}
        className='outline-none bg-blue-700 text-white px-3 py-0.5 shrink-0 cursor-pointer'
        >copy</button>
        
    </div>
    <div className='flex text-sm gap-x-2'>
      <div className='flex items-center gap-x-1'>
        <input 
        type="range"
        min={6}
        max={16}
        value={lengthOfPass}
         className='cursor-pointer'
         onChange={(e) => {setLengthOfPass(e.target.value)}}
          />
          <label>Length: {lengthOfPass}</label>
      </div>
      <div className="flex items-center gap-x-1">
      <input
          className='cursor-pointer'
          type="checkbox"
          defaultChecked={numbersAllow}
          id="numberInput"
          onChange={() => {
              setNumbersAllow((prev) => !prev);
          }}
      />
      <label htmlFor="numberInput">Numbers</label>
      </div>
      <div className="flex items-center gap-x-1">
          <input         
              className='cursor-pointer'
              type="checkbox"
              defaultChecked={charactersAllow}
              id="characterInput"
              onChange={() => {
                  setCharactersAllow((prev) => !prev )
              }}
          />
          <label htmlFor="characterInput">Characters</label>
      </div>
    </div>
</div>
    </>
  );
}
