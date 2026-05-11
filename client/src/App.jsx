import { BrowserRouter, Routes, Route } from 'react-router-dom'
import PoseApp from './components/PoseApp'

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<PoseApp />} />
        <Route path="/yolo/" element={<PoseApp />} />
      </Routes>
    </BrowserRouter>
  )
}

export default App
