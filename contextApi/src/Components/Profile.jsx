import React, { useContext } from 'react'
import userContext from '../Context/Context'

function Profile() {
    const {user} = useContext(userContext)
   
    if (!user) return <div>Please login to view your Profile</div>
    return <div>welcome {user.username}</div>
}

export default Profile