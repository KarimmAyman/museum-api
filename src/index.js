import express from 'express'
import 'dotenv/config'
import cors from 'cors'
import museumsRouter from './museums.routes.js'
import floorsRouter from './floor.routes.js'
import journeysRouter from './journeys.routes.js'

const app = express()

// ========================
// Middlewares
// ========================
app.use(cors())
app.use(express.json())
app.use(express.urlencoded({ extended: true }))

// ========================
// Health check route
// ========================
app.get('/', (req, res) => {
    res.json({
        status: 'ok',
        message: 'Museum API is running',
        version: '2.0.0',
        endpoints: {
            museums: '/museums',
            floors: '/floors/:floorId',
            journeys: '/journeys'
        }
    })
})

// ========================
// Routes
// ========================
app.use('/museums', museumsRouter)   // museums + nested floors
app.use('/floors', floorsRouter)     // standalone floor + rooms/walls/anchors/stairs/pois
app.use('/journeys', journeysRouter) // journeys + route-points

// ========================
// Handle 404 routes
// ========================
app.use((req, res) => {
    res.status(404).json({ error: 'Route not found' })
})

// ========================
// Global error handler
// ========================
app.use((err, req, res, next) => {
    console.error('🔥 Server Error:', err)

    if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({ error: 'File too large. Max size is 10MB.' })
    }

    if (err.message === 'Only image files are allowed') {
        return res.status(400).json({ error: err.message })
    }

    res.status(500).json({ error: 'Internal server error' })
})

// ========================
// Start server
// ========================
const PORT = process.env.PORT || 3000

app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`)
})