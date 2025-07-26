import { useLoaderData } from 'react-router'
import React from 'react'
function Github() {
    const githubData = useLoaderData()
  return (
    <div className='text-center m-4 bg-gray-600 text-white p-4 text-3xl'>Github Followers:{githubData.followers}
    <img src={githubData.avatar_url} alt="Git picture" />
    </div>
  )
}



export default Github

export const githubInfoLoader = async () =>{
    const res  = await fetch('https://api.github.com/users/Umarmalik1542')
    return res.json()
}