import express from 'express'
import 'dotenv/config'
import cors from 'cors'
import museumsRouter from './museums.routes.js'
import storiesRouter from './Stories.routes.js'
import importMapRouter from './import.map.routes.js'

const app = express()

// ========================
// Middlewares
// ========================
app.use(cors())
app.use(express.json({ limit: '50mb' }))        // large map JSONs
app.use(express.urlencoded({ extended: true, limit: '50mb' }))

// ========================
// Health check
// ========================
app.get('/', (req, res) => {
    res.json({
        status: 'ok',
        message: 'Goia Museum API is running',
        version: '3.0.0',
        endpoints: {
            museums: '/museums',
            floors: '/museums/:id/floors',
            stories: '/museums/:museumId/floors/:floorId/stories',
            recal: '/museums/:museumId/floors/:floorId/stories/:storyId/recalibration-points',
            importMap: '/import-map'
        }
    })
})

// ========================
// Routes
// ========================
app.use('/museums', museumsRouter)

// Stories + recalibration points nested under floors
// /museums/:museumId/floors/:floorId/stories/...
app.use('/museums/:museumId/floors/:floorId/stories', storiesRouter)

// Import map JSON script
app.use('/import-map', importMapRouter)

// ========================
// 404 handler
// ========================
app.use((req, res) => {
    res.status(404).json({ error: 'Route not found' })
})

// ========================
// Global error handler
// ========================
app.use((err, req, res, next) => {
    console.error('Server Error:', err)
    if (err.code === 'LIMIT_FILE_SIZE')
        return res.status(400).json({ error: 'File too large. Max size is 10MB.' })
    if (err.message === 'Only image files are allowed')
        return res.status(400).json({ error: err.message })
    res.status(500).json({ error: 'Internal server error' })
})

// ========================
// Start server
// ========================
const PORT = process.env.PORT || 3000
app.listen(PORT, () => {
    console.log(`Goia API v3.0.0 running on port ${PORT}`)
})