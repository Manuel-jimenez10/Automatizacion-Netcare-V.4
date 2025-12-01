import { Route, Routes } from 'react-router'
import './App.css'
import { Navbar } from './components/navBar'
import Home from './components/Home'

function App() {

  return (
    <>
    <Navbar />
      <Routes>
        <Route path='/' element={<Home/>} />
      </Routes>
    </>
  )
}

export default App
