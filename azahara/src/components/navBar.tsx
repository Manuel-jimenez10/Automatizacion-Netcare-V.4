import { useNavigate } from "react-router"

export const Navbar = () => { 
      const navigate = useNavigate();

    return (
        <nav>
            <ul className="">
                <li className="hover:text-red-500 font-bold" onClick={()=>navigate('/home')}>home</li>
                </ul> </nav>
    )
 }